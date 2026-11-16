const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const empty = () => ({ retentionDays: 90, inactivityGraceMinutes: 30, routes: [], shifts: [], trips: [], claims: [], photos: [] });
const fileFor = (vaultDir) => path.join(vaultDir, 'docs', 'field-work.json');
const photoPath = (vaultDir, id) => {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid photo ID');
  return path.join(vaultDir, 'docs', 'field-work-photos', `${id}.enc`);
};
let encryptionKey;

function configureEncryptionKey(value) { encryptionKey = crypto.createHash('sha256').update(String(value)).digest(); }

function read(vaultDir) {
  const file = fileFor(vaultDir);
  if (!fs.existsSync(file)) return empty();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...empty(), ...data };
}

function write(vaultDir, data) {
  const file = fileFor(vaultDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary may not exist */ }
    throw error;
  }
}

function prunePhotos(data, vaultDir) {
  const cutoff = Date.now() - Math.max(1, Math.min(3650, Number(data.retentionDays) || 90)) * 86400000;
  const kept = data.photos.filter((photo) => Date.parse(photo.createdAt) > cutoff);
  const removedPhotos = data.photos.filter((photo) => !kept.includes(photo));
  const removed = removedPhotos.length > 0;
  data.photos = kept;
  if (removed) {
    const ids = new Set(kept.map((photo) => photo.id));
    for (const shift of data.shifts) for (const key of ['checkInPhotoId', 'checkOutPhotoId']) if (shift[key] && !ids.has(shift[key])) shift[key] = '';
    for (const trip of data.trips) for (const key of ['departurePhotoId', 'returnPhotoId']) if (trip[key] && !ids.has(trip[key])) trip[key] = '';
    write(vaultDir, data);
    for (const photo of removedPhotos) { try { fs.unlinkSync(photoPath(vaultDir, photo.id)); } catch (error) { if (error.code !== 'ENOENT' && error.message !== 'Invalid photo ID') throw error; } }
  }
  return data;
}

function load(vaultDir) {
  const data = read(vaultDir);
  prunePhotos(data, vaultDir);
  return data;
}

function save(vaultDir, data) { write(vaultDir, data); }

function addPhoto(vaultDir, data, userId, dataUrl) {
  if (!encryptionKey) throw new Error('Field-work photo encryption is not configured');
  if (typeof dataUrl !== 'string' || dataUrl.length > 1_500_000) throw new Error('Photo must be a compressed image under 1 MB');
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) throw new Error('Upload a JPEG, PNG, or WebP photo');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 1_000_000 || bytes.toString('base64') !== match[2]) throw new Error('Photo must be under 1 MB');
  const id = crypto.randomUUID();
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const target = photoPath(vaultDir, id); fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, target); }
  catch (error) { try { fs.unlinkSync(temporary); } catch { /* temp file may not exist */ } throw error; }
  data.photos.push({ id, userId, mime: match[1], iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), createdAt: new Date().toISOString() });
  return id;
}

function decryptPhoto(vaultDir, photo) {
  if (!encryptionKey) throw new Error('Field-work photo encryption is not configured');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(photo.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(photo.tag, 'base64'));
  return Buffer.concat([decipher.update(fs.readFileSync(photoPath(vaultDir, photo.id))), decipher.final()]);
}

module.exports = { load, save, addPhoto, decryptPhoto, configureEncryptionKey };
