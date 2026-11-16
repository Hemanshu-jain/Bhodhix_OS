const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const VaultManager = require('./vaultManager');
const HealthMonitor = require('./healthMonitor');
const { loadPin, createAuth } = require('./auth');
const { createMcpOAuth, READ_SCOPE, WRITE_SCOPE } = require('./mcpOAuth');
const { createWorkspaceMcp } = require('./mcpServer');
const { readSecretsVault, writeSecretsVault, readSecretsVaultAudit, appendSecretsVaultAudit } = require('./secretsVault');
const { readBilling, saveBilling, saveProjectTemplate } = require('./billingStore');
const { configuredProviders, runScheduledAi } = require('./scheduledAi');
const { createSlackIntegration } = require('./slackIntegration');
const { createSnapshot, restoreSnapshot } = require('./workspaceBackup');
const { createDatabaseMonitor } = require('./databaseMonitor');
const { createMailCalendarIntegration } = require('./mailCalendarIntegration');
const { createPushNotifications } = require('./pushNotifications');
const fieldWorkStore = require('./fieldWorkStore');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const PORT = process.env.PORT || 4000;
const HOST = process.env.BIND_HOST || '127.0.0.1';
const HEALTH_INTERVAL_MS = 20000;
const HEALTH_MONITOR_ENABLED = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const TENANT_DATA_DIR = path.resolve(process.env.TENANT_DATA_DIR || path.join(__dirname, '../../data/tenants'));
const publicBase = new URL(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`);
const isLoopbackBase = ['localhost', '127.0.0.1', '[::1]'].includes(publicBase.hostname);
if (publicBase.protocol !== 'https:' && !(publicBase.protocol === 'http:' && isLoopbackBase)) throw new Error('PUBLIC_BASE_URL must use HTTPS outside localhost.');
if (publicBase.username || publicBase.password || publicBase.pathname !== '/' || publicBase.search || publicBase.hash) throw new Error('PUBLIC_BASE_URL must be an origin without credentials, a path, or a query.');
if (!HEALTH_MONITOR_ENABLED && !process.env.PUBLIC_BASE_URL) throw new Error('Set PUBLIC_BASE_URL to the public HTTPS origin before enabling remote AI connections.');
const emailVerificationRequired = !isLoopbackBase || process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const smtpUrl = process.env.SMTP_URL || '';
const emailFrom = process.env.EMAIL_FROM || '';
if (emailVerificationRequired && (!smtpUrl || !emailFrom)) throw new Error('Hosted signup requires SMTP_URL and EMAIL_FROM for email verification.');
if (emailVerificationRequired && smtpUrl) {
  const smtp = new URL(smtpUrl);
  if (!['smtp:', 'smtps:'].includes(smtp.protocol) || smtp.protocol === 'smtp:' && smtp.searchParams.get('requireTLS') !== 'true') throw new Error('Hosted SMTP must use smtps:// or smtp:// with requireTLS=true.');
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const pinFile = path.resolve(process.env.BHODIX_PIN_FILE || path.join(__dirname, '../.pin'));
const authStore = path.resolve(process.env.AUTH_STORE_FILE || path.join(__dirname, '../.team.json'));
const fieldEncryptionKeyFile = path.join(path.dirname(authStore), '.field-work.key');
let fieldEncryptionKey = process.env.FIELD_WORK_ENCRYPTION_KEY || process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY || '';
if (!fieldEncryptionKey) {
  try { fieldEncryptionKey = fs.readFileSync(fieldEncryptionKeyFile, 'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fieldEncryptionKey = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(fieldEncryptionKeyFile, fieldEncryptionKey, { mode: 0o600, flag: 'wx' }); }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; fieldEncryptionKey = fs.readFileSync(fieldEncryptionKeyFile, 'utf8').trim(); }
  }
}
fieldWorkStore.configureEncryptionKey(fieldEncryptionKey);
const auth = createAuth(loadPin(pinFile), authStore, { emailVerificationRequired, publicBaseUrl: publicBase.origin, smtpUrl, emailFrom, defaultWorkspaceName: process.env.DEFAULT_WORKSPACE_NAME || 'Bhodhix Workspace' });
app.use(auth.hostAllowed);
app.use(cors(auth.corsOptions));

const mcpUrl = new URL('/mcp', publicBase);
const mcpOAuth = createMcpOAuth({
  auth,
  storeFile: path.resolve(process.env.MCP_OAUTH_STORE_FILE || path.join(__dirname, '../.mcp-oauth.json')),
  issuerUrl: publicBase,
  resourceUrl: mcpUrl
});
const slack = createSlackIntegration({
  clientId: process.env.SLACK_CLIENT_ID || '',
  clientSecret: process.env.SLACK_CLIENT_SECRET || '',
  encryptionKey: process.env.SLACK_TOKEN_ENCRYPTION_KEY || '',
  publicBaseUrl: publicBase.origin
});
const databaseMonitor = createDatabaseMonitor({ encryptionKey: process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY || '' });
const pushNotifications = createPushNotifications({
  encryptionKey: process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY || '',
  publicKey: process.env.WEB_PUSH_PUBLIC_KEY || '',
  privateKey: process.env.WEB_PUSH_PRIVATE_KEY || '',
  subject: process.env.WEB_PUSH_SUBJECT || 'mailto:support@bhodhix.com'
});
const mailCalendar = createMailCalendarIntegration({
  encryptionKey: process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY || '',
  publicBaseUrl: publicBase.origin,
  desktopMode: !process.env.PUBLIC_BASE_URL,
  onNotification: async (notification) => {
    if (pushNotifications.allows(notification.vaultDir, notification.userId, notification.kind)) {
      process.emit('bhodhix:notification', notification);
      await pushNotifications.send(notification.vaultDir, notification.userId, notification);
    }
    const owner = [...runtimes.entries()].find(([, runtime]) => runtime.vaultManager.vaultDir === notification.vaultDir);
    if (owner) broadcast(owner[0], 'server_notification', notification, notification.userId);
  }
});
app.get('/api/integrations/oauth/callback', mailCalendar.callback);
app.get('/api/slack/oauth/callback', slack.callback);
app.post('/oauth/consent', express.urlencoded({ extended: false, limit: '10kb' }), mcpOAuth.finishConsent);
app.get('/.well-known/oauth-authorization-server', (req, res) => res.set('Cache-Control', 'no-store').json(mcpOAuth.authorizationMetadata));
app.use(mcpOAuth.router);

// --- Server-Sent Events ---
const sseClients = new Map();

function broadcast(organizationId, eventType, data, targetUserId = '') {
  sseClients.forEach(({ token, organizationId: clientOrganizationId, projectIds, userId: clientUserId }, client) => {
    try {
      if (clientOrganizationId !== organizationId) return;
      if (targetUserId && targetUserId !== clientUserId) return;
      if (!auth.sessionValid(token)) { sseClients.delete(client); client.end(); return; }
      let visibleData = data;
      if (Array.isArray(projectIds) && eventType === 'vault_update') visibleData = { ...data, projects: Object.fromEntries(Object.entries(data.projects || {}).filter(([id]) => projectIds.includes(id))) };
      if (Array.isArray(projectIds) && eventType === 'health_update') visibleData = {
        ...data,
        results: (data.results || []).filter((item) => projectIds.includes(item.project)),
        metrics: Object.fromEntries(Object.entries(data.metrics || {}).filter(([, metric]) => projectIds.includes(metric.project)))
      };
      if (Array.isArray(projectIds) && eventType === 'database_update') visibleData = (data || []).filter((item) => projectIds.includes(item.project));
      if (visibleData && typeof visibleData === 'object') { visibleData = { ...visibleData }; delete visibleData.userId; delete visibleData.vaultDir; }
      const payload = `event: ${eventType}\ndata: ${JSON.stringify(visibleData)}\n\n`;
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  });
}

const runtimes = new Map();
function createRuntime(organization, vaultPath) {
  if (organization.id !== 'bhodhix') {
    fs.mkdirSync(path.join(vaultPath, 'finances'), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, 'monitoring'), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, 'docs'), { recursive: true });
    const companyFile = path.join(vaultPath, 'company.md');
    if (!fs.existsSync(companyFile)) fs.writeFileSync(companyFile, `---\ncompany: ${JSON.stringify(organization.name)}\nlegal_name: ${JSON.stringify(organization.name)}\n---\n\n# Company\n`, 'utf8');
    const ledgerFile = path.join(vaultPath, 'finances', 'bhodhix-ledger.md');
    if (!fs.existsSync(ledgerFile)) fs.writeFileSync(ledgerFile, `---\n---\n\n### App Contribution\n\n| Product / App | Inflow (MRR) | Direct Infra Burn | Net Contribution | Margin % |\n|---|---|---|---|---|\n\n### Cash Flow\n\n| Month | Inflow | Outflow | Net |\n|---|---|---|---|\n\n### Central Overheads\n\n| Service | Provider | Cost (INR) | Purpose |\n|---|---|---|---|\n`, 'utf8');
    const endpointsFile = path.join(vaultPath, 'monitoring', 'endpoints.md');
    if (!fs.existsSync(endpointsFile)) fs.writeFileSync(endpointsFile, `---\n---\n\n| ID | Name | Project | URL | Method | Expected Status |\n|---|---|---|---|---|---|\n`, 'utf8');
    const incidentsFile = path.join(vaultPath, 'monitoring', 'incidents.md');
    if (!fs.existsSync(incidentsFile)) fs.writeFileSync(incidentsFile, `---\n---\n`, 'utf8');
  }
  const vaultManager = new VaultManager(vaultPath);
  vaultManager.init();
  const healthMonitor = new HealthMonitor(vaultManager, HEALTH_INTERVAL_MS);
  healthMonitor.on('update', (data) => broadcast(organization.id, 'health_update', data));
  const databaseTimer = setInterval(() => databaseMonitor.checkAll(vaultPath)
    .then((data) => { if (data.length) broadcast(organization.id, 'database_update', databaseMonitor.publicStatus(vaultPath)); })
    .catch((error) => console.error(`[database-monitor] Check failed (${error.name || 'storage error'}).`)), 60_000);
  databaseTimer.unref();
  const accountsTimer = setInterval(() => mailCalendar.syncDirectory(vaultPath).catch((error) => console.error(`[account-sync] Sync failed (${error.name || 'provider error'}).`)), 60_000);
  accountsTimer.unref();
  databaseMonitor.checkAll(vaultPath).then((data) => { if (data.length) broadcast(organization.id, 'database_update', databaseMonitor.publicStatus(vaultPath)); }).catch(() => {});
  vaultManager.on('change', (state) => broadcast(organization.id, 'vault_update', state));
  vaultManager.on('task_activity', (data) => broadcast(organization.id, 'task_activity_update', data));
  if (HEALTH_MONITOR_ENABLED) healthMonitor.start();
  return { vaultManager, healthMonitor };
}

