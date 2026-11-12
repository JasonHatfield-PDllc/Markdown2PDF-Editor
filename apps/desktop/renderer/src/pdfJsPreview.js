/**
 * Prefer B Preview host: pdf.js canvas + text layer over printToPDF bytes.
 * Layout comes from Chromium Export; text layer enables Find + selection.
 *
 * Use the **legacy** build — modern pdfjs 6 expects Uint8Array.prototype.toHex
 * (not in Electron 33) → "a.toHex is not a function" in the preview status bar.
 */
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  attachPdfTextLayerSelection,
  detachAllPdfTextLayerSelections,
} from './textLayerSelection.js';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
let pdfDoc = null;
/** @type {number} */
let renderToken = 0;
/** @type {string | null} */
let lastPdfBase64 = null;
/** @type {ResizeObserver | null} */
let hostResizeObserver = null;
/** @type {number} */
let lastFitWidth = 0;
/** @type {ReturnType<typeof setTimeout> | 0} */
let resizeTimer = 0;

/** Readable default (~115% of PDF point size at 96dpi). */
const MIN_PREVIEW_SCALE = 1.15;
const MAX_PREVIEW_SCALE = 2.5;

/**
 * @returns {HTMLElement | null}
 */
function getPagesRoot() {
  return document.getElementById('pdfjs-pages');
}

/** Scroll container for the PDF page strip (not #main-preview). */
function getPreviewScrollEl() {
  return getPagesRoot();
}

/**
 * @typedef {{ scrollTop: number, ratio: number, pageNum: number, anchorY: number }} PreviewScrollAnchor
 */

/** @returns {PreviewScrollAnchor | null} */
export function capturePreviewScrollAnchor() {
  const el = getPreviewScrollEl();
  if (!el) return null;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const scrollTop = el.scrollTop;
  const ratio = max > 0 ? scrollTop / max : 0;
  const viewportMid = scrollTop + el.clientHeight / 2;
  let pageNum = 1;
  let anchorY = viewportMid;
  const pages = el.querySelectorAll('.m2pdf-pdfjs-page');
  for (const p of pages) {
    const top = p.offsetTop;
    const bottom = top + p.offsetHeight;
    if (viewportMid >= top && viewportMid < bottom) {
      pageNum = Number(/** @type {HTMLElement} */ (p).dataset.pageNumber) || 1;
      anchorY = viewportMid - top;
      break;
    }
  }
  return { scrollTop, ratio, pageNum, anchorY };
}

/**
 * @param {PreviewScrollAnchor | null} anchor
 */
function restorePreviewScrollAnchor(anchor) {
  const el = getPreviewScrollEl();
  if (!el || !anchor) return;

  const apply = () => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max <= 0) {
      el.scrollTop = 0;
      return;
    }
    const page = el.querySelector(`.m2pdf-pdfjs-page[data-page-number="${anchor.pageNum}"]`);
    if (page instanceof HTMLElement) {
      const target = page.offsetTop + anchor.anchorY - el.clientHeight * 0.35;
      el.scrollTop = Math.min(max, Math.max(0, target));
      return;
    }
    if (anchor.ratio > 0) {
      el.scrollTop = Math.min(max, anchor.ratio * max);
      return;
    }
    el.scrollTop = Math.min(max, Math.max(0, anchor.scrollTop));
  };

  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

/**
 * @param {HTMLElement} host
 */
function measureFitWidth(host) {
  const w = host.clientWidth || host.getBoundingClientRect().width || 0;
  return Math.max(0, Math.floor(w));
}

/**
 * Fit-width, but never below MIN_PREVIEW_SCALE (avoids tiny first paint / narrow measure).
 * @param {number} pageWidthPt
 * @param {number} hostWidthPx
 */
function resolvePreviewScale(pageWidthPt, hostWidthPx) {
  const pad = 32;
  const usable = Math.max(280, hostWidthPx - pad);
  const fit = usable / pageWidthPt;
  return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, fit));
}

