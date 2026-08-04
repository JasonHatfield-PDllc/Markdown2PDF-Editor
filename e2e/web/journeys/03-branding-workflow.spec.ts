import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppPage } from '../../pages/app.page';

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
});