const legacyVaultPath = path.resolve(process.env.LEGACY_VAULT_DIR || path.join(__dirname, '../../vault'));
fs.mkdirSync(legacyVaultPath, { recursive: true });
runtimes.set('bhodhix', createRuntime({ id: 'bhodhix' }, legacyVaultPath));
const scheduledAiTimer = setInterval(() => runScheduledAi(runtimes).catch((error) => console.error(`[scheduled-ai] Scheduler stopped for this cycle (${error.name || 'storage error'}).`)), 15_000);
scheduledAiTimer.unref();
const reminderTimer = setInterval(async () => {
  const now = Date.now();
  for (const [organizationId, runtime] of runtimes) {
    for (const [projectId, project] of Object.entries(runtime.vaultManager.state.projects)) for (const task of project.tasks || []) {
      const due = Date.parse(task.reminderAt || '');
      if (task.status === 'done' || !Number.isFinite(due) || due > now || now - due > 15 * 60_000) continue;
      for (const userId of auth.notificationRecipients(organizationId, task.assignee)) {
        const deliveryId = `${organizationId}:${userId}:${projectId}:${task.id}:${task.reminderAt}`;
        if (!pushNotifications.allows(runtime.vaultManager.vaultDir, userId, 'task') || !pushNotifications.active || !pushNotifications.claim(runtime.vaultManager.vaultDir, deliveryId)) continue;
        const notification = { kind: 'task', title: 'Task reminder', body: `${task.title} · ${project.meta?.name || projectId}`, projectId, taskId: task.id, tag: deliveryId };
        await pushNotifications.send(runtime.vaultManager.vaultDir, userId, notification);
      }
    }
  }
}, 30_000);
reminderTimer.unref();
const fieldInactivityTimer = setInterval(async () => {
  const now = Date.now();
  for (const [organizationId, runtime] of runtimes) {
    try {
      const data = fieldWorkStore.load(runtime.vaultManager.vaultDir);
      const idleShifts = data.shifts.filter((shift) => shift.checkedInAt && !shift.checkedOutAt && shift.activityStatus === 'working' && !shift.idleAlertAt && Number.isFinite(Date.parse(shift.lastActiveAt || '')) && now - Date.parse(shift.lastActiveAt) >= Number(data.inactivityGraceMinutes || 30) * 60_000);
      if (!idleShifts.length) continue;
      for (const shift of idleShifts) shift.idleAlertAt = new Date(now).toISOString();
      fieldWorkStore.save(runtime.vaultManager.vaultDir, data);
      for (const shift of idleShifts) for (const userId of auth.administratorIds(organizationId)) {
        const deliveryId = `${organizationId}:field-idle:${shift.id}:${shift.idleAlertAt}:${userId}`;
        const notification = { kind: 'system', title: 'Team member may be inactive', body: `No app activity from ${auth.memberName(shift.userId)} for ${data.inactivityGraceMinutes} minutes. Their visible status is still Working.`, tag: deliveryId };
        broadcast(organizationId, 'server_notification', notification, userId);
        if (pushNotifications.active && pushNotifications.allows(runtime.vaultManager.vaultDir, userId, 'system') && pushNotifications.claim(runtime.vaultManager.vaultDir, deliveryId)) {
          try { await pushNotifications.send(runtime.vaultManager.vaultDir, userId, notification); } catch { /* in-app alert was already delivered */ }
        }
        process.emit('bhodhix:notification', notification);
      }
    } catch (error) { console.error(`[field-work] Inactivity check failed (${error.name || 'storage error'}).`); }
  }
}, 30_000);
fieldInactivityTimer.unref();
function runtimeFor(organization) {
  if (runtimes.has(organization.id)) return runtimes.get(organization.id);
  if (!/^[a-zA-Z0-9_-]+$/.test(organization.id)) throw new Error('Invalid workspace identifier');
  const runtime = createRuntime(organization, path.join(TENANT_DATA_DIR, organization.id));
  runtimes.set(organization.id, runtime);
  return runtime;
}

