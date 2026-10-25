/**
 * Agent Export audit via real Electron printToPDF (same options as Export).
 * Playwright page.pdf can green-pass while Electron marginType fights @page —
 * this script is the ground-truth gate for footer clearance.
 *
 * Usage (from Markdown2PDF/):
 *   npm run build:desktop
 *   npm run test:pdf-audit:electron
 *
 * Expects desktop Vite preview OR loads apps/desktop/dist/index.html.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { printToPdfOptions } = require('../electron/printToPdfOptions.cjs');

const PAGE_SIZE_MAP = { letter: 'Letter', a4: 'A4', legal: 'Legal' };
const OUT_DIR = path.resolve(__dirname, '../../../test-results/pdf-audit');
const FIXTURE_MD = path.resolve(__dirname, '../../../e2e/fixtures/pdf-audit/multi-page-markers.md');
const FOOTER_TOKEN = 'AUDIT_FOOTER_DISCLAIMER_TOKEN';
const BODY_MARKERS = ['AUDIT_BODY_', 'AUDIT_P1_TOP', 'AUDIT_LAST_MARKER', 'AUDIT_SRC_TITLE'];
/** Must stay in sync with FOOTER clearance intent (footer + page# + pad). */
const FOOTER_BAND_MM = 20;
const FOOTER_MAX_HEIGHT_FROM_BOTTOM_MM = 36;
/** Body / footerTemplate side inset (@page left/right). */
const SIDE_INSET_MM = 14;
const SIDE_INSET_PT = mmToPt(SIDE_INSET_MM);
/** Allow extract / glyph slack; still fails if flush to paper edge (~0–8pt). */
const SIDE_SLACK_PT = 12;

const PREVIEW_URL = process.env.M2PDF_AUDIT_URL || 'http://127.0.0.1:4174/';

function mmToPt(mm) {
  return (mm / 25.4) * 72;
}

async function extractWithPdfJs(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !String(raw.str).trim()) continue;
      const t = raw.transform;
      items.push({ str: raw.str, x: t[4], y: t[5], width: Number(raw.width) || 0 });
    }
    pages.push({
      pageIndex: i - 1,
      width: viewport.width,
      height: viewport.height,
      items,
      text: items.map((it) => it.str).join(' '),
    });
  }
  return pages;
}

async function prepareDocument(win, markdown) {
  await win.webContents.executeJavaScript(
    `(() => {
      const md = ${JSON.stringify(markdown)};
      const foot = ${JSON.stringify(FOOTER_TOKEN)};
      const ta = document.getElementById('textarea-md');
      const disc = document.getElementById('textarea-disclaimer');
      const rep = document.getElementById('select-footer-repeat');
      const pageNum = document.getElementById('select-footer-pagenum');
      const textAlign = document.getElementById('select-footer-text-align');
      if (!ta || !disc || !rep) throw new Error('missing controls');
      ta.value = md;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      disc.value = foot + ' — Confidential Property of Audit Fixture Corp | Strictly Proprietary | Do not distribute outside the engagement team without written approval.';
      disc.dispatchEvent(new Event('input', { bubbles: true }));
      rep.value = 'every';
      rep.dispatchEvent(new Event('change', { bubbles: true }));
      // Left disclaimer + right page # — prove footerTemplate side insets vs paper edge.
      if (textAlign) {
        textAlign.value = 'left';
        textAlign.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (pageNum) {
        pageNum.value = 'right';
        pageNum.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`,
  );
  // Debounced render + footer measure
  await new Promise((r) => setTimeout(r, 900));
  await win.webContents.executeJavaScript(
    `typeof window.__m2pdfPreparePrintPdf === 'function'
      ? window.__m2pdfPreparePrintPdf()
      : Promise.resolve()`,
  );
}

