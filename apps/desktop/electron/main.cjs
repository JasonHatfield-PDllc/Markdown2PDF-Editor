const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const DEV_URL = 'http://127.0.0.1:5174';
const MAX_MD_OPEN_BYTES = 2 * 1024 * 1024;

/** Match @page margins in renderer CSS (mm → inches). */
const PDF_MARGINS_IN = {
  top: 16 / 25.4,
  right: 14 / 25.4,
  bottom: 22 / 25.4,
  left: 14 / 25.4,
};

const PAGE_SIZE_MAP = {
  letter: 'Letter',
  a4: 'A4',
  legal: 'Legal',
};

/** @type {BrowserWindow | null} */
let mainWindow = null;

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getIndexPath() {
  return path.join(__dirname, '../dist/index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.M2PDF_ELECTRON_DEV === '1') {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(getIndexPath());
  }
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
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize,
        margins: {
          marginType: 'custom',
          top: PDF_MARGINS_IN.top,
          bottom: PDF_MARGINS_IN.bottom,
          left: PDF_MARGINS_IN.left,
          right: PDF_MARGINS_IN.right,
        },
      });
      await fs.writeFile(filePath, pdfBuffer);
      return { canceled: false, path: filePath };
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'PDF export failed.' };
    }
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
