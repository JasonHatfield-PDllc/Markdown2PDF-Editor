/**
 * Find highlights for the Markdown source textarea.
 *
 * While the Find bar has focus, browsers often hide native selection — so we
 * show a yellow mark layer behind a transparent textarea. Metrics must match
 * exactly (including scrollbar gutter) or marks look jumbled.
 */

/** @type {WeakMap<HTMLTextAreaElement, { inner: HTMLElement, backdrop: HTMLElement, onScroll: () => void, onResize: () => void }>} */
const layers = new WeakMap();

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Align backdrop box + wrap width with the textarea (scrollbar-aware).
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
  // Extra padding-right = scrollbar so wrap width matches textarea client area
  backdrop.style.paddingRight = `${padR + sb}px`;
  backdrop.style.borderStyle = 'solid';
  backdrop.style.borderColor = 'transparent';
  backdrop.style.borderTopWidth = cs.borderTopWidth;
  backdrop.style.borderRightWidth = cs.borderRightWidth;
  backdrop.style.borderBottomWidth = cs.borderBottomWidth;
  backdrop.style.borderLeftWidth = cs.borderLeftWidth;
  backdrop.style.borderRadius = cs.borderRadius;
  backdrop.style.fontFamily = cs.fontFamily;
  backdrop.style.fontSize = cs.fontSize;
  backdrop.style.fontWeight = cs.fontWeight;
  backdrop.style.fontStyle = cs.fontStyle;
  backdrop.style.lineHeight = cs.lineHeight;
  backdrop.style.letterSpacing = cs.letterSpacing;
  backdrop.style.overflow = 'hidden';

  inner.style.margin = '0';
  inner.style.padding = '0';
  inner.style.border = '0';
  inner.style.fontFamily = cs.fontFamily;
  inner.style.fontSize = cs.fontSize;
  inner.style.fontWeight = cs.fontWeight;
  inner.style.fontStyle = cs.fontStyle;
  inner.style.lineHeight = cs.lineHeight;
  inner.style.letterSpacing = cs.letterSpacing;
  inner.style.whiteSpace = 'pre-wrap';
  inner.style.overflowWrap = 'break-word';
  inner.style.wordWrap = 'break-word';
  inner.style.tabSize = cs.tabSize || '8';
  inner.style.width = '100%';
  inner.style.boxSizing = 'border-box';
}

/**
 * @param {HTMLTextAreaElement} ta
 */
function ensureLayer(ta) {
  let layer = layers.get(ta);
  if (layer) return layer;

  const backdrop = document.getElementById('textarea-md-backdrop');
  const inner = document.getElementById('textarea-md-backdrop-inner');
  if (!backdrop || !inner) return null;

  const onScroll = () => {
    inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  };
  const onResize = () => {
    if (!ta.classList.contains('m2pdf-find-overlay-active')) return;
    syncBackdropMetrics(ta, backdrop, inner);
    onScroll();
  };
  ta.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(ta);
  }

  layer = { inner, backdrop, onScroll, onResize };
  layers.set(ta, layer);
  return layer;
}

/**
 * @param {HTMLTextAreaElement} ta
 */
export function syncEditorFindScroll(ta) {
  const layer = layers.get(ta);
  if (!layer) return;
  layer.inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {number} position
 * @returns {{ top: number, left: number, lineHeight: number }}
 */
export function getTextareaCaretOffset(ta, position) {
  const off = Math.max(0, Math.min(position, ta.value.length));
  const computed = window.getComputedStyle(ta);
  const mirror = document.createElement('div');
  const style = mirror.style;
  const sb = Math.max(0, ta.offsetWidth - ta.clientWidth);

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.overflow = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflowWrap = 'break-word';
  style.top = '0';
  style.left = '-99999px';
  style.boxSizing = 'border-box';
  style.width = `${ta.clientWidth}px`;
  style.padding = computed.padding;
  style.borderStyle = computed.borderStyle;
  style.borderWidth = computed.borderWidth;
  style.font = computed.font;
  style.letterSpacing = computed.letterSpacing;
  style.lineHeight = computed.lineHeight;
  style.tabSize = computed.tabSize;
  void sb;

  mirror.textContent = ta.value.slice(0, off);
  const marker = document.createElement('span');
  marker.textContent = ta.value.slice(off) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight =
    Number.parseFloat(computed.lineHeight) ||
    Number.parseFloat(computed.fontSize) * 1.5 ||
    16;
  const coords = {
    top: marker.offsetTop,
    left: marker.offsetLeft,
    lineHeight,
  };
  mirror.remove();
  return coords;
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {number} offset
 */
export function scrollTextareaToOffset(ta, offset) {
  if (!ta) return;
  const { top, left, lineHeight } = getTextareaCaretOffset(ta, offset);
  const viewH = ta.clientHeight;
  const viewW = ta.clientWidth;
  const marginY = Math.min(64, Math.max(24, viewH * 0.25));

  const visibleTop = ta.scrollTop;
  const visibleBottom = visibleTop + viewH;
  const caretBottom = top + lineHeight;

  if (top < visibleTop + marginY) {
    ta.scrollTop = Math.max(0, top - marginY);
  } else if (caretBottom > visibleBottom - marginY) {
    ta.scrollTop = Math.max(0, caretBottom - viewH + marginY);
  }

  if (left < ta.scrollLeft + 8) {
    ta.scrollLeft = Math.max(0, left - 24);
  } else if (left > ta.scrollLeft + viewW - 24) {
    ta.scrollLeft = Math.max(0, left - viewW / 2);
  }

  syncEditorFindScroll(ta);
}

/**
 * @param {string} text
 * @param {string} query
 * @param {boolean} matchCase
 * @param {number} activeStart
 */
function buildHighlightedHtml(text, query, matchCase, activeStart) {
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

  if (!starts.length) return escapeHtml(text);

  let out = '';
  let cursor = 0;
  for (const idx of starts) {
    out += escapeHtml(text.slice(cursor, idx));
    const end = idx + query.length;
    const active = idx === activeStart;
    out += `<mark class="${active ? 'm2pdf-find-mark-active' : 'm2pdf-find-mark'}">${escapeHtml(
      text.slice(idx, end),
    )}</mark>`;
    cursor = end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

/**
 * @param {HTMLTextAreaElement | null | undefined} ta
 * @param {string} query
 * @param {boolean} matchCase
 * @param {number} activeStart
 */
export function paintEditorFindHighlights(ta, query, matchCase, activeStart) {
  if (!ta || !query) {
    clearEditorFindHighlights(ta);
    return;
  }

  const layer = ensureLayer(ta);
  if (!layer) return;

  syncBackdropMetrics(ta, layer.backdrop, layer.inner);
  layer.inner.innerHTML = buildHighlightedHtml(ta.value, query, matchCase, activeStart);
  layer.backdrop.classList.remove('opacity-0');
  layer.backdrop.classList.add('opacity-100');
  ta.classList.add('m2pdf-find-overlay-active');
  syncEditorFindScroll(ta);
}

/**
 * @param {HTMLTextAreaElement | null | undefined} ta
 */
export function clearEditorFindHighlights(ta) {
  if (!ta) return;
  const layer = layers.get(ta);
  if (layer) {
    layer.inner.textContent = '';
    layer.inner.style.transform = '';
    layer.backdrop.classList.add('opacity-0');
    layer.backdrop.classList.remove('opacity-100');
  }
  ta.classList.remove('m2pdf-find-overlay-active');
}
