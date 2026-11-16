const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const markdown = require('../src/markdown');

const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'bhodix-command-center') : '';
const useAppData = appData && fs.existsSync(appData);
const authRoot = useAppData ? path.join(appData, 'auth') : path.resolve(__dirname, '../');
const vaultRoot = path.resolve(process.env.LEGACY_VAULT_DIR || (useAppData ? path.join(appData, 'vault') : path.join(__dirname, '../../vault')));
const tenantRoot = path.resolve(process.env.TENANT_DATA_DIR || (useAppData ? path.join(appData, 'tenants') : path.join(__dirname, '../../data/tenants')));
const authFile = path.resolve(process.env.AUTH_STORE_FILE || path.join(authRoot, useAppData ? 'team.json' : '.team.json'));
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const countMarkdown = (directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length
  : 0;

function inspectVault(root) {
  const projectRoot = path.join(root, 'projects');
  const projects = fs.existsSync(projectRoot) ? fs.readdirSync(projectRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const directory = path.join(projectRoot, entry.name);
    const projectFile = path.join(directory, 'project.md');
    const featuresFile = path.join(directory, 'features.md');
    const tasksFile = path.join(directory, 'tasks.md');
    const features = fs.existsSync(featuresFile) ? markdown.parseMarkdownTable(matter(fs.readFileSync(featuresFile, 'utf8')).content).length : 0;
    const tasks = fs.existsSync(tasksFile) ? markdown.parseTasks(fs.readFileSync(tasksFile, 'utf8'), entry.name).length : 0;
    return { features, tasks, documents: countMarkdown(path.join(directory, 'docs')) };
  }) : [];
  const billing = readJson(path.join(root, 'billing', 'billing.json'), {}).data || {};
  const fieldwork = readJson(path.join(root, 'docs', 'field-work.json'), {});
  const allFiles = [];
  const walk = (directory, prefix = '') => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name.endsWith('.tmp')) continue;
      if (entry.isDirectory()) walk(absolute, prefix ? `${prefix}/${entry.name}` : entry.name);
      else if (entry.isFile()) {
        const content = fs.readFileSync(absolute);
        allFiles.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, content });
      }
    }
  };
  walk(root);
  const fingerprint = crypto.createHash('sha256').update(allFiles.map((file) => `${file.path}:${crypto.createHash('sha256').update(file.content).digest('hex')}`).sort().join('\n')).digest('hex');
  return {
    fileCount: allFiles.length,
    fingerprint,
    projectCount: projects.length,
    featureCount: projects.reduce((sum, project) => sum + project.features, 0),
    taskCount: projects.reduce((sum, project) => sum + project.tasks, 0),
    documentCount: projects.reduce((sum, project) => sum + project.documents, 0),
    billing: { clientCount: (billing.clients || []).length, quotationCount: (billing.quotations || []).length, invoiceCount: (billing.invoices || []).length, templateCount: (billing.projectTemplates || []).length },
    fieldwork: { routeCount: (fieldwork.routes || []).length, shiftCount: (fieldwork.shifts || []).length, tripCount: (fieldwork.trips || []).length, claimCount: (fieldwork.claims || []).length, photoCount: (fieldwork.photos || []).length }
  };
}

function main() {
  const auth = readJson(authFile, {});
  const tenants = fs.existsSync(tenantRoot) ? fs.readdirSync(tenantRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
  const encryptedFiles = fs.existsSync(vaultRoot) ? fs.readdirSync(vaultRoot).filter((name) => /\.(?:enc|json)$/i.test(name) && name.startsWith('.')) : [];
  const recoveryDirs = useAppData ? fs.readdirSync(appData).filter((name) => /^vault\.backup-before-/i.test(name)) : [];
  console.log(JSON.stringify({
    activeDataSource: useAppData ? 'installed-app-profile' : 'project-vault',
    auth: { organizationCount: (auth.organizations || []).length, userCount: (auth.users || []).length, membershipCount: (auth.memberships || []).length, activeSessionCount: (auth.sessions || []).filter((session) => Number(session.expiresAt) > Date.now()).length, inviteCount: (auth.invites || []).length, emailTokenCount: (auth.emailTokens || []).length },
    primaryVault: inspectVault(vaultRoot),
    tenantDirectories: tenants.length,
    encryptedOrStateFiles: encryptedFiles.length,
    recoveryVaults: recoveryDirs.length
  }, null, 2));
}

main();
