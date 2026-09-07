'use strict';

// Preload for the app's own local pages (first-run setup and settings).
// These are the only windows allowed to change configuration.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  state: () => ipcRenderer.invoke('ui:state'),
  probeServer: (url) => ipcRenderer.invoke('ui:probe-server', url),
  saveServer: (url) => ipcRenderer.invoke('ui:save-server', url),
  saveSettings: (patch) => ipcRenderer.invoke('ui:save-settings', patch),
  resetWindowState: () => ipcRenderer.invoke('ui:reset-window-state'),
  forgetCertificates: () => ipcRenderer.invoke('ui:forget-certificates'),
  clearData: () => ipcRenderer.invoke('ui:clear-data'),
  openRole: (role) => ipcRenderer.send('ui:open-role', role),
  openSetup: () => ipcRenderer.send('ui:open-setup'),
  openExternal: (url) => ipcRenderer.send('ui:open-external', url),
  close: () => ipcRenderer.send('ui:close-window'),
});
