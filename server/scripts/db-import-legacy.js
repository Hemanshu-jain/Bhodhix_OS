const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const markdown = require('../src/markdown');
const { createPool, migrate } = require('../src/postgres');
const { buildArchiveFiles, archiveFiles } = require('./db-archive-legacy');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jsonColumns = {
  organizations: ['metadata'], users: ['metadata'], memberships: ['project_ids'], invites: ['metadata'],
  workspace_profiles: ['profile'], projects: ['metadata', 'finances'], features: ['metadata'],
  tasks: ['tags', 'subtasks', 'metadata'], task_activity: ['metadata'], task_trash: ['task_snapshot', 'activity_snapshot'],
  workspace_documents: ['metadata'], billing_clients: ['details'], billing_documents: ['metadata'],
  billing_document_items: ['metadata'], finance_entries: ['metadata'], monitoring_endpoints: ['metadata'],
  monitoring_incidents: ['metadata'], database_monitors: ['encryption_metadata'], field_routes: ['metadata'],
  field_route_stops: ['metadata'], field_shifts: ['metadata'], field_trips: ['metadata'],
  field_expense_claims: ['metadata'], field_photos: ['metadata'], encrypted_workspace_data: ['encryption_metadata'],
  secret_vault_audit: ['metadata'], notification_deliveries: ['metadata'], mcp_oauth_records: ['record'],
  migration_runs: ['counts'], workspace_settings: ['value']
};
const uuid = (value, key) => {
  if (uuidPattern.test(String(value || ''))) return String(value);
  const bytes = crypto.createHash('sha256').update(String(key || value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const jsonFile = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const rawFile = (file) => { try { return fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const parsedFile = (file) => { const raw = rawFile(file); return raw ? { raw: raw.toString('utf8'), ...matter(raw.toString('utf8')) } : null; };
const dateTime = (value) => { const time = typeof value === 'number' ? value : Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
const dateOnly = (value) => { const normalized = String(value || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized; const match = normalized.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null; };
const amount = (value) => { const number = Number(String(value ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(number) ? number : 0; };
const asJson = (value) => value == null ? null : value;

async function upsert(client, table, columns, values, keyColumns) {
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  const params = columns.map((_, index) => `$${index + 1}`).join(', ');
  const keySet = new Set(keyColumns);
  const updates = columns.filter((column) => !keySet.has(column)).map((column) => `"${column}" = EXCLUDED."${column}"`).join(', ');
  const json = new Set(jsonColumns[table] || []);
  const prepared = values.map((value, index) => json.has(columns[index]) && value != null ? JSON.stringify(value) : value);
  await client.query(`INSERT INTO "${table}" (${quoted}) VALUES (${params}) ON CONFLICT (${keyColumns.map((column) => `"${column}"`).join(', ')}) DO UPDATE SET ${updates}`, prepared);
}

function resolveSources() {
  const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'bhodix-command-center') : '';
  const useAppData = appData && fs.existsSync(appData);
  const authRoot = useAppData ? path.join(appData, 'auth') : path.resolve(__dirname, '../');
  return {
    useAppData,
    appData,
    authFile: path.resolve(process.env.AUTH_STORE_FILE || path.join(authRoot, useAppData ? 'team.json' : '.team.json')),
    mcpFile: path.resolve(process.env.MCP_OAUTH_STORE_FILE || path.join(authRoot, useAppData ? 'mcp-oauth.json' : '.mcp-oauth.json')),
    vaultRoot: path.resolve(process.env.LEGACY_VAULT_DIR || (useAppData ? path.join(appData, 'vault') : path.join(__dirname, '../../vault'))),
    tenantRoot: path.resolve(process.env.TENANT_DATA_DIR || (useAppData ? path.join(appData, 'tenants') : path.join(__dirname, '../../data/tenants')))
  };
}

function readTasks(file, projectId) {
  if (!fs.existsSync(file)) return [];
  return markdown.parseTasks(fs.readFileSync(file, 'utf8'), projectId);
}

function collectWorkspace(orgId, root, sourceKey, mcpOAuth) {
  const bundle = { orgId, root, sourceKey, projects: [], documents: [], activities: [], trash: [], settings: [], encrypted: [], billing: null, endpoints: [], finance: [], mcpOAuth };
  bundle.fieldwork = jsonFile(path.join(root, 'docs', 'field-work.json'), { routes: [], shifts: [], trips: [], claims: [], photos: [] });
  bundle.photosRoot = path.join(root, 'docs', 'field-work-photos');
  const profile = parsedFile(path.join(root, 'company.md'));
  bundle.profile = profile ? { metadata: profile.data, content: profile.content } : {};
  const projectsRoot = path.join(root, 'projects');
  const projectIds = fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && markdown.isSafeId(entry.name)).map((entry) => entry.name) : [];
  for (const projectId of projectIds) {
    const directory = path.join(projectsRoot, projectId);
    const projectFile = parsedFile(path.join(directory, 'project.md'));
    const featureFile = parsedFile(path.join(directory, 'features.md'));
    const financeFile = parsedFile(path.join(directory, 'finances.md'));
    const tasksFile = path.join(directory, 'tasks.md');
    const features = featureFile ? markdown.parseMarkdownTable(featureFile.content) : [];
    const tasks = readTasks(tasksFile, projectId);
    const finances = financeFile ? { metadata: financeFile.data, content: financeFile.content, tables: markdown.parseFinanceTables(financeFile.content) } : {};
    bundle.projects.push({ id: projectId, metadata: projectFile?.data || {}, overview: projectFile?.content || '', features, tasks, finances });
    const activityRoot = path.join(directory, 'docs', 'task-activity');
    if (fs.existsSync(activityRoot)) for (const name of fs.readdirSync(activityRoot).filter((item) => item.endsWith('.md'))) {
      const taskId = name.slice(0, -3);
      const activity = parsedFile(path.join(activityRoot, name));
      for (const [index, row] of (activity ? markdown.parseMarkdownTable(activity.content) : []).entries()) bundle.activities.push({ projectId, taskId, index, row });
    }
  }

  const walk = (directory, prefix = '') => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name.endsWith('.tmp')) continue;
      if (entry.isDirectory()) { walk(absolute, relative); continue; }
      if (!entry.isFile()) continue;
      if (relative.endsWith('.md')) {
        const parsed = matter(fs.readFileSync(absolute, 'utf8'));
        const parts = relative.split('/');
        const projectId = parts[0] === 'projects' && projectIds.includes(parts[1]) ? parts[1] : null;
        bundle.documents.push({ path: relative, projectId, title: parsed.data.title || path.basename(relative, '.md'), content: fs.readFileSync(absolute, 'utf8'), metadata: parsed.data });
      } else if (entry.name.startsWith('.') && /\.(?:enc|json)$/i.test(entry.name)) {
        const bytes = fs.readFileSync(absolute);
        if (['.done-seen.json', '.task-sequence.json'].includes(entry.name)) bundle.settings.push({ key: entry.name, value: jsonFile(absolute, {}) });
        else if (entry.name === '.secrets-vault.audit.json') {
          for (const [index, row] of (jsonFile(absolute, []) || []).entries()) bundle.settings.push({ key: `${entry.name}:${index}`, value: row, audit: true });
        } else bundle.encrypted.push({ key: entry.name, bytes });
      }
    }
  };
  walk(root);
  const billing = jsonFile(path.join(root, 'billing', 'billing.json'), null);
  bundle.billing = billing?.data || null;
  const endpointFile = parsedFile(path.join(root, 'monitoring', 'endpoints.md'));
  bundle.endpoints = endpointFile ? markdown.parseMarkdownTable(endpointFile.content) : [];
  const ledger = parsedFile(path.join(root, 'finances', 'bhodix-ledger.md'));
  if (ledger) {
    for (const { heading, body } of markdown.sectionsByHeading(ledger.content)) {
      if (/central|overhead/i.test(heading)) for (const [index, row] of markdown.parseMarkdownTable(body).entries()) bundle.finance.push({ id: `overhead:${index}`, type: 'overhead', row });
    }
  }
  for (const project of bundle.projects) {
    for (const [index, row] of project.finances.tables?.revenueStreams?.entries() || []) bundle.finance.push({ id: `${project.id}:revenue:${index}`, projectId: project.id, type: 'revenue', row });
    for (const [index, row] of project.finances.tables?.expenses?.entries() || []) bundle.finance.push({ id: `${project.id}:expense:${index}`, projectId: project.id, type: 'expense', row });
  }
  const trashRoot = path.join(root, '.trash', 'tasks');
  if (fs.existsSync(trashRoot)) for (const project of fs.readdirSync(trashRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) for (const name of fs.readdirSync(path.join(trashRoot, project.name)).filter((item) => item.endsWith('.json'))) {
    const row = jsonFile(path.join(trashRoot, project.name, name), null);
    if (row) bundle.trash.push({ projectId: project.name, row });
  }
  return bundle;
}

function mapAuth(auth) {
  const organizations = (auth.organizations || []).map((item) => ({ ...item }));
  const users = (auth.users || []).map((item) => ({ ...item, id: uuid(item.id, `user:${item.email}`) }));
  const userIds = new Map((auth.users || []).map((item, index) => [item.id, users[index].id]));
  const memberships = (auth.memberships || []).map((item) => ({ ...item, id: uuid(item.id, `membership:${item.userId}:${item.organizationId}`), userId: userIds.get(item.userId) || uuid(item.userId, `user:${item.userId}`) }));
  const membershipIds = new Map((auth.memberships || []).map((item, index) => [item.id, memberships[index].id]));
  const sessions = (auth.sessions || []).map((item) => ({ ...item, userId: userIds.get(item.userId) || uuid(item.userId, `user:${item.userId}`), membershipId: membershipIds.get(item.membershipId) || uuid(item.membershipId, `membership:${item.membershipId}`) }));
  return { organizations, memberships, users, sessions, invites: auth.invites || [], emailTokens: auth.emailTokens || [], userIds };
}

function validateAuth(mapped) {
  const organizationIds = new Set(mapped.organizations.map((item) => item.id));
  const userIds = new Set(mapped.users.map((item) => item.id));
  const membershipIds = new Set(mapped.memberships.map((item) => item.id));
  for (const user of mapped.users) {
    if (!user.email || !user.passwordSalt || !user.passwordHash) throw new Error('Legacy import stopped: an account is missing its email or password verifier. No database writes were made.');
  }
  for (const membership of mapped.memberships) {
    if (!organizationIds.has(membership.organizationId) || !userIds.has(membership.userId)) throw new Error('Legacy import stopped: an account membership references a missing organization or user. No database writes were made.');
  }
  for (const invite of mapped.invites) {
    if (!organizationIds.has(invite.organizationId) || !invite.email || !invite.tokenHash || (invite.invitedBy && !userIds.has(mapped.userIds.get(invite.invitedBy)))) throw new Error('Legacy import stopped: an invitation has incomplete or unmatched account references. No database writes were made.');
  }
  for (const session of mapped.sessions) {
    if (!session.tokenHash || !dateTime(session.expiresAt) || !userIds.has(session.userId) || !membershipIds.has(session.membershipId) || !organizationIds.has(session.organizationId)) throw new Error('Legacy import stopped: a login session has incomplete or unmatched account references. No database writes were made.');
  }
  for (const token of mapped.emailTokens) {
    if (!token.tokenHash || !token.purpose || !userIds.has(mapped.userIds.get(token.userId)) || !dateTime(token.expiresAt)) throw new Error('Legacy import stopped: an email verification token has incomplete account references. No database writes were made.');
  }
}

function migrationCounts(bundle) {
  return {
    projects: bundle.projects.length,
    features: bundle.projects.reduce((sum, item) => sum + item.features.length, 0),
    tasks: bundle.projects.reduce((sum, item) => sum + item.tasks.length, 0),
    taskActivity: bundle.activities.length,
    documents: bundle.documents.length,
    billingClients: bundle.billing?.clients?.length || 0,
    quotations: bundle.billing?.quotations?.length || 0,
    invoices: bundle.billing?.invoices?.length || 0,
    financeEntries: bundle.finance.length,
    monitoringEndpoints: bundle.endpoints.length,
    encryptedSettings: bundle.encrypted.length,
    fieldRoutes: (bundle.fieldwork.routes || []).length,
    fieldShifts: (bundle.fieldwork.shifts || []).length,
    fieldTrips: (bundle.fieldwork.trips || []).length,
    fieldClaims: (bundle.fieldwork.claims || []).length,
    fieldPhotos: (bundle.fieldwork.photos || []).length,
    mcpOAuthRecords: Object.values(bundle.mcpOAuth || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0),
    trashedTasks: bundle.trash.length
  };
}

async function main() {
  const sources = resolveSources();
  const auth = jsonFile(sources.authFile, { organizations: [], users: [], memberships: [], sessions: [], invites: [], emailTokens: [] });
  const mcpOAuth = jsonFile(sources.mcpFile, {});
  const mappedAuth = mapAuth(auth);
  validateAuth(mappedAuth);
  const defaultOrgId = process.env.LEGACY_ORGANIZATION_ID || mappedAuth.organizations[0]?.id || 'bhodhix';
  const orgIds = [...new Set([...mappedAuth.organizations.map((item) => item.id), defaultOrgId])];
  const bundles = orgIds.map((orgId) => {
    const isPrimary = orgId === defaultOrgId;
    const root = isPrimary ? sources.vaultRoot : path.join(sources.tenantRoot, orgId);
    return collectWorkspace(orgId, root, isPrimary ? 'vault' : `tenants/${orgId}`, mcpOAuth);
  });
  const counts = Object.fromEntries(bundles.map((bundle) => [bundle.orgId, migrationCounts(bundle)]));
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ dryRun: true, organizations: orgIds.length, auth: { users: mappedAuth.users.length, memberships: mappedAuth.memberships.length, sessions: mappedAuth.sessions.length, invites: mappedAuth.invites.length }, counts }, null, 2));
    return;
  }

  const pool = createPool();
  const archived = buildArchiveFiles();
  const sourceFingerprint = crypto.createHash('sha256').update(archived.map((file) => `${file.sourceKey}:${file.relativePath}:${crypto.createHash('sha256').update(file.content).digest('hex')}`).sort().join('\n')).digest('hex');
  try {
    await migrate(pool);
    await archiveFiles(pool, archived);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const organization of mappedAuth.organizations) {
        await upsert(client, 'organizations', ['id', 'slug', 'name', 'active', 'created_at', 'metadata'], [organization.id, organization.slug || organization.id, organization.name || organization.id, organization.active !== false, dateTime(organization.createdAt) || new Date().toISOString(), organization], ['id']);
      }
      for (const orgId of orgIds) if (!mappedAuth.organizations.some((item) => item.id === orgId)) await upsert(client, 'organizations', ['id', 'slug', 'name', 'active', 'metadata'], [orgId, orgId, orgId, true, {}], ['id']);

      for (const user of mappedAuth.users) {
        const metadata = { ...user }; delete metadata.passwordSalt; delete metadata.passwordHash;
        await upsert(client, 'users', ['id', 'name', 'email', 'password_salt', 'password_hash', 'active', 'email_verified', 'created_at', 'metadata'], [user.id, user.name, user.email, user.passwordSalt || '', user.passwordHash || '', user.active !== false, user.emailVerified !== false, dateTime(user.createdAt) || new Date().toISOString(), metadata], ['id']);
      }
      for (const membership of mappedAuth.memberships) await upsert(client, 'memberships', ['id', 'organization_id', 'user_id', 'role', 'active', 'created_at', 'work_mode', 'project_ids'], [membership.id, membership.organizationId, membership.userId, ['owner', 'admin', 'member', 'viewer'].includes(membership.role) ? membership.role : 'member', membership.active !== false, dateTime(membership.createdAt) || new Date().toISOString(), membership.workMode || 'office', asJson(membership.projectIds ?? null)], ['id']);
      for (const invite of mappedAuth.invites) if (invite.tokenHash) await upsert(client, 'invites', ['id', 'organization_id', 'email', 'role', 'token_hash', 'invited_by', 'created_at', 'expires_at', 'accepted_at', 'metadata'], [uuid(invite.id, `invite:${invite.tokenHash}`), invite.organizationId, invite.email, ['admin', 'member', 'viewer'].includes(invite.role) ? invite.role : 'member', invite.tokenHash, mappedAuth.userIds.get(invite.invitedBy) || null, dateTime(invite.createdAt) || new Date().toISOString(), dateTime(invite.expiresAt) || new Date().toISOString(), dateTime(invite.acceptedAt), invite], ['id']);
      for (const session of mappedAuth.sessions) await upsert(client, 'sessions', ['token_hash', 'user_id', 'membership_id', 'organization_id', 'expires_at'], [session.tokenHash, mappedAuth.userIds.get(session.userId) || uuid(session.userId, `user:${session.userId}`), uuid(session.membershipId, `membership:${session.membershipId}`), session.organizationId, dateTime(session.expiresAt)], ['token_hash']);
      for (const token of mappedAuth.emailTokens) if (token.tokenHash) await upsert(client, 'email_tokens', ['token_hash', 'user_id', 'purpose', 'expires_at'], [token.tokenHash, mappedAuth.userIds.get(token.userId) || uuid(token.userId, `user:${token.userId}`), token.purpose, dateTime(token.expiresAt) || new Date().toISOString()], ['user_id', 'purpose']);

      for (const bundle of bundles) {
        const orgId = bundle.orgId;
        await upsert(client, 'workspace_profiles', ['organization_id', 'profile'], [orgId, bundle.profile], ['organization_id']);
        const projectIds = new Set(bundle.projects.map((item) => item.id));
        for (const project of bundle.projects) {
          await upsert(client, 'projects', ['organization_id', 'project_id', 'name', 'overview', 'metadata', 'finances'], [orgId, project.id, project.metadata.name || project.id, project.overview, project.metadata, project.finances], ['organization_id', 'project_id']);
          for (const [index, feature] of project.features.entries()) await upsert(client, 'features', ['organization_id', 'project_id', 'feature_id', 'name', 'description', 'status', 'readiness', 'owner', 'metadata'], [orgId, project.id, String(feature.id || `feature-${index + 1}`), feature.feature_name || feature.name || '', feature.description || '', feature.status || 'planned', feature.readiness || '', feature.owner || '', feature], ['organization_id', 'project_id', 'feature_id']);
          for (const task of project.tasks) {
            const user = mappedAuth.users.find((item) => item.id === task.assignee || item.name.toLowerCase() === String(task.assignee || '').toLowerCase() || item.email.toLowerCase() === String(task.assignee || '').toLowerCase());
            await upsert(client, 'tasks', ['organization_id', 'project_id', 'task_id', 'title', 'description', 'status', 'priority', 'assignee_id', 'assignee_label', 'start_at', 'due_at', 'reminder_at', 'tags', 'subtasks', 'metadata'], [orgId, project.id, task.id, task.title, task.description || '', ['todo', 'in_progress', 'review', 'done', 'hold', 'upcoming'].includes(task.status) ? task.status : 'todo', ['urgent', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium', user?.id || null, task.assignee || '', dateTime(task.startAt), dateTime(task.dueDate), dateTime(task.reminderAt), task.tags || [], task.subtasks || [], task], ['organization_id', 'project_id', 'task_id']);
          }
        }
        for (const activity of bundle.activities) await upsert(client, 'task_activity', ['id', 'organization_id', 'project_id', 'task_id', 'type', 'author', 'content', 'value', 'created_at', 'metadata'], [uuid('', `${orgId}:${activity.projectId}:${activity.taskId}:${activity.index}:${JSON.stringify(activity.row)}`), orgId, activity.projectId, activity.taskId, activity.row.type || 'comment', activity.row.author || '', activity.row.content || '', activity.row.value || '', dateTime(activity.row.created_at) || new Date().toISOString(), activity.row], ['id']);
        for (const document of bundle.documents) await upsert(client, 'workspace_documents', ['id', 'organization_id', 'project_id', 'path', 'title', 'content', 'metadata'], [uuid('', `${orgId}:${document.path}`), orgId, document.projectId, document.path, document.title, document.content, document.metadata], ['organization_id', 'path']);
        for (const item of bundle.trash) {
          if (!projectIds.has(item.projectId)) continue;
          const deletedAt = dateTime(item.row.deletedAt);
          if (!deletedAt) continue;
          const taskSnapshot = { ...item.row, task: markdown.parseTasks(item.row.block || '', item.projectId)[0] || null };
          const activitySnapshot = item.row.activity ? [{ markdown: item.row.activity }] : [];
          await upsert(client, 'task_trash', ['organization_id', 'project_id', 'task_id', 'title', 'reason', 'deleted_by', 'deleted_at', 'expires_at', 'task_snapshot', 'activity_snapshot'], [orgId, item.projectId, item.row.id, item.row.title || '', item.row.reason || '', item.row.deletedBy || '', deletedAt, new Date(Date.parse(deletedAt) + 7 * 86400000).toISOString(), taskSnapshot, activitySnapshot], ['organization_id', 'project_id', 'task_id']);
        }
        for (const setting of bundle.settings) {
          if (setting.audit) await upsert(client, 'secret_vault_audit', ['id', 'organization_id', 'user_id', 'action', 'entry_id', 'created_at', 'metadata'], [uuid(setting.value.id, `${orgId}:${setting.key}`), orgId, mappedAuth.userIds.get(setting.value.userId) || null, setting.value.action || 'created', setting.value.entryId || '', dateTime(setting.value.time) || new Date().toISOString(), setting.value], ['id']);
          else await upsert(client, 'workspace_settings', ['organization_id', 'setting_key', 'value'], [orgId, setting.key, setting.value], ['organization_id', 'setting_key']);
        }
        for (const entry of bundle.encrypted) await upsert(client, 'encrypted_workspace_data', ['id', 'organization_id', 'owner_user_id', 'data_type', 'data_key', 'revision', 'ciphertext', 'encryption_metadata'], [uuid('', `${orgId}:${entry.key}`), orgId, null, 'legacy-file', entry.key, 1, entry.bytes, { format: 'legacy-file', fileName: entry.key }], ['id']);
        const fieldwork = bundle.fieldwork;
        const fieldRouteIds = new Map();
        for (const route of fieldwork.routes || []) {
          const routeId = uuid(route.id, `${orgId}:route:${JSON.stringify(route)}`);
          fieldRouteIds.set(route.id, routeId);
          await upsert(client, 'field_routes', ['id', 'organization_id', 'route_date', 'assigned_to', 'planned_distance_km', 'metadata'], [routeId, orgId, dateOnly(route.date) || new Date().toISOString().slice(0, 10), mappedAuth.userIds.get(route.userId) || null, amount(route.plannedKm), route], ['id']);
          for (const [position, stop] of (route.stops || []).entries()) await upsert(client, 'field_route_stops', ['id', 'route_id', 'position', 'name', 'metadata'], [uuid('', `${routeId}:stop:${position}:${stop}`), routeId, position, typeof stop === 'string' ? stop : String(stop.name || ''), typeof stop === 'object' ? stop : {}], ['id']);
        }
        for (const shift of fieldwork.shifts || []) {
          const userId = mappedAuth.userIds.get(shift.userId);
          if (!userId) continue;
          await upsert(client, 'field_shifts', ['id', 'organization_id', 'user_id', 'check_in_at', 'check_out_at', 'activity_status', 'metadata'], [uuid(shift.id, `${orgId}:shift:${shift.userId}:${shift.date}`), orgId, userId, dateTime(shift.checkedInAt), dateTime(shift.checkedOutAt), shift.activityStatus || 'working', shift], ['id']);
        }
        const fieldTripIds = new Map();
        for (const trip of fieldwork.trips || []) {
          const userId = mappedAuth.userIds.get(trip.userId);
          if (!userId) continue;
          const tripId = uuid(trip.id, `${orgId}:trip:${JSON.stringify(trip)}`);
          fieldTripIds.set(trip.id, tripId);
          const route = (fieldwork.routes || []).find((item) => item.id === trip.routeId);
          await upsert(client, 'field_trips', ['id', 'organization_id', 'route_id', 'user_id', 'departure_at', 'return_at', 'start_odometer', 'end_odometer', 'planned_distance_km', 'actual_distance_km', 'metadata'], [tripId, orgId, fieldRouteIds.get(trip.routeId) || null, userId, dateTime(trip.startedAt), dateTime(trip.returnedAt), Number.isFinite(Number(trip.startOdometer)) ? Number(trip.startOdometer) : null, Number.isFinite(Number(trip.endOdometer)) ? Number(trip.endOdometer) : null, route ? amount(route.plannedKm) : null, Number.isFinite(Number(trip.distanceKm)) ? Number(trip.distanceKm) : null, trip], ['id']);
        }
        for (const claim of fieldwork.claims || []) {
          const userId = mappedAuth.userIds.get(claim.userId);
          if (!userId) continue;
          const trip = (fieldwork.trips || []).find((item) => item.routeId === claim.routeId);
          await upsert(client, 'field_expense_claims', ['id', 'organization_id', 'user_id', 'trip_id', 'amount', 'currency', 'claim_type', 'status', 'description', 'submitted_at', 'metadata'], [uuid(claim.id, `${orgId}:claim:${JSON.stringify(claim)}`), orgId, userId, fieldTripIds.get(trip?.id) || null, amount(claim.amount), 'INR', claim.category || 'other', claim.status || 'pending', claim.note || '', dateTime(claim.createdAt) || new Date().toISOString(), claim], ['id']);
        }
        for (const photo of fieldwork.photos || []) {
          const bytes = rawFile(path.join(bundle.photosRoot, `${photo.id}.enc`));
          if (!bytes) continue;
          await upsert(client, 'field_photos', ['id', 'organization_id', 'user_id', 'mime_type', 'ciphertext', 'iv', 'auth_tag', 'created_at', 'metadata'], [uuid(photo.id, `${orgId}:photo:${photo.id}`), orgId, mappedAuth.userIds.get(photo.userId) || null, photo.mime || 'image/jpeg', bytes, Buffer.from(photo.iv || '', 'base64'), Buffer.from(photo.tag || '', 'base64'), dateTime(photo.createdAt) || new Date().toISOString(), photo], ['id']);
        }
        for (const [recordType, records] of Object.entries(bundle.mcpOAuth || {})) if (Array.isArray(records)) for (const [index, record] of records.entries()) {
          const key = record.id || record.client_id || record.flowId || record.tokenHash || record.code || index;
          await upsert(client, 'mcp_oauth_records', ['id', 'owner_user_id', 'organization_id', 'record_type', 'expires_at', 'record'], [`${recordType}:${key}`, mappedAuth.userIds.get(record.userId) || null, orgId, recordType, dateTime(record.expiresAt), record], ['id']);
        }
        for (const endpoint of bundle.endpoints) await upsert(client, 'monitoring_endpoints', ['id', 'organization_id', 'project_id', 'name', 'url', 'method', 'expected_status', 'metadata'], [uuid(endpoint.id, `${orgId}:endpoint:${JSON.stringify(endpoint)}`), orgId, projectIds.has(endpoint.project) ? endpoint.project : null, endpoint.name || '', endpoint.url || '', endpoint.method || 'GET', Math.max(100, Math.min(599, Number(endpoint.expected_status) || 200)), endpoint], ['id']);
        for (const entry of bundle.finance) {
          const row = entry.row;
          const label = Object.values(row)[0] || entry.id;
          const value = amount(row.amount__inr_ ?? row.amount ?? row.cost__inr_ ?? row.cost ?? row.inflow__mrr_);
          await upsert(client, 'finance_entries', ['id', 'organization_id', 'project_id', 'entry_type', 'label', 'amount', 'currency', 'effective_date', 'metadata'], [uuid('', `${orgId}:${entry.id}`), orgId, projectIds.has(entry.projectId) ? entry.projectId : null, entry.type, String(label), value, 'INR', dateOnly(row.next_invoice), row], ['id']);
        }
        for (const [index, item] of (bundle.billing?.clients || []).entries()) await upsert(client, 'billing_clients', ['id', 'organization_id', 'name', 'details'], [uuid(item.id, `${orgId}:client:${index}:${item.name}`), orgId, item.name || `Client ${index + 1}`, item], ['id']);
        const clientIds = new Map((bundle.billing?.clients || []).map((item, index) => [item.id, uuid(item.id, `${orgId}:client:${index}:${item.name}`)]));
        for (const type of ['quotation', 'invoice']) for (const [index, item] of (bundle.billing?.[type === 'quotation' ? 'quotations' : 'invoices'] || []).entries()) {
          const number = String(item.number || item.id || `${type}-${index + 1}`);
          const docId = uuid(item.id, `${orgId}:${type}:${number}`);
          const items = item.items || [];
          const total = items.reduce((sum, row) => sum + amount(row.amount), 0);
          await upsert(client, 'billing_documents', ['id', 'organization_id', 'client_id', 'document_type', 'document_number', 'project_id', 'status', 'issue_date', 'due_date', 'valid_until', 'currency', 'subtotal', 'total', 'terms', 'metadata'], [docId, orgId, clientIds.get(item.clientId) || null, type, number, projectIds.has(item.projectId) ? item.projectId : null, item.status || 'draft', dateOnly(item.issueDate), dateOnly(item.dueDate), dateOnly(item.validUntil), 'INR', total, total, item.terms || '', item], ['id']);
          for (const [position, row] of items.entries()) await upsert(client, 'billing_document_items', ['id', 'document_id', 'position', 'description', 'details', 'quantity', 'unit_price', 'amount', 'metadata'], [uuid('', `${docId}:item:${position}`), docId, position, row.description || '', row.details || '', 1, amount(row.amount), amount(row.amount), row], ['id']);
        }
        await upsert(client, 'workspace_settings', ['organization_id', 'setting_key', 'value'], [orgId, 'billing_company_profile', bundle.billing?.company || {}], ['organization_id', 'setting_key']);
        await upsert(client, 'workspace_settings', ['organization_id', 'setting_key', 'value'], [orgId, 'billing_project_templates', bundle.billing?.projectTemplates || []], ['organization_id', 'setting_key']);
      }
      for (const organization of orgIds) await client.query(`INSERT INTO migration_runs (id, organization_id, source_fingerprint, completed_at, counts, status)
        VALUES ($1,$2,$3,now(),$4,'completed')`, [crypto.randomUUID(), organization, sourceFingerprint, counts[organization] || {}]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ imported: true, organizations: orgIds.length, counts, archivedFiles: archived.length }, null, 2));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Legacy import failed: ${error.message}`);
  process.exitCode = 1;
});