// --- API ---
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
app.get('/api/setup/status', auth.setupStatus);
app.post('/api/setup/owner', asyncRoute(auth.setupOwner));
app.post('/api/signup', asyncRoute(auth.signup));
app.post('/api/login', auth.login);
app.post('/api/join', asyncRoute(auth.join));
app.get('/api/auth/verify-email', auth.showEmailVerification);
app.post('/api/auth/verify-email', express.urlencoded({ extended: false, limit: '10kb' }), auth.verifyEmail);
app.post('/api/auth/resend-verification', asyncRoute(auth.resendVerification));
app.post('/api/auth/request-password-reset', asyncRoute(auth.requestPasswordReset));
app.get('/api/auth/reset-password', auth.showPasswordReset);
app.post('/api/auth/reset-password', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => auth.resetPassword(req, res, mcpOAuth.revokeUser));
app.use('/api', auth.requireAuth);
app.use('/api', (req, res, next) => {
  try {
    const runtime = runtimeFor(req.organization);
    req.vaultManager = runtime.vaultManager;
    req.healthMonitor = runtime.healthMonitor;
    req.databaseMonitor = databaseMonitor;
    return next();
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});
app.use('/api', (req, res, next) => {
  const allowed = req.membership?.projectIds;
  if (req.path.startsWith('/finances') && Array.isArray(allowed) && !['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Only workspace admins can access consolidated finance data' });
  if (req.method === 'POST' && req.path === '/projects/create' && !['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Only workspace admins can create projects' });
  if (!Array.isArray(allowed)) return next();
  let projectId = req.params.project || req.params.id || req.body?.project || req.body?.projectId || '';
  const routeProject = req.path.match(/^\/(?:tasks|projects)\/([^/]+)(?:\/|$)/);
  if (!projectId && routeProject && routeProject[1] !== 'create') projectId = decodeURIComponent(routeProject[1]);
  const docPath = req.body?.path || req.query?.path || '';
  if (!projectId && typeof docPath === 'string') {
    const match = docPath.replace(/\\/g, '/').match(/^projects\/([^/]+)(?:\/|$)/);
    if (match) projectId = match[1];
  }
  if (projectId && !allowed.includes(projectId)) return fail(res, 403, 'Your account does not have access to this project');
  return next();
});
app.use('/api', (req, res, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !['/auth/logout', '/monitoring/check-now', '/ai/connections'].includes(req.path)
  ? auth.requireRole('owner', 'admin', 'member')(req, res, next) : next());
app.get('/api/auth/me', (req, res) => res.json({ success: true, user: { ...req.user, organization: { id: req.organization.id, name: req.organization.name, slug: req.organization.slug } } }));
app.post('/api/auth/logout', auth.logout);
app.get('/api/team', auth.listTeam);
app.get('/api/team/invites', auth.requireRole('owner', 'admin'), auth.listInvites);
app.post('/api/team/invites', auth.requireRole('owner', 'admin'), asyncRoute(auth.createInvite));
app.delete('/api/team/invites/:id', auth.requireRole('owner', 'admin'), auth.revokeInvite);
app.patch('/api/team/members/:id', auth.requireRole('owner', 'admin'), auth.updateRole);
app.patch('/api/team/members/:id/work-mode', (req, res, next) => req.membership?.id === req.params.id
  ? auth.requireRole('owner', 'admin', 'member')(req, res, next)
  : auth.requireRole('owner', 'admin')(req, res, next), auth.updateWorkMode);
app.patch('/api/team/members/:id/projects', auth.requireRole('owner', 'admin'), (req, res) => {
  const projectIds = req.body?.projectIds;
  if (!Array.isArray(projectIds) || projectIds.some((id) => !Object.hasOwn(req.vaultManager.state.projects, id))) return fail(res, 400, 'One or more selected projects do not exist');
  return auth.updateProjectAccess(req, res);
});
app.delete('/api/team/members/:id', auth.requireRole('owner', 'admin'), auth.removeMember);
app.get('/api/ai/connections', (req, res) => res.json({ success: true, endpoint: mcpUrl.href, connections: mcpOAuth.connections(req.user.id, req.organization.id) }));
app.delete('/api/ai/connections/:id', (req, res) => res.json({ success: true, revoked: mcpOAuth.revokeConnection(req.params.id, req.user.id, req.organization.id) }));
app.get('/api/slack/status', auth.requireRole('owner', 'admin'), slack.status);
app.post('/api/slack/connect', auth.requireRole('owner', 'admin'), slack.begin);
app.get('/api/slack/channels', auth.requireRole('owner', 'admin'), slack.channels);
app.put('/api/slack/channel', auth.requireRole('owner', 'admin'), slack.setChannel);
app.put('/api/slack/routing', auth.requireRole('owner', 'admin'), slack.saveRouting);
app.post('/api/slack/test-message', auth.requireRole('owner', 'admin'), slack.testMessage);
app.delete('/api/slack/connection', auth.requireRole('owner', 'admin'), slack.disconnect);
app.get('/api/integrations/accounts', (req, res) => ok(res, { redirectUri: mailCalendar.redirectUri, desktopMode: mailCalendar.desktopMode, providers: mailCalendar.status(req.vaultManager.vaultDir, req.user.id) }));
app.post('/api/integrations/accounts/:provider/connect', guarded((req, res) => {
  try { return ok(res, { authorizationUrl: mailCalendar.begin(req.vaultManager.vaultDir, req.user, req.params.provider) }); }
  catch (error) { return fail(res, 503, error.message || 'Could not begin account authorization'); }
}));
app.delete('/api/integrations/accounts/:provider', guarded((req, res) => ok(res, { disconnected: mailCalendar.disconnect(req.vaultManager.vaultDir, req.user.id, req.params.provider) })));
app.get('/api/push/config', (req, res) => ok(res, { configured: pushNotifications.active, publicKey: pushNotifications.publicKey }));
app.post('/api/push/subscription', guarded((req, res) => {
  pushNotifications.store(req.vaultManager.vaultDir, req.user.id, req.body?.subscription);
  return ok(res);
}));
app.delete('/api/push/subscription', guarded((req, res) => {
  return ok(res, { removed: pushNotifications.remove(req.vaultManager.vaultDir, req.user.id, String(req.body?.endpoint || '')) });
}));
app.get('/api/push/preferences', guarded((req, res) => ok(res, { preferences: pushNotifications.getPreferences(req.vaultManager.vaultDir, req.user.id) })));
app.put('/api/push/preferences', guarded((req, res) => ok(res, { preferences: pushNotifications.setPreferences(req.vaultManager.vaultDir, req.user.id, req.body?.preferences || {}) })));

const requireMcpAuth = requireBearerAuth({
  verifier: mcpOAuth.provider,
  requiredScopes: [READ_SCOPE],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  expectedResource: mcpUrl
});
app.all('/mcp', requireMcpAuth, async (req, res) => {
  try {
    const identity = auth.getMcpIdentity(req.auth.extra.userId, req.auth.extra.membershipId, req.auth.extra.organizationId);
    if (!identity) return res.status(401).json({ error: 'Workspace access has been revoked' });
    const server = createWorkspaceMcp(runtimeFor(identity.organization).vaultManager, {
      canWrite: req.auth.scopes.includes(WRITE_SCOPE) && identity.membership.role !== 'viewer',
      author: `${mcpOAuth.clientName(req.auth.clientId)} as ${identity.user.name}`,
      role: identity.membership.role,
      projectIds: identity.membership.projectIds ?? null
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: 'Could not process MCP request' });
  }
});

const ok = (res, extra = {}) => res.json({ success: true, ...extra });
const fail = (res, status, error) => res.status(status).json({ success: false, error });

// Wraps a handler so thrown errors become a 400 with the message.
function guarded(fn) {
  return (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    fail(res, 400, err.message);
  }
  };
}

app.get('/api/team/updates', (req, res) => ok(res, req.vaultManager.getTeamUpdates()));
app.post('/api/team/announcements', auth.requireRole('owner', 'admin'), guarded((req, res) => ok(res, { announcement: req.vaultManager.addAnnouncement({ message: req.body.message, author: req.user.name }) })));
app.put('/api/team/availability', guarded((req, res) => ok(res, { availability: req.vaultManager.setAvailability(req.user, req.body) })));

const fieldDay = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const validFieldDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const fieldManager = (req) => ['owner', 'admin'].includes(req.user.role);
const fieldData = (req) => fieldWorkStore.load(req.vaultManager.vaultDir);
const publicFieldData = (data) => ({
  retentionDays: data.retentionDays,
  inactivityGraceMinutes: data.inactivityGraceMinutes,
  routes: data.routes,
  shifts: data.shifts,
  trips: data.trips,
  claims: data.claims,
  photos: data.photos.map(({ id, userId, mime, createdAt }) => ({ id, userId, mime, createdAt }))
});
app.get('/api/team/field-work', (req, res) => {
  const data = fieldData(req);
  const allowed = req.membership?.projectIds;
  const routes = data.routes.filter((item) => (fieldManager(req) || item.userId === req.user.id) && (!Array.isArray(allowed) || !item.projectId || allowed.includes(item.projectId)));
  const routeIds = new Set(routes.map((item) => item.id));
  const tripIds = new Set(data.trips.filter((item) => (fieldManager(req) || item.userId === req.user.id) && routeIds.has(item.routeId)).map((item) => item.id));
  const visibleUserIds = new Set(routes.map((item) => item.userId)); visibleUserIds.add(req.user.id);
  const visibleShifts = (fieldManager(req) && !Array.isArray(allowed) ? data.shifts : data.shifts.filter((item) => visibleUserIds.has(item.userId)));
  const visibleClaims = data.claims.filter((item) => item.userId === req.user.id || fieldManager(req) && (!Array.isArray(allowed) || !!item.routeId && routeIds.has(item.routeId)));
  return ok(res, { data: publicFieldData({
    ...data,
    routes,
    shifts: visibleShifts,
    trips: data.trips.filter((item) => (fieldManager(req) || item.userId === req.user.id) && routeIds.has(item.routeId)),
    claims: visibleClaims,
    photos: data.photos.filter((item) => item.userId === req.user.id || data.trips.some((trip) => tripIds.has(trip.id) && [trip.departurePhotoId, trip.returnPhotoId].includes(item.id)))
  }) });
});
app.get('/api/team/field-work/shift', (req, res) => {
  const data = fieldData(req);
  return ok(res, { shift: data.shifts.find((item) => item.userId === req.user.id && item.date === fieldDay()) || null });
});
app.post('/api/team/field-work/routes', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const { date, userId, projectId = '', title, plannedKm, stops } = req.body || {};
  const km = Number(plannedKm);
  const stopList = Array.isArray(stops) ? stops.map((item) => String(item).trim()).filter(Boolean) : String(stops || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!validFieldDay(date) || !auth.isActiveMember(userId, req.organization.id) || !['field', 'hybrid'].includes(auth.memberWorkMode(userId, req.organization.id)) || !String(title || '').trim() || String(title).length > 120 || !Number.isFinite(km) || km <= 0 || km > 10000 || stopList.length > 30 || stopList.some((item) => item.length > 120)) return fail(res, 400, 'Choose an on-ground or hybrid team member, route date, route name, planned distance, and up to 30 stops');
  if (projectId && !Object.hasOwn(req.vaultManager.state.projects, projectId)) return fail(res, 400, 'Select a valid project');
  if (projectId && !auth.memberCanAccessProject(userId, req.organization.id, projectId)) return fail(res, 400, 'The selected employee does not have access to this project');
  const data = fieldData(req);
  const route = { id: crypto.randomUUID(), date, userId, projectId, title: String(title).trim(), plannedKm: km, stops: stopList, status: 'assigned', createdBy: req.user.id, createdAt: new Date().toISOString() };
  data.routes.unshift(route);
  fieldWorkStore.save(req.vaultManager.vaultDir, data);
  return ok(res, { route });
}));
app.post('/api/team/field-work/shifts', guarded((req, res) => {
  const { action, photoData } = req.body || {};
  if (!['check_in', 'check_out'].includes(action)) return fail(res, 400, 'Choose check-in or check-out');
  const data = fieldData(req); const date = fieldDay();
  let shift = data.shifts.find((item) => item.userId === req.user.id && item.date === date);
  if (action === 'check_in' && shift?.checkedInAt) return fail(res, 409, 'You have already checked in today');
  if (action === 'check_out' && (!shift?.checkedInAt || shift.checkedOutAt)) return fail(res, 409, 'There is no open shift to check out');
  const photoId = fieldWorkStore.addPhoto(req.vaultManager.vaultDir, data, req.user.id, photoData);
  if (!shift) { shift = { id: crypto.randomUUID(), userId: req.user.id, date, status: 'on_shift' }; data.shifts.unshift(shift); }
  if (action === 'check_in') { shift.checkedInAt = new Date().toISOString(); shift.checkInPhotoId = photoId; shift.activityStatus = 'working'; shift.lastActiveAt = shift.checkedInAt; }
  else { shift.checkedOutAt = new Date().toISOString(); shift.checkOutPhotoId = photoId; shift.status = 'complete'; shift.activityStatus = 'off_shift'; }
  fieldWorkStore.save(req.vaultManager.vaultDir, data);
  return ok(res, { shift });
}));
app.put('/api/team/field-work/activity-status', guarded((req, res) => {
  const status = req.body?.status;
  if (!['working', 'break', 'travel'].includes(status)) return fail(res, 400, 'Choose working, break, or travel');
  const data = fieldData(req); const shift = data.shifts.find((item) => item.userId === req.user.id && item.date === fieldDay() && item.checkedInAt && !item.checkedOutAt);
  if (!shift) return fail(res, 409, 'Check in before changing your work status');
  shift.activityStatus = status; shift.idleAlertAt = '';
  if (status === 'working') shift.lastActiveAt = new Date().toISOString();
  fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res, { shift });
}));
app.post('/api/team/field-work/activity', guarded((req, res) => {
  const data = fieldData(req); const shift = data.shifts.find((item) => item.userId === req.user.id && item.date === fieldDay() && item.checkedInAt && !item.checkedOutAt);
  if (!shift || shift.activityStatus !== 'working') return fail(res, 409, 'No active working shift');
  shift.lastActiveAt = new Date().toISOString(); shift.idleAlertAt = '';
  fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res);
}));
app.post('/api/team/field-work/trips', guarded((req, res) => {
  const { routeId, odometer, photoData } = req.body || {};
  const data = fieldData(req); const route = data.routes.find((item) => item.id === routeId && item.userId === req.user.id);
  const shift = data.shifts.find((item) => item.userId === req.user.id && item.date === fieldDay() && item.checkedInAt && !item.checkedOutAt);
  const reading = Number(odometer);
  if (!route || route.date !== fieldDay() || !shift || route.status !== 'assigned' || !Number.isFinite(reading) || reading < 0 || reading > 10_000_000) return fail(res, 400, 'Check in first, then choose today’s assigned route and enter a valid departure odometer');
  const photoId = fieldWorkStore.addPhoto(req.vaultManager.vaultDir, data, req.user.id, photoData);
  const trip = { id: crypto.randomUUID(), routeId, userId: req.user.id, startOdometer: reading, departurePhotoId: photoId, startedAt: new Date().toISOString(), status: 'in_progress' };
  data.trips.unshift(trip); route.status = 'in_progress';
  shift.activityStatus = 'travel';
  fieldWorkStore.save(req.vaultManager.vaultDir, data);
  return ok(res, { trip, route });
}));
app.patch('/api/team/field-work/trips/:id/return', guarded((req, res) => {
  const data = fieldData(req); const trip = data.trips.find((item) => item.id === req.params.id && item.userId === req.user.id);
  const reading = Number(req.body?.odometer);
  if (!trip || trip.status !== 'in_progress' || !Number.isFinite(reading) || reading < trip.startOdometer || reading > 10_000_000) return fail(res, 400, 'Return odometer must be at least the departure reading');
  const photoId = fieldWorkStore.addPhoto(req.vaultManager.vaultDir, data, req.user.id, req.body?.photoData);
  trip.endOdometer = reading; trip.distanceKm = reading - trip.startOdometer; trip.returnPhotoId = photoId; trip.returnedAt = new Date().toISOString(); trip.status = 'complete';
  const route = data.routes.find((item) => item.id === trip.routeId); if (route) route.status = 'complete';
  const shift = data.shifts.find((item) => item.userId === req.user.id && item.date === fieldDay() && item.checkedInAt && !item.checkedOutAt);
  if (shift) { shift.activityStatus = 'working'; shift.lastActiveAt = new Date().toISOString(); shift.idleAlertAt = ''; }
  fieldWorkStore.save(req.vaultManager.vaultDir, data);
  return ok(res, { trip, route });
}));
app.post('/api/team/field-work/claims', guarded((req, res) => {
  const { routeId = '', category, amount, note } = req.body || {};
  const value = Number(amount); const data = fieldData(req);
  const route = routeId ? data.routes.find((item) => item.id === routeId && item.userId === req.user.id) : null;
  if (routeId && !route || !['fuel', 'toll', 'parking', 'other'].includes(category) || !Number.isFinite(value) || value <= 0 || value > 10_000_000 || typeof note !== 'string' || !note.trim() || note.length > 500) return fail(res, 400, 'Enter a valid expense type, amount, and reason');
  const claim = { id: crypto.randomUUID(), userId: req.user.id, routeId, category, amount: value, note: note.trim(), status: 'pending', createdAt: new Date().toISOString() };
  data.claims.unshift(claim); fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res, { claim });
}));
app.patch('/api/team/field-work/claims/:id', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const data = fieldData(req); const claim = data.claims.find((item) => item.id === req.params.id);
  if (!claim || !['approved', 'rejected'].includes(req.body?.status)) return fail(res, 400, 'Select a valid claim and decision');
  claim.status = req.body.status; claim.reviewedBy = req.user.id; claim.reviewedAt = new Date().toISOString();
  fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res, { claim });
}));
app.put('/api/team/field-work/retention', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const days = Number(req.body?.days); if (!Number.isInteger(days) || days < 30 || days > 3650) return fail(res, 400, 'Photo retention must be 30 to 3650 days');
  const data = fieldData(req); data.retentionDays = days; fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res, { retentionDays: days });
}));
app.put('/api/team/field-work/inactivity-grace', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const minutes = Number(req.body?.minutes); if (![20, 30, 45, 60].includes(minutes)) return fail(res, 400, 'Choose a grace period of 20, 30, 45, or 60 minutes');
  const data = fieldData(req); data.inactivityGraceMinutes = minutes; fieldWorkStore.save(req.vaultManager.vaultDir, data); return ok(res, { inactivityGraceMinutes: minutes });
}));
app.get('/api/team/field-work/photos/:id', (req, res) => {
  const data = fieldData(req); const photo = data.photos.find((item) => item.id === req.params.id);
  const allowed = req.membership?.projectIds;
  const trip = data.trips.find((item) => [item.departurePhotoId, item.returnPhotoId].includes(req.params.id));
  const route = trip && data.routes.find((item) => item.id === trip.routeId);
  const photoVisible = photo && (photo.userId === req.user.id || fieldManager(req) && (!Array.isArray(allowed) || !route?.projectId || allowed.includes(route.projectId)));
  if (!photoVisible) return fail(res, 404, 'Photo not found');
  try { res.set('Cache-Control', 'private, no-store').type(photo.mime).send(fieldWorkStore.decryptPhoto(req.vaultManager.vaultDir, photo)); }
  catch { return fail(res, 500, 'Could not decrypt the field-work photo. Check that the server encryption key is unchanged.'); }
});

