const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  openMarkdown: () => ipcRenderer.invoke('desktop:open-markdown'),
  openPath: (filePath) => ipcRenderer.invoke('desktop:open-path', filePath),
  saveMarkdown: (payload) => ipcRenderer.invoke('desktop:save-markdown', payload),
  exportPdf: (payload) => ipcRenderer.invoke('desktop:export-pdf', payload),
  setRecentFiles: (paths) => ipcRenderer.invoke('desktop:set-recent-files', paths),
  confirmDiscard: (fileName) => ipcRenderer.invoke('desktop:confirm-discard', fileName),
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
  onMenuAction: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, message) => {
      const action = message?.action;
      if (typeof action !== 'string') return;
      handler(action, message?.payload);
    };
    ipcRenderer.on('desktop:menu', listener);
    return () => {
      ipcRenderer.removeListener('desktop:menu', listener);
    };
  },
});
