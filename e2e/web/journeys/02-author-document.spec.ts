import { test, expect } from '@playwright/test';
import { AppPage } from '../../pages/app.page';

test.describe('Journey: author a document', () => {
  test('typing markdown updates the preview; toolbar bold formats selection in source and preview', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('Hello world');
    await expect(app.preview).toContainText('Hello world');
    await expect(app.preview.locator('p')).toHaveCount(1);

    await app.markdownTextarea.fill('Make this bold');
    await app.selectMarkdownRange(5, 9);
    await app.clickToolbarInsert('B');

    await expect(app.markdownTextarea).toHaveValue('Make **this** bold');
    await expect(app.preview.locator('strong')).toHaveText('this');

    await app.clickToolbarInsert('H1');
    await expect(app.markdownTextarea).toHaveValue(/^# /);
    await expect(app.preview.locator('h1')).toContainText('Make');
  });

  test('clear removes source and resets preview without touching branding controls', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('# Keep branding\n\nBody copy.');
    await app.setDisclaimer('Confidential — internal use only.');

    await app.clearSource();

    await expect(app.markdownTextarea).toHaveValue('');
    await expect(app.preview).toContainText('Open or paste Markdown to see the preview.');
    await expect(app.disclaimerTextarea).toHaveValue('Confidential — internal use only.');
    await expect(app.disclaimerFooter).toContainText('Confidential — internal use only.');
  });
});
