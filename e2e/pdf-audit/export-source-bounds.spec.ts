import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopAppPage } from '../pages/desktop-app.page';
import {
  extractPdfPages,
  findItemsBelowClearance,
  joinPdfText,
  mmToPt,
} from '../support/pdfExtract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/pdf-audit/multi-page-markers.md');
const OUT_DIR = path.resolve(__dirname, '../../test-results/pdf-audit');

/** Disclaimer token — must appear in PDF when every-page footer is on. */
const FOOTER_TOKEN = 'AUDIT_FOOTER_DISCLAIMER_TOKEN';

/**
 * Source tokens that must survive printToPDF / page.pdf text layer.
 * Top/bottom of pages are validated via presence + footer-band clearance, not
 * fragile page-index guesses (layout can reflow).
 */
const SOURCE_TOKENS = [
  'AUDIT_SRC_TITLE',
  'AUDIT_P1_TOP',
  'AUDIT_BODY_A1',
  'AUDIT_BODY_D3',
  'AUDIT_LAST_MARKER',
  'end of the day',
  'Summarizing closers',
  'Filler openers',
] as const;

/**
 * Body-only markers: must not paint inside the reserved every-page footer band.
 * (~28mm ≈ measured footer + page-# + pad; keep slightly under resolvePrintBottomMarginMm.)
 */
const BODY_MARKERS = ['AUDIT_BODY_', 'AUDIT_P1_TOP', 'AUDIT_LAST_MARKER', 'AUDIT_SRC_TITLE'] as const;
/** Body must clear @page bottom (~20mm). */
const FOOTER_BAND_MM = 20;
/**
 * Top of reserved footer band (not “footer height”). Tokens live near @page
 * bottom edge (~20mm); allow extract slack. Fat = ⅓-page empty caught by lowBody.
 */
const FOOTER_MAX_HEIGHT_FROM_BOTTOM_MM = 36;

test.describe('PDF audit: Export ground truth (agent loop)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  test('multi-page fixture: source tokens in PDF; body above footer band; disclaimer present', async ({
    page,
  }, testInfo) => {
    const md = fs.readFileSync(FIXTURE, 'utf8');
    const app = new DesktopAppPage(page);
    await app.goto();

    await app.typeMarkdown(md);
    // Tall real-world footer: long legal line + footer logo (under-measure was a prior miss).
    await app.setDisclaimer(
      `${FOOTER_TOKEN} — Confidential Property of Audit Fixture Corp | Strictly Proprietary | Do not distribute outside the engagement team without written approval.`,
    );
    const logoPath = path.resolve(__dirname, '../fixtures/logo-12x12.png');
    await page.locator('#logo-slot-footer').check();
    await page.locator('#file-logo').setInputFiles(logoPath);
    await page.waitForTimeout(500);
    await app.setFooterRepeat('every');
    await page.waitForTimeout(400);

    await expect(app.mdPreview).toContainText('AUDIT_SRC_TITLE');
    await expect(app.printFooterBlock).toContainText(FOOTER_TOKEN);

    const pdf = await app.exportPdfBuffer();
    expect(pdf.byteLength).toBeGreaterThan(2000);

    const artifact = path.join(OUT_DIR, `multi-page-markers-${testInfo.project.name}.pdf`);
    fs.writeFileSync(artifact, pdf);
    await testInfo.attach('export-pdf', { path: artifact, contentType: 'application/pdf' });

    const pages = await extractPdfPages(pdf);
    const allText = joinPdfText(pages);

    expect(pages.length, 'fixture should span multiple pages').toBeGreaterThanOrEqual(2);

    for (const token of SOURCE_TOKENS) {
      expect(allText, `PDF missing source token ${token}`).toContain(token);
    }

    // Footer / disclaimer may be split across PDF text items — join check.
    expect(allText.replace(/\s+/g, ' '), 'PDF missing footer disclaimer').toContain(
      FOOTER_TOKEN,
    );

    const minY = mmToPt(FOOTER_BAND_MM);
    const violations: string[] = [];
    for (const pg of pages) {
      for (const marker of BODY_MARKERS) {
        for (const hit of findItemsBelowClearance(pg, marker, minY)) {
          violations.push(
            `page ${pg.pageIndex + 1}: "${hit.str}" at y=${hit.y.toFixed(1)}pt < ${minY.toFixed(1)}pt footer band`,
          );
        }
      }
    }

    expect(violations, `body text inside footer clearance:\n${violations.join('\n')}`).toEqual([]);

    // Overlap: body markers must sit above footer disclaimer glyphs on the same page.
    const overlap: string[] = [];
    for (const pg of pages) {
      const footerYs = pg.items.filter((it) => it.str.includes('AUDIT_FOOTER')).map((it) => it.y);
      if (!footerYs.length) continue;
      const footerTop = Math.max(...footerYs) + 14;
      for (const marker of BODY_MARKERS) {
        for (const hit of pg.items.filter((it) => it.str.includes(marker))) {
          if (hit.y < footerTop) {
            overlap.push(
              `page ${pg.pageIndex + 1}: "${hit.str}" y=${hit.y.toFixed(1)} under footerTop≈${footerTop.toFixed(1)}`,
            );
          }
        }
      }
    }
    expect(overlap, `body/footer Y overlap:\n${overlap.join('\n')}`).toEqual([]);

    // Footer must stay a compact strip — not ~⅓ of the page (logo uncapped regression).
    const fatFooter: string[] = [];
    const maxFooterY = mmToPt(FOOTER_MAX_HEIGHT_FROM_BOTTOM_MM);
    for (const pg of pages) {
      for (const it of pg.items.filter((i) => i.str.includes('AUDIT_FOOTER'))) {
        if (it.y > maxFooterY) {
          fatFooter.push(
            `page ${pg.pageIndex + 1}: footer "${it.str.slice(0, 24)}…" y=${it.y.toFixed(1)} > ${maxFooterY.toFixed(1)}pt`,
          );
        }
      }
    }
    expect(fatFooter, `footer band too tall:\n${fatFooter.join('\n')}`).toEqual([]);

    // Usable body: at least one body marker should sit in the lower half of some page
    // (proves @page bottom is not eating most of the sheet).
    const lowBody = pages.some((pg) =>
      pg.items.some(
        (it) =>
          BODY_MARKERS.some((m) => it.str.includes(m)) && it.y < pg.height * 0.45,
      ),
    );
    expect(lowBody, 'no body text in lower page half — @page bottom likely oversized').toBe(true);

    // First page should open with title near the top (high y).
    const p0 = pages[0];
    const titleItem = p0.items.find((it) => it.str.includes('AUDIT_SRC_TITLE'));
    expect(titleItem, 'title glyph missing on page 1').toBeTruthy();
    if (titleItem) {
      expect(titleItem.y, 'title should be in upper half of page 1').toBeGreaterThan(p0.height * 0.45);
    }
  });
});
