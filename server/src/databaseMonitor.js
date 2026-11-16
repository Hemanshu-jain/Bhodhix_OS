const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const FILE = '.database-monitors.enc';

function createDatabaseMonitor({ encryptionKey }) {
  const key = /^[a-f\d]{64}$/i.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'hex') : null;
  const statusByWorkspace = new Map();

  function read(directory) {
    const file = path.join(directory, FILE);
    if (!fs.existsSync(file)) return [];
    if (!key) throw new Error('Database-monitor encryption key is not configured');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored.version !== 1) throw new Error('Stored database monitor data is invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const list = JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(list)) throw new Error('Stored database monitor data is invalid');
    return list;
  }

  function write(directory, monitors) {
    if (!key) throw new Error('Database-monitor encryption key is not configured');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(monitors), 'utf8'), cipher.final()]);
    const record = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    const file = path.join(directory, FILE);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* temp file may not exist */ }
      throw error;
    }
  }

  function publicStatus(directory) {
    return (statusByWorkspace.get(directory) || []).map(({ id, name, project, engine, status, checkedAt, latencyMs, message }) => ({ id, name, project, engine, status, checkedAt, latencyMs, message }));
  }

  async function checkOne(directory, monitor) {
    const started = Date.now();
    const result = { id: monitor.id, name: monitor.name, project: monitor.project, engine: 'PostgreSQL', status: 'down', checkedAt: new Date().toISOString(), latencyMs: 0, message: 'Connection failed. Check access and network settings.' };
    let client;
    try {
      client = new Client({ connectionString: monitor.connectionString, connectionTimeoutMillis: 5000, query_timeout: 4000, statement_timeout: 4000, application_name: 'Bhodhix health monitor' });
      await client.connect();
      await client.query('SELECT 1');
      result.status = 'operational';
      result.message = 'Read-only health query succeeded';
    } catch {
      result.message = 'Connection failed. Check access and network settings.';
    } finally {
      if (client) await client.end().catch(() => {});
      result.latencyMs = Date.now() - started;
      result.checkedAt = new Date().toISOString();
    }
    const all = statusByWorkspace.get(directory) || [];
    statusByWorkspace.set(directory, [...all.filter((item) => item.id !== monitor.id), result]);
    return result;
  }

  async function checkAll(directory) {
    const monitors = read(directory);
    const results = await Promise.all(monitors.map((monitor) => checkOne(directory, monitor)));
    return results;
  }

  function add(directory, input, projects) {
    if (!key) throw new Error('Database monitoring is not configured. Set CONNECTOR_TOKEN_ENCRYPTION_KEY, then restart the app.');
    const name = String(input?.name || '').trim().slice(0, 100);
    const project = String(input?.project || '');
    const connectionString = String(input?.connectionString || '').trim();
    if (!name || !Object.hasOwn(projects, project)) throw new Error('Choose a name and existing project');
    if (connectionString.length > 4000) throw new Error('Connection string is too long');
    let parsed;
    try { parsed = new URL(connectionString); } catch { throw new Error('Enter a valid PostgreSQL connection string'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username) throw new Error('Use a PostgreSQL URL with a host and username');
    const monitors = read(directory);
    if (monitors.length >= 30) throw new Error('A workspace can monitor up to 30 databases');
    const monitor = { id: crypto.randomUUID(), name, project, connectionString };
    write(directory, [...monitors, monitor]);
    return { id: monitor.id, name, project, engine: 'PostgreSQL', status: 'unknown', checkedAt: '', latencyMs: 0, message: 'Waiting for first check' };
  }

  function remove(directory, id) {
    const current = read(directory);
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length) return false;
    write(directory, next);
    statusByWorkspace.set(directory, (statusByWorkspace.get(directory) || []).filter((item) => item.id !== id));
    return true;
  }

  return { configured: Boolean(key), add, remove, read, checkAll, checkOne, publicStatus };
}

module.exports = { createDatabaseMonitor };
