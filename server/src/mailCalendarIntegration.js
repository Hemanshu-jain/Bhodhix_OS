const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = '.mail-calendar-connections.enc';
const STATE_TTL = 10 * 60 * 1000;
const PROVIDERS = {
  google: {
    name: 'Google',
    clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
    async profile(token) { const data = await apiJson('https://www.googleapis.com/oauth2/v2/userinfo', token); return { email: data.email || '' }; }
  },
  microsoft: {
    name: 'Microsoft 365',
    clientId: process.env.MICROSOFT_CLIENT_ID || '', clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'],
    async profile(token) { const data = await apiJson('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', token); return { email: data.mail || data.userPrincipalName || '' }; }
  }
};
const apiJson = async (url, token) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Provider request failed');
  return data;
};

function createMailCalendarIntegration({ encryptionKey, publicBaseUrl, desktopMode = false, onNotification = () => {} }) {
  const key = /^[a-f\d]{64}$/i.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'hex') : null;
  const pending = new Map();
  const redirectUri = new URL('/api/integrations/oauth/callback', publicBaseUrl).href;

  function read(directory) {
    const file = path.join(directory, FILE);
    if (!fs.existsSync(file)) return [];
    if (!key) throw new Error('Integration-token encryption key is not configured');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(value)) throw new Error('Stored account connections are invalid');
    return value;
  }

  function write(directory, connections) {
    if (!key) throw new Error('Integration-token encryption key is not configured. Set CONNECTOR_TOKEN_ENCRYPTION_KEY and restart Bhodhix.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(connections), 'utf8'), cipher.final()]);
    const file = path.join(directory, FILE), temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } catch (error) { try { fs.unlinkSync(temp); } catch { /* temp file may not exist */ } throw error; }
  }

  function configured(provider) { return Boolean(key && PROVIDERS[provider]?.clientId && (provider === 'google' || !desktopMode ? PROVIDERS[provider]?.clientSecret : true)); }
  function status(directory, userId) {
    const connections = read(directory);
    return Object.keys(PROVIDERS).map((id) => {
      const connection = connections.find((item) => item.provider === id && item.userId === userId);
      return { id, name: PROVIDERS[id].name, configured: configured(id), connected: Boolean(connection), email: connection?.email || '', error: connection?.lastError || '', mode: desktopMode ? 'desktop' : 'hosted' };
    });
  }

  function begin(directory, user, providerId) {
    const provider = PROVIDERS[providerId];
    if (!provider || !configured(providerId)) throw new Error(`${provider?.name || 'This provider'} is not configured yet`);
    for (const [state, item] of pending) if (item.expiresAt < Date.now()) pending.delete(state);
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    pending.set(state, { directory, userId: user.id, providerId, verifier, expiresAt: Date.now() + STATE_TTL });
    const url = new URL(provider.authorize);
    const params = { client_id: provider.clientId, redirect_uri: redirectUri, response_type: 'code', scope: provider.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', prompt: providerId === 'google' ? 'consent' : 'select_account', response_mode: 'query' };
    if (providerId === 'google') params.access_type = 'offline';
    url.search = new URLSearchParams(params).toString();
    return url.href;
  }

  function finishCallback(res, result, success = false) {
    if (!desktopMode) return res.redirect(result.href);
    const message = success ? 'Your account is connected. Return to the Bhodhix app to continue.' : 'The account connection could not be completed. Return to Bhodhix and try again.';
    return res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bhodhix account connection</title><style>body{margin:0;background:#090b12;color:#f4f5fb;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:440px;margin:24px;padding:32px;border:1px solid #292d3d;border-radius:16px;background:#121522}h1{font-size:22px}p{color:#a9b0c2;line-height:1.6}</style></head><body><main><h1>${success ? 'Connected' : 'Connection incomplete'}</h1><p>${message}</p><p>You can close this tab.</p></main></body></html>`);
  }

  async function callback(req, res) {
    res.set('Cache-Control', 'no-store');
    const state = String(req.query.state || ''), flow = pending.get(state);
    pending.delete(state);
    const result = new URL('/', publicBaseUrl);
    result.searchParams.set('account', 'error');
    if (!flow || flow.expiresAt < Date.now() || req.query.error || typeof req.query.code !== 'string') return finishCallback(res, result);
    const provider = PROVIDERS[flow.providerId];
    try {
      const tokenRequest = { client_id: provider.clientId, code: req.query.code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier };
      if (provider.clientSecret && (!desktopMode || flow.providerId === 'google')) tokenRequest.client_secret = provider.clientSecret;
      const response = await fetch(provider.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenRequest) });
      const tokens = await response.json();
      if (!response.ok || !tokens.access_token) throw new Error('Authorization could not be completed');
      const profile = await provider.profile(tokens.access_token);
      const connections = read(flow.directory);
      const previous = connections.find((item) => item.provider === flow.providerId && item.userId === flow.userId);
      const next = connections.filter((item) => !(item.provider === flow.providerId && item.userId === flow.userId));
      next.push({ id: crypto.randomUUID(), provider: flow.providerId, userId: flow.userId, email: String(profile.email || '').slice(0, 200), accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous?.refreshToken || '', expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, initialized: false, knownMailIds: [], notifiedEvents: [] });
      write(flow.directory, next);
      result.searchParams.set('account', `${flow.providerId}-connected`);
      return finishCallback(res, result, true);
    } catch { result.searchParams.set('account', 'error'); }
    return finishCallback(res, result);
  }

  async function accessToken(connection) {
    if (connection.expiresAt > Date.now() + 60_000) return connection.accessToken;
    if (!connection.refreshToken) throw new Error('Reconnect this account to restore access');
    const provider = PROVIDERS[connection.provider];
    const tokenRequest = { client_id: provider.clientId, refresh_token: connection.refreshToken, grant_type: 'refresh_token' };
    if (provider.clientSecret && (!desktopMode || connection.provider === 'google')) tokenRequest.client_secret = provider.clientSecret;
    const response = await fetch(provider.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenRequest) });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) throw new Error('Account authorization expired');
    connection.accessToken = tokens.access_token;
    connection.refreshToken = tokens.refresh_token || connection.refreshToken;
    connection.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
    return connection.accessToken;
  }

  async function fetchUpdates(connection) {
    const token = await accessToken(connection);
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let messages = [], events = [];
    if (connection.provider === 'google') {
      const page = await apiJson('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=in%3Ainbox', token);
      messages = await Promise.all((page.messages || []).slice(0, 10).map((item) => apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, token).then((message) => {
        const header = (name) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || '';
        return { id: item.id, subject: header('Subject') || '(no subject)', sender: header('From'), receivedAt: header('Date'), url: `https://mail.google.com/mail/u/0/#all/${item.id}` };
      })));
      const calendar = await apiJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(until.toISOString())}`, token);
      events = (calendar.items || []).map((item) => ({ id: item.id, title: item.summary || 'Meeting', start: item.start?.dateTime || item.start?.date, url: item.htmlLink || 'https://calendar.google.com/calendar/u/0/r' }));
    } else {
      const messagesPage = await apiJson('https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,webLink', token);
      messages = (messagesPage.value || []).map((item) => ({ id: item.id, subject: item.subject || '(no subject)', sender: item.from?.emailAddress?.name || item.from?.emailAddress?.address || '', receivedAt: item.receivedDateTime, url: item.webLink || 'https://outlook.office.com/mail/' }));
      const calendarPage = await apiJson(`https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(now.toISOString())}&endDateTime=${encodeURIComponent(until.toISOString())}&$orderby=start/dateTime&$select=id,subject,start,webLink`, token);
      events = (calendarPage.value || []).map((item) => ({ id: item.id, title: item.subject || 'Meeting', start: item.start?.dateTime, url: item.webLink || 'https://outlook.office.com/calendar/' }));
    }
    const notifications = [];
    const mailIds = new Set(connection.knownMailIds || []);
    if (connection.initialized) for (const mail of messages) if (!mailIds.has(mail.id)) notifications.push({ kind: 'mail', title: mail.subject, body: mail.sender ? `From ${mail.sender}` : 'New message', url: mail.url, tag: `mail-${mail.id}` });
    connection.knownMailIds = messages.map((item) => item.id).slice(0, 100);
    connection.initialized = true;
    const sent = new Set(connection.notifiedEvents || []);
    for (const event of events) {
      const startMs = Date.parse(event.start);
      const key = `${event.id}:${event.start}`;
      if (Number.isFinite(startMs) && startMs - now.getTime() <= 15 * 60_000 && startMs > now.getTime() && !sent.has(key)) {
        notifications.push({ kind: 'meeting', title: event.title, body: `Starts at ${new Date(startMs).toLocaleTimeString()}`, url: event.url, tag: `meeting-${key}` });
        sent.add(key);
      }
    }
    connection.notifiedEvents = [...sent].slice(-200);
    return notifications;
  }

  async function syncDirectory(directory) {
    const connections = read(directory);
    for (const connection of connections) {
      try {
        const updates = await fetchUpdates(connection);
        for (const notification of updates) await onNotification({ userId: connection.userId, provider: connection.provider, vaultDir: directory, ...notification });
      } catch (error) { connection.lastError = error.message; }
    }
    if (connections.length) write(directory, connections);
  }

  function disconnect(directory, userId, providerId) {
    const connections = read(directory);
    const next = connections.filter((item) => item.userId !== userId || item.provider !== providerId);
    if (next.length !== connections.length) write(directory, next);
    return next.length !== connections.length;
  }

  return { configured, status, begin, callback, syncDirectory, disconnect, redirectUri, desktopMode };
}

module.exports = { createMailCalendarIntegration };
