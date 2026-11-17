const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPool, migrate } = require('../src/postgres');

function collect(root, sourceKey, files = [], prefix = '') {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink() || entry.name.endsWith('.tmp')) continue;
    if (entry.isDirectory()) collect(absolute, sourceKey, files, relative);
    else if (entry.isFile()) files.push({ sourceKey, relativePath: relative, content: fs.readFileSync(absolute) });
  }
  return files;
}

function collectFile(file, sourceKey) {
  if (!fs.existsSync(file)) return [];
  return [{ sourceKey, relativePath: path.basename(file), content: fs.readFileSync(file) }];
}

async function archiveFiles(pool, files) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expected = new Map();
    for (const file of files) {
      const sha256 = crypto.createHash('sha256').update(file.content).digest('hex');
      expected.set(`${file.sourceKey}\0${file.relativePath}`, sha256);
      await client.query(`INSERT INTO legacy_files (id, source_key, relative_path, content, sha256)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_key, relative_path) DO UPDATE
        SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, imported_at = now()
        WHERE legacy_files.sha256 <> EXCLUDED.sha256`, [crypto.randomUUID(), file.sourceKey, file.relativePath, file.content, sha256]);
    }
    for (const sourceKey of new Set(files.map((file) => file.sourceKey))) {
      const paths = files.filter((file) => file.sourceKey === sourceKey).map((file) => file.relativePath);
      const result = await client.query('SELECT relative_path, sha256 FROM legacy_files WHERE source_key = $1 AND relative_path = ANY($2::text[])', [sourceKey, paths]);
      if (result.rowCount !== paths.length || result.rows.some((row) => expected.get(`${sourceKey}\0${row.relative_path}`) !== row.sha256.trim())) throw new Error(`Legacy archive verification failed for source ${sourceKey}`);
    }
    await client.query('COMMIT');
    return { fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.content.length, 0) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildArchiveFiles() {
  const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'bhodix-command-center') : '';
  const useAppData = appData && fs.existsSync(appData);
  const authRoot = useAppData ? path.join(appData, 'auth') : path.resolve(__dirname, '..');
  const authStore = path.resolve(process.env.AUTH_STORE_FILE || path.join(authRoot, useAppData ? 'team.json' : '.team.json'));
  const mcpStore = path.resolve(process.env.MCP_OAUTH_STORE_FILE || path.join(authRoot, useAppData ? 'mcp-oauth.json' : '.mcp-oauth.json'));
  const vaultRoot = path.resolve(process.env.LEGACY_VAULT_DIR || (useAppData ? path.join(appData, 'vault') : path.join(__dirname, '../../vault')));
  const tenantRoot = path.resolve(process.env.TENANT_DATA_DIR || (useAppData ? path.join(appData, 'tenants') : path.join(__dirname, '../../data/tenants')));
  const files = [
    ...collectFile(authStore, 'auth'),
    ...collectFile(mcpStore, 'auth'),
    ...collect(vaultRoot, 'vault'),
    ...collect(tenantRoot, 'tenants')
  ];
  if (useAppData) {
    for (const name of fs.readdirSync(authRoot)) {
      if (/^team\.json\.backup-before-/i.test(name)) files.push(...collectFile(path.join(authRoot, name), 'auth-recovery'));
    }
    for (const name of fs.readdirSync(path.dirname(vaultRoot))) {
      if (/^vault\.backup-before-/i.test(name)) files.push(...collect(path.join(path.dirname(vaultRoot), name), 'vault-recovery'));
    }
  }
  return files;
}

async function main() {
  const files = buildArchiveFiles();
  if (!files.length) throw new Error('No legacy files found. Set AUTH_STORE_FILE, LEGACY_VAULT_DIR, and TENANT_DATA_DIR to the app data locations first.');
  const sources = Object.groupBy(files, (file) => file.sourceKey);
  const summary = Object.fromEntries(Object.entries(sources).map(([key, items]) => [key, {
    files: items.length,
    bytes: items.reduce((total, item) => total + item.content.length, 0),
    sha256: crypto.createHash('sha256').update(items.map((item) => `${item.relativePath}:${crypto.createHash('sha256').update(item.content).digest('hex')}`).sort().join('\n')).digest('hex')
  }]));
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ dryRun: true, sources: summary, totalFiles: files.length, totalBytes: files.reduce((total, file) => total + file.content.length, 0) }, null, 2));
    return;
  }
  const pool = createPool();
  try {
    await migrate(pool);
    await archiveFiles(pool, files);
    console.log(`Archived ${files.length} legacy files to PostgreSQL with SHA-256 checksums; source files were left untouched.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(`Legacy archive failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { buildArchiveFiles, archiveFiles };
