/**
 * Find highlights for the Markdown source textarea.
 *
 * Best-effort orange rects (measured inside the backdrop inner).
 * Primary UX: native textarea selection (see findReplace.js).
 */

/**
 * @typedef {{
 *   inner: HTMLElement,
 *   backdrop: HTMLElement,
 *   onScroll: () => void,
 *   onResize: () => void,
 *   lastPaint: { query: string, matchCase: boolean, activeStart: number } | null,
 * }} EditorFindLayer
 */

/** @type {WeakMap<HTMLTextAreaElement, EditorFindLayer>} */
const layers = new WeakMap();

export const MAX_FIND_HIGHLIGHT_MATCHES = 200;
export const MIN_LIVE_FIND_QUERY_LENGTH = 2;

/** @type {WeakMap<HTMLTextAreaElement, boolean>} */
const paintingFlags = new WeakMap();

const PROBE_CLASS = 'm2pdf-find-probe';

/**
 * @param {HTMLElement} probe
 * @param {CSSStyleDeclaration} computed
 */
function applyProbeTypography(probe, computed) {
  const style = probe.style;
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflowWrap = 'break-word';
  style.boxSizing = 'border-box';
  style.width = '100%';
  style.margin = '0';
  style.padding = '0';
  style.border = '0';
  style.font = computed.font;
  style.fontFamily = computed.fontFamily;
  style.fontSize = computed.fontSize;
  style.fontWeight = computed.fontWeight;
  style.fontStyle = computed.fontStyle;
  style.letterSpacing = computed.letterSpacing;
  style.lineHeight = computed.lineHeight;
  style.tabSize = computed.tabSize;
}

/**
 * @param {HTMLElement} probe
 * @param {string} text
 * @param {number} position
 */
function fillProbeAtCaret(probe, text, position) {
  const off = Math.max(0, Math.min(position, text.length));
  const before = text.slice(0, off);
  const after = text.slice(off);
  probe.replaceChildren();
  if (before) probe.append(document.createTextNode(before));
  const marker = document.createElement('span');
  if (after.length > 0) {
    marker.textContent = after.charAt(0);
    probe.append(marker);
    if (after.length > 1) probe.append(document.createTextNode(after.slice(1)));
  } else {
    marker.textContent = '\u200b';
    probe.append(marker);
  }
  return marker;
}

/**
 * In-stack measure div — same width and font as inner (not body-mounted).
 * @param {HTMLTextAreaElement} ta
 * @param {HTMLElement} inner
 */
function ensureMeasureProbe(ta, inner) {
  let probe = inner.querySelector(`:scope > .${PROBE_CLASS}`);
  if (!probe) {
    probe = document.createElement('div');
    probe.className = PROBE_CLASS;
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'absolute';
    probe.style.left = '0';
    probe.style.top = '0';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.overflow = 'hidden';
    inner.prepend(probe);
  }
  applyProbeTypography(probe, window.getComputedStyle(ta));
  return probe;
}

/**
 * @param {HTMLElement} marker
 * @param {HTMLElement} probe
 * @param {CSSStyleDeclaration} computed
 */
function coordsFromMarker(marker, probe, computed) {
  const pr = probe.getBoundingClientRect();
  const mr = marker.getBoundingClientRect();
  const lineHeight =
    Number.parseFloat(computed.lineHeight) ||
    Number.parseFloat(computed.fontSize) * 1.625 ||
    16;
  return {
    top: mr.top - pr.top,
    left: mr.left - pr.left,
    lineHeight,
  };
}

/**
 * @param {string} text
 * @param {string} query
 * @param {boolean} matchCase
 * @returns {number[]}
 */
function listMatchStarts(text, query, matchCase) {
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  /** @type {number[]} */
  const starts = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    starts.push(idx);
    from = idx + (needle.length || 1);
  }
  return starts;
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {HTMLElement} inner
 * @param {number} position
 */
