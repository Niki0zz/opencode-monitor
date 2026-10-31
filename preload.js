'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  pin: (value) => ipcRenderer.invoke('win:pin', value),
  mini: (value) => ipcRenderer.invoke('win:mini', value),
  opacity: (value) => ipcRenderer.invoke('win:opacity', value),
  openConsole: (url) => ipcRenderer.invoke('app:console', url),
  settings: () => ipcRenderer.invoke('app:settings'),
  version: () => ipcRenderer.invoke('app:version'),
});
