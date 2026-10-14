const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alfera_setup', {
  read: () => ipcRenderer.invoke('setup:read'),
  run: (work, input) => ipcRenderer.invoke('setup:run', work, input),
  copy: (name) => ipcRenderer.invoke('setup:copy', name),
  leave: () => ipcRenderer.invoke('setup:leave'),
  on_progress: (show) => ipcRenderer.on('setup:progress', (_event, progress) => show(progress)),
  on_show: (show) => ipcRenderer.on('setup:show', (_event, wanted) => show(wanted)),
});
