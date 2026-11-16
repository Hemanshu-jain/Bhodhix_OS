const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPool } = require('../src/postgres');

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
    for (const file of files) {
      const sha256 = crypto.createHash('sha256').update(file.content).digest('hex');
      await client.query(`INSERT INTO legacy_files (id, source_key, relative_path, content, sha256)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_key, relative_path) DO UPDATE
        SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, imported_at = now()
        WHERE legacy_files.sha256 <> EXCLUDED.sha256`, [crypto.randomUUID(), file.sourceKey, file.relativePath, file.content, sha256]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const authStore = path.resolve(process.env.AUTH_STORE_FILE || path.join(__dirname, '../.team.json'));
  const mcpStore = path.resolve(process.env.MCP_OAUTH_STORE_FILE || path.join(__dirname, '../.mcp-oauth.json'));
  const vaultRoot = path.resolve(process.env.LEGACY_VAULT_DIR || path.join(__dirname, '../../vault'));
  const tenantRoot = path.resolve(process.env.TENANT_DATA_DIR || path.join(__dirname, '../../data/tenants'));
  const files = [
    ...collectFile(authStore, 'auth'),
    ...collectFile(mcpStore, 'auth'),
    ...collect(vaultRoot, 'vault'),
    ...collect(tenantRoot, 'tenants')
  ];
  if (!files.length) throw new Error('No legacy files found. Set AUTH_STORE_FILE, LEGACY_VAULT_DIR, and TENANT_DATA_DIR to the app data locations first.');
  const pool = createPool();
  try {
    await archiveFiles(pool, files);
    console.log(`Archived ${files.length} legacy files to PostgreSQL with SHA-256 checksums; source files were left untouched.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Legacy archive failed: ${error.message}`);
  process.exitCode = 1;
});
