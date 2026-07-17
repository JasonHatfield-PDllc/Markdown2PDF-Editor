import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppPage } from '../../pages/app.page';
import { useLegacyFileIo } from '../../support/legacy-file-io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleFixture = path.join(__dirname, '../../fixtures/sample.md');

test.describe('Journey: file workflow', () => {
  test.beforeEach(async ({ page }) => {
    await useLegacyFileIo(page);
  });

  test('open .md loads source into editor and preview; save as downloads matching markdown', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await app.openMarkdownFile(sampleFixture);

    await expect(app.markdownTextarea).toHaveValue(/Branded Report/);
    await expect(app.preview.getByRole('heading', { name: 'Branded Report' })).toBeVisible();
    await expect(app.preview.locator('strong')).toContainText('Bold');

    await app.markdownTextarea.fill(`${await app.markdownTextarea.inputValue()}\n\nAdded after open.`);
    await page.waitForTimeout(300);

    const download = await app.saveMarkdownAs();
    const suggested = download.suggestedFilename();
    expect(suggested).toMatch(/\.md$/i);

    const savedPath = path.join(test.info().outputDir, suggested);
    await download.saveAs(savedPath);

    const fs = await import('node:fs/promises');
    const savedText = await fs.readFile(savedPath, 'utf8');
    expect(savedText).toContain('Branded Report');
    expect(savedText).toContain('Added after open.');
  });
});