function visibleVaultState(req) {
  const allowed = req.membership?.projectIds;
  if (!Array.isArray(allowed)) return req.vaultManager.state;
  const monitoring = req.vaultManager.state.monitoring || {};
  return {
    ...req.vaultManager.state,
    projects: Object.fromEntries(Object.entries(req.vaultManager.state.projects).filter(([id]) => allowed.includes(id))),
    finances: null,
    monitoring: { ...monitoring, endpoints: (monitoring.endpoints || []).filter((item) => allowed.includes(item.project)), incidents: (monitoring.incidents || []).filter((item) => allowed.includes(item.project)) }
  };
}
app.get('/api/vault', (req, res) => ok(res, { data: visibleVaultState(req) }));

app.get('/api/workspace/backup', auth.requireRole('owner', 'admin'), (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(createSnapshot(req.vaultManager.vaultDir));
  } catch (error) { return fail(res, 400, error.message || 'Could not create a workspace backup'); }
});
app.post('/api/workspace/restore', auth.requireRole('owner', 'admin'), (req, res) => {
  try {
    const restoredFiles = restoreSnapshot(req.vaultManager.vaultDir, req.body?.backup);
    req.vaultManager.syncDerived();
    req.vaultManager.loadAll();
    return ok(res, { restoredFiles });
  } catch (error) { return fail(res, 400, error.message || 'Could not restore this workspace backup'); }
});