function measureCaretInInner(ta, inner, position) {
  const computed = window.getComputedStyle(ta);
  const probe = ensureMeasureProbe(ta, inner);
  const marker = fillProbeAtCaret(probe, ta.value, position);
  return coordsFromMarker(marker, probe, computed);
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {HTMLElement} inner
 * @param {number[]} starts
 * @param {number} queryLen
 */
function measureMatchRects(ta, inner, starts, queryLen) {
  if (!starts.length || !queryLen) return [];
  const computed = window.getComputedStyle(ta);
  const probe = ensureMeasureProbe(ta, inner);
  const lineHeight =
    Number.parseFloat(computed.lineHeight) ||
    Number.parseFloat(computed.fontSize) * 1.625 ||
    16;
  const text = ta.value;

  /** @type {{ start: number, top: number, left: number, width: number, height: number }[]} */
  const rects = [];
  for (const start of starts) {
    const end = start + queryLen;
    const s = measureCaretInInner(ta, inner, start);
    const e = measureCaretInInner(ta, inner, end);
    if (Math.abs(e.top - s.top) < lineHeight * 0.75) {
      rects.push({
        start,
        top: s.top,
        left: s.left,
        width: Math.max(1, e.left - s.left),
        height: Math.max(1, s.lineHeight),
      });
      continue;
    }
    probe.replaceChildren();
    if (start > 0) probe.append(document.createTextNode(text.slice(0, start)));
    const mark = document.createElement('span');
    mark.textContent = text.slice(start, end);
    probe.append(mark);
    if (end < text.length) probe.append(document.createTextNode(text.slice(end)));
    const pr = probe.getBoundingClientRect();
    for (const r of mark.getClientRects()) {
      rects.push({
        start,
        top: r.top - pr.top,
        left: r.left - pr.left,
        width: r.width,
        height: r.height,
      });
    }
  }
  return rects;
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {HTMLElement} backdrop
 * @param {HTMLElement} inner
 */
export function syncBackdropMetrics(ta, backdrop, inner) {
  const cs = window.getComputedStyle(ta);
  const sb = Math.max(0, ta.offsetWidth - ta.clientWidth);
  const padR = Number.parseFloat(cs.paddingRight) || 0;
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padT = Number.parseFloat(cs.paddingTop) || 0;
  const padB = Number.parseFloat(cs.paddingBottom) || 0;

  backdrop.style.boxSizing = 'border-box';
  backdrop.style.width = `${ta.offsetWidth}px`;
  backdrop.style.height = `${ta.offsetHeight}px`;
  backdrop.style.paddingTop = `${padT}px`;
  backdrop.style.paddingBottom = `${padB}px`;
  backdrop.style.paddingLeft = `${padL}px`;
  backdrop.style.paddingRight = `${padR + sb}px`;
  backdrop.style.borderStyle = 'solid';
  backdrop.style.borderColor = 'transparent';
  backdrop.style.borderTopWidth = cs.borderTopWidth;
  backdrop.style.borderRightWidth = cs.borderRightWidth;
  backdrop.style.borderBottomWidth = cs.borderBottomWidth;
  backdrop.style.borderLeftWidth = cs.borderLeftWidth;
  backdrop.style.borderRadius = cs.borderRadius;
  backdrop.style.overflow = 'hidden';

  inner.style.margin = '0';
  inner.style.padding = '0';
  inner.style.border = '0';
  inner.style.position = 'relative';
  inner.style.width = '100%';
  inner.style.minHeight = `${ta.scrollHeight}px`;
  inner.style.height = 'auto';
  inner.style.boxSizing = 'border-box';
  inner.style.pointerEvents = 'none';
}

function ensureLayer(ta) {
  let layer = layers.get(ta);
  if (layer) return layer;

  const backdrop = document.getElementById('textarea-md-backdrop');
  const inner = document.getElementById('textarea-md-backdrop-inner');
  if (!backdrop || !inner) return null;

  const repaintIfNeeded = () => {
    const lp = layer.lastPaint;
    if (!ta.classList.contains('m2pdf-find-highlights-on') || !lp) return;
    paintEditorFindHighlights(ta, lp.query, lp.matchCase, lp.activeStart);
  };

  const onScroll = () => {
    if (paintingFlags.get(ta)) return;
    inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  };
  let resizeRepaintTimer = 0;
  const onResize = () => {
    if (!ta.classList.contains('m2pdf-find-highlights-on')) return;
    syncBackdropMetrics(ta, backdrop, inner);
    onScroll();
    if (paintingFlags.get(ta)) return;
    window.clearTimeout(resizeRepaintTimer);
    resizeRepaintTimer = window.setTimeout(() => {
      resizeRepaintTimer = 0;
      if (!paintingFlags.get(ta)) repaintIfNeeded();
    }, 120);
  };

  ta.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(ta);
  }

  layer = { inner, backdrop, onScroll, onResize, lastPaint: null };
  layers.set(ta, layer);
  return layer;
}

export function syncEditorFindScroll(ta) {
  const layer = layers.get(ta);
  if (!layer) return;
  layer.inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
}

/**
 * Scroll so the match at `offset` is inside the textarea viewport (soft-wrap aware).
 * @param {HTMLTextAreaElement} ta
 * @param {number} offset
 */
export function scrollTextareaToOffset(ta, offset) {
  if (!ta) return;
  try {
  const off = Math.max(0, Math.min(offset, ta.value.length));
  const cs = window.getComputedStyle(ta);
  let top;
  let lineHeight =
    Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.625 || 16;

  const layer = layers.get(ta) ?? ensureLayer(ta);
  if (layer) {
    syncBackdropMetrics(ta, layer.backdrop, layer.inner);
    const c = measureCaretInInner(ta, layer.inner, off);
    top = c.top;
    lineHeight = c.lineHeight;
  } else {
    const before = ta.value.slice(0, off);
    const lineIndex = before.split('\n').length - 1;
    const padT = Number.parseFloat(cs.paddingTop) || 0;
    top = padT + lineIndex * lineHeight;
  }

  const viewH = ta.clientHeight;
  const viewW = ta.clientWidth;
  const marginY = Math.min(56, Math.max(24, viewH * 0.22));
  const visibleTop = ta.scrollTop;
  const visibleBottom = visibleTop + viewH;
  const caretBottom = top + lineHeight;

  if (top < visibleTop + marginY) {
    ta.scrollTop = Math.max(0, top - marginY);
  } else if (caretBottom > visibleBottom - marginY) {
    ta.scrollTop = Math.max(0, caretBottom - viewH + marginY);
  }

  if (layer) {
    const c = measureCaretInInner(ta, layer.inner, off);
    const left = c.left;
    if (left < ta.scrollLeft + 12) {
      ta.scrollLeft = Math.max(0, left - 24);
    } else if (left > ta.scrollLeft + viewW - 24) {
      ta.scrollLeft = Math.max(0, left - viewW / 2);
    }
  }

  syncEditorFindScroll(ta);
  } catch {
    /* ignore measure failures; native selection may still scroll */
  }
}

/** @deprecated Internal; uses in-inner probe. */
export function getTextareaCaretOffset(ta, position) {
  const layer = layers.get(ta) ?? ensureLayer(ta);
  if (!layer) {
    return { top: 0, left: 0, lineHeight: 16 };
  }
  syncBackdropMetrics(ta, layer.backdrop, layer.inner);
  return measureCaretInInner(ta, layer.inner, position);
}

/**
 * @param {HTMLTextAreaElement | null | undefined} ta
 * @param {string} query
 * @param {boolean} matchCase
 * @param {number} activeStart
 * @param {{ maxMatches?: number, matchStarts?: number[] }} [opts]
 */
export function paintEditorFindHighlights(ta, query, matchCase, activeStart, opts = {}) {
  if (!ta || !query) {
    clearEditorFindHighlights(ta);
    return;
  }

  const layer = ensureLayer(ta);
  if (!layer) return;

  const maxMatches = opts.maxMatches ?? MAX_FIND_HIGHLIGHT_MATCHES;
  let starts = opts.matchStarts ?? listMatchStarts(ta.value, query, matchCase);

  if (!opts.matchStarts && starts.length > maxMatches) {
    starts = starts.slice(0, maxMatches);
    if (activeStart >= 0 && !starts.includes(activeStart)) {
      starts.push(activeStart);
      starts.sort((a, b) => a - b);
    }
  }

  layer.lastPaint = { query, matchCase, activeStart };

  paintingFlags.set(ta, true);
  try {
    syncBackdropMetrics(ta, layer.backdrop, layer.inner);
    const rects = measureMatchRects(ta, layer.inner, starts, query.length);

    for (const el of layer.inner.querySelectorAll('.m2pdf-find-rect, .m2pdf-find-rect-active')) {
      el.remove();
    }

    const frag = document.createDocumentFragment();
    for (const r of rects) {
      const box = document.createElement('div');
      const active = r.start === activeStart;
      box.className = active ? 'm2pdf-find-rect-active' : 'm2pdf-find-rect';
      box.style.top = `${r.top}px`;
      box.style.left = `${r.left}px`;
      box.style.width = `${Math.max(1, r.width)}px`;
      box.style.height = `${Math.max(1, r.height)}px`;
      frag.append(box);
    }
    layer.inner.append(frag);

    layer.backdrop.classList.remove('opacity-0');
    layer.backdrop.classList.add('opacity-100');
    ta.classList.add('m2pdf-find-highlights-on');
    ta.classList.remove('m2pdf-find-overlay-active');
    syncEditorFindScroll(ta);
    requestAnimationFrame(() => {
      syncBackdropMetrics(ta, layer.backdrop, layer.inner);
      syncEditorFindScroll(ta);
    });
  } finally {
    paintingFlags.set(ta, false);
  }
}

export function clearEditorFindHighlights(ta) {
  if (!ta) return;
  const layer = layers.get(ta);
  if (layer) {
    layer.lastPaint = null;
    for (const el of layer.inner.querySelectorAll('.m2pdf-find-rect, .m2pdf-find-rect-active')) {
      el.remove();
    }
    layer.inner.style.transform = '';
    layer.backdrop.classList.add('opacity-0');
    layer.backdrop.classList.remove('opacity-100');
  }
  ta.classList.remove('m2pdf-find-highlights-on');
  ta.classList.remove('m2pdf-find-overlay-active');
}
