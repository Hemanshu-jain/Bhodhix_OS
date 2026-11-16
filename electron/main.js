const { app, BrowserWindow, shell, dialog, screen, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');

let APP_URL = '';
let LOCAL_APP_URL = '';
let connectionFile = '';
let localPortFile = '';
const APP_ID = 'com.bhodix.os';
const ICON = path.join(__dirname, 'icon.ico');
const NOTIFICATION_FILE = path.join(__dirname, '../client/dist/desktop-notification.html');
const READY_TIMEOUT_MS = 60000; // cold starts on this PC can be slow
const READY_POLL_MS = 250;

let mainWindow = null;
let tray = null;
const notificationWindows = [];

function logStartup(message) {
  try {
    let dataDirectory;
    try { dataDirectory = app.getPath('userData'); }
    catch { dataDirectory = path.join(process.env.APPDATA || process.cwd(), 'bhodix-command-center'); }
    const logFile = path.join(dataDirectory, 'startup.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const previous = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-12000) : '';
    fs.writeFileSync(logFile, `${previous}[${new Date().toISOString()}] ${message}\n`);
  } catch { /* diagnostics must not interrupt startup */ }
}
process.on('uncaughtException', (error) => {
  logStartup(`Uncaught startup exception: ${error?.stack || error?.message || String(error)}`);
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logStartup(`Unhandled startup rejection: ${reason?.stack || reason?.message || String(reason)}`);
});

// Any HTTP answer (even 401 from the auth gate) means the engine is up.
function engineResponds(serverUrl = APP_URL) {
  return new Promise((resolve) => {
    const url = new URL('/api/setup/status', serverUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForEngine() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await engineResponds()) return true;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return false;
}

// Runs the engine inside this process (Electron ships its own Node), unless one
// is already running, e.g. `npm start` in a terminal.
async function startEngine(portFile) {
  const reservePort = (preferredPort) => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(preferredPort || 0, '127.0.0.1', () => {
      const { port: availablePort } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(availablePort));
    });
  });
  let port;
  const savedPort = Number(fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim() : 0);
  if (Number.isInteger(savedPort) && savedPort > 0 && savedPort <= 65535) {
    try { port = await reservePort(savedPort); } catch { /* A different app owns the saved port; choose another and persist it. */ }
  }
  if (!port) port = await reservePort(0);
  fs.writeFileSync(portFile, String(port), { mode: 0o600 });
  process.env.PORT = String(port);
  process.env.BIND_HOST = '127.0.0.1';
  APP_URL = `http://127.0.0.1:${port}`;
  LOCAL_APP_URL = APP_URL;
  const engine = require('../server/src/server.js');
  await new Promise((resolve, reject) => {
    if (engine.listening) return resolve();
    engine.once('listening', resolve);
    engine.once('error', reject);
  });
}

function normalizedServerUrl(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid company server address');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete server address, such as https://planner.company.com'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', ...(local ? ['http:'] : [])].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS server address without a path. HTTP is allowed only for this device.');
  return url.origin;
}

async function serverResponds(url) {
  return engineResponds(url);
}

function senderIsApp(event) {
  try { return new URL(event.senderFrame?.url).origin === new URL(APP_URL).origin; } catch { return false; }
}

