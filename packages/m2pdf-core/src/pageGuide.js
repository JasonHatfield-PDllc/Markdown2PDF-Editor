/**
 * Vertical page-band hints for the on-screen preview only (not printed).
 * Uses the same margin assumptions as @page in main.css so spacing feels consistent.
 */

/** CSS px per mm (96dpi reference). */
export const MM_TO_PX = 96 / 25.4;

/** Match `@page` margins in main.css (bottom includes space for page margin box). */
export const PAGE_MARGIN_MM = {
  top: 16,
  right: 14,
  bottom: 22,
  left: 14,
};

/** Every-page footer mode: larger bottom margin reserves the repeating brand strip. */
export const PAGE_MARGIN_MM_EVERY_PAGE = {
  top: 16,
  right: 14,
  bottom: 40,
  left: 14,
};

/** Usable body height (mm) = sheet height − top/bottom print margins. */
export const PAPERS = {
  letter: { label: 'US Letter', heightMm: 279.4 },
  a4: { label: 'A4', heightMm: 297 },
  legal: { label: 'US Legal', heightMm: 355.6 },
};

/**
 * Vertical pitch for repeating guide lines (CSS px).
 * @param {'letter' | 'a4' | 'legal'} paperId
 * @param {{ bottomMm?: number }} [opts]
 */
export function getUsableHeightPx(paperId, opts) {
  const p = PAPERS[paperId] ?? PAPERS.letter;
  const bottomMm =
    opts && Number.isFinite(opts.bottomMm) ? /** @type {number} */ (opts.bottomMm) : PAGE_MARGIN_MM.bottom;
  const usableMm = p.heightMm - PAGE_MARGIN_MM.top - bottomMm;
  return Math.max(48, usableMm * MM_TO_PX);
}
