const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = '.secrets-vault.json';
const AUDIT_FILE = '.secrets-vault.audit.json';
const MAX_CIPHERTEXT = 1_800_000;
const AUDIT_ACTIONS = new Set(['created', 'updated', 'deleted', 'vault_renamed']);
const validBase64 = (value, expectedBytes, maxBytes = expectedBytes) => {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value && decoded.length >= expectedBytes && decoded.length <= maxBytes;
};

function readSecretsVault(directory) {
  const file = path.join(directory, FILE);
  if (!fs.existsSync(file)) return { revision: 0, envelope: null };
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 1 || !validEnvelope(stored.envelope)) throw new Error('Secrets vault data is invalid');
  return stored;
}

function validEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  if (Object.keys(envelope).sort().join(',') !== 'ciphertext,iterations,iv,kdf,salt,version') return false;
  return envelope.version === 1
    && envelope.kdf === 'PBKDF2-SHA-256'
    && envelope.iterations === 600000
    && validBase64(envelope.salt, 16)
    && validBase64(envelope.iv, 12)
    && validBase64(envelope.ciphertext, 18, MAX_CIPHERTEXT);
}

function writeSecretsVault(directory, expectedRevision, envelope) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid vault revision');
  if (!validEnvelope(envelope)) throw new Error('Invalid encrypted vault data');
  const current = readSecretsVault(directory);
  if (current.revision !== expectedRevision) return null;
  const next = { revision: current.revision + 1, updatedAt: new Date().toISOString(), envelope };
  const file = path.join(directory, FILE);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary file may not exist */ }
    throw error;
  }
  return next;
}

function readSecretsVaultAudit(directory) {
  const file = path.join(directory, AUDIT_FILE);
  if (!fs.existsSync(file)) return [];
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(entries) || entries.length > 500) throw new Error('Secrets vault audit data is invalid');
  return entries;
}

function appendSecretsVaultAudit(directory, user, action, entryId = '') {
  if (!AUDIT_ACTIONS.has(action)) throw new Error('Invalid vault audit action');
  if (entryId && (typeof entryId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entryId))) throw new Error('Invalid credential reference');
  const entries = readSecretsVaultAudit(directory);
  const record = { id: crypto.randomUUID(), userId: user.id, actor: String(user.name || user.email || 'Workspace admin').slice(0, 120), action, entryId, time: new Date().toISOString() };
  entries.push(record);
  const file = path.join(directory, AUDIT_FILE);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(entries.slice(-500))}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary file may not exist */ }
    throw error;
  }
  return record;
}

module.exports = { readSecretsVault, writeSecretsVault, readSecretsVaultAudit, appendSecretsVaultAudit };
