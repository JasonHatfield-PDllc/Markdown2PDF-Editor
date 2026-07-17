import { test, expect } from '@playwright/test';
import { AppPage } from '../../pages/app.page';
import { STORAGE_KEYS } from '../../support/constants';

test.describe('Journey: page guides in the preview system', () => {
  test('enabling guides shows overlay bands; paper change updates stored settings without altering markdown', async ({
    page,
  }) => {
    const app = new AppPage(page);
    await app.goto();

    const source = '# Guide check\n\nParagraph one.\n\nParagraph two.';
    await app.typeMarkdown(source);

    await expect(app.pageGuideOverlay).toHaveClass(/\bhidden\b/);

    await app.pageGuideCheckbox.check();
    await page.waitForTimeout(300);
    const overlayVisible = await app.pageGuideOverlay.evaluate((el) => !el.classList.contains('hidden'));
    expect(overlayVisible).toBe(true);

    const stepBefore = await app.printRoot.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--m2pdf-guide-step').trim(),
    );
    expect(stepBefore).not.toBe('');

    await app.pageGuidePaper.selectOption('a4');
    await page.waitForTimeout(300);

    const stepAfter = await app.printRoot.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--m2pdf-guide-step').trim(),
    );
    expect(stepAfter).not.toBe(stepBefore);

    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.pageGuide);
    expect(stored).toContain('"paper":"a4"');
    expect(app.markdownTextarea).toHaveValue(source);

    await page.emulateMedia({ media: 'print' });
    await expect(app.pageGuideOverlay).toBeHidden();
  });
});
