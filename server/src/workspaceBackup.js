const fs = require('fs');
const path = require('path');

const MAX_BYTES = 25 * 1024 * 1024;
const safeRelative = (name) => typeof name === 'string' && name.length <= 500 && !path.isAbsolute(name) && !name.includes('\\') && name.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes('\0'));

function createSnapshot(root) {
  const files = {};
  let size = 0;
  const walk = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isSymbolicLink() || item.name.endsWith('.tmp')) continue;
      if (item.isDirectory()) walk(path.join(directory, item.name), relative);
      else if (item.isFile()) {
        if (!safeRelative(relative)) throw new Error('Workspace contains an unsafe file path');
        const content = fs.readFileSync(path.join(directory, item.name));
        size += content.length;
        if (size > MAX_BYTES) throw new Error('Workspace backup exceeds the 25 MB limit');
        files[relative] = content.toString('base64');
      }
    }
  };
  walk(root);
  return { format: 'bhodhix-workspace-backup', version: 1, createdAt: new Date().toISOString(), files };
}

function restoreSnapshot(root, snapshot) {
  if (!snapshot || snapshot.format !== 'bhodhix-workspace-backup' || snapshot.version !== 1 || !snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) throw new Error('This is not a supported Bhodhix backup');
  const entries = Object.entries(snapshot.files);
  if (!entries.length || entries.length > 20_000) throw new Error('Backup file count is invalid');
  let size = 0;
  const decoded = entries.map(([name, content]) => {
    if (!safeRelative(name) || typeof content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error('Backup contains invalid file data');
    const buffer = Buffer.from(content, 'base64');
    if (buffer.toString('base64') !== content) throw new Error('Backup contains invalid file data');
    size += buffer.length;
    if (size > MAX_BYTES) throw new Error('Backup exceeds the 25 MB limit');
    return [name, buffer];
  });
  const previous = new Map();
  try {
    for (const [name, content] of decoded) {
      const target = path.resolve(root, ...name.split('/'));
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Backup path is outside the workspace');
      let parent = path.resolve(root);
      for (const part of name.split('/').slice(0, -1)) {
        parent = path.join(parent, part);
        if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Backup cannot write through a workspace link');
      }
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) throw new Error('Backup conflicts with a workspace folder or link');
        previous.set(target, fs.readFileSync(target));
      } else previous.set(target, null);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { mode: 0o600 });
    }
  } catch (error) {
    for (const [target, content] of previous) {
      try { if (content === null) fs.unlinkSync(target); else fs.writeFileSync(target, content, { mode: 0o600 }); } catch { /* preserve the original restore error */ }
    }
    throw error;
  }
  return decoded.length;
}

module.exports = { createSnapshot, restoreSnapshot };
