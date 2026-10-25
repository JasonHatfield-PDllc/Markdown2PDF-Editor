/**
 * Break rendered Markdown (#md-preview children) into page-sized HTML chunks.
 */

/** @typedef {{ kind: 'block', el: Element } | { kind: 'li', listTag: 'ul' | 'ol', listEl: Element, li: Element, listOrdinal: number }} BreakUnit */

/**
 * @param {HTMLElement} mdPreview
 * @returns {BreakUnit[]}
 */
export function collectBreakUnits(mdPreview) {
  /** @type {BreakUnit[]} */
  const units = [];
  for (const el of mdPreview.children) {
    const tag = el.tagName;
    if (tag === 'UL' || tag === 'OL') {
      const listTag = tag === 'UL' ? 'ul' : 'ol';
      let ordinal = 0;
      for (const li of el.children) {
        if (li.tagName === 'LI') {
          units.push({ kind: 'li', listTag, listEl: el, li, listOrdinal: ordinal });
          ordinal += 1;
        }
      }
      if (el.children.length === 0) {
        units.push({ kind: 'block', el });
      }
    } else {
      units.push({ kind: 'block', el });
    }
  }
  return units;
}

/**
 * @param {BreakUnit[]} units
 * @returns {HTMLElement[]}
 */
function unitsToElements(units) {
  return unitsToElementsWithListStart(units);
}

/**
 * @param {Element} listEl
 */
function olStartBase(listEl) {
  const s = listEl.getAttribute('start');
  const n = s ? Number.parseInt(s, 10) : 1;
  return Number.isFinite(n) ? n : 1;
}

/**
 * @param {BreakUnit[]} units
 * @returns {HTMLElement[]}
 */
function unitsToElementsWithListStart(units) {
  /** @type {HTMLElement[]} */
  const out = [];
  /** @type {'ul' | 'ol' | null} */
  let openList = null;
  /** @type {HTMLElement | null} */
  let listHost = null;
  /** @type {Element | null} */
  let openListSource = null;

  for (const u of units) {
    if (u.kind === 'block') {
      if (listHost) {
        out.push(listHost);
        listHost = null;
        openList = null;
        openListSource = null;
      }
      out.push(/** @type {HTMLElement} */ (u.el.cloneNode(true)));
    } else {
      const sameList = openListSource === u.listEl && openList === u.listTag && listHost;
      if (!sameList) {
        if (listHost) out.push(listHost);
        listHost = document.createElement(u.listTag);
        for (const attr of u.listEl.attributes) {
          if (u.listTag === 'ol' && attr.name === 'start') continue;
          listHost.setAttribute(attr.name, attr.value);
        }
        if (u.listTag === 'ol') {
          listHost.setAttribute('start', String(olStartBase(u.listEl) + u.listOrdinal));
        }
        openList = u.listTag;
        openListSource = u.listEl;
      }
      listHost.appendChild(u.li.cloneNode(true));
    }
  }
  if (listHost) out.push(listHost);
  return out;
}

/** Reserve space so wrapped last lines are not clipped at the page body edge. */
export const PAGE_FOLD_GUARD_PX = 10;

const MIN_PARAGRAPH_SPLIT_HEAD_WORDS = 4;
const MIN_PARAGRAPH_SPLIT_TAIL_WORDS = 4;

/**
 * @param {HTMLElement} probe
 * @param {BreakUnit[]} units
 */
export function measureUnits(probe, units) {
  const nodes = unitsToElements(units);
  probe.replaceChildren(...nodes);
  return probe.offsetHeight;
}

/**
 * @param {HTMLElement} clipHost
 * @param {HTMLElement} probe
 * @param {number} maxHeightPx
 */
