/**
 * Print preview / @page geometry (CSS px at 96dpi).
 * Chrome bands (header, footer) are measured in the renderer; this module holds the math.
 */

import { MM_TO_PX, PAPERS, PAGE_MARGIN_MM, PAGE_MARGIN_MM_EVERY_PAGE } from './pageGuide.js';

/**
 * @param {'letter' | 'a4' | 'legal'} paperId
 */
export function getSheetSizePx(paperId) {
  const p = PAPERS[paperId] ?? PAPERS.letter;
  return {
    widthPx: p.widthMm * MM_TO_PX,
    heightPx: p.heightMm * MM_TO_PX,
  };
}

/**
 * @param {boolean} everyPageFooter
 */
export function getPageMarginPx(everyPageFooter) {
  const bottomMm = everyPageFooter ? PAGE_MARGIN_MM_EVERY_PAGE.bottom : PAGE_MARGIN_MM.bottom;
  return {
    top: PAGE_MARGIN_MM.top * MM_TO_PX,
    right: PAGE_MARGIN_MM.right * MM_TO_PX,
    bottom: bottomMm * MM_TO_PX,
    left: PAGE_MARGIN_MM.left * MM_TO_PX,
  };
}

/**
 * Vertical space inside the sheet between top and bottom @page margins.
 * @param {number} sheetHeightPx
 * @param {{ top: number, bottom: number }} marginPx
 */
export function getInnerBandHeightPx(sheetHeightPx, marginPx) {
  return Math.max(48, sheetHeightPx - marginPx.top - marginPx.bottom);
}

/**
 * @typedef {{
 *   headerBandPx: number,
 *   footerBandPx: number,
 *   footerOnEveryPage: boolean,
 *   repeatHeaderEachPage: boolean,
 *   headerOnFirstPageOnly: boolean,
 * }} PreviewChromeBands
 */

/**
 * @param {boolean} showHeader
 * @param {boolean} repeatHeaderEachPage
 * @returns {Pick<PreviewChromeBands, 'repeatHeaderEachPage' | 'headerOnFirstPageOnly'>}
 */
export function getHeaderPlacementFlags(showHeader, repeatHeaderEachPage) {
  if (!showHeader) {
    return { repeatHeaderEachPage: false, headerOnFirstPageOnly: false };
  }
  if (repeatHeaderEachPage) {
    return { repeatHeaderEachPage: true, headerOnFirstPageOnly: false };
  }
  return { repeatHeaderEachPage: false, headerOnFirstPageOnly: true };
}

/**
 * Content area height for one preview sheet (px), after margins and chrome.
 * @param {number} pageIndex 0-based
 * @param {number} pageCount
 * @param {number} innerBandPx
 * @param {PreviewChromeBands} chrome
 */
export function getSlotHeightForPage(pageIndex, pageCount, innerBandPx, chrome) {
  const header = Math.max(0, chrome.headerBandPx);
  const footer = Math.max(0, chrome.footerBandPx);
  const isLast = pageIndex === pageCount - 1;
  const isFirst = pageIndex === 0;

  let band = innerBandPx;
  if (chrome.footerOnEveryPage) band -= footer;
  else if (isLast && footer > 0) band -= footer;

  let slot = band;
  if (chrome.repeatHeaderEachPage) slot -= header;
  else if (chrome.headerOnFirstPageOnly && isFirst) slot -= header;

  return Math.max(48, slot);
}