export function clearPdfJsPreview() {
  renderToken += 1;
  lastPdfBase64 = null;
  if (pdfDoc) {
    try {
      pdfDoc.destroy();
    } catch {
      /* ignore */
    }
    pdfDoc = null;
  }
  clearPdfJsFindHighlights();
  detachAllPdfTextLayerSelections();
  const root = getPagesRoot();
  if (root) root.replaceChildren();
}

/**
 * Re-render at readable scale when the host finishes layout (first paint often ~0 width).
 */
function ensureHostResizeObserver() {
  const host = document.getElementById('chromium-pdf-host');
  if (!host || hostResizeObserver) return;
  hostResizeObserver = new ResizeObserver(() => {
    if (!lastPdfBase64) return;
    const w = measureFitWidth(host);
    if (w < 200) return;
    if (Math.abs(w - lastFitWidth) < 48) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0;
      if (!lastPdfBase64) return;
      void renderPdfJsFromBase64(lastPdfBase64, { fitWidth: w });
    }, 320);
  });
  hostResizeObserver.observe(host);
}

/**
 * @param {string} pdfBase64
 * @param {{ fitWidth?: number }} [opts]
 */
export async function renderPdfJsFromBase64(pdfBase64, opts = {}) {
  const host = document.getElementById('chromium-pdf-host');
  let root = getPagesRoot();
  if (!host) return { ok: false, error: 'PDF host missing.' };
  if (!root) {
    root = document.createElement('div');
    root.id = 'pdfjs-pages';
    root.className = 'm2pdf-pdfjs-pages';
    host.appendChild(root);
  }
  ensureHostResizeObserver();

  const token = ++renderToken;
  if (pdfDoc) {
    try {
      pdfDoc.destroy();
    } catch {
      /* ignore */
    }
    pdfDoc = null;
  }
  clearPdfJsFindHighlights();
  const scrollAnchor = capturePreviewScrollAnchor();

  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  if (token !== renderToken) {
    doc.destroy();
    return { ok: false, error: 'stale' };
  }
  pdfDoc = doc;
  lastPdfBase64 = pdfBase64;

  // Prefer real host width; fall back to a desktop-preview-sized default (not 320).
  let hostWidth = opts.fitWidth || measureFitWidth(host);
  if (hostWidth < 360) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    hostWidth = measureFitWidth(host);
  }
  if (hostWidth < 360) hostWidth = 900;
  lastFitWidth = hostWidth;

  /** Build off-DOM first — keep prior pages visible until one atomic swap (avoids scroll jump). */
  const builtPages = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    if (token !== renderToken) return { ok: false, error: 'stale' };
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = resolvePreviewScale(base.width, hostWidth);
    const viewport = page.getViewport({ scale });

    const pageWrap = document.createElement('div');
    pageWrap.className = 'm2pdf-pdfjs-page';
    pageWrap.dataset.pageNumber = String(pageNum);
    pageWrap.style.width = `${viewport.width}px`;
    pageWrap.style.height = `${viewport.height}px`;
    // Required by pdf.js TextLayer CSS (font-size / layer size use these).
    pageWrap.style.setProperty('--scale-factor', String(scale));
    pageWrap.style.setProperty('--user-unit', '1');
    pageWrap.style.setProperty('--total-scale-factor', String(scale));
    pageWrap.style.setProperty('--scale-round-x', '1px');
    pageWrap.style.setProperty('--scale-round-y', '1px');

    const canvas = document.createElement('canvas');
    canvas.className = 'm2pdf-pdfjs-canvas';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) continue;

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    // Dimensions come from TextLayer → setLayerDimensions (needs --total-scale-factor above).

    pageWrap.appendChild(canvas);
    pageWrap.appendChild(textLayerDiv);

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    if (token !== renderToken) return { ok: false, error: 'stale' };

    const textContentSource = page.streamTextContent({
      includeMarkedContent: true,
    });
    const textLayer = new TextLayer({
      textContentSource,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
    builtPages.push(pageWrap);
  }

  if (token !== renderToken) return { ok: false, error: 'stale' };
  detachAllPdfTextLayerSelections();
  root.replaceChildren(...builtPages);
  for (const pageWrap of builtPages) {
    const layer = pageWrap.querySelector('.textLayer');
    if (layer instanceof HTMLElement) attachPdfTextLayerSelection(layer);
  }
  restorePreviewScrollAnchor(scrollAnchor);

  return { ok: true, pageCount: doc.numPages };
}

