/**
 * Find bar typing must not freeze on large source (single-char queries are skipped live).
 *
 * Usage: electron apps/desktop/scripts/electron-find-typing-audit.cjs
 * Env: M2PDF_AUDIT_URL (default http://127.0.0.1:4176/)
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { printToPdfOptions } = require('../electron/printToPdfOptions.cjs');

const PAGE_SIZE_MAP = { letter: 'Letter', a4: 'A4', legal: 'Legal' };
const PREVIEW_URL = process.env.M2PDF_AUDIT_URL || 'http://127.0.0.1:4176/';
const PRELOAD = path.join(__dirname, '../electron/preload.cjs');

const PARA = 'Lorem ipsum dolor sit amet. ';
const BIG_MD = `---
**Author:** Jason Hatfield
---

${PARA.repeat(4000)}
This is the first this in the document.
`;

const MAX_MS_PER_KEY = 800;
const MAX_MS_FIND_CLICK = 5000;

ipcMain.handle('desktop:preview-pdf', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No window.' };
  try {
    const pdfBuffer = await win.webContents.printToPDF(
      printToPdfOptions(payload ?? {}, PAGE_SIZE_MAP),
    );
    return { ok: true, pdfBase64: pdfBuffer.toString('base64'), byteLength: pdfBuffer.byteLength };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Preview PDF failed.' };
  }
});

for (const ch of [
  'desktop:set-recent-files',
  'desktop:take-launch-open',
  'desktop:get-recent-files',
  'desktop:clear-recent-files',
]) {
  try {
    ipcMain.handle(ch, async () => (ch.includes('recent') ? [] : null));
  } catch {
    /* noop */
  }
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {string} script
 * @param {number} timeoutMs
 */
function jsWithTimeout(win, script, timeoutMs) {
  return Promise.race([
    win.webContents.executeJavaScript(script),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`renderer hung (> ${timeoutMs}ms)`)), timeoutMs),
    ),
  ]);
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await win.loadURL(PREVIEW_URL);
    await win.webContents.executeJavaScript(`(() => {
      const ta = document.getElementById('textarea-md');
      if (!ta) throw new Error('missing textarea-md');
      ta.value = ${JSON.stringify(BIG_MD)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()`);

    await new Promise((r) => setTimeout(r, 1200));

    await jsWithTimeout(
      win,
      `(() => {
        const findBar = document.getElementById('find-bar');
        const input = document.getElementById('find-query');
        if (!findBar || !input) throw new Error('find UI missing');
        findBar.classList.remove('hidden');
        input.value = '';
        input.focus();
        return true;
      })()`,
      5000,
    );

    /** @type {{ ch: string, syncMs: number, afterPaintMs: number }[]} */
    const steps = [];
    for (const ch of 'this') {
      const syncMs = await jsWithTimeout(
        win,
        `(() => {
          const input = document.getElementById('find-query');
          const t0 = performance.now();
          input.value = (input.value ?? '') + ${JSON.stringify(ch)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return performance.now() - t0;
        })()`,
        5000,
      );
      await new Promise((r) => setTimeout(r, 220));
      const pingMs = await jsWithTimeout(win, '(() => performance.now())()', 3000);
      steps.push({ ch, syncMs, afterPaintMs: pingMs });
    }

    const findMs = await jsWithTimeout(
      win,
      `(() => {
        const t0 = performance.now();
        document.getElementById('find-go')?.click();
        return performance.now() - t0;
      })()`,
      MAX_MS_FIND_CLICK,
    );
    await new Promise((r) => setTimeout(r, 200));

    const report = await jsWithTimeout(
      win,
      `(() => {
        const ta = document.getElementById('textarea-md');
        const rects = document.querySelectorAll('#textarea-md-backdrop-inner .m2pdf-find-rect, #textarea-md-backdrop-inner .m2pdf-find-rect-active');
        return {
          ok: true,
          docLen: ta?.value?.length ?? 0,
          rectCount: rects.length,
          selectionStart: ta?.selectionStart ?? -1,
          selectedText: ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '',
        };
      })()`,
      5000,
    );
    report.steps = steps;
    report.findMs = findMs;

    const failures = [];
    if (!report?.ok) failures.push(report?.error || 'probe failed');
    else {
      if (!(Number(report.docLen) > 50_000)) {
        failures.push(`expected large fixture, got len ${report.docLen}`);
      }
      for (const s of report.steps ?? []) {
        if (s.ms > MAX_MS_PER_KEY) {
          failures.push(`typing "${s.ch}" took ${Math.round(s.ms)}ms (max ${MAX_MS_PER_KEY})`);
        }
      }
      if (report.findMs > MAX_MS_FIND_CLICK) {
        failures.push(`Find click took ${Math.round(report.findMs)}ms (max ${MAX_MS_FIND_CLICK})`);
      }
      if (!(Number(report.rectCount) >= 1)) {
        failures.push(`expected highlight rects after Find, got ${report.rectCount}`);
      }
      const sel = String(report.selectedText).toLowerCase();
      if (sel !== 'this') {
        failures.push(`expected selection "this", got "${report.selectedText}"`);
      }
    }

    if (failures.length) {
      console.error('FIND TYPING AUDIT FAILED:');
      for (const f of failures) console.error(' -', f);
      console.error('report:', JSON.stringify(report, null, 2));
      win.destroy();
      app.exit(1);
      setTimeout(() => process.exit(1), 250);
      return;
    }

    console.log('FIND TYPING AUDIT OK');
    console.log(JSON.stringify(report, null, 2));
    win.destroy();
    app.exit(0);
    setTimeout(() => process.exit(0), 200);
  } catch (err) {
    console.error(err);
    win.destroy();
    app.exit(1);
    process.exit(1);
  }
}

main();
