const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alfera_tabs', {
  on_change: (show) => ipcRenderer.on('tabs:changed', (_event, tabs) => show(tabs)),
  on_look: (show) => ipcRenderer.on('look:changed', (_event, look) => show(look)),
  on_covered: (show) => ipcRenderer.on('strip:covered', (_event, is_covered) => show(is_covered)),
  on_full_screen: (show) =>
    ipcRenderer.on('window:full_screen', (_event, is_full_screen) => show(is_full_screen)),
  select: (tab_id) => ipcRenderer.send('tabs:select', tab_id),
  close: (tab_id) => ipcRenderer.send('tabs:close', tab_id),
  open_new: () => ipcRenderer.send('tabs:new'),
});
