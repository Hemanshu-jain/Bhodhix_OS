const CACHE_NAME = 'bhodhix-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/','/manifest.webmanifest','/icon-512.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('bhodhix-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { message = { title: 'Bhodhix notification', body: event.data?.text() || '' }; }
  const title = String(message.title || 'Bhodhix notification').slice(0, 120);
  const options = {
    body: String(message.body || '').slice(0, 300),
    tag: String(message.tag || `bhodhix-${Date.now()}`).slice(0, 180),
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: {
      projectId: /^[a-zA-Z0-9_-]{1,100}$/.test(String(message.projectId || '')) ? String(message.projectId) : '',
      taskId: /^[a-zA-Z0-9_-]{1,100}$/.test(String(message.taskId || '')) ? String(message.taskId) : '',
      url: typeof message.url === 'string' && /^https:\/\//i.test(message.url) ? message.url.slice(0, 2000) : ''
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL('/', self.location.origin);
  if (data.url && !data.projectId) {
    event.waitUntil(self.clients.openWindow(data.url));
    return;
  }
  if (data.projectId && data.taskId) {
    target.searchParams.set('openProject', data.projectId);
    target.searchParams.set('openTask', data.taskId);
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const appWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (appWindow) {
      if (data.projectId && data.taskId) appWindow.postMessage({ type: 'bhodhix:open-task', projectId: data.projectId, taskId: data.taskId });
      return appWindow.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/') || url.pathname === '/mcp') return;
  const isShell = request.mode === 'navigate' || url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/icon-512.png';
  if (!isShell) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('/') : null);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request.mode === 'navigate' ? '/' : request, response.clone());
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
