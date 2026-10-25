/**
 * Prefer B text-layer smoke: after live preview PDF render, assert pdf.js spans
 * have real font metrics (wonky selection / orange box when --scale-factor missing).
 *
 * Usage (preview already on :4174, or set M2PDF_AUDIT_URL):
 *   electron apps/desktop/scripts/electron-textlayer-audit.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { printToPdfOptions } = require('../electron/printToPdfOptions.cjs');

const PAGE_SIZE_MAP = { letter: 'Letter', a4: 'A4', legal: 'Legal' };
const PREVIEW_URL = process.env.M2PDF_AUDIT_URL || 'http://127.0.0.1:4174/';
const PRELOAD = path.join(__dirname, '../electron/preload.cjs');

const SAMPLE_MD = `# Role & Purpose

This audit checks preview text-layer selection metrics.

## Governing References

1. First reference line for selection coverage.
2. Second reference line for selection coverage.
3. Third reference line for selection coverage.
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

// Stub handlers the desktop UI calls on boot (avoid noisy IPC errors).
for (const ch of [
  'desktop:set-recent-files',
  'desktop:take-launch-open',
  'desktop:get-recent-files',
  'desktop:clear-recent-files',
]) {
  try {
    ipcMain.handle(ch, async () => (ch.includes('recent') ? [] : null));
  } catch {
    /* already registered */
  }
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await win.loadURL(PREVIEW_URL);
    await win.webContents.executeJavaScript(
      `(() => {
        const ta = document.getElementById('textarea-md');
        if (!ta) throw new Error('missing textarea-md');
        ta.value = ${JSON.stringify(SAMPLE_MD)};
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );

    // Wait until pdf.js text layer has spans (debounce 650ms + printToPDF + render).
    const ready = await win.webContents.executeJavaScript(`(() => new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const spans = document.querySelectorAll('.m2pdf-pdfjs-page .textLayer span');
        const status = document.getElementById('chromium-pdf-status');
        if (spans.length > 5) {
          resolve({ ready: true, spanCount: spans.length, status: status?.textContent || '' });
          return;
        }
        if (Date.now() - started > 12000) {
          resolve({
            ready: false,
            spanCount: spans.length,
            status: status?.textContent || '',
            pages: document.querySelectorAll('.m2pdf-pdfjs-page').length,
            bodyClass: document.body.className,
          });
          return;
        }
        setTimeout(tick, 250);
      };
      tick();
    }))()`);
    console.log('wait:', JSON.stringify(ready));

    const report = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.m2pdf-pdfjs-page');
      const layer = document.querySelector('.m2pdf-pdfjs-page .textLayer');
      const spans = [...document.querySelectorAll('.m2pdf-pdfjs-page .textLayer span')];
      if (!page || !layer) {
        return { ok: false, error: 'text layer / page missing (preview not chromium-pdf?)' };
      }
      const totalScale = getComputedStyle(page).getPropertyValue('--total-scale-factor').trim();
      const scaleFactor = page.style.getPropertyValue('--scale-factor').trim();
      const sample = spans.slice(0, 12).map((span) => {
        const cs = getComputedStyle(span);
        return {
          text: (span.textContent || '').slice(0, 40),
          fontSize: cs.fontSize,
          transform: cs.transform,
          fontHeightVar: span.style.getPropertyValue('--font-height').trim(),
          top: span.style.top,
          left: span.style.left,
        };
      });
      const withFont = sample.filter((s) => s.fontSize && s.fontSize !== '0px' && s.fontHeightVar);
      const scaled = sample.filter((s) => s.transform && s.transform !== 'none');
      return {
        ok: true,
        spanCount: spans.length,
        totalScale,
        scaleFactor,
        sampleCount: sample.length,
        withFontCount: withFont.length,
        scaledCount: scaled.length,
        sample,
        layerWidth: layer.style.width || getComputedStyle(layer).width,
        layerHeight: layer.style.height || getComputedStyle(layer).height,
        layerHTML: layer.innerHTML.slice(0, 280),
      };
    })()`);

    const failures = [];
    if (!report?.ok) failures.push(report?.error || 'probe failed');
    else {
      if (!(Number(report.spanCount) > 5)) {
        failures.push(`expected many text spans, got ${report.spanCount}`);
      }
      if (!(Number(report.scaleFactor) > 0.5)) {
        failures.push(`--scale-factor missing/too small: "${report.scaleFactor}"`);
      }
      if (!(Number(report.totalScale) > 0.5)) {
        failures.push(`--total-scale-factor missing/too small: "${report.totalScale}"`);
      }
      if (report.withFontCount < Math.min(3, report.sampleCount)) {
        failures.push(
          `spans missing font metrics (${report.withFontCount}/${report.sampleCount}): ${JSON.stringify(report.sample.slice(0, 3))}`,
        );
      }
      // Wonky selection regression: font-size stayed browser-default (~16px) without CSS.
      const badSizes = (report.sample || []).filter((s) => {
        const px = parseFloat(s.fontSize);
        return !Number.isFinite(px) || px < 4 || px > 80;
      });
      if (badSizes.length) {
        failures.push(`implausible font-size on spans: ${JSON.stringify(badSizes.slice(0, 3))}`);
      }
    }

    if (failures.length) {
      console.error('TEXT LAYER AUDIT FAILED:');
      for (const f of failures) console.error(' -', f);
      console.error('report:', JSON.stringify(report, null, 2));
      win.destroy();
      app.exit(1);
      setTimeout(() => process.exit(1), 250);
      return;
    }

    console.log('TEXT LAYER AUDIT OK');
    console.log(
      JSON.stringify(
        {
          spanCount: report.spanCount,
          scaleFactor: report.scaleFactor,
          totalScale: report.totalScale,
          withFontCount: report.withFontCount,
          layerWidth: report.layerWidth,
          sample: report.sample.slice(0, 4),
        },
        null,
        2,
      ),
    );
    win.destroy();
    app.exit(0);
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    console.error(err);
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
    app.exit(1);
    setTimeout(() => process.exit(1), 250);
  }
}

main();
