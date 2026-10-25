import type { Locator, Page } from '@playwright/test';
import { BRANDING_SETTLE_MS, PREVIEW_SETTLE_MS } from '../support/constants';

/** Desktop renderer page object (Markdown2PDF Electron UI served via Vite preview). */
export class DesktopAppPage {
  readonly page: Page;
  readonly markdownTextarea: Locator;
  readonly disclaimerTextarea: Locator;
  readonly footerRepeatSelect: Locator;
  readonly printRoot: Locator;
  readonly printFooterBlock: Locator;
  readonly mdPreview: Locator;

  constructor(page: Page) {
    this.page = page;
    this.markdownTextarea = page.getByLabel('Markdown (edit or paste)');
    this.disclaimerTextarea = page.getByLabel('Disclaimer / legal text (optional)');
    this.footerRepeatSelect = page.getByLabel('Footer on pages');
    this.printRoot = page.locator('#print-root');
    this.printFooterBlock = page.locator('#print-footer-block');
    this.mdPreview = page.locator('#md-preview');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.getByRole('heading', { name: 'Markdown2PDF' }).waitFor();
  }

  async typeMarkdown(text: string) {
    await this.markdownTextarea.click();
    await this.markdownTextarea.fill(text);
    await this.page.waitForTimeout(PREVIEW_SETTLE_MS);
  }

  async setDisclaimer(text: string) {
    await this.disclaimerTextarea.fill(text);
    await this.page.waitForTimeout(BRANDING_SETTLE_MS);
  }

  /** @param {'last' | 'every'} mode */
  async setFooterRepeat(mode: 'last' | 'every') {
    await this.footerRepeatSelect.selectOption(mode);
    await this.page.waitForTimeout(BRANDING_SETTLE_MS);
  }

  /**
   * Sync @page margins the same way Export does, then Chromium-print to PDF.
   * Matches Electron printToPDF options: preferCSSPageSize + printBackground.
   */
  async exportPdfBuffer(): Promise<Buffer> {
    const payload = await this.page.evaluate(async () => {
      if (typeof window.__m2pdfPreparePrintPdf === 'function') {
        await window.__m2pdfPreparePrintPdf();
      }
      if (typeof window.__m2pdfBuildPrintPdfPayload === 'function') {
        return window.__m2pdfBuildPrintPdfPayload();
      }
      return { paper: 'letter', footerRepeat: 'last' as const };
    });
    await this.page.waitForTimeout(100);

    const every = payload?.footerRepeat === 'every' && Boolean(payload.footerTemplate);
    const pdf = await this.page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'Letter',
      displayHeaderFooter: every,
      headerTemplate: '<div></div>',
      footerTemplate: every ? payload.footerTemplate! : '<div></div>',
      // Match Electron printToPdfOptions every-page custom margins (mm).
      margin: every
        ? { top: '16mm', right: '14mm', bottom: '20mm', left: '14mm' }
        : { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  }
}
