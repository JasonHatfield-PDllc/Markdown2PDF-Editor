import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BRANDING_SETTLE_MS, PREVIEW_SETTLE_MS } from '../support/constants';

/**
 * Page object mirroring what a human sees: sidebar controls + preview pane.
 * Locators use roles/labels from index.html (accessibility-aligned).
 */
export class AppPage {
  readonly page: Page;

  readonly markdownTextarea: Locator;
  readonly disclaimerTextarea: Locator;
  readonly preview: Locator;
  readonly printRoot: Locator;
  readonly printFooterBlock: Locator;
  readonly disclaimerFooter: Locator;
  readonly brandHeader: Locator;
  readonly pageGuideOverlay: Locator;
  readonly pageGuideCheckbox: Locator;
  readonly pageGuidePaper: Locator;
  readonly sidebar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.markdownTextarea = page.getByLabel('Markdown (edit or paste)');
    this.disclaimerTextarea = page.getByLabel('Disclaimer / legal text (optional)');
    this.preview = page.locator('#md-preview');
    this.printRoot = page.locator('#print-root');
    this.printFooterBlock = page.locator('#print-footer-block');
    this.disclaimerFooter = page.locator('#disclaimer-footer');
    this.brandHeader = page.locator('#brand-header');
    this.pageGuideOverlay = page.locator('#page-guide-overlay');
    this.pageGuideCheckbox = page.getByRole('checkbox', { name: 'Show guides' });
    this.pageGuidePaper = page.getByLabel('Paper');
    this.sidebar = page.getByRole('complementary', { name: 'Document and branding controls' });
  }

  async goto() {
    await this.page.goto('/');
    await this.page.getByRole('heading', { name: 'Markdown → PDF Editor' }).waitFor();
  }

  async typeMarkdown(text: string) {
    await this.markdownTextarea.click();
    await this.markdownTextarea.fill(text);
    await this.page.waitForTimeout(PREVIEW_SETTLE_MS);
  }

  async selectMarkdownRange(start: number, end: number) {
    await this.markdownTextarea.focus();
    await this.markdownTextarea.evaluate(
      (el, { start, end }) => {
        const ta = el as HTMLTextAreaElement;
        ta.setSelectionRange(start, end);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { start, end },
    );
  }

  async clickToolbarInsert(name: string) {
    await this.page.getByRole('toolbar', { name: 'Insert Markdown' }).getByRole('button', { name, exact: true }).click();
    await this.page.waitForTimeout(PREVIEW_SETTLE_MS);
  }

  async setDisclaimer(text: string) {
    await this.disclaimerTextarea.fill(text);
    await this.page.waitForTimeout(BRANDING_SETTLE_MS);
  }

  /** Human path: click Open .md and complete the file picker. */
  async openMarkdownFile(path: string) {
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent('filechooser', { timeout: 15_000 }),
      this.page.getByRole('button', { name: 'Open .md' }).click(),
    ]);
    await fileChooser.setFiles(path);
    await expect(this.markdownTextarea).not.toHaveValue('', { timeout: 10_000 });
    await this.page.waitForTimeout(PREVIEW_SETTLE_MS);
  }

  async saveMarkdownAs() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Save As…' }).click();
    return downloadPromise;
  }

  async clearSource() {
    await this.page.getByRole('button', { name: 'Clear' }).click();
    await this.page.waitForTimeout(PREVIEW_SETTLE_MS);
  }

  async clickPrint() {
    await this.page.getByRole('button', { name: 'Print / Save as PDF' }).click();
  }
}
