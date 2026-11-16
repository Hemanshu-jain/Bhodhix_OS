const ITERATIONS = 600000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptWithKey(contents, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(JSON.stringify(contents)));
  return {
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

export async function createSecretsVault(entries, passphrase, vaultName = 'Secrets Vault') {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  return { key, salt, envelope: await encryptWithKey({ vaultName, entries }, key, salt) };
}

export async function encryptSecrets(entries, key, salt, vaultName = 'Secrets Vault') {
  return encryptWithKey({ vaultName, entries }, key, salt);
}

export async function decryptSecrets(envelope, passphrase) {
  const key = await deriveKey(passphrase, fromBase64(envelope.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.ciphertext)
  );
  const contents = JSON.parse(textDecoder.decode(plaintext));
  const entries = Array.isArray(contents) ? contents : contents.entries;
  if (!Array.isArray(entries)) throw new Error('Vault contents are invalid');
  return {
    key,
    salt: fromBase64(envelope.salt),
    entries,
    vaultName: Array.isArray(contents) ? 'Secrets Vault' : (contents.vaultName || 'Secrets Vault')
  };
}
