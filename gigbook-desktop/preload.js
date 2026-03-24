const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onServerStatus: (cb) => ipcRenderer.on('server-status', (e, v) => cb(v)),
  onServerInfo:   (cb) => ipcRenderer.on('server-info',   (e, v) => cb(v)),
  onServerOutput: (cb) => ipcRenderer.on('server-output', (e, v) => cb(v)),
  onServerQR:     (cb) => ipcRenderer.on('server-qr',     (e, v) => cb(v)),
  onServerToken:  (cb) => ipcRenderer.on('server-token',  (e, v) => cb(v)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
