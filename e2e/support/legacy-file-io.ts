import type { Page } from '@playwright/test';

/**
 * Forces legacy <input type="file"> and download fallback paths so file I/O
 * journeys are automatable without mocking the File System Access API.
 *
 * Decision: documented in docs/PHASE0-HANDOFF.md (D-004).
 */
export async function useLegacyFileIo(page: Page) {
  await page.addInitScript(() => {
    // Remove FS Access API so Open/Save use sync legacy paths (file input + download).
    // @ts-expect-error — test-only override
    window.showOpenFilePicker = undefined;
    // @ts-expect-error — test-only override
    window.showSaveFilePicker = undefined;
  });
}
