const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  openMarkdown: () => ipcRenderer.invoke('desktop:open-markdown'),
  saveMarkdown: (payload) => ipcRenderer.invoke('desktop:save-markdown', payload),
  exportPdf: (payload) => ipcRenderer.invoke('desktop:export-pdf', payload),
  /** Cold-start file from OS association (consumes pending payload). */
  takeLaunchOpen: () => ipcRenderer.invoke('desktop:take-launch-open'),
  /** Warm open when a second double-click targets an already-running instance. */
  onOpenFromOs: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on('desktop:open-from-os', listener);
    return () => {
      ipcRenderer.removeListener('desktop:open-from-os', listener);
    };
  },
});
