const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alfera_quick_ask', {
  send: (question) => ipcRenderer.send('quick_ask:send', question),
  hide: () => ipcRenderer.send('quick_ask:hide'),
  on_shown: (show) => ipcRenderer.on('quick_ask:shown', () => show()),
  on_outcome: (show) =>
    ipcRenderer.on('quick_ask:outcome', (_event, outcome, sentence) => show(outcome, sentence)),
});