/**
 * Find in the pdf.js text layer. Highlights matches; scrolls active into view.
 * @param {string} query
 * @param {{ matchCase?: boolean, reverse?: boolean, matchIndex?: number }} [opts]
 * @returns {{ ok: boolean, matchCount: number, activeIndex: number }}
 */
export function findInPdfJsTextLayer(query, opts = {}) {
  const root = getPagesRoot();
  const q = query?.trim() ?? '';
  clearPdfJsFindHighlights();
  if (!root || !q) return { ok: false, matchCount: 0, activeIndex: -1 };

  const matchCase = Boolean(opts.matchCase);
  const needle = matchCase ? q : q.toLowerCase();

  const spans = [...root.querySelectorAll('.textLayer span')];

  let flat = '';
  /** @type {{ span: HTMLElement, start: number, pageEl: HTMLElement }[]} */
  const map = [];
  for (const span of spans) {
    const pageEl = /** @type {HTMLElement} */ (span.closest('.m2pdf-pdfjs-page'));
    if (!pageEl) continue;
    const t = span.textContent ?? '';
    map.push({ span: /** @type {HTMLElement} */ (span), start: flat.length, pageEl });
    flat += t;
  }
  const hay = matchCase ? flat : flat.toLowerCase();

  const matchStarts = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    matchStarts.push(idx);
    from = idx + (needle.length || 1);
  }

  if (!matchStarts.length) return { ok: false, matchCount: 0, activeIndex: -1 };

  let pick = typeof opts.matchIndex === 'number' ? opts.matchIndex : 0;
  if (opts.reverse) pick = pick < 0 ? matchStarts.length - 1 : pick;
  while (pick < 0) pick += matchStarts.length;
  pick %= matchStarts.length;

  const activeStart = matchStarts[pick];
  const activeEnd = activeStart + needle.length;

  for (const entry of map) {
    const spanEnd = entry.start + (entry.span.textContent?.length ?? 0);
    if (spanEnd <= activeStart || entry.start >= activeEnd) continue;
    const inAny = matchStarts.some((s) => entry.start < s + needle.length && spanEnd > s);
    if (inAny) entry.span.classList.add('m2pdf-pdfjs-find-hit');
    if (entry.start < activeEnd && spanEnd > activeStart) {
      entry.span.classList.add('m2pdf-pdfjs-find-active');
      entry.span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  return { ok: true, matchCount: matchStarts.length, activeIndex: pick };
}

export function clearPdfJsFindHighlights() {
  document.querySelectorAll('.m2pdf-pdfjs-find-hit, .m2pdf-pdfjs-find-active').forEach((el) => {
    el.classList.remove('m2pdf-pdfjs-find-hit', 'm2pdf-pdfjs-find-active');
  });
}

export function countPdfJsMatches(query, matchCase) {
  const root = getPagesRoot();
  const q = query?.trim() ?? '';
  if (!root || !q) return 0;
  const spans = [...root.querySelectorAll('.textLayer span')];
  let flat = '';
  for (const span of spans) flat += span.textContent ?? '';
  const hay = matchCase ? flat : flat.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();
  let n = 0;
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    n += 1;
    from = idx + (needle.length || 1);
  }
  return n;
}

/** Root for Find when Prefer B is active. */
export function getPdfJsFindRoot() {
  return getPagesRoot();
}
