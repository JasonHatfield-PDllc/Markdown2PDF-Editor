import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppPage } from '../../pages/app.page';
import { BRANDING_SETTLE_MS } from '../../support/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoFixture = path.join(__dirname, '../../fixtures/logo-12x12.png');

test.describe('Journey: branded document', () => {
  test('disclaimer and header logo appear in preview and print footer region together with article', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('# Quarterly Update\n\nRevenue grew year over year.');
    await app.setDisclaimer('© Pragmatic Disruptor, LLC. — For authorized recipients only.');

    await expect(app.disclaimerFooter).toContainText('For authorized recipients only.');
    await expect(app.printFooterBlock).toBeVisible();

    await page.getByLabel('Image URL (optional, saved in this browser)').fill('https://example.com/logo.png');
    await page.waitForTimeout(500);

    await expect(app.brandHeader).toBeVisible();
    await expect(app.brandHeader.locator('img')).toHaveAttribute('src', /example\.com\/logo\.png/);

    await expect(app.printRoot.locator('#md-preview h1')).toContainText('Quarterly Update');
    await expect(app.printRoot).toContainText('Revenue grew year over year.');
    await expect(app.printRoot).toContainText('For authorized recipients only.');
  });

  test('uploaded header logo and disclaimer coexist in the print-root system layout', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('## Deliverable\n\nSee attached summary.');
    await app.setDisclaimer('Draft — not for distribution.');

    const uploadInput = page.locator('#file-logo');
    await uploadInput.setInputFiles(logoFixture);
    await page.waitForTimeout(500);

    await expect(app.brandHeader).toBeVisible();
    await expect(app.brandHeader.locator('img')).toHaveAttribute('src', /^data:image\//);
    await expect(app.printFooterBlock).toBeVisible();
    await expect(app.disclaimerFooter).toContainText('Draft — not for distribution.');
    await expect(app.preview.locator('h2')).toContainText('Deliverable');
  });

  test('header Left at 100% scale uses a shrink-wrap logo column (placement is meaningful)', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    const uploadInput = page.locator('#file-logo');
    await uploadInput.setInputFiles(logoFixture);
    await page.getByLabel('Header logo placement').selectOption('left');
    await page.getByLabel('Header logo scale').fill('100');
    await page.getByLabel('Header logo scale').dispatchEvent('change');
    await page.waitForTimeout(500);

    await expect(app.brandHeader).toBeVisible();
    await expect(app.headerLogoColumn).toBeVisible();

    const metrics = await app.headerLogoColumn.evaluate((col) => {
      const parent = col.parentElement;
      return {
        colWidth: col.getBoundingClientRect().width,
        parentWidth: parent?.getBoundingClientRect().width ?? 0,
        justify: parent?.className ?? '',
      };
    });
    expect(metrics.parentWidth).toBeGreaterThan(0);
    expect(metrics.colWidth).toBeLessThan(metrics.parentWidth * 0.9);
    expect(metrics.justify).toContain('justify-start');
  });

  test('print title and logo share a smart header row; empty title+logo hides header', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await expect(app.brandHeader).toBeHidden();

    await app.setPrintTitle('Board Packet', 'h1');
    await expect(app.brandHeader).toBeVisible();
    await expect(app.brandHeaderTitle).toContainText('Board Packet');
    await expect(app.headerLogoColumn).toBeHidden();

    await app.typeMarkdown('# Body Heading Match');
    const sizes = await page.evaluate(() => {
      const title = document.getElementById('brand-header-title');
      const bodyH1 = document.querySelector('#md-preview h1');
      if (!title || !bodyH1) return null;
      return {
        title: Number.parseFloat(getComputedStyle(title).fontSize),
        body: Number.parseFloat(getComputedStyle(bodyH1).fontSize),
      };
    });
    expect(sizes).not.toBeNull();
    expect(sizes?.title).toBeCloseTo(sizes?.body ?? 0, 0);

    await page.getByLabel('Title placement').selectOption('center');
    await page.waitForTimeout(300);
    await expect(app.brandHeaderTitle).toHaveCSS('text-align', 'center');
    await page.getByLabel('Title placement').selectOption('right');
    await page.waitForTimeout(300);
    await expect(app.brandHeaderTitle).toHaveCSS('text-align', 'right');
    await page.getByLabel('Title placement').selectOption('left');
    await page.waitForTimeout(300);
    await expect(app.brandHeaderTitle).toHaveCSS('text-align', 'left');

    const uploadInput = page.locator('#file-logo');
    await uploadInput.setInputFiles(logoFixture);
    await page.waitForTimeout(500);

    await expect(app.headerLogoColumn).toBeVisible();
    await expect(app.brandHeaderTitle).toBeVisible();

    await app.printTitleInput.fill('');
    await page.waitForTimeout(500);
    await expect(app.brandHeaderTitle).toBeHidden();
    await expect(app.brandHeader).toBeVisible();

    await page.getByRole('button', { name: 'Remove logo preview' }).click();
    await page.waitForTimeout(300);
    await expect(app.brandHeader).toBeHidden();
  });

  test('footer text placement L/C/R updates disclaimer alignment', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.setDisclaimer('Aligned footer line.');

    await app.footerTextAlignSelect.selectOption('center');
    await page.waitForTimeout(BRANDING_SETTLE_MS);
    await expect(app.disclaimerFooter).toHaveCSS('text-align', 'center');

    await app.footerTextAlignSelect.selectOption('right');
    await page.waitForTimeout(BRANDING_SETTLE_MS);
    await expect(app.disclaimerFooter).toHaveCSS('text-align', 'right');

    await app.footerTextAlignSelect.selectOption('left');
    await page.waitForTimeout(BRANDING_SETTLE_MS);
    await expect(app.disclaimerFooter).toHaveCSS('text-align', 'left');
  });

  test('footer logo scale uses Header-parity (column %, image not stretched to 100%)', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await page.locator('#logo-slot-footer').check();
    const uploadInput = page.locator('#file-logo');
    await uploadInput.setInputFiles(logoFixture);
    await page.getByLabel('Footer logo placement').selectOption('left');
    await page.getByLabel('Footer logo scale').fill('40');
    await page.getByLabel('Footer logo scale').dispatchEvent('change');
    await page.waitForTimeout(BRANDING_SETTLE_MS);

    const footerCol = page.locator('#footer-logo-column');
    const footerImg = page.locator('#brand-logo-footer-img');
    await expect(footerCol).toBeVisible();

    const metrics = await footerCol.evaluate((col) => {
      const img = col.querySelector('img');
      return {
        colMax: (col as HTMLElement).style.maxWidth,
        imgWidth: img ? (img as HTMLElement).style.width : '',
      };
    });
    expect(metrics.colMax).toBe('40%');
    expect(metrics.imgWidth).toBe('auto');
    await expect(footerImg).toHaveCSS('max-width', '100%');
  });

  test('page number control injects @page margin-box CSS; paper width tracks A4', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.footerPageNumSelect.selectOption('right');
    await page.waitForTimeout(200);
    const styleRight = await page.locator('#m2pdf-print-page').textContent();
    expect(styleRight).toMatch(/@bottom-right\s*\{[^}]*counter\(page\)/s);
    expect(styleRight).toMatch(/@bottom-center\s*\{\s*content:\s*none/s);

    await app.footerPageNumSelect.selectOption('off');
    await page.waitForTimeout(200);
    const styleOff = await page.locator('#m2pdf-print-page').textContent();
    expect(styleOff).not.toMatch(/counter\(page\)/);

    await app.pageGuidePaper.selectOption('a4');
    await page.waitForTimeout(200);
    const paperW = await app.printRoot.evaluate((root) =>
      getComputedStyle(root).getPropertyValue('--m2pdf-print-paper-width').trim(),
    );
    expect(paperW).toBe('210mm');
  });
});
