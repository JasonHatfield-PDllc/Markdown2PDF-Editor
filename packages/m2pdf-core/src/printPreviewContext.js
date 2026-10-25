/**
 * Print preview pipeline: Paper → geometry → Source inventory → layout plan.
 * Desktop renderer consumes this on load and on every Source update.
 */

import { PAPERS } from './pageGuide.js';
import { inventoryMarkdownSource } from './markdownBlockInventory.js';
import {
  getInnerBandHeightPx,
  getPageMarginPx,
  getSheetSizePx,
} from './printPageGeometry.js';
import { planPreviewPagesFromSource } from './previewLayoutPlan.js';

/** @typedef {'letter' | 'a4' | 'legal'} PaperId */

/**
 * @param {string | null | undefined} paper
 * @returns {PaperId}
 */
export function normalizePaperId(paper) {
  if (paper === 'a4' || paper === 'legal' || paper === 'letter') return paper;
  return 'letter';
}

/**
 * @param {PaperId} paper
 * @returns {boolean} true when value was invalid and fell back to letter
 */
export function validatePaperSelection(paper) {
  return paper in PAPERS;
}

/**
 * @typedef {{
 *   sourceText: string,
 *   paper: PaperId,
 *   everyPageFooter: boolean,
 *   maxSourceChars: number,
 *   chrome: import('./printPageGeometry.js').PreviewChromeBands,
 * }} BuildPreviewContextInput
 */

/**
 * @param {BuildPreviewContextInput} input
 */
export function buildPrintPreviewContext(input) {
  const paperRaw = input.paper;
  const paper = normalizePaperId(paperRaw);
  const paperCorrected = paperRaw !== paper;
  const marginPx = getPageMarginPx(input.everyPageFooter);
  const { widthPx, heightPx } = getSheetSizePx(paper);
  const contentWidthPx = widthPx - marginPx.left - marginPx.right;
  const innerBandPx = getInnerBandHeightPx(heightPx, marginPx);

  const sourceText = input.sourceText ?? '';
  const trimmed = sourceText.trim();
  const charCount = sourceText.length;
  const paused = charCount > input.maxSourceChars;
  const hasContent = Boolean(trimmed) && !paused;

  const inventory = inventoryMarkdownSource(hasContent ? sourceText : '', contentWidthPx);

  const plan = hasContent
    ? planPreviewPagesFromSource(inventory.blocks, innerBandPx, input.chrome)
    : { pages: [], pageCount: 0 };

  return {
    paper,
    paperCorrected,
    paperValid: validatePaperSelection(paper),
    geometry: {
      sheetWidthPx: widthPx,
      sheetHeightPx: heightPx,
      marginPx,
      contentWidthPx,
      innerBandPx,
    },
    chrome: input.chrome,
    source: {
      hasContent,
      paused,
      charCount,
      lineCount: inventory.stats.lineCount || (sourceText ? sourceText.split('\n').length : 0),
    },
    inventory,
    plan,
  };
}