app.get('/api/secrets-vault', auth.requireRole('owner', 'admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return ok(res, readSecretsVault(req.vaultManager.vaultDir)); }
  catch { return fail(res, 500, 'Could not read the encrypted secrets vault'); }
});
app.put('/api/secrets-vault', auth.requireRole('owner', 'admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const saved = writeSecretsVault(req.vaultManager.vaultDir, req.body?.revision, req.body?.envelope);
    return saved ? ok(res, { revision: saved.revision, updatedAt: saved.updatedAt }) : fail(res, 409, 'The vault changed in another session. Reload it before saving again.');
  } catch (error) { return fail(res, 400, error.message || 'Could not save the encrypted secrets vault'); }
});
app.get('/api/secrets-vault/audit', auth.requireRole('owner', 'admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return ok(res, { entries: readSecretsVaultAudit(req.vaultManager.vaultDir) }); }
  catch { return fail(res, 500, 'Could not read the secrets vault audit history'); }
});
app.post('/api/secrets-vault/audit', auth.requireRole('owner', 'admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return ok(res, { entry: appendSecretsVaultAudit(req.vaultManager.vaultDir, req.user, req.body?.action, req.body?.entryId || '') }); }
  catch (error) { return fail(res, 400, error.message || 'Could not record the vault audit event'); }
});