async function readPrintPayload(win) {
  return win.webContents.executeJavaScript(
    `typeof window.__m2pdfBuildPrintPdfPayload === 'function'
      ? window.__m2pdfBuildPrintPdfPayload()
      : ({ paper: 'letter', footerRepeat: 'every' })`,
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(FIXTURE_MD)) {
    console.error('Missing fixture:', FIXTURE_MD);
    app.exit(2);
    return;
  }
  const markdown = fs.readFileSync(FIXTURE_MD, 'utf8');

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      offscreen: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadURL(PREVIEW_URL);
    await prepareDocument(win, markdown);

    const printPayload = await readPrintPayload(win);
    const failures = [];
    const tmpl = String(printPayload?.footerTemplate || '');
    const sideIn = `${(SIDE_INSET_MM / 25.4).toFixed(4)}in`;
    // Side spacer <td width:SIDE> — padding/abspos `right:` are ignored in footerTemplate.
    if (!tmpl.includes(`width:${sideIn}`) || !tmpl.includes('<table')) {
      failures.push(
        `footerTemplate missing side spacer width:${sideIn} (got snippet: ${tmpl.slice(0, 280).replace(/\s+/g, ' ')})`,
      );
    }

    const pdfBuffer = await win.webContents.printToPDF(
      printToPdfOptions(
        {
          paper: printPayload?.paper || 'letter',
          footerRepeat: printPayload?.footerRepeat || 'every',
          footerTemplate: printPayload?.footerTemplate,
          footerBottomMm: printPayload?.footerBottomMm,
        },
        PAGE_SIZE_MAP,
      ),
    );
    const outPdf = path.join(OUT_DIR, 'electron-multi-page-markers.pdf');
    fs.writeFileSync(outPdf, pdfBuffer);
    console.log('Wrote', outPdf, `(${pdfBuffer.byteLength} bytes)`);

    const pages = await extractWithPdfJs(pdfBuffer);
    const allText = pages.map((p) => p.text).join('\n');

    if (pages.length < 2) failures.push(`expected >=2 pages, got ${pages.length}`);
    const mustSurvive = [
      'AUDIT_SRC_TITLE',
      'AUDIT_P1_TOP',
      'AUDIT_BODY_A1',
      'AUDIT_LAST_MARKER',
      FOOTER_TOKEN,
      'end of the day',
      'Summarizing closers',
      'Filler openers',
    ];
    const flat = allText.replace(/\s+/g, ' ');
    for (const token of mustSurvive) {
      if (!flat.includes(token)) {
        failures.push(`missing token: ${token}`);
      }
    }

    const minY = mmToPt(FOOTER_BAND_MM);
    for (const pg of pages) {
      for (const it of pg.items) {
        const isBody = BODY_MARKERS.some((m) => it.str.includes(m));
        if (isBody && it.y < minY) {
          failures.push(
            `page ${pg.pageIndex + 1}: body "${it.str}" at y=${it.y.toFixed(1)} < ${minY.toFixed(1)}pt footer band`,
          );
        }
      }
    }

    // Overlap: body glyph below or within 10pt of footer disclaimer baseline
    for (const pg of pages) {
      const footerYs = pg.items.filter((it) => it.str.includes('AUDIT_FOOTER')).map((it) => it.y);
      if (!footerYs.length) continue;
      const footerTop = Math.max(...footerYs) + 14;
      for (const it of pg.items) {
        const isBody = BODY_MARKERS.some((m) => it.str.includes(m));
        if (isBody && it.y < footerTop) {
          failures.push(
            `page ${pg.pageIndex + 1}: body "${it.str}" y=${it.y.toFixed(1)} overlaps footer band (footerTop≈${footerTop.toFixed(1)})`,
          );
        }
      }
    }

    const maxFooterY = mmToPt(FOOTER_MAX_HEIGHT_FROM_BOTTOM_MM);
    for (const pg of pages) {
      for (const it of pg.items.filter((i) => i.str.includes('AUDIT_FOOTER'))) {
        if (it.y > maxFooterY) {
          failures.push(
            `page ${pg.pageIndex + 1}: fat footer y=${it.y.toFixed(1)} > ${maxFooterY.toFixed(1)}pt`,
          );
        }
      }
    }

    const lowBody = pages.some((pg) =>
      pg.items.some(
        (it) => BODY_MARKERS.some((m) => it.str.includes(m)) && it.y < pg.height * 0.45,
      ),
    );
    if (!lowBody) failures.push('no body text in lower page half — @page bottom oversized');

    // Horizontal inset: left disclaimer + right page # must clear paper edges (~14mm).
    const minSideX = SIDE_INSET_PT - SIDE_SLACK_PT;
    for (const pg of pages) {
      const footerBand = pg.items.filter((it) => it.y < mmToPt(FOOTER_BAND_MM + 8));
      const leftFoot = footerBand.filter((it) => it.str.includes('AUDIT_FOOTER'));
      // Match "Page 1 of 2" (single item) or split Page / digits / of — not "Property of…".
      const pageBits = footerBand.filter((it) => /^Page(\s+\d+(\s+of\s+\d+)?)?$/i.test(it.str.trim()) || /^(of|\d+)$/i.test(it.str.trim()));
      if (leftFoot.length) {
        const minX = Math.min(...leftFoot.map((it) => it.x));
        if (minX < minSideX) {
          failures.push(
            `page ${pg.pageIndex + 1}: left footer text x=${minX.toFixed(1)} < ${minSideX.toFixed(1)}pt (edge-flush)`,
          );
        }
      }
      if (pageBits.length) {
        const rightEdge = Math.max(...pageBits.map((it) => it.x + (Number(it.width) || it.str.length * 4)));
        const maxAllowed = pg.width - minSideX;
        if (rightEdge > maxAllowed) {
          failures.push(
            `page ${pg.pageIndex + 1}: page# rightEdge=${rightEdge.toFixed(1)} > ${maxAllowed.toFixed(1)}pt (edge-flush right; width=${pg.width.toFixed(1)}; x=${pageBits[0].x.toFixed(1)} "${pageBits[0].str}")`,
          );
        }
      } else if (pg.pageIndex === 0) {
        failures.push('page 1: no page-number text in footer band (expected Right page #)');
      }
    }

    if (failures.length) {
      console.error('ELECTRON PDF AUDIT FAILED:');
      for (const f of failures) console.error(' -', f);
      win.destroy();
      app.exit(1);
      setTimeout(() => process.exit(1), 250);
      return;
    }
    console.log(`ELECTRON PDF AUDIT OK (${pages.length} pages)`);
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