ipcMain.handle('bhodhix:server-url:get', (event) => senderIsApp(event) ? APP_URL : '');
ipcMain.handle('bhodhix:server-url:set', async (event, value) => {
  if (!senderIsApp(event)) return { success: false, error: 'This request did not come from Bhodhix OS.' };
  try {
    const remoteUrl = normalizedServerUrl(value);
    if (remoteUrl) {
      if (!await serverResponds(remoteUrl)) throw new Error('Could not reach the company server. Check the address and that the server is online.');
      fs.writeFileSync(connectionFile, JSON.stringify({ serverUrl: remoteUrl }), { mode: 0o600 });
      APP_URL = remoteUrl;
    } else {
      if (!LOCAL_APP_URL) await startEngine(localPortFile);
      APP_URL = LOCAL_APP_URL;
      try { fs.unlinkSync(connectionFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(APP_URL).catch((error) => logStartup(`Server change navigation failed: ${error.message}`));
    return { success: true };
  } catch (error) { return { success: false, error: error.message || 'Could not change server connection.' }; }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#08090d',
    title: 'Bhodhix OS',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'notification-preload.js') }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.loadURL(APP_URL);

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(url).origin === new URL(APP_URL).origin; } catch { /* malformed navigation is external */ }
    if (!sameOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  else if (mainWindow.isMinimized()) mainWindow.restore();
  else mainWindow.show();
  mainWindow?.focus();
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(image);
  tray.setToolTip('Bhodhix OS is running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bhodhix', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit Bhodhix', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function repositionNotifications() {
  const windows = notificationWindows.filter((item) => !item.window.isDestroyed());
  const bounds = mainWindow?.getBounds() || screen.getPrimaryDisplay().workArea;
  const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  const area = display.workArea;
  windows.forEach(({ window }, index) => window.setBounds({ x: area.x + area.width - 402, y: area.y + 18 + index * 154, width: 390, height: 148 }));
}

function showDesktopNotification(event, value) {
  try { if (new URL(event.senderFrame?.url).origin !== new URL(APP_URL).origin) return; } catch { return; }
  const kind = ['mail', 'meeting', 'task', 'system'].includes(value?.kind) ? value.kind : 'system';
  const data = value?.data && typeof value.data === 'object' ? value.data : {};
  const payload = {
    id: String(value?.id || ''), kind,
    title: String(value?.title || 'Bhodhix notification').slice(0, 120),
    body: String(value?.body || '').slice(0, 500),
    data: {
      projectId: /^[a-zA-Z0-9_-]{1,100}$/.test(String(data.projectId || '')) ? String(data.projectId) : '',
      taskId: /^[a-zA-Z0-9_-]{1,100}$/.test(String(data.taskId || '')) ? String(data.taskId) : '',
      url: typeof data.url === 'string' && /^https:\/\//i.test(data.url) ? data.url.slice(0, 2000) : ''
    },
    tag: String(value?.tag || '').slice(0, 180)
  };
  if (payload.tag && notificationWindows.some((item) => item.payload.tag === payload.tag && !item.window.isDestroyed())) return;
  if (!fs.existsSync(NOTIFICATION_FILE)) return;
  while (notificationWindows.length >= 4) notificationWindows[0].window.close();
  const window = new BrowserWindow({
    width: 390, height: 148, show: false, frame: false, transparent: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: true, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    backgroundColor: '#00000000', webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'notification-preload.js') }
  });
  const entry = { window, payload, timer: null };
  notificationWindows.push(entry);
  window.once('ready-to-show', () => { repositionNotifications(); window.showInactive(); });
  window.loadFile(NOTIFICATION_FILE, { query: { payload: JSON.stringify(payload) } });
  entry.timer = setTimeout(() => { if (!window.isDestroyed()) window.close(); }, 8500);
  window.on('closed', () => {
    clearTimeout(entry.timer);
    const index = notificationWindows.indexOf(entry);
    if (index >= 0) notificationWindows.splice(index, 1);
    repositionNotifications();
  });
}

ipcMain.on('bhodhix:notify', showDesktopNotification);
process.on('bhodhix:notification', (value) => {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: String(value?.title || 'Bhodhix notification').slice(0, 120), body: String(value?.body || '').slice(0, 300), icon: path.join(__dirname, 'icon.png') });
  notification.on('click', () => { if (value?.url && /^https:\/\//i.test(value.url)) shell.openExternal(value.url); else showMainWindow(); });
  notification.show();
});
ipcMain.on('bhodhix:notification-action', (event, action) => {
  const entry = notificationWindows.find((item) => item.window.webContents.id === event.sender.id);
  if (!entry || action?.id !== entry.payload.id) return;
  if (action.action === 'open_link' && entry.payload.data.url) shell.openExternal(entry.payload.data.url);
  if (action.action !== 'dismiss' && mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('bhodhix:notification-action', { kind: entry.payload.kind, action: action.action, data: entry.payload.data });
  }
  if (!entry.window.isDestroyed()) entry.window.close();
});

logStartup('Electron main module loaded; requesting the single-instance lock.');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
logStartup(`Single-instance lock ${hasSingleInstanceLock ? 'acquired' : 'not acquired'}.`);
if (!hasSingleInstanceLock) {
  app.quit(); // a second launch just focuses the first window (below)
} else {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    logStartup('App ready; starting local engine.');
    try {
      const dataDir = app.getPath('userData');
      const authDir = path.join(dataDir, 'auth');
      fs.mkdirSync(authDir, { recursive: true });
      connectionFile = path.join(authDir, 'connection.json');
      localPortFile = path.join(authDir, '.engine-port');
      if (app.isPackaged) {
        process.env.AUTH_STORE_FILE ||= path.join(authDir, 'team.json');
        process.env.BHODIX_PIN_FILE ||= path.join(authDir, '.pin');
        process.env.TENANT_DATA_DIR ||= path.join(dataDir, 'tenants');
        process.env.MCP_OAUTH_STORE_FILE ||= path.join(authDir, 'mcp-oauth.json');
        process.env.LEGACY_VAULT_DIR ||= path.join(dataDir, 'vault');
      }
      const connectorKeyFile = path.join(authDir, '.connector-key');
      if (!process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY) {
        if (!fs.existsSync(connectorKeyFile)) fs.writeFileSync(connectorKeyFile, require('crypto').randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
        process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = fs.readFileSync(connectorKeyFile, 'utf8').trim();
      }
      const vapidFile = path.join(authDir, '.web-push-vapid.json');
      if (!process.env.WEB_PUSH_PUBLIC_KEY || !process.env.WEB_PUSH_PRIVATE_KEY) {
        let vapid;
        try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
        catch {
          vapid = require('../server/src/pushNotifications').generateVapidKeys();
          fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600, flag: 'wx' });
        }
        process.env.WEB_PUSH_PUBLIC_KEY = vapid.publicKey;
        process.env.WEB_PUSH_PRIVATE_KEY = vapid.privateKey;
      }
      let configuredServer = '';
      try { configuredServer = normalizedServerUrl(JSON.parse(fs.readFileSync(connectionFile, 'utf8')).serverUrl); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`Saved server connection is invalid: ${error.message}`); }
      if (configuredServer) {
        APP_URL = configuredServer;
        while (!await engineResponds()) {
          const choice = await dialog.showMessageBox({ type: 'warning', title: 'Company server unavailable', message: `Could not connect to ${configuredServer}.`, detail: 'You can retry, switch to this device’s separate local workspace, or quit Bhodhix OS. Local data is separate from company-server data.', buttons: ['Retry', 'Use this device', 'Quit'], defaultId: 0, cancelId: 2, noLink: true });
          if (choice.response === 0) continue;
          if (choice.response === 1) {
            try { fs.unlinkSync(connectionFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            await startEngine(localPortFile);
            break;
          }
          app.quit(); return;
        }
      } else await startEngine(localPortFile);
    } catch (err) {
      logStartup(`Engine startup failed: ${err?.stack || err?.message || String(err)}`);
      dialog.showErrorBox('Bhodhix OS', `The engine failed to start:\n\n${err.message}`);
      app.quit();
      return;
    }
    if (!(await waitForEngine())) {
      logStartup(`Engine did not respond at ${APP_URL}.`);
      dialog.showErrorBox('Bhodhix OS', `The engine did not respond at ${APP_URL}.`);
      app.quit();
      return;
    }
    logStartup(`Engine ready at ${APP_URL}; opening the main window.`);
    createTray();
    createWindow();
  });

  app.on('window-all-closed', () => {});
  app.on('activate', showMainWindow);
}
