const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fsSync = require('fs');
const fs = fsSync.promises;

const DEV_URL = 'http://127.0.0.1:5174';
const MAX_MD_OPEN_BYTES = 2 * 1024 * 1024;
const APP_DISPLAY_NAME = 'Markdown2PDF';
const IS_DEV = process.env.M2PDF_ELECTRON_DEV === '1';

/** Match @page margins in renderer CSS (mm → inches). */
const PDF_MARGINS_IN = {
  top: 16 / 25.4,
  right: 14 / 25.4,
  bottom: 22 / 25.4,
  left: 14 / 25.4,
};

/** Every-page footer mode: larger bottom margin for the repeating brand strip. */
const PDF_MARGINS_EVERY_PAGE_IN = {
  top: 16 / 25.4,
  right: 14 / 25.4,
  bottom: 40 / 25.4,
  left: 14 / 25.4,
};

const PAGE_SIZE_MAP = {
  letter: 'Letter',
  a4: 'A4',
  legal: 'Legal',
};

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {string[]} */
let recentFiles = [];

/**
 * File opened via OS association / argv. Kept until the renderer consumes it.
 * @type {{ text: string, path: string, name: string } | null}
 */
let pendingOpenPayload = null;

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getIndexPath() {
  return path.join(__dirname, '../dist/index.html');
}

/**
 * Runtime icon must live under `electron/` (packaged in asar).
 * `build/` is buildResources only — not shipped inside the app.
 * Prefer .ico on Windows for title bar + taskbar.
 */
function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(__dirname, 'assets', 'icon.png'),
    // Dev/unpacked fallbacks when running from source near build/
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} [payload]
 */
function sendMenuAction(action, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:menu', { action, payload });
}

function buildAppMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const recentItems =
    recentFiles.length > 0
      ? recentFiles.map((filePath) => ({
          label: filePath,
          click: () => sendMenuAction('open-recent', { path: filePath }),
        }))
      : [{ label: '(No recent files)', enabled: false }];

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: 'Open Recent',
          submenu: recentItems,
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuAction('close'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Export PDF…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuAction('export-pdf'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Visit Markdown2PDF site',
          click: () => {
            shell.openExternal('https://www.pragmaticdisruptor.com/markdown2pdf-overview');
          },
        },
        {
          label: 'Terms of Use',
          click: () => {
            shell.openExternal('https://www.pragmaticdisruptor.com/terms-of-use');
          },
        },
        {
          label: 'Privacy Notice',
          click: () => {
            shell.openExternal('https://www.pragmaticdisruptor.com/privacynotice');
          },
        },
        {
          label: 'Contact Us',
          click: () => {
            shell.openExternal('https://www.pragmaticdisruptor.com/contact-jason');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Windows / Electron: double-click passes the file path in argv.
 * @param {string[]} argv
 * @returns {string | null}
 */
function findMarkdownPathFromArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 2) return null;
  for (const raw of argv.slice(1)) {
    if (!raw || typeof raw !== 'string') continue;
    const arg = raw.replace(/^["']|["']$/g, '');
    if (!arg || arg.startsWith('-')) continue;
    const lower = arg.toLowerCase();
    if (
      lower.endsWith('.md') ||
      lower.endsWith('.markdown') ||
      lower.endsWith('.txt')
    ) {
      return path.resolve(arg);
    }
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ ok: true, text: string, path: string, name: string } | { ok: false, error: string }>}
 */
async function readMarkdownFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_MD_OPEN_BYTES) {
    return {
      ok: false,
      error: `File is too large (${Math.round(stat.size / 1024)} KB). Max is ${MAX_MD_OPEN_BYTES / (1024 * 1024)} MB.`,
    };
  }
  const text = await fs.readFile(filePath, 'utf8');
  return {
    ok: true,
    text,
    path: filePath,
    name: path.basename(filePath),
  };
}

/**
 * @param {string} filePath
 * @param {{ focus?: boolean }} [opts]
 */
async function openPathFromOs(filePath, opts = {}) {
  try {
    const result = await readMarkdownFile(filePath);
    if (!result.ok) {
      dialog.showErrorBox('Could not open Markdown file', result.error);
      return;
    }
    const payload = {
      text: result.text,
      path: result.path,
      name: result.name,
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (opts.focus) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      if (!mainWindow.webContents.isLoading()) {
        pendingOpenPayload = null;
        mainWindow.webContents.send('desktop:open-from-os', payload);
        return;
      }
    }

    pendingOpenPayload = payload;
  } catch (err) {
    dialog.showErrorBox(
      'Could not open Markdown file',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function createWindow() {
  const icon = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_DISPLAY_NAME,
    ...(icon ? { icon } : {}),
    autoHideMenuBar: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: IS_DEV,
    },
  });

  mainWindow.setTitle(APP_DISPLAY_NAME);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Keep product title (don't let the HTML <title> rename the window).
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(APP_DISPLAY_NAME);
  });

  if (IS_DEV) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(getIndexPath());
  }
}

