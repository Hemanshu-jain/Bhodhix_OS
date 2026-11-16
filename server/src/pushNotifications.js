const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = '.push-subscriptions.enc';
const SENT_FILE = '.push-sent.enc';
const PREFS_FILE = '.notification-preferences.enc';
const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(value, 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
function expand(prk, info, length) {
  let result = Buffer.alloc(0), previous = Buffer.alloc(0), counter = 1;
  while (result.length < length) { previous = hmac(prk, Buffer.concat([previous, info, Buffer.from([counter++])])); result = Buffer.concat([result, previous]); }
  return result.subarray(0, length);
}
function generateVapidKeys() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)])), privateKey: jwk.d };
}
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
const allowedEndpoint = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && (PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) || url.hostname.endsWith('.notify.windows.com')); } catch { return false; }
};

function createPushNotifications({ encryptionKey, publicKey, privateKey, subject = 'mailto:admin@example.com' }) {
  const storageKey = /^[a-f\d]{64}$/i.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'hex') : null;
  const active = Boolean(storageKey && /^[A-Za-z0-9_-]{80,100}$/.test(publicKey || '') && /^[A-Za-z0-9_-]{40,50}$/.test(privateKey || ''));
  function read(directory) {
    const file = path.join(directory, FILE);
    if (!fs.existsSync(file)) return [];
    if (!storageKey) throw new Error('Push storage encryption is not configured');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', storageKey, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const subscriptions = JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(subscriptions)) throw new Error('Push subscription data is invalid');
    return subscriptions;
  }
  function write(directory, subscriptions) {
    if (!storageKey) throw new Error('Push storage encryption is not configured');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', storageKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(subscriptions), 'utf8'), cipher.final()]);
    const file = path.join(directory, FILE), temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try { fs.writeFileSync(temp, `${JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
    catch (error) { try { fs.unlinkSync(temp); } catch { /* temp file may not exist */ } throw error; }
  }
  function claim(directory, id) {
    const file = path.join(directory, SENT_FILE);
    let sent = [];
    if (fs.existsSync(file)) {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', storageKey, Buffer.from(record.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      sent = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8'));
    }
    if (sent.includes(id)) return false;
    sent.push(id);
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', storageKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(sent.slice(-10_000)), 'utf8'), cipher.final()]);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, `${JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
    catch (error) { try { fs.unlinkSync(temp); } catch { /* temp file may not exist */ } throw error; }
    return true;
  }
  function store(directory, userId, subscription) {
    if (!active) throw new Error('Web Push is not configured. Set VAPID keys and restart Bhodhix.');
    if (!subscription || !allowedEndpoint(subscription.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{20,30}$/.test(subscription.keys?.auth || '')) throw new Error('Invalid push subscription');
    const subscriptions = read(directory).filter((item) => item.endpoint !== subscription.endpoint);
    if (subscriptions.filter((item) => item.userId === userId).length >= 25) throw new Error('This account has reached the 25-device notification limit');
    subscriptions.push({ userId, endpoint: subscription.endpoint, keys: subscription.keys, createdAt: new Date().toISOString() });
    write(directory, subscriptions);
  }
  function remove(directory, userId, endpoint = '') {
    const old = read(directory), next = old.filter((item) => item.userId !== userId || endpoint && item.endpoint !== endpoint);
    if (next.length !== old.length) write(directory, next);
    return old.length - next.length;
  }
  function readPreferences(directory) {
    const file = path.join(directory, PREFS_FILE);
    if (!fs.existsSync(file)) return [];
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', storageKey, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8'));
    return Array.isArray(value) ? value : [];
  }
  function writePreferences(directory, preferences) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', storageKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(preferences), 'utf8'), cipher.final()]);
    const file = path.join(directory, PREFS_FILE), temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try { fs.writeFileSync(temp, `${JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')})}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
    catch (error) { try { fs.unlinkSync(temp); } catch { /* temp file may not exist */ } throw error; }
  }
  function getPreferences(directory, userId) {
    const { userId: _userId, ...preferences } = readPreferences(directory).find((item) => item.userId === userId) || {};
    return preferences;
  }
  function setPreferences(directory, userId, input) {
    if (!storageKey) throw new Error('Notification preferences cannot be stored because encryption is not configured');
    const categories = Object.fromEntries(['mail', 'meeting', 'task', 'system'].map((category) => [category, input?.categories?.[category] !== false]));
    const quietStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.quietStart || '') ? input.quietStart : '22:00';
    const quietEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.quietEnd || '') ? input.quietEnd : '08:00';
    let timeZone = '';
    try { timeZone = new Intl.DateTimeFormat('en-US', { timeZone: input?.timeZone }).resolvedOptions().timeZone; } catch { /* use server local time */ }
    const preferences = { userId, quietHours: input?.quietHours === true, quietStart, quietEnd, categories, timeZone };
    const records = readPreferences(directory).filter((item) => item.userId !== userId);
    records.push(preferences);
    writePreferences(directory, records);
    return getPreferences(directory, userId);
  }
  function allows(directory, userId, kind) {
    const preferences = getPreferences(directory, userId);
    if (!preferences.categories) return true;
    if (preferences.categories[kind] === false) return false;
    if (!preferences.quietHours || preferences.quietStart === preferences.quietEnd) return true;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timeZone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const clock = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    const minuteNow = clock('hour') * 60 + clock('minute');
    const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = toMinutes(preferences.quietStart), end = toMinutes(preferences.quietEnd);
    return !(start < end ? minuteNow >= start && minuteNow < end : minuteNow >= start || minuteNow < end);
  }
  function vapidToken(endpoint) {
    const url = new URL(endpoint);
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64url(JSON.stringify({ aud: url.origin, exp: now + 12 * 60 * 60, sub: subject }));
    const input = `${header}.${claims}`;
    const jwk = { kty: 'EC', crv: 'P-256', x: b64url(fromB64url(publicKey).subarray(1, 33)), y: b64url(fromB64url(publicKey).subarray(33, 65)), d: privateKey };
    const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
    return `${input}.${crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  function encrypt(subscription, payload) {
    const userPublic = fromB64url(subscription.keys.p256dh), authSecret = fromB64url(subscription.keys.auth);
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const serverPublic = ecdh.getPublicKey();
    const shared = ecdh.computeSecret(userPublic);
    const prkKey = hmac(authSecret, shared);
    const ikm = expand(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), userPublic, serverPublic]), 32);
    const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
    const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = serverPublic.length;
    return Buffer.concat([header, serverPublic, encrypted]);
  }
  async function send(directory, userId, payload) {
    if (!active) return;
    const subscriptions = read(directory), deliveries = subscriptions.filter((item) => item.userId === userId);
    const expired = [];
    await Promise.all(deliveries.map(async (subscription) => {
      if (!allowedEndpoint(subscription.endpoint)) { expired.push(subscription.endpoint); return; }
      try {
        const response = await fetch(subscription.endpoint, { method: 'POST', headers: { Authorization: `vapid t=${vapidToken(subscription.endpoint)}, k=${publicKey}`, TTL: '300', Urgency: 'normal', 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm' }, body: encrypt(subscription, payload) });
        if (response.status === 404 || response.status === 410) expired.push(subscription.endpoint);
      } catch { /* push service may be temporarily unavailable */ }
    }));
    if (expired.length) write(directory, subscriptions.filter((item) => !expired.includes(item.endpoint)));
  }
  return { active, publicKey: active ? publicKey : '', store, remove, send, claim, getPreferences, setPreferences, allows };
}

module.exports = { createPushNotifications, generateVapidKeys };