app.get('/api/billing', auth.requireRole('owner', 'admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return ok(res, readBilling(req.vaultManager.vaultDir)); }
  catch (error) { return fail(res, 500, error.message || 'Could not read billing records'); }
});
app.put('/api/billing', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  res.set('Cache-Control', 'no-store');
  const saved = saveBilling(req.vaultManager.vaultDir, req.body, req.user);
  return saved ? ok(res, saved) : fail(res, 409, 'Billing changed in another session. Reload before saving again.');
}));
app.put('/api/billing/project-templates/:projectId', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  res.set('Cache-Control', 'no-store');
  const saved = saveProjectTemplate(req.vaultManager.vaultDir, req.params.projectId, req.body, req.user);
  return ok(res, { revision: saved.revision, projectTemplates: saved.data.projectTemplates });
}));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.set(res, { token: req.sessionToken, organizationId: req.organization.id, userId: req.user.id, projectIds: req.membership.projectIds ?? null });
  res.on('close', () => sseClients.delete(res));
  res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
});

app.get('/api/vault/file', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return fail(res, 400, 'Missing path query parameter');
  const content = req.vaultManager.getFile(relPath);
  if (content === null) return fail(res, 404, 'File not found');
  return ok(res, { path: relPath, content });
});

app.post('/api/vault/file', guarded((req, res) => {
  const { path: relPath, content } = req.body;
  if (!relPath || typeof content !== 'string') return fail(res, 400, 'Missing path or content');
  req.vaultManager.saveFile(relPath, content);
  return ok(res, { message: 'File saved successfully' });
}));

