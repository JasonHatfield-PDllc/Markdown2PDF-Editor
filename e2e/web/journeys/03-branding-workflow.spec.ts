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

    await expect(app.printRoot.locator('h1')).toContainText('Quarterly Update');
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
});
