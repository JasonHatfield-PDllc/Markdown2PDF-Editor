import {
  clearPdfJsFindHighlights,
  countPdfJsMatches,
  findInPdfJsTextLayer,
} from './pdfJsPreview.js';

/** @type {Highlight | null} */
let activeHighlight = null;

const HIGHLIGHT_NAME = 'm2pdf-find';
const HIGHLIGHT_ACTIVE = 'm2pdf-find-active';

function isPdfJsRoot(root) {
  return Boolean(root?.id === 'pdfjs-pages' || root?.classList?.contains('m2pdf-pdfjs-pages'));
}

/** Clear CSS Highlight API marks in the preview pane. */
export function clearPreviewFindHighlights() {
  clearPdfJsFindHighlights();
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  }
  activeHighlight = null;
  document.querySelectorAll('#md-preview mark.m2pdf-find-mark').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
    parent.normalize();
  });
}

/**
 * @param {HTMLElement} root
 * @param {string} query
 * @param {boolean} matchCase
 * @returns {{ ranges: Range[] }}
 */
function buildMatchRanges(root, query, matchCase) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest('mark.m2pdf-find-mark')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  /** @type {{ node: Text, start: number }[]} */
  const nodeStarts = [];
  let flat = '';
  /** @type {Text | null} */
  let n;
  while ((n = /** @type {Text | null} */ (walker.nextNode()))) {
    nodeStarts.push({ node: n, start: flat.length });
    flat += n.textContent ?? '';
  }
  const hay = matchCase ? flat : flat.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  /** @type {Range[]} */
  const ranges = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    const end = idx + query.length;
    const startPos = indexToRange(nodeStarts, idx);
    const endPos = indexToRange(nodeStarts, end);
    if (startPos && endPos) {
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      ranges.push(range);
    }
    from = idx + (needle.length || 1);
  }
  return { ranges };
}

/**
 * @param {HTMLElement} root
 * @param {string} query
 * @param {boolean} matchCase
 */
export function countPreviewMatches(root, query, matchCase) {
  const q = query?.trim() ?? '';
  if (!root || !q) return 0;
  if (isPdfJsRoot(root)) return countPdfJsMatches(q, matchCase);
  return buildMatchRanges(root, q, matchCase).ranges.length;
}

/**
 * @param {{ node: Text, start: number }[]} nodeStarts
 * @param {number} index
 */
function indexToRange(nodeStarts, index) {
  for (let i = nodeStarts.length - 1; i >= 0; i--) {
    const { node, start } = nodeStarts[i];
    if (index >= start) {
      return { node, offset: index - start };
    }
  }
  return null;
}

/**
 * @param {HTMLElement | null} previewRoot
 * @param {string} query
 * @param {{ matchCase?: boolean, reverse?: boolean, matchIndex?: number }} [opts]
 * @returns {boolean}
 */
export function findInPreview(previewRoot, query, opts = {}) {
  const q = query?.trim() ?? '';
  if (!previewRoot || !q) return false;

  if (isPdfJsRoot(previewRoot)) {
    const r = findInPdfJsTextLayer(q, opts);
    return r.ok;
  }

  clearPreviewFindHighlights();

  const matchCase = Boolean(opts.matchCase);
  const { ranges } = buildMatchRanges(previewRoot, q, matchCase);
  if (!ranges.length) return false;

  let pick = typeof opts.matchIndex === 'number' ? opts.matchIndex : 0;
  if (opts.reverse) {
    pick = pick < 0 ? ranges.length - 1 : pick;
  }
  while (pick < 0) pick += ranges.length;
  pick %= ranges.length;

  const range = ranges[pick];

  if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
    activeHighlight = new Highlight(...ranges);
    CSS.highlights.set(HIGHLIGHT_NAME, activeHighlight);
    CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(range));
  } else {
    try {
      const mark = document.createElement('mark');
      mark.className = 'm2pdf-find-mark bg-amber-200 text-inherit';
      range.surroundContents(mark);
    } catch {
      /* cross-node */
    }
  }

  const scroller = document.getElementById('main-preview');
  const rect = range.getBoundingClientRect();
  if (scroller && rect.height) {
    const scRect = scroller.getBoundingClientRect();
    if (rect.top < scRect.top + 48 || rect.bottom > scRect.bottom - 48) {
      scroller.scrollTop += rect.top - scRect.top - scRect.height / 3;
    }
  }

  return true;
}

/** @param {HTMLElement | null} previewRoot */
export function getPreviewFindAnchor(previewRoot) {
  if (!previewRoot) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!previewRoot.contains(range.startContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(previewRoot);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}
