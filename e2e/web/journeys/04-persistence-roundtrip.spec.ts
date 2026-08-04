import { test, expect } from '@playwright/test';
import { AppPage } from '../../pages/app.page';
import { BRANDING_SETTLE_MS, STORAGE_KEYS } from '../../support/constants';

test.describe('Journey: preferences survive reload', () => {
  test('disclaimer and page guide settings persist in localStorage across a full page reload', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.setDisclaimer('Persisted legal notice.');
    await app.pageGuideCheckbox.check();
    await app.pageGuidePaper.selectOption('legal');
    await page.waitForTimeout(300);

    const disclaimerBefore = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.disclaimer);
    const pageGuideBefore = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.pageGuide);
    expect(disclaimerBefore).toBe('Persisted legal notice.');
    expect(pageGuideBefore).toContain('"enabled":true');
    expect(pageGuideBefore).toContain('"paper":"legal"');

    await page.reload();
    await app.page.getByRole('heading', { name: 'Markdown → PDF Editor' }).waitFor();

    await expect(app.disclaimerTextarea).toHaveValue('Persisted legal notice.');
    await expect(app.pageGuideCheckbox).toBeChecked();
    await expect(app.pageGuidePaper).toHaveValue('legal');
    await expect(app.disclaimerFooter).toContainText('Persisted legal notice.');
  });

  test('markdown editor draft survives a full page reload', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('# Draft that should survive refresh\n\nKeep me.');
    await page.waitForTimeout(BRANDING_SETTLE_MS);

    const draftBefore = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.mdDraft);
    expect(draftBefore).toContain('Draft that should survive refresh');

    await page.reload();
    await app.page.getByRole('heading', { name: 'Markdown → PDF Editor' }).waitFor();

    await expect(app.markdownTextarea).toHaveValue(/Draft that should survive refresh/);
    await expect(app.preview.locator('h1')).toContainText('Draft that should survive refresh');
  });

  test('clearing markdown source does not clear persisted branding (documented product behavior)', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.typeMarkdown('# Temp doc');
    await app.setDisclaimer('Still here after clear.');
    await app.clearSource();

    await page.reload();
    await app.page.getByRole('heading', { name: 'Markdown → PDF Editor' }).waitFor();

    await expect(app.disclaimerTextarea).toHaveValue('Still here after clear.');
    await expect(app.markdownTextarea).toHaveValue('');
  });
});
