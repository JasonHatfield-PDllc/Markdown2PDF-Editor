/**
 * Height matrix for print preview — aligned with desktop `.m2pdf-print-canvas` (11pt, line-height 1.35).
 * Used to estimate block heights from Source before / alongside DOM measure.
 */

import { getContentWidthPx } from './pageGuide.js';

/** 11pt body in CSS px (96dpi). */
export const PRINT_BODY_PT = 11;
export const PT_TO_PX = 96 / 72;
export const BODY_FONT_PX = PRINT_BODY_PT * PT_TO_PX;
export const BODY_LINE_HEIGHT = 1.35;
export const BODY_LINE_PX = BODY_FONT_PX * BODY_LINE_HEIGHT;

/** Matches `.m2pdf-print-canvas #md-preview.prose :where(p, li, td, th)` margin. */
export const BLOCK_MARGIN_EM = 0.35;
export const BLOCK_MARGIN_PX = BODY_FONT_PX * BLOCK_MARGIN_EM;

/** Average glyph width for prose sans at 11pt (estimate for wrapping). */
export const AVG_CHAR_WIDTH_PX = 6.1;

/**
 * Per block-type multipliers (prose-sm heading scale approximations).
 * @type {Record<string, { linePx?: number, fontScale?: number, marginPx?: number, fixedPx?: number }>}
 */
export const BLOCK_TYPE_MATRIX = {
  h1: { fontScale: 1.55, marginPx: BLOCK_MARGIN_PX * 1.1 },
  h2: { fontScale: 1.35, marginPx: BLOCK_MARGIN_PX * 1.05 },
  h3: { fontScale: 1.2, marginPx: BLOCK_MARGIN_PX },
  h4: { fontScale: 1.1, marginPx: BLOCK_MARGIN_PX },
  h5: { fontScale: 1.05, marginPx: BLOCK_MARGIN_PX * 0.9 },
  h6: { fontScale: 1, marginPx: BLOCK_MARGIN_PX * 0.9 },
  p: { fontScale: 1, marginPx: BLOCK_MARGIN_PX },
  li: { fontScale: 1, marginPx: BODY_FONT_PX * 0.2 },
  blockquote: { fontScale: 1, marginPx: BLOCK_MARGIN_PX, linePx: BODY_LINE_PX * 1.05 },
  hr: { fixedPx: 28, marginPx: BLOCK_MARGIN_PX },
  pre: { linePx: BODY_FONT_PX * 1.15, marginPx: BLOCK_MARGIN_PX },
  table: { linePx: BODY_LINE_PX * 0.95, marginPx: BLOCK_MARGIN_PX * 1.2 },
  'table-row': { linePx: BODY_LINE_PX * 0.95, marginPx: 0 },
  empty: { fixedPx: 0, marginPx: 0 },
};

/**
 * @param {number} contentWidthPx printable width (sheet − left/right margins)
 */
export function createTypographyMetrics(contentWidthPx) {
  const width = Math.max(200, contentWidthPx);
  const charsPerLine = Math.max(24, Math.floor(width / AVG_CHAR_WIDTH_PX));
  return {
    contentWidthPx: width,
    charsPerLine,
    bodyLinePx: BODY_LINE_PX,
    blockMarginPx: BLOCK_MARGIN_PX,
  };
}

/**
 * @param {string} text plain / markdown line text (no block marker)
 * @param {ReturnType<typeof createTypographyMetrics>} metrics
 * @param {number} [fontScale]
 */
export function estimateWrappedLines(text, metrics, fontScale = 1) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 1;
  const effectiveChars = Math.max(16, Math.floor(metrics.charsPerLine / Math.max(1, fontScale * 0.92)));
  let len = 0;
  for (const word of t.split(' ')) {
    len += word.length + 1;
  }
  return Math.max(1, Math.ceil(len / effectiveChars));
}

/**
 * @param {import('./markdownBlockInventory.js').SourceBlock} block
 * @param {ReturnType<typeof createTypographyMetrics>} metrics
 */
export function estimateBlockHeightPx(block, metrics) {
  const row = BLOCK_TYPE_MATRIX[block.type] ?? BLOCK_TYPE_MATRIX.p;
  if (row.fixedPx != null) {
    return row.fixedPx + (row.marginPx ?? 0);
  }

  const fontScale = row.fontScale ?? 1;
  const linePx = row.linePx ?? BODY_LINE_PX * fontScale;
  let lines = 1;

  if (block.type === 'pre') {
    lines = Math.max(1, (block.lineCount ?? 1));
  } else if (block.type === 'table') {
    const rows = block.rowCount ?? 1;
    const perRow = BLOCK_TYPE_MATRIX['table-row'].linePx ?? linePx;
    return rows * perRow + (row.marginPx ?? 0) + 8;
  } else if (block.type === 'hr') {
    return (row.fixedPx ?? 28) + (row.marginPx ?? 0);
  } else {
    lines = estimateWrappedLines(block.text ?? '', metrics, fontScale);
    if (block.type.startsWith('h')) lines = 1;
  }

  return lines * linePx + (row.marginPx ?? metrics.blockMarginPx);
}

/**
 * @param {'letter' | 'a4' | 'legal'} paperId
 */
export function contentWidthPxForPaper(paperId) {
  return getContentWidthPx(paperId);
}
