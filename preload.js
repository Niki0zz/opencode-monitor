'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  pin: (value) => ipcRenderer.invoke('win:pin', value),
  mini: (value) => ipcRenderer.invoke('win:mini', value),
  onMini: (callback) => {
    ipcRenderer.on('win:mini', (_event, value) => callback(!!value));
  },
  onNotifications: (callback) => {
    ipcRenderer.on('win:notifications', (_event, value) => callback(!!value));
  },
  opacity: (value) => ipcRenderer.invoke('win:opacity', value),
  openConsole: (url) => ipcRenderer.invoke('app:console', url),
  settings: () => ipcRenderer.invoke('app:settings'),
  version: () => ipcRenderer.invoke('app:version'),
  token: () => ipcRenderer.invoke('app:token'),
  notifyOnce: (key, title, body) => ipcRenderer.invoke('app:notify-once', { key, title, body }),
});
