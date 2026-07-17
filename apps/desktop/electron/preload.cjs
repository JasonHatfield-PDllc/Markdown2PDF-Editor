const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  openMarkdown: () => ipcRenderer.invoke('desktop:open-markdown'),
  saveMarkdown: (payload) => ipcRenderer.invoke('desktop:save-markdown', payload),
  exportPdf: (payload) => ipcRenderer.invoke('desktop:export-pdf', payload),
});
