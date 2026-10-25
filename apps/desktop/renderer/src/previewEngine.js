/**
 * Desktop print preview engine — Source panel → context → View.
 *
 * Pipeline (real-time on debounced Source edits):
 * 1. Paper selection (US Letter / A4 / Legal) → sheet + @page margins
 * 2. Branding chrome (header, footer, logos, page #) → measured bands
 * 3. Source inventory (H1–H6, lists, tables, ---, code, …) + typography matrix → block heights
 * 4. Layout plan → page assignments
 * 5. Renderer builds #print-pages-stack from plan (+ DOM verify when block count matches)
 */

import { buildPrintPreviewContext, normalizePaperId } from '@m2pdf/core';

/**
 * @param {string | null | undefined} formValue
 * @returns {'letter' | 'a4' | 'legal'}
 */
export function confirmPaperSelection(formValue) {
  return normalizePaperId(formValue);
}

/**
 * @param {{
 *   sourceText: string,
 *   paper: string | null | undefined,
 *   everyPageFooter: boolean,
 *   maxSourceChars: number,
 *   chrome: import('@m2pdf/core').PreviewChromeBands,
 * }} params
 */
export function computePreviewFromSource(params) {
  return buildPrintPreviewContext({
    sourceText: params.sourceText,
    paper: params.paper,
    everyPageFooter: params.everyPageFooter,
    maxSourceChars: params.maxSourceChars,
    chrome: params.chrome,
  });
}