function isTextPastClipBottom(clipHost, probe, maxHeightPx) {
  const clipTop = clipHost.getBoundingClientRect().top;
  const clipBottom = clipTop + maxHeightPx;
  const walker = document.createTreeWalker(probe, NodeFilter.SHOW_TEXT);
  /** @type {Node | null} */
  let lastText = null;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.textContent?.trim()) lastText = n;
  }
  if (!lastText) return false;

  const range = document.createRange();
  range.selectNodeContents(lastText);
  for (const rect of range.getClientRects()) {
    if (rect.height > 0 && rect.bottom > clipBottom - 0.5) return true;
  }
  return false;
}

/**
 * @param {HTMLElement} clipHost
 * @param {HTMLElement} probe
 * @param {BreakUnit[]} units
 * @param {number} slotPx full page body height (matches preview `.m2pdf-preview-page-body`)
 */
export function measureUnitsInPageSlot(clipHost, probe, units, slotPx) {
  const nodes = unitsToElements(units);
  probe.replaceChildren(...nodes);
  const slotH = Math.max(48, slotPx);
  const contentLimit = Math.max(24, slotH - PAGE_FOLD_GUARD_PX);
  clipHost.style.height = `${slotH}px`;
  clipHost.style.maxHeight = `${slotH}px`;
  clipHost.style.overflow = 'hidden';

  let contentH = probe.scrollHeight;
  const lastEl = probe.lastElementChild;
  if (lastEl) {
    const probeTop = probe.getBoundingClientRect().top;
    const lastBottom = lastEl.getBoundingClientRect().bottom - probeTop;
    contentH = Math.max(contentH, lastBottom);
  }

  const overflow = contentH > contentLimit + 0.5;
  const lastLineClip = isTextPastClipBottom(clipHost, probe, contentLimit);
  return {
    contentHeight: contentH,
    clipped: overflow || lastLineClip,
  };
}

/**
 * @param {BreakUnit[]} page
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} slotPx
 * @returns {{ head: BreakUnit[], tail: BreakUnit[] } | null}
 */
/** @param {BreakUnit} unit */
export function isHeadingUnit(unit) {
  const el = unit.kind === 'li' ? unit.li : unit.el;
  return /^H[1-6]$/.test(el.tagName);
}

/**
 * Keep section headings with the following content (no orphan heading at page bottom).
 * @param {BreakUnit[][]} pages
 * @returns {boolean} changed
 */
export function demoteWidowHeadings(pages) {
  let changed = false;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.length !== 1) continue;
    const last = page[0];
    if (!isHeadingUnit(last)) continue;
    page.pop();
    if (!pages[i + 1]) pages.push([]);
    pages[i + 1] = [last, ...pages[i + 1]];
    changed = true;
  }
  return changed;
}

export function splitLastUnitOnPage(page, probe, clipHost, slotPx) {
  if (!page.length) return null;
  const prefix = page.slice(0, -1);
  const last = page[page.length - 1];
  const split = trySplitUnitAtFold(last, probe, clipHost, slotPx, prefix);
  if (!split) return null;
  return {
    head: [...prefix, ...split.head],
    tail: split.tail,
  };
}

/**
 * @param {BreakUnit[]} units
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {(pageIndex: number, pageCountHint: number) => number} slotForPage
 * @param {number} [maxPasses]
 * @returns {BreakUnit[][]}
 */