app.post('/api/tasks/status', guarded((req, res) => {
  const { project, taskId, status, note } = req.body;
  if (!project || !taskId || !status) return fail(res, 400, 'Missing project, taskId, or status');
  const task = req.vaultManager.state.projects[project]?.tasks.find((item) => item.id === taskId);
  if (task?.status === 'review' && status === 'done' && !['owner', 'admin'].includes(req.user.role)) return fail(res, 403, 'A workspace admin must approve work in review');
  if (!req.vaultManager.updateTaskStatus(project, taskId, status, note)) return fail(res, 404, 'Task or project not found, or invalid status');
  req.vaultManager.addTaskActivity(project, taskId, { type: 'status', author: req.user.name, content: `Moved to ${status}` });
  if (task && task.status !== status) void slack.notify(req.vaultManager.vaultDir, { event: 'task.status', projectId: project, text: `Task “${task.title}” moved to ${status} in ${req.vaultManager.state.projects[project]?.name || project}.` });
  return ok(res);
}));

app.post('/api/tasks/reminder', guarded((req, res) => {
  const { project, taskId, reminderAt = '' } = req.body;
  if (!project || !taskId || typeof reminderAt !== 'string') return fail(res, 400, 'Project, task ID, and a valid reminder time are required');
  if (!req.vaultManager.updateTaskReminder(project, taskId, reminderAt)) return fail(res, 404, 'Task not found');
  req.vaultManager.addTaskActivity(project, taskId, { type: 'comment', author: req.user.name, content: reminderAt ? `Reminder set for ${reminderAt}` : 'Task reminder cleared' });
  return ok(res);
}));

app.post('/api/tasks/approve', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const { project, taskId } = req.body;
  const task = req.vaultManager.state.projects[project]?.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== 'review') return fail(res, 409, 'Only tasks in review can be approved');
  if (!req.vaultManager.updateTaskStatus(project, taskId, 'done')) return fail(res, 404, 'Task not found');
  req.vaultManager.addTaskActivity(project, taskId, { type: 'status', author: req.user.name, content: 'Approved and completed' });
  void slack.notify(req.vaultManager.vaultDir, { event: 'task.status', projectId: project, text: `Task “${task.title}” was approved and completed in ${req.vaultManager.state.projects[project]?.name || project}.` });
  return ok(res);
}));

app.get('/api/tasks/ai/providers', auth.requireRole('owner', 'admin'), (req, res) => ok(res, { providers: configuredProviders() }));
app.post('/api/tasks/:project/:taskId/ai/retry', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const { project, taskId } = req.params;
  const task = req.vaultManager.state.projects[project]?.tasks.find((item) => item.id === taskId);
  if (!task?.aiProvider || task.aiRunStatus !== 'failed') return fail(res, 409, 'Only failed scheduled AI tasks can be retried');
  if (!configuredProviders().some((provider) => provider.id === task.aiProvider)) return fail(res, 503, 'Configure the selected AI provider before retrying');
  return req.vaultManager.setAiRunStatus(project, taskId, 'queued', new Date().toISOString()) ? ok(res) : fail(res, 404, 'Task not found');
}));

app.get('/api/tasks/:project/:taskId/activity', guarded((req, res) => {
  ok(res, { entries: req.vaultManager.getTaskActivity(req.params.project, req.params.taskId) });
}));

app.get('/api/tasks/templates', (req, res) => {
  const templates = req.vaultManager.getTaskTemplates();
  const allowed = req.membership.projectIds;
  ok(res, { templates: Array.isArray(allowed) ? templates.filter((template) => !template.project || allowed.includes(template.project)) : templates });
});
app.put('/api/tasks/templates', guarded((req, res) => {
  const allowed = req.membership.projectIds;
  if (Array.isArray(allowed) && (req.body.templates || []).some((template) => template.project && !allowed.includes(template.project))) return fail(res, 403, 'A task template references a project your account cannot access');
  return ok(res, { templates: req.vaultManager.saveTaskTemplates(req.body.templates) });
}));

app.post('/api/tasks/:project/:taskId/activity', guarded((req, res) => {
  const { type, content = '', value = '' } = req.body;
  const text = String(content).trim();
  if (type === 'comment' && (!text || text.length > 2000)) return fail(res, 400, 'Comment must be between 1 and 2000 characters');
  if (type === 'time' && (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1440)) return fail(res, 400, 'Time must be between 1 and 1440 minutes');
  if (type === 'link') {
    try { if (!['http:', 'https:'].includes(new URL(String(value)).protocol) || !text) throw new Error(); }
    catch { return fail(res, 400, 'Enter a valid web link and label'); }
  }
  if (!['comment', 'time', 'link'].includes(type)) return fail(res, 400, 'Invalid activity type');
  const entry = req.vaultManager.addTaskActivity(req.params.project, req.params.taskId, { type, author: req.user.name, content: text, value: String(value) });
  return ok(res, { entry });
}));

app.post('/api/tasks/toggle-subtask', guarded((req, res) => {
  const { project, taskId, subtaskText, completed } = req.body;
  if (!project || !taskId || !subtaskText) return fail(res, 400, 'Missing required fields');
  return req.vaultManager.toggleSubtask(project, taskId, subtaskText, completed)
    ? ok(res)
    : fail(res, 404, 'Task or subtask not found');
}));

