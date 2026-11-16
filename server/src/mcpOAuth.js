const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mcpAuthRouter, createOAuthMetadata } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { InvalidRequestError, InvalidScopeError, AccessDeniedError, InvalidGrantError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const READ_SCOPE = 'bhodix:read';
const WRITE_SCOPE = 'bhodix:task.write';
const ACCESS_MS = 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function readCookie(req, name) {
  const part = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}

function createMcpOAuth({ auth, storeFile, issuerUrl, resourceUrl }) {
  // shortcut: OAuth clients and grants are file-backed, move them to shared storage before running multiple server replicas.
  let store = { clients: [], pending: [], codes: [], accessTokens: [], refreshTokens: [], grants: [] };
  try {
    store = { ...store, ...JSON.parse(fs.readFileSync(storeFile, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const save = () => {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    const temp = `${storeFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(store)}\n`, { mode: 0o600 });
    fs.renameSync(temp, storeFile);
  };
  const live = (items) => items.filter((item) => item.expiresAt > Date.now());

  const clientsStore = {
    getClient: (clientId) => store.clients.find((client) => client.client_id === clientId),
    registerClient: (client) => { store.clients.push(client); save(); return client; }
  };

  const provider = {
    clientsStore,
    authorize: async (client, params, res) => {
      const requestedScopes = params.scopes?.length ? params.scopes : [READ_SCOPE];
      if (requestedScopes.some((scope) => ![READ_SCOPE, WRITE_SCOPE, 'offline_access'].includes(scope))) throw new InvalidScopeError('This connector does not support the requested scope.');
      const scopes = [...new Set([...requestedScopes, READ_SCOPE])];
      if (params.resource && params.resource.href !== resourceUrl.href) throw new InvalidRequestError('Invalid resource for this connector.');
      const flowId = randomToken();
      const csrf = randomToken();
      store.pending = live(store.pending);
      store.pending.push({ flowId, csrfHash: sha256(csrf), clientId: client.client_id, clientName: client.client_name || 'AI assistant', redirectUri: params.redirectUri, state: params.state || '', codeChallenge: params.codeChallenge, resource: resourceUrl.href, scopes, expiresAt: Date.now() + 10 * 60 * 1000 });
      save();
      res.cookie('bhodix_mcp_csrf', csrf, { httpOnly: true, sameSite: 'lax', secure: issuerUrl.protocol === 'https:', maxAge: 10 * 60 * 1000, path: '/oauth/consent' });
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(`<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect AI to Bhodhix</title><main style="font:16px system-ui;max-width:420px;margin:10vh auto;padding:24px"><h1>Connect ${escapeHtml(client.client_name || 'AI assistant')}</h1><p>Sign in to choose the Bhodhix workspace this assistant can read. Your password is sent only to this Bhodhix server.</p><form method="post" action="/oauth/consent"><input type="hidden" name="flowId" value="${flowId}"><input type="hidden" name="csrf" value="${csrf}"><label>Workspace<input name="workspace" required autocomplete="organization" style="display:block;width:100%;padding:10px;margin:6px 0 14px"></label><label>Email<input type="email" name="email" required autocomplete="username" style="display:block;width:100%;padding:10px;margin:6px 0 14px"></label><label>Password<input type="password" name="password" required autocomplete="current-password" style="display:block;width:100%;padding:10px;margin:6px 0 20px"></label><button style="padding:10px 16px">Continue</button></form></main>`);
    },
    challengeForAuthorizationCode: async (_client, code) => {
      const record = store.codes.find((item) => item.codeHash === sha256(code) && item.expiresAt > Date.now());
      if (!record) throw new InvalidGrantError('Authorization code is invalid or expired.');
      return record.codeChallenge;
    },
    exchangeAuthorizationCode: async (client, code, _verifier, redirectUri, resource) => {
      const index = store.codes.findIndex((item) => item.codeHash === sha256(code) && item.expiresAt > Date.now());
      const record = store.codes[index];
      if (!record || record.clientId !== client.client_id || record.redirectUri !== redirectUri || (resource && resource.href !== record.resource)) throw new InvalidGrantError('Authorization code is invalid, expired, or belongs to another client.');
      store.codes.splice(index, 1);
      const grant = { id: randomToken(), userId: record.userId, membershipId: record.membershipId, organizationId: record.organizationId, clientId: record.clientId, scopes: record.scopes, createdAt: new Date().toISOString(), revokedAt: '' };
      store.grants.push(grant);
      return issueTokens({ grant, scopes: record.scopes, resource: record.resource });
    },
    exchangeRefreshToken: async (client, refreshToken, scopes, resource) => {
      const index = store.refreshTokens.findIndex((item) => item.tokenHash === sha256(refreshToken) && item.expiresAt > Date.now());
      const record = store.refreshTokens[index];
      const grant = record && store.grants.find((item) => item.id === record.grantId && !item.revokedAt);
      if (!record || !grant || record.clientId !== client.client_id || (resource && resource.href !== record.resource) || !auth.getMcpIdentity(grant.userId, grant.membershipId, grant.organizationId)) throw new InvalidGrantError('Refresh token is invalid or expired.');
      if (scopes?.some((scope) => !record.scopes.includes(scope))) throw new InvalidScopeError('The requested scope exceeds the original grant.');
      store.refreshTokens.splice(index, 1);
      return issueTokens({ grant, scopes: scopes?.length ? scopes : record.scopes, resource: record.resource });
    },
    verifyAccessToken: async (token) => {
      const record = store.accessTokens.find((item) => item.tokenHash === sha256(token) && item.expiresAt > Date.now());
      const grant = record && store.grants.find((item) => item.id === record.grantId && !item.revokedAt);
      if (!record || !grant || !auth.getMcpIdentity(grant.userId, grant.membershipId, grant.organizationId)) throw new Error('Invalid or expired access token');
      return { token, clientId: record.clientId, scopes: record.scopes, expiresAt: Math.floor(record.expiresAt / 1000), resource: new URL(record.resource), extra: { userId: grant.userId, membershipId: grant.membershipId, organizationId: grant.organizationId, grantId: grant.id } };
    },
    revokeToken: async (client, request) => {
      const hashes = [request.token].map(sha256);
      store.accessTokens = store.accessTokens.filter((item) => !(hashes.includes(item.tokenHash) && item.clientId === client.client_id));
      store.refreshTokens = store.refreshTokens.filter((item) => !(hashes.includes(item.tokenHash) && item.clientId === client.client_id));
      save();
    }
  };

  function issueTokens({ grant, scopes, resource }) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const expiresAt = Date.now() + ACCESS_MS;
    store.accessTokens = live(store.accessTokens);
    store.refreshTokens = live(store.refreshTokens);
    store.accessTokens.push({ tokenHash: sha256(accessToken), grantId: grant.id, clientId: grant.clientId, scopes, resource, expiresAt });
    store.refreshTokens.push({ tokenHash: sha256(refreshToken), grantId: grant.id, clientId: grant.clientId, scopes, resource, expiresAt: Date.now() + REFRESH_MS });
    save();
    return { access_token: accessToken, token_type: 'bearer', expires_in: ACCESS_MS / 1000, refresh_token: refreshToken, scope: scopes.join(' ') };
  }

  function finishConsent(req, res) {
    const pending = store.pending.find((item) => item.flowId === req.body?.flowId && item.expiresAt > Date.now());
    const cookie = readCookie(req, 'bhodix_mcp_csrf');
    if (!pending || !cookie || sha256(cookie) !== pending.csrfHash || cookie !== req.body?.csrf) return res.status(400).send('This connection request expired. Return to the AI app and try again.');
    const base = '<meta name="viewport" content="width=device-width,initial-scale=1"><main style="font:16px system-ui;max-width:460px;margin:10vh auto;padding:24px">';
    if (req.body?.decision === 'deny') {
      store.pending = store.pending.filter((item) => item.flowId !== pending.flowId); save();
      const target = new URL(pending.redirectUri); target.searchParams.set('error', 'access_denied'); if (pending.state) target.searchParams.set('state', pending.state);
      return res.redirect(target.href);
    }
    if (!pending.userId) {
      let identity;
      try { identity = auth.authenticateMcpUser(req.body?.workspace, req.body?.email, req.body?.password); }
      catch (error) { return res.status(401).type('html').send(`${base}<h1>Sign-in failed</h1><p>${escapeHtml(error.message)}</p><button onclick="history.back()">Try again</button></main>`); }
      pending.userId = identity.user.id; pending.membershipId = identity.membership.id; pending.organizationId = identity.organization.id; pending.organizationName = identity.organization.name;
      if (identity.membership.role === 'viewer') pending.scopes = pending.scopes.filter((scope) => scope !== WRITE_SCOPE);
      save();
      const csrf = escapeHtml(req.body.csrf);
      const canWrite = pending.scopes.includes(WRITE_SCOPE);
      const permissionText = canWrite
        ? 'It can also create tasks, post task comments, and change task status when you ask it to. It cannot access the Secrets Vault.'
        : identity.membership.role === 'viewer' ? 'This viewer account can read workspace data but cannot grant task changes.' : 'This connection is read-only and cannot change workspace data.';
      const allowLabel = canWrite ? 'Allow read and task changes' : 'Allow read access';
      const readOnlyChoice = canWrite ? ' <button name="decision" value="read_only" style="padding:10px 16px">Read-only access</button>' : '';
      return res.type('html').send(`${base}<h1>Allow ${escapeHtml(pending.clientName)}?</h1><p>Workspace: <strong>${escapeHtml(identity.organization.name)}</strong></p><p>This AI assistant can read projects, tasks, and workspace documents as ${escapeHtml(identity.user.name)}. ${permissionText}</p><form method="post" action="/oauth/consent"><input type="hidden" name="flowId" value="${pending.flowId}"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow" style="padding:10px 16px">${allowLabel}</button>${readOnlyChoice} <button name="decision" value="deny" style="padding:10px 16px">Deny</button></form></main>`);
    }
    if (req.body?.decision === 'read_only') pending.scopes = pending.scopes.filter((scope) => scope !== WRITE_SCOPE);
    else if (req.body?.decision !== 'allow') return res.status(400).send('Select whether to allow this connection.');
    store.pending = store.pending.filter((item) => item.flowId !== pending.flowId);
    const code = randomToken();
    store.codes.push({ codeHash: sha256(code), codeChallenge: pending.codeChallenge, clientId: pending.clientId, redirectUri: pending.redirectUri, resource: pending.resource, scopes: pending.scopes, userId: pending.userId, membershipId: pending.membershipId, organizationId: pending.organizationId, expiresAt: Date.now() + 3 * 60 * 1000 });
    save();
    const target = new URL(pending.redirectUri); target.searchParams.set('code', code); if (pending.state) target.searchParams.set('state', pending.state);
    res.clearCookie('bhodix_mcp_csrf', { path: '/oauth/consent' });
    return res.redirect(target.href);
  }

  function connections(userId, organizationId) {
    return store.grants.filter((grant) => grant.userId === userId && grant.organizationId === organizationId && !grant.revokedAt).map((grant) => ({ id: grant.id, name: clientsStore.getClient(grant.clientId)?.client_name || 'AI assistant', createdAt: grant.createdAt, scopes: grant.scopes || [READ_SCOPE] }));
  }

  function revokeConnection(grantId, userId, organizationId) {
    const grant = store.grants.find((item) => item.id === grantId && item.userId === userId && item.organizationId === organizationId && !item.revokedAt);
    if (!grant) return false;
    grant.revokedAt = new Date().toISOString();
    save();
    return true;
  }

  function revokeUser(userId) {
    const revokedAt = new Date().toISOString();
    let changed = false;
    store.grants.forEach((grant) => {
      if (grant.userId === userId && !grant.revokedAt) { grant.revokedAt = revokedAt; changed = true; }
    });
    if (changed) save();
  }

  const router = mcpAuthRouter({ provider, issuerUrl, resourceServerUrl: resourceUrl, scopesSupported: [READ_SCOPE, WRITE_SCOPE], resourceName: 'Bhodhix OS' });
  const authorizationMetadata = createOAuthMetadata({ provider, issuerUrl, scopesSupported: [READ_SCOPE, WRITE_SCOPE, 'offline_access'] });
  return { provider, router, authorizationMetadata, finishConsent, connections, revokeConnection, revokeUser, clientName: (clientId) => clientsStore.getClient(clientId)?.client_name || 'AI assistant' };
}

module.exports = { createMcpOAuth, READ_SCOPE, WRITE_SCOPE };