export function paginateBreakUnits(units, probe, clipHost, slotForPage, maxPasses = 6) {
  if (!units.length) return [[]];

  let pageCountHint = 1;
  /** @type {BreakUnit[][]} */
  let pages = [[]];

  for (let pass = 0; pass < maxPasses; pass++) {
    pages = [[]];
    let pageIndex = 0;
    /** @type {BreakUnit[]} */
    let cur = [];

    for (const unit of units) {
      const slotPx = slotForPage(pageIndex, pageCountHint);
      const tryUnits = [...cur, unit];
      const { clipped } = measureUnitsInPageSlot(clipHost, probe, tryUnits, slotPx);

      if (!clipped) {
        cur = tryUnits;
        continue;
      }

      if (cur.length === 0) {
        const split = trySplitUnitAtFold(unit, probe, clipHost, slotPx, []);
        if (split) {
          pages[pageIndex] = split.head;
          pageIndex += 1;
          pages.push([]);
          cur = split.tail;
          continue;
        }
        pages[pageIndex] = [unit];
        pageIndex += 1;
        pages.push([]);
        cur = [];
        continue;
      }

      const curFits = !measureUnitsInPageSlot(clipHost, probe, cur, slotPx).clipped;
      if (curFits) {
        pages[pageIndex] = cur;
        pageIndex += 1;
        pages.push([]);
        cur = [unit];
        continue;
      }

      const splitCur = splitLastUnitOnPage(cur, probe, clipHost, slotPx);
      if (splitCur) {
        pages[pageIndex] = splitCur.head;
        pageIndex += 1;
        pages.push([]);
        cur = [...splitCur.tail, unit];
        continue;
      }

      pages[pageIndex] = cur;
      pageIndex += 1;
      pages.push([]);
      cur = [unit];
    }

    if (cur.length) {
      if (!pages[pageIndex]) pages.push([]);
      pages[pageIndex] = cur;
    }

    while (pages.length && pages[pages.length - 1].length === 0) {
      pages.pop();
    }
    if (!pages.length) pages = [[]];

    const newHint = pages.length;
    if (newHint === pageCountHint) break;
    pageCountHint = newHint;
  }

  return reflowPagesAvoidFold(pages, probe, clipHost, slotForPage);
}

/**
 * @param {BreakUnit} unit
 * @param {Element[]} childEls
 * @returns {BreakUnit}
 */
function partialUnitFromChildren(unit, childEls) {
  if (unit.kind === 'li') {
    const li = document.createElement('li');
    for (const attr of unit.li.attributes) {
      li.setAttribute(attr.name, attr.value);
    }
    for (const c of childEls) {
      li.appendChild(c.cloneNode(true));
    }
    return { kind: 'li', listTag: unit.listTag, listEl: unit.listEl, li, listOrdinal: unit.listOrdinal };
  }
  const tag = unit.el.tagName.toLowerCase();
  const shell = document.createElement(tag);
  for (const attr of unit.el.attributes) {
    shell.setAttribute(attr.name, attr.value);
  }
  for (const c of childEls) {
    shell.appendChild(c.cloneNode(true));
  }
  return { kind: 'block', el: shell };
}

/**
 * Split one block/list item when it alone overflows the page slot.
 * @param {BreakUnit} unit
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} maxHeightPx
 * @returns {{ head: BreakUnit[], tail: BreakUnit[] } | null}
 */
/**
 * @param {BreakUnit} unit
 * @param {HTMLParagraphElement} pEl
 * @param {string} text
 */
function unitWithParagraphText(unit, pEl, text) {
  const p = /** @type {HTMLParagraphElement} */ (pEl.cloneNode(false));
  p.textContent = text;
  if (unit.kind === 'li') {
    const li = document.createElement('li');
    for (const attr of unit.li.attributes) li.setAttribute(attr.name, attr.value);
    li.appendChild(p);
    return { kind: 'li', listTag: unit.listTag, listEl: unit.listEl, li, listOrdinal: unit.listOrdinal };
  }
  if (unit.kind === 'block' && unit.el.tagName === 'P') {
    return { kind: 'block', el: p };
  }
  const shell = document.createElement(unit.el.tagName.toLowerCase());
  for (const attr of unit.el.attributes) shell.setAttribute(attr.name, attr.value);
  shell.appendChild(p);
  return { kind: 'block', el: shell };
}

/**
 * @param {BreakUnit} unit
 * @param {HTMLParagraphElement} pEl
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} maxHeightPx
 */