function normalizeMdSuggestedName(name) {
  let base = name?.trim() || 'document';
  const lower = base.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return base;
  if (lower.endsWith('.txt')) return `${base.slice(0, -4)}.md`;
  const lastDot = base.lastIndexOf('.');
  if (lastDot > 0) return `${base.slice(0, lastDot)}.md`;
  return `${base}.md`;
}

function suggestedPdfName(mdName) {
  const base = normalizeMdSuggestedName(mdName).replace(/\.(md|markdown)$/i, '');
  return `${base}.pdf`;
}

function registerIpc() {
  ipcMain.handle('desktop:take-launch-open', () => {
    const payload = pendingOpenPayload;
    pendingOpenPayload = null;
    return payload;
  });

  ipcMain.handle('desktop:set-recent-files', (_event, paths) => {
    recentFiles = Array.isArray(paths)
      ? paths.filter((p) => typeof p === 'string' && p.trim()).slice(0, 12)
      : [];
    buildAppMenu();
    return { ok: true };
  });

  ipcMain.handle('desktop:confirm-discard', async (event, fileName) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const name = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'Untitled.md';
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `"${name}" has unsaved changes.`,
      detail: 'Do you want to save before closing?',
      noLink: true,
    });
    if (response === 0) return 'save';
    if (response === 1) return 'discard';
    return 'cancel';
  });

  ipcMain.handle('desktop:open-path', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { canceled: true };
    }
    try {
      const result = await readMarkdownFile(path.resolve(filePath));
      if (!result.ok) return { canceled: false, error: result.error };
      return { canceled: false, ...result };
    } catch (err) {
      return {
        canceled: false,
        error: err instanceof Error ? err.message : 'Could not open file.',
      };
    }
  });

  ipcMain.handle('desktop:open-markdown', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Open Markdown',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths?.[0]) return { canceled: true };
    const result = await readMarkdownFile(filePaths[0]);
    if (!result.ok) return { canceled: false, error: result.error };
    return { canceled: false, ...result };
  });

  ipcMain.handle('desktop:save-markdown', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const text = typeof payload?.text === 'string' ? payload.text : '';
    const existingPath = typeof payload?.path === 'string' ? payload.path : '';

    if (existingPath) {
      try {
        await fs.writeFile(existingPath, text, 'utf8');
        return { canceled: false, path: existingPath, name: path.basename(existingPath) };
      } catch (err) {
        return { canceled: false, error: err instanceof Error ? err.message : 'Save failed.' };
      }
    }

    const suggested = normalizeMdSuggestedName(payload?.suggestedName || 'document.md');
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
      title: 'Save Markdown As',
      defaultPath: suggested,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    });
    if (canceled || !filePath) return { canceled: true };
    try {
      await fs.writeFile(filePath, text, 'utf8');
      return { canceled: false, path: filePath, name: path.basename(filePath) };
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Save failed.' };
    }
  });

  ipcMain.handle('desktop:export-pdf', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { canceled: true, error: 'No window.' };

    const paper = payload?.paper === 'a4' || payload?.paper === 'legal' ? payload.paper : 'letter';
    const pageSize = PAGE_SIZE_MAP[paper] ?? 'Letter';
    const suggested = suggestedPdfName(payload?.suggestedName || 'document.md');

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export PDF',
      defaultPath: suggested,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    try {
      const margins =
        payload?.footerRepeat === 'every' ? PDF_MARGINS_EVERY_PAGE_IN : PDF_MARGINS_IN;
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize,
        margins: {
          marginType: 'custom',
          top: margins.top,
          bottom: margins.bottom,
          left: margins.left,
          right: margins.right,
        },
      });
      await fs.writeFile(filePath, pdfBuffer);
      return { canceled: false, path: filePath };
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'PDF export failed.' };
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = findMarkdownPathFromArgv(argv);
    if (filePath) {
      openPathFromOs(filePath, { focus: true });
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Before ready: name Windows uses for taskbar / jump list (avoids bare "Electron").
  app.setName(APP_DISPLAY_NAME);
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.pragmaticdisruptor.markdown2pdf');
  }

  app.whenReady().then(async () => {
    registerIpc();
    buildAppMenu();
    const launchPath = findMarkdownPathFromArgv(process.argv);
    createWindow();
    if (launchPath) {
      await openPathFromOs(launchPath);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
