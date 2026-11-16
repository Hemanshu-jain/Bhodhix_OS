const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bhodhixDesktop', {
  getServerUrl: () => ipcRenderer.invoke('bhodhix:server-url:get'),
  setServerUrl: (url) => ipcRenderer.invoke('bhodhix:server-url:set', url),
  notify: (payload) => ipcRenderer.send('bhodhix:notify', payload),
  action: (payload) => ipcRenderer.send('bhodhix:notification-action', payload),
  onNotificationAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('bhodhix:notification-action', listener);
    return () => ipcRenderer.removeListener('bhodhix:notification-action', listener);
  }
});