function trySplitSingleParagraphAtFold(unit, pEl, probe, clipHost, slotPx, prefixUnits) {
  const words = pEl.textContent.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let lo = 0;
  let hi = words.length;
  while (lo < hi - 1) {
    const mid = Math.ceil((lo + hi) / 2);
    const text = words.slice(0, mid).join(' ');
    const trial = unitWithParagraphText(unit, pEl, text);
    const pageUnits = [...prefixUnits, trial];
    const { clipped } = measureUnitsInPageSlot(clipHost, probe, pageUnits, slotPx);
    if (clipped) hi = mid;
    else lo = mid;
  }

  if (lo < MIN_PARAGRAPH_SPLIT_HEAD_WORDS) return null;
  if (lo >= words.length) lo = words.length - 1;

  const tailText = words.slice(lo).join(' ').trim();
  if (!tailText) return null;
  const tailWords = tailText.split(/\s+/).filter(Boolean);
  if (tailWords.length < MIN_PARAGRAPH_SPLIT_TAIL_WORDS) return null;

  const headUnit = unitWithParagraphText(unit, pEl, words.slice(0, lo).join(' '));
  const headPage = [...prefixUnits, headUnit];
  if (measureUnitsInPageSlot(clipHost, probe, headPage, slotPx).clipped) return null;

  return {
    head: [headUnit],
    tail: [unitWithParagraphText(unit, pEl, tailText)],
  };
}

/**
 * @param {BreakUnit} unit
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} slotPx
 * @param {BreakUnit[]} prefixUnits content already on this page above `unit`
 */
export function trySplitUnitAtFold(unit, probe, clipHost, slotPx, prefixUnits = []) {
  const root = unit.kind === 'li' ? unit.li : unit.el;

  if (root.tagName === 'P') {
    return trySplitSingleParagraphAtFold(
      unit,
      /** @type {HTMLParagraphElement} */ (root),
      probe,
      clipHost,
      slotPx,
      prefixUnits,
    );
  }

  const childEls = root.children.length ? [...root.children] : null;
  if (!childEls || childEls.length === 0) return null;

  if (childEls.length === 1 && childEls[0].tagName === 'P') {
    return trySplitSingleParagraphAtFold(
      unit,
      /** @type {HTMLParagraphElement} */ (childEls[0]),
      probe,
      clipHost,
      slotPx,
      prefixUnits,
    );
  }

  if (childEls.length < 2) return null;

  let lo = 0;
  let hi = childEls.length;
  while (lo < hi - 1) {
    const mid = Math.ceil((lo + hi) / 2);
    const trial = partialUnitFromChildren(unit, childEls.slice(0, mid));
    const pageUnits = [...prefixUnits, trial];
    const { clipped } = measureUnitsInPageSlot(clipHost, probe, pageUnits, slotPx);
    if (clipped) hi = mid;
    else lo = mid;
  }

  if (lo <= 0 || lo >= childEls.length) return null;

  const headUnit = partialUnitFromChildren(unit, childEls.slice(0, lo));
  if (measureUnitsInPageSlot(clipHost, probe, [...prefixUnits, headUnit], slotPx).clipped) {
    return null;
  }

  return {
    head: [headUnit],
    tail: [partialUnitFromChildren(unit, childEls.slice(lo))],
  };
}

/**
 * Move units off the bottom fold when clipped content would show only a sliver of text.
 * @param {BreakUnit[][]} pages
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {(pageIndex: number, pageCountHint: number) => number} slotForPage
 * @param {number} [maxOuterPasses]
 */
export function reflowPagesAvoidFold(
  pages,
  probe,
  clipHost,
  slotForPage,
  maxOuterPasses = 24,
) {
  if (!pages.length) return [[]];

  for (let outer = 0; outer < maxOuterPasses; outer++) {
    let changed = false;
    const countHint = Math.max(1, pages.length);

    for (let i = 0; i < pages.length; i++) {
      const slotPx = slotForPage(i, countHint);
      if (!pages[i].length) continue;

      while (pages[i].length > 0) {
        const { clipped } = measureUnitsInPageSlot(clipHost, probe, pages[i], slotPx);
        if (!clipped) break;

        const splitLast = splitLastUnitOnPage(pages[i], probe, clipHost, slotPx);
        if (splitLast) {
          changed = true;
          pages[i] = splitLast.head;
          if (!pages[i + 1]) pages.push([]);
          pages[i + 1] = [...splitLast.tail, ...pages[i + 1]];
          continue;
        }

        if (pages[i].length === 1) break;

        changed = true;
        const tail = pages[i].pop();
        if (!pages[i + 1]) {
          pages.push([]);
        }
        pages[i + 1].unshift(tail);
      }
    }

    pages = pages.filter((p) => p.length > 0);
    if (!pages.length) pages = [[]];

    if (!changed) break;
  }

  demoteWidowHeadings(pages);
  return pages;
}

