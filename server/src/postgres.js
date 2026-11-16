const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) throw new Error('DATABASE_URL is required for PostgreSQL storage');
  let parsed;
  try { parsed = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error('DATABASE_URL must include a PostgreSQL host and database name');
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
}

async function migrate(pool, directory = path.join(__dirname, '../migrations')) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', ['71824092611016']);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = fs.readdirSync(directory).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    const applied = [];
    for (const name of files) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM app_schema_migrations WHERE version = $1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum.trim() !== checksum) throw new Error(`Applied migration ${name} was modified; add a new migration instead`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app_schema_migrations (version, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(name);
    }
    return applied;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', ['71824092611016']).catch(() => {});
    client.release();
  }
}

module.exports = { createPool, migrate };
