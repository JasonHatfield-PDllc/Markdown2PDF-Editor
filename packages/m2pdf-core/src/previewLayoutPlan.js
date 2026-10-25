/**
 * Assign Source blocks to preview pages using geometry slots + estimated heights.
 */

import { getSlotHeightForPage } from './printPageGeometry.js';

/** Match desktop `PAGE_FOLD_GUARD_PX` — keep source plan conservative vs DOM clip. */
const SOURCE_FOLD_GUARD_PX = 12;

/**
 * @typedef {{
 *   pageIndex: number,
 *   blockIds: number[],
 *   slotHeightPx: number,
 *   usedHeightPx: number,
 * }} PreviewPagePlan
 */

/**
 * @typedef {{
 *   pages: PreviewPagePlan[],
 *   pageCount: number,
 * }} PreviewLayoutPlan
 */

/**
 * @param {import('./markdownBlockInventory.js').SourceBlock[]} blocks
 * @param {number} innerBandPx
 * @param {import('./printPageGeometry.js').PreviewChromeBands} chrome
 * @param {number} [maxPasses]
 * @returns {PreviewLayoutPlan}
 */
export function planPreviewPagesFromSource(blocks, innerBandPx, chrome, maxPasses = 8) {
  if (!blocks.length) {
    return {
      pages: [{ pageIndex: 0, blockIds: [], slotHeightPx: getSlotHeightForPage(0, 1, innerBandPx, chrome), usedHeightPx: 0 }],
      pageCount: 1,
    };
  }

  let pageCountHint = 1;
  /** @type {PreviewPagePlan[]} */
  let pages = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    pages = [];
    let pageIndex = 0;
    /** @type {number[]} */
    let curIds = [];
    let used = 0;

    const slot = () =>
      getSlotHeightForPage(pageIndex, pageCountHint, innerBandPx, chrome) - SOURCE_FOLD_GUARD_PX;

    for (const block of blocks) {
      const h = block.estimatedHeightPx;
      const maxH = slot();

      if (used + h <= maxH || curIds.length === 0) {
        if (used + h > maxH && curIds.length === 0) {
          curIds.push(block.id);
          used += h;
          pages.push({
            pageIndex,
            blockIds: curIds,
            slotHeightPx: maxH,
            usedHeightPx: used,
          });
          pageIndex += 1;
          curIds = [];
          used = 0;
          continue;
        }
        curIds.push(block.id);
        used += h;
        continue;
      }

      pages.push({
        pageIndex,
        blockIds: curIds,
        slotHeightPx: maxH,
        usedHeightPx: used,
      });
      pageIndex += 1;
      curIds = [block.id];
      used = h;
    }

    if (curIds.length) {
      const maxH = getSlotHeightForPage(pageIndex, pageCountHint, innerBandPx, chrome);
      pages.push({
        pageIndex,
        blockIds: curIds,
        slotHeightPx: maxH,
        usedHeightPx: used,
      });
    }

    if (!pages.length) {
      pages = [{ pageIndex: 0, blockIds: blocks.map((b) => b.id), slotHeightPx: getSlotHeightForPage(0, 1, innerBandPx, chrome), usedHeightPx: blocks.reduce((s, b) => s + b.estimatedHeightPx, 0) }];
    }

    const newHint = pages.length;
    if (newHint === pageCountHint) break;
    pageCountHint = newHint;
  }

  return { pages, pageCount: pages.length };
}

/**
 * Map a layout plan to break-unit page arrays by block index alignment.
 * @template T
 * @param {T[]} units DOM break units (same order as inventory blocks when aligned)
 * @param {PreviewLayoutPlan} plan
 * @param {import('./markdownBlockInventory.js').SourceBlock[]} blocks
 * @returns {T[][]}
 */
export function assignUnitsByPlan(units, plan, blocks) {
  if (units.length !== blocks.length) return null;

  const idToUnit = new Map(blocks.map((b, idx) => [b.id, units[idx]]));
  /** @type {T[][]} */
  const out = plan.pages.map((p) =>
    p.blockIds.map((bid) => idToUnit.get(bid)).filter(Boolean),
  );
  return out;
}
