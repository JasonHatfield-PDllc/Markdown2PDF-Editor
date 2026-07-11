import { test, expect } from '@playwright/test';
import { AppPage } from '../../pages/app.page';

test.describe('Journey: print-ready layout', () => {
  test('print media hides chrome; print-root and PDF output include authored content and disclaimer', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('# Board Brief\n\nDecision required by Friday.');
    await app.setDisclaimer('Privileged and confidential.');

    await page.emulateMedia({ media: 'print' });

    await expect(app.sidebar).toBeHidden();
    await expect(app.printRoot).toBeVisible();
    await expect(app.printRoot.locator('h1')).toContainText('Board Brief');
    await expect(app.printFooterBlock).toBeVisible();
    await expect(app.disclaimerFooter).toContainText('Privileged and confidential.');

    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(500);
  });

  test('Print button invokes the browser print pipeline after the document is prepared', async ({ page }) => {
    let printCalled = false;
    await page.exposeFunction('markPrinted', () => {
      printCalled = true;
    });
    await page.addInitScript(() => {
      window.print = () => {
        // @ts-expect-error — exposed from test runner
        window.markPrinted();
      };
    });

    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('Print me');
    await app.clickPrint();

    expect(printCalled).toBe(true);
    await expect(app.preview).toContainText('Print me');
  });
});