/**
 * @param {HTMLElement} stack
 * @returns {number} 0-based page index, or -1
 */
export function findMountedOverflowPage(stack) {
  for (const frame of stack.querySelectorAll('.m2pdf-preview-page-frame')) {
    const body = frame.querySelector('.m2pdf-preview-page-body');
    const content = body?.querySelector('.m2pdf-page-prose');
    if (!body || !content) continue;
    if (content.scrollHeight > body.clientHeight + 1) {
      return Number(frame.dataset.page) - 1;
    }
  }
  return -1;
}

/**
 * @param {BreakUnit[][]} pageUnits
 * @param {number} pageIndex
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} slotPx
 * @returns {boolean}
 */
/**
 * @param {BreakUnit[][]} pageUnits
 * @param {number} pageIndex
 * @param {HTMLElement} probe
 * @param {HTMLElement} clipHost
 * @param {number} slotPx
 * @param {{ blocksOnly?: boolean }} [opts]
 */
export function shiftOverflowOffPage(pageUnits, pageIndex, probe, clipHost, slotPx, opts = {}) {
  const page = pageUnits[pageIndex];
  if (!page?.length) return false;

  if (!opts.blocksOnly) {
    const split = splitLastUnitOnPage(page, probe, clipHost, slotPx);
    if (split) {
      pageUnits[pageIndex] = split.head;
      if (!pageUnits[pageIndex + 1]) pageUnits.push([]);
      pageUnits[pageIndex + 1] = [...split.tail, ...pageUnits[pageIndex + 1]];
      return true;
    }
  }

  if (page.length > 1) {
    const tail = page.pop();
    if (!pageUnits[pageIndex + 1]) pageUnits.push([]);
    pageUnits[pageIndex + 1].unshift(tail);
    return true;
  }

  if (page.length === 1) {
    const only = page[0];
    pageUnits[pageIndex] = [];
    if (!pageUnits[pageIndex + 1]) pageUnits.push([]);
    pageUnits[pageIndex + 1].unshift(only);
    return true;
  }

  return false;
}

/**
 * @param {BreakUnit[]} units
 * @returns {string}
 */
export function breakUnitsToHtml(units) {
  const nodes = unitsToElements(units);
  return nodes.map((n) => n.outerHTML).join('');
}

/**
 * @param {string} proseClass
 * @param {number} widthPx
 * @returns {{ probe: HTMLElement, clipHost: HTMLElement }}
 */
export function createMeasureProbe(proseClass, widthPx) {
  const canvas = document.createElement('div');
  canvas.className = 'm2pdf-print-canvas';
  canvas.style.cssText = [
    'position:fixed',
    'left:-12000px',
    'top:0',
    `width:${widthPx}px`,
    'visibility:hidden',
    'pointer-events:none',
    'box-sizing:border-box',
  ].join(';');

  const clipHost = document.createElement('div');
  clipHost.style.width = '100%';
  clipHost.style.boxSizing = 'border-box';
  clipHost.style.overflow = 'hidden';

  const probe = document.createElement('article');
  probe.className = `m2pdf-page-prose ${proseClass}`;
  probe.style.width = '100%';
  probe.style.boxSizing = 'border-box';
  probe.style.margin = '0';

  clipHost.appendChild(probe);
  canvas.appendChild(clipHost);
  document.body.appendChild(canvas);
  return { probe, clipHost, canvas };
}

/**
 * @param {{ probe: HTMLElement, clipHost: HTMLElement }} bundle
 */
export function removeMeasureProbe(bundle) {
  bundle.canvas.remove();
}
