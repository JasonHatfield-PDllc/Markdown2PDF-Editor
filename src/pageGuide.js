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

/** Usable body height (mm) = sheet height − top/bottom print margins. */
export const PAPERS = {
  letter: { label: 'US Letter', heightMm: 279.4 },
  a4: { label: 'A4', heightMm: 297 },
  legal: { label: 'US Legal', heightMm: 355.6 },
};

/**
 * Vertical pitch for repeating guide lines (CSS px).
 * @param {'letter' | 'a4' | 'legal'} paperId
 */
export function getUsableHeightPx(paperId) {
  const p = PAPERS[paperId] ?? PAPERS.letter;
  const usableMm = p.heightMm - PAGE_MARGIN_MM.top - PAGE_MARGIN_MM.bottom;
  return Math.max(48, usableMm * MM_TO_PX);
}
