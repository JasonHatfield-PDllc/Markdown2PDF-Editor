import { test, expect } from '@playwright/test';
import { AppPage } from '../../pages/app.page';

test.describe('Journey: first visit', () => {
  test('author lands on a ready editor with empty preview placeholder', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await expect(page.getByRole('heading', { name: 'Markdown → PDF Editor' })).toBeVisible();
    await expect(app.sidebar).toBeVisible();
    await expect(app.markdownTextarea).toBeVisible();
    await expect(app.markdownTextarea).toHaveValue('');
    await expect(app.preview).toContainText('Open or paste Markdown to see the preview.');
    await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open .md' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Insert Markdown' })).toBeVisible();
  });
});