app.post('/api/tasks/create', guarded((req, res) => {
  const { project, task } = req.body;
  if (!project || !task?.title) return fail(res, 400, 'Missing project or task title');
  if (task.aiProvider) {
    if (!['owner', 'admin'].includes(req.user.role)) return fail(res, 403, 'Only workspace admins can schedule AI runs');
    if (!configuredProviders().some((provider) => provider.id === task.aiProvider)) return fail(res, 503, 'Configure the selected AI provider before scheduling a run');
  }
  const id = req.vaultManager.createTask(project, task);
  if (id) void slack.notify(req.vaultManager.vaultDir, { event: 'task.created', projectId: project, text: `Task “${task.title}” was created in ${req.vaultManager.state.projects[project]?.name || project}.` });
  return id ? ok(res, { id }) : fail(res, 404, 'Project not found');
}));
app.get('/api/tasks/trash', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const tasks = req.vaultManager.getDeletedTasks();
  const allowed = req.membership.projectIds;
  return ok(res, { tasks: Array.isArray(allowed) ? tasks.filter((task) => allowed.includes(task.project)) : tasks });
});
app.post('/api/tasks/delete', guarded((req, res) => {
  const { project, taskId, reason } = req.body;
  if (!project || !taskId || String(reason || '').trim().length < 5) return fail(res, 400, 'Project, task ID, and a clear deletion reason are required');
  return req.vaultManager.deleteTask(project, taskId, reason, req.user.name)
    ? ok(res, { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    : fail(res, 404, 'Task not found');
}));
app.post('/api/tasks/restore', guarded((req, res) => {
  const { project, taskId } = req.body;
  if (!project || !taskId) return fail(res, 400, 'Project and task ID are required');
  return req.vaultManager.restoreTask(project, taskId) ? ok(res) : fail(res, 404, 'Task is no longer available to restore');
}));

app.post('/api/projects/create', guarded((req, res) => {
  ok(res, { project: req.vaultManager.createProject(req.body) });
}));

app.post('/api/projects/:id/metadata', guarded((req, res) => {
  ok(res, { metadata: req.vaultManager.updateProjectMetadata(req.params.id, { ...req.body, author: req.user.name }) });
}));

app.delete('/api/projects/:id', guarded((req, res) => {
  req.vaultManager.deleteProject(req.params.id);
  ok(res, { message: 'Project moved to vault/.trash' });
}));

app.post('/api/features/create', guarded((req, res) => {
  const { project, feature } = req.body;
  if (!project || !feature?.name) return fail(res, 400, 'Missing project or feature name');
  ok(res, { data: req.vaultManager.addFeature(project, feature) });
}));

app.post('/api/finances/revenue', guarded((req, res) => {
  const { project, revenue } = req.body;
  if (!project || !revenue?.client) return fail(res, 400, 'Missing project or revenue client');
  ok(res, { data: req.vaultManager.addRevenueStream(project, revenue) });
}));

app.post('/api/finances/expense', guarded((req, res) => {
  const { project, expense } = req.body;
  if (!project || !expense?.item) return fail(res, 400, 'Missing project or expense item');
  ok(res, { data: req.vaultManager.addExpense(project, expense) });
}));

app.post('/api/finances/overhead', guarded((req, res) => {
  const { expense } = req.body;
  if (!expense?.service) return fail(res, 400, 'Missing expense service');
  ok(res, { data: req.vaultManager.addOverhead(expense) });
}));

// Re-read everything from disk (covers a missed file-watcher event).
app.post('/api/vault/reload', (req, res) => {
  req.vaultManager.syncDerived();
  req.vaultManager.loadAll();
  ok(res, { data: visibleVaultState(req) });
});

app.post('/api/monitoring/endpoints', guarded((req, res) => {
  if (!HEALTH_MONITOR_ENABLED) return res.status(503).json({ success: false, error: 'Active endpoint checks are disabled in hosted mode' });
  const endpoint = req.body;
  if (!endpoint?.url || !endpoint?.name) return fail(res, 400, 'Missing endpoint name or url');
  ok(res, { data: req.vaultManager.addEndpoint(endpoint) });
}));

app.post('/api/monitoring/incidents', guarded((req, res) => {
  const incident = req.body;
  if (!incident?.title) return fail(res, 400, 'Missing incident title');
  const data = req.vaultManager.addIncident(incident);
  void slack.notify(req.vaultManager.vaultDir, { event: 'incident.logged', projectId: incident.project || '', text: `Incident logged: ${String(incident.title).slice(0, 300)} (${incident.severity || 'severity not set'}).` });
  ok(res, { data });
}));

app.get('/api/monitoring/status', (req, res) => {
  const { endpoints, incidents, meta } = req.vaultManager.state.monitoring;
  const allowed = req.membership.projectIds;
  const visibleEndpoints = Array.isArray(allowed) ? endpoints.filter((item) => allowed.includes(item.project)) : endpoints;
  const visibleIncidents = Array.isArray(allowed) ? incidents.filter((item) => allowed.includes(item.project)) : incidents;
  const metrics = req.healthMonitor.getMetrics();
  const visibleMetrics = Array.isArray(allowed) ? Object.fromEntries(Object.entries(metrics).filter(([, metric]) => allowed.includes(metric.project))) : metrics;
  const databaseChecks = req.databaseMonitor.publicStatus(req.vaultManager.vaultDir);
  const visibleDatabases = Array.isArray(allowed) ? databaseChecks.filter((item) => allowed.includes(item.project)) : databaseChecks;
  ok(res, { data: { endpoints: visibleEndpoints, metrics: visibleMetrics, incidents: visibleIncidents, databases: visibleDatabases, databaseMonitoringConfigured: req.databaseMonitor.configured, meta } });
});

app.get('/api/monitoring/databases', auth.requireRole('owner', 'admin'), (req, res) => {
  const allowed = req.membership.projectIds;
  const statuses = req.databaseMonitor.publicStatus(req.vaultManager.vaultDir);
  return ok(res, { configured: req.databaseMonitor.configured, databases: Array.isArray(allowed) ? statuses.filter((item) => allowed.includes(item.project)) : statuses });
});
app.post('/api/monitoring/databases', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  const created = req.databaseMonitor.add(req.vaultManager.vaultDir, req.body, req.vaultManager.state.projects);
  void req.databaseMonitor.checkOne(req.vaultManager.vaultDir, req.databaseMonitor.read(req.vaultManager.vaultDir).find((item) => item.id === created.id))
    .then(() => broadcast(req.organization.id, 'database_update', req.databaseMonitor.publicStatus(req.vaultManager.vaultDir)))
    .catch(() => {});
  return ok(res, { database: created });
}));
app.delete('/api/monitoring/databases/:id', auth.requireRole('owner', 'admin'), guarded((req, res) => {
  return req.databaseMonitor.remove(req.vaultManager.vaultDir, req.params.id) ? ok(res) : fail(res, 404, 'Database monitor not found');
}));
app.post('/api/monitoring/databases/check-now', auth.requireRole('owner', 'admin'), asyncRoute(async (req, res) => {
  const results = await req.databaseMonitor.checkAll(req.vaultManager.vaultDir);
  broadcast(req.organization.id, 'database_update', req.databaseMonitor.publicStatus(req.vaultManager.vaultDir));
  return ok(res, { results });
}));

app.post('/api/monitoring/check-now', async (req, res) => {
  if (!HEALTH_MONITOR_ENABLED) return res.status(503).json({ success: false, error: 'Active endpoint checks are disabled in hosted mode' });
  const results = await req.healthMonitor.checkAll(true);
  const allowed = req.membership.projectIds;
  ok(res, { results: Array.isArray(allowed) ? results.filter((item) => allowed.includes(item.project)) : results });
});

// Serve the compiled client
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[Bhodhix OS Engine] Server running on http://${HOST}:${PORT}`);
  console.log(`[Bhodhix OS Engine] Legacy Markdown Vault mounted at: ${legacyVaultPath}`);
  console.log(`[Bhodhix OS Engine] Auth store path: ${authStore}`);
}).on('error', (err) => {
  console.error(`[Bhodhix OS Engine] Could not listen on ${HOST}:${PORT}: ${err.message}`);
});
module.exports = server;
