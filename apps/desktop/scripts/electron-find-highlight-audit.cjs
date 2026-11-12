/**
 * Source Find highlight smoke: rects render above textarea when Find runs.
 *
 * Usage: electron apps/desktop/scripts/electron-find-highlight-audit.cjs
 * Env: M2PDF_AUDIT_URL (default http://127.0.0.1:4175/)
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { printToPdfOptions } = require('../electron/printToPdfOptions.cjs');

const PAGE_SIZE_MAP = { letter: 'Letter', a4: 'A4', legal: 'Legal' };
const PREVIEW_URL = process.env.M2PDF_AUDIT_URL || 'http://127.0.0.1:4176/';
const PRELOAD = path.join(__dirname, '../electron/preload.cjs');

const SAMPLE_MD = `---
**Author:** Jason Hatfield
---

This is the first this in the document.
Another line without the word.
`;

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
      ta.value = ${JSON.stringify(SAMPLE_MD)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

    await new Promise((r) => setTimeout(r, 800));

    const report = await win.webContents.executeJavaScript(`(() => {
      const findBar = document.getElementById('find-bar');
      const input = document.getElementById('find-query');
      const go = document.getElementById('find-go');
      if (!findBar || !input || !go) return { ok: false, error: 'find UI missing' };
      findBar.classList.remove('hidden');
      document.body.classList.add('m2pdf-find-bar-open');
      input.value = 'this';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      go.click();
      const backdrop = document.getElementById('textarea-md-backdrop');
      const rects = document.querySelectorAll('#textarea-md-backdrop-inner .m2pdf-find-rect');
      const activeEl = document.querySelector('#textarea-md-backdrop-inner .m2pdf-find-rect-active');
      const ta = document.getElementById('textarea-md');
      const bz = backdrop ? getComputedStyle(backdrop).zIndex : '';
      const tz = ta ? getComputedStyle(ta).zIndex : '';
      const hay = (ta && ta.value ? ta.value : '').toLowerCase();
      const firstThis = hay.indexOf('this');
      const authorIdx = hay.indexOf('author');

      return {
        ok: true,
        rectCount: rects.length,
        activeCount: activeEl ? 1 : 0,
        highlightAligned: (() => {
          if (!activeEl || !ta) return false;
          const ar = activeEl.getBoundingClientRect();
          const tr = ta.getBoundingClientRect();
          const cs = getComputedStyle(ta);
          const padT = parseFloat(cs.paddingTop) || 0;
          const padB = parseFloat(cs.paddingBottom) || 0;
          const padL = parseFloat(cs.paddingLeft) || 0;
          const padR = parseFloat(cs.paddingRight) || 0;
          const cTop = tr.top + padT;
          const cBottom = tr.bottom - padB;
          const cLeft = tr.left + padL;
          const cRight = tr.right - padR;
          return (
            ar.width > 2 &&
            ar.height > 2 &&
            ar.bottom > cTop &&
            ar.top < cBottom &&
            ar.right > cLeft &&
            ar.left < cRight
          );
        })(),
        backdropVisible: backdrop ? backdrop.classList.contains('opacity-100') : false,
        backdropZ: bz,
        textareaZ: tz,
        selectionLen: ta ? ta.selectionEnd - ta.selectionStart : 0,
        selectionStart: ta ? ta.selectionStart : -1,
        firstThis,
        authorIdx,
        selectedText: ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '',
        textareaHasHighlightClass: ta ? ta.classList.contains('m2pdf-find-highlights-on') : false,
        textareaBgTransparent: ta
          ? getComputedStyle(ta).backgroundColor.indexOf('0)') >= 0
          : false,
        scrollTop: ta ? ta.scrollTop : 0,
        clientHeight: ta ? ta.clientHeight : 0,
      };
    })()`);

    const failures = [];
    if (!report?.ok) failures.push(report?.error || 'probe failed');
    else {
      const markCount = Number(report.rectCount) + Number(report.activeCount);
      if (!(markCount >= 1)) {
        failures.push(
          `expected at least one highlight rect (inactive or active), got inactive=${report.rectCount} active=${report.activeCount}`,
        );
      }
      if (!report.backdropVisible) failures.push('backdrop not opacity-100 after find');
      if (!report.backdropVisible) failures.push('backdrop not opacity-100 after find');
      const taBg =
        report.textareaBgTransparent ??
        report.textareaHasHighlightClass ??
        false;
      if (!taBg && !Number(report.activeCount)) {
        failures.push('expected highlight class or active rect after find');
      }
      if (!(Number(report.selectionLen) === 4)) {
        failures.push(`expected selected "this" (len 4), got ${report.selectionLen} "${report.selectedText}"`);
      }
      if (report.firstThis >= 0 && report.selectionStart !== report.firstThis) {
        failures.push(
          `selection should start at first "this" (${report.firstThis}), got ${report.selectionStart}`,
        );
      }
      if (report.selectionStart >= 0 && report.selectionStart < 20) {
        failures.push(`selection must not land on Author header (idx ${report.selectionStart}, author≈${report.authorIdx})`);
      }
      if (!report.highlightAligned) {
        failures.push('active highlight rect must overlap textarea content box');
      }
    }

    if (failures.length) {
      console.error('FIND HIGHLIGHT AUDIT FAILED:');
      for (const f of failures) console.error(' -', f);
      console.error('report:', JSON.stringify(report, null, 2));
      win.destroy();
      app.exit(1);
      setTimeout(() => process.exit(1), 250);
      return;
    }

    console.log('FIND HIGHLIGHT AUDIT OK');
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
