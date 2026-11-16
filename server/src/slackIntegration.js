const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = '.slack-connection.json';
const SCOPES = 'chat:write,channels:read';
const STATE_TTL = 10 * 60 * 1000;
const ROUTABLE_EVENTS = ['task.created', 'task.status', 'incident.logged'];

function createSlackIntegration({ clientId, clientSecret, encryptionKey, publicBaseUrl }) {
  // shortcut: OAuth state is process-local; persist it before running multiple server replicas.
  const pending = new Map();
  const key = /^[a-f\d]{64}$/i.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'hex') : null;
  const callbackUrl = new URL('/api/slack/oauth/callback', publicBaseUrl).href;
  const isConfigured = Boolean(clientId && clientSecret && key);

  const encryptedFile = (vaultDir) => path.join(vaultDir, FILE);
  function seal(value) {
    if (!key) throw new Error('Slack token encryption is not configured.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }
  function open(vaultDir) {
    const file = encryptedFile(vaultDir);
    if (!fs.existsSync(file)) return null;
    if (!key) throw new Error('Slack token encryption key is missing.');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored.version !== 1) throw new Error('Stored Slack connection is invalid.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  }
  function save(vaultDir, connection) {
    const file = encryptedFile(vaultDir);
    fs.mkdirSync(vaultDir, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(seal(connection))}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* temporary file may not exist */ }
      throw error;
    }
  }
  function remove(vaultDir) {
    try { fs.unlinkSync(encryptedFile(vaultDir)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function slackApi(method, token, values = {}, form = false) {
    const options = { method: form ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` } };
    let url = `https://slack.com/api/${method}`;
    if (form) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(values);
    } else {
      url += `?${new URLSearchParams(values)}`;
    }
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Slack ${method} request failed.`);
    return data;
  }
  async function listChannels(token) {
    const channels = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const data = await slackApi('conversations.list', token, {
        types: 'public_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {})
      });
      channels.push(...(data.channels || []).filter((channel) => channel.is_member));
      cursor = data.response_metadata?.next_cursor || '';
      if (!cursor) break;
    }
    return channels.map(({ id, name }) => ({ id, name }));
  }

  function status(vaultDir) {
    const connection = open(vaultDir);
    const canConnect = isConfigured && new URL(publicBaseUrl).protocol === 'https:';
    return {
      configured: isConfigured,
      canConnect,
      setupMessage: !isConfigured
        ? 'Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and a persistent 32-byte SLACK_TOKEN_ENCRYPTION_KEY on the server.'
        : !canConnect ? 'Slack OAuth requires the app to use its public HTTPS URL.' : '',
      connected: Boolean(connection),
      teamName: connection?.teamName || '',
      teamId: connection?.teamId || '',
      channelId: connection?.channelId || '',
      channelName: connection?.channelName || '',
      events: connection?.events || [],
      projectChannels: connection?.projectChannels || {},
      connectedAt: connection?.connectedAt || ''
    };
  }

  function start(vaultDir, organizationId, userId) {
    if (!isConfigured) throw new Error('Slack is not configured on this server.');
    if (new URL(publicBaseUrl).protocol !== 'https:') throw new Error('Slack OAuth requires the app to use its public HTTPS URL.');
    const now = Date.now();
    pending.forEach((entry, state) => { if (entry.expiresAt <= now) pending.delete(state); });
    const state = crypto.randomBytes(32).toString('base64url');
    pending.set(state, { vaultDir, organizationId, userId, expiresAt: now + STATE_TTL });
    const authorize = new URL('https://slack.com/oauth/v2/authorize');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('scope', SCOPES);
    authorize.searchParams.set('redirect_uri', callbackUrl);
    authorize.searchParams.set('state', state);
    return authorize.href;
  }

  async function callback(req, res) {
    res.set('Cache-Control', 'no-store');
    const destination = new URL('/', publicBaseUrl);
    destination.searchParams.set('slack', 'error');
    const state = req.query.state;
    const flow = pending.get(state);
    if (state) pending.delete(state);
    if (!flow || flow.expiresAt <= Date.now()) return res.redirect(destination.href);
    if (req.query.error || !req.query.code) return res.redirect(destination.href);
    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: req.query.code, redirect_uri: callbackUrl })
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.access_token || !data.team?.id) throw new Error(data.error || 'Slack authorization failed.');
      save(flow.vaultDir, {
        accessToken: data.access_token,
        teamId: data.team.id,
        teamName: data.team.name || data.team.id,
        botUserId: data.bot_user_id || '',
        scopes: String(data.scope || '').split(',').filter(Boolean),
        connectedBy: flow.userId,
        organizationId: flow.organizationId,
        connectedAt: new Date().toISOString(),
        channelId: '',
        events: [],
        projectChannels: {}
      });
      destination.searchParams.set('slack', 'connected');
    } catch (error) {
      console.error(`[slack] OAuth callback failed (${error.message || 'unknown error'}).`);
    }
    return res.redirect(destination.href);
  }

  function safeStatus(req, res) {
    try { return res.json({ success: true, ...status(req.vaultManager.vaultDir) }); }
    catch { return res.status(500).json({ success: false, error: 'Could not read the encrypted Slack connection.' }); }
  }
  function begin(req, res) {
    try { return res.json({ success: true, authorizationUrl: start(req.vaultManager.vaultDir, req.organization.id, req.user.id) }); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  }
  async function channels(req, res) {
    try {
      const connection = open(req.vaultManager.vaultDir);
      if (!connection) return res.status(404).json({ success: false, error: 'Connect a Slack workspace first.' });
      return res.json({ success: true, channels: await listChannels(connection.accessToken) });
    } catch (error) { return res.status(502).json({ success: false, error: `Could not load Slack channels: ${error.message}` }); }
  }
  async function setChannel(req, res) {
    try {
      const connection = open(req.vaultManager.vaultDir);
      if (!connection) return res.status(404).json({ success: false, error: 'Connect a Slack workspace first.' });
      const channelId = String(req.body?.channelId || '');
      if (!/^[A-Z0-9]{1,32}$/.test(channelId)) return res.status(400).json({ success: false, error: 'Choose a valid Slack channel.' });
      const channel = (await listChannels(connection.accessToken)).find((item) => item.id === channelId);
      if (!channel) return res.status(400).json({ success: false, error: 'The bot must be a member of the selected public channel.' });
      connection.channelId = channel.id;
      connection.channelName = channel.name;
      save(req.vaultManager.vaultDir, connection);
      return res.json({ success: true, channelId: channel.id, channelName: channel.name });
    } catch (error) { return res.status(502).json({ success: false, error: `Could not save the Slack channel: ${error.message}` }); }
  }
  async function saveRouting(req, res) {
    try {
      const connection = open(req.vaultManager.vaultDir);
      if (!connection) return res.status(404).json({ success: false, error: 'Connect a Slack workspace first.' });
      const available = await listChannels(connection.accessToken);
      const events = Array.isArray(req.body?.events) ? [...new Set(req.body.events)].filter((event) => ROUTABLE_EVENTS.includes(event)) : [];
      const projectChannels = {};
      for (const [projectId, channelId] of Object.entries(req.body?.projectChannels || {})) {
        if (!Object.hasOwn(req.vaultManager.state.projects, projectId)) return res.status(400).json({ success: false, error: 'A selected project does not exist.' });
        if (channelId && !available.some((channel) => channel.id === channelId)) return res.status(400).json({ success: false, error: 'The bot must be a member of each selected public channel.' });
        if (channelId) projectChannels[projectId] = channelId;
      }
      connection.events = events;
      connection.projectChannels = projectChannels;
      save(req.vaultManager.vaultDir, connection);
      return res.json({ success: true, events, projectChannels });
    } catch (error) { return res.status(502).json({ success: false, error: `Could not save Slack routing: ${error.message}` }); }
  }
  async function testMessage(req, res) {
    try {
      const connection = open(req.vaultManager.vaultDir);
      if (!connection?.channelId) return res.status(400).json({ success: false, error: 'Select and save a Slack channel first.' });
      await slackApi('chat.postMessage', connection.accessToken, {
        channel: connection.channelId,
        text: `Bhodhix is connected to ${connection.teamName}. This is a test message from the workspace integration.`,
        parse: 'none', unfurl_links: 'false', unfurl_media: 'false'
      }, true);
      return res.json({ success: true, channelName: connection.channelName || connection.channelId });
    } catch (error) { return res.status(502).json({ success: false, error: `Could not send the Slack test message: ${error.message}` }); }
  }
  async function disconnect(req, res) {
    try {
      const connection = open(req.vaultManager.vaultDir);
      if (!connection) return res.json({ success: true, disconnected: true });
      try { await slackApi('auth.revoke', connection.accessToken); }
      catch (error) { if (error.message !== 'token_revoked') return res.status(502).json({ success: false, error: `Slack could not revoke the connection: ${error.message}` }); }
      remove(req.vaultManager.vaultDir);
      return res.json({ success: true, disconnected: true });
    } catch { return res.status(500).json({ success: false, error: 'Could not disconnect Slack.' }); }
  }
  async function notify(vaultDir, { event, projectId, text }) {
    try {
      const connection = open(vaultDir);
      if (!connection?.events?.includes(event)) return;
      const channelId = connection.projectChannels?.[projectId] || connection.channelId;
      if (!channelId) return;
      await slackApi('chat.postMessage', connection.accessToken, { channel: channelId, text: String(text).slice(0, 500), parse: 'none', unfurl_links: 'false', unfurl_media: 'false' }, true);
    } catch (error) { console.error(`[slack] Notification delivery failed (${error.message || 'Slack error'}).`); }
  }

  return { callback, status: safeStatus, begin, channels, setChannel, saveRouting, testMessage, disconnect, notify };
}

module.exports = { createSlackIntegration };
