/**
 * Prefer B — live View = Chromium printToPDF (same engine as Export),
 * rendered with pdf.js canvas + text layer (Find / selection).
 */
import {
  clearPdfJsPreview,
  renderPdfJsFromBase64,
  findInPdfJsTextLayer,
  clearPdfJsFindHighlights,
  countPdfJsMatches,
  getPdfJsFindRoot,
} from './pdfJsPreview.js';

export {
  findInPdfJsTextLayer,
  clearPdfJsFindHighlights,
  countPdfJsMatches,
  getPdfJsFindRoot,
};

/** @type {number} */
let generation = 0;
/** @type {ReturnType<typeof setTimeout> | 0} */
let debounceTimer = 0;

/** Wait for footer measure + @page CSS before printToPDF. */
const PREVIEW_DEBOUNCE_MS = 650;

/**
 * @returns {HTMLElement | null}
 */
function ensureHost() {
  const main = document.getElementById('main-preview');
  if (!main) return null;
  let host = document.getElementById('chromium-pdf-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'chromium-pdf-host';
    host.className = 'm2pdf-chromium-pdf-host';
    host.setAttribute('aria-label', 'Print preview (PDF)');
    host.innerHTML = `
      <div id="chromium-pdf-status" class="m2pdf-chromium-pdf-status" aria-live="polite"></div>
      <div id="pdfjs-pages" class="m2pdf-pdfjs-pages"></div>
    `;
    main.insertBefore(host, main.firstChild);
  } else if (!document.getElementById('pdfjs-pages')) {
    const pages = document.createElement('div');
    pages.id = 'pdfjs-pages';
    pages.className = 'm2pdf-pdfjs-pages';
    host.appendChild(pages);
  }
  // Remove legacy iframe if present from older builds
  document.getElementById('chromium-pdf-frame')?.remove();
  return host;
}

/**
 * @param {string} message
 * @param {'idle' | 'busy' | 'error' | 'ready' | 'find'} kind
 */
export function setChromiumPdfStatus(message, kind) {
  const status = document.getElementById('chromium-pdf-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
  status.classList.toggle('hidden', !message);
}

/**
 * @param {string} message
 * @param {'idle' | 'busy' | 'error' | 'ready'} kind
 */
function setStatus(message, kind) {
  setChromiumPdfStatus(message, kind);
}

/**
 * @param {{
 *   paper: 'letter' | 'a4' | 'legal',
 *   footerRepeat: 'last' | 'every',
 *   hasContent: boolean,
 *   paused?: boolean,
 *   pauseMessage?: string,
 * }} opts
 */
export async function runChromiumPdfPreview(opts) {
  ensureHost();
  document.body.classList.add('m2pdf-chromium-preview');

  if (!opts.hasContent) {
    generation += 1;
    clearPdfJsPreview();
    setStatus('Open or paste Markdown to see the print preview.', 'idle');
    return;
  }

  if (opts.paused) {
    generation += 1;
    setStatus(opts.pauseMessage ?? 'Preview paused for very large input.', 'error');
    return;
  }

  const api = window.desktopAPI;
  if (!api?.previewPdf) {
    setStatus('Live PDF preview requires the desktop app.', 'error');
    return;
  }

  const token = ++generation;
  setStatus('Updating print preview…', 'busy');

  try {
    if (typeof window.__m2pdfPreparePrintPdf === 'function') {
      await window.__m2pdfPreparePrintPdf();
    }
    if (token !== generation) return;
    const printPayload =
      typeof window.__m2pdfBuildPrintPdfPayload === 'function'
        ? await window.__m2pdfBuildPrintPdfPayload()
        : { paper: opts.paper, footerRepeat: opts.footerRepeat };
    if (token !== generation) return;
    const result = await api.previewPdf(printPayload);
    if (token !== generation) return;
    if (!result?.ok || typeof result.pdfBase64 !== 'string') {
      setStatus(result?.error ?? 'Could not build print preview.', 'error');
      return;
    }
    const host = document.getElementById('chromium-pdf-host');
    const rendered = await renderPdfJsFromBase64(result.pdfBase64, {
      fitWidth: host?.clientWidth ?? 720,
    });
    if (token !== generation) return;
    if (!rendered.ok) {
      setStatus(rendered.error === 'stale' ? '' : rendered.error || 'Render failed.', 'error');
      return;
    }
    setStatus('', 'ready');
  } catch (err) {
    if (token !== generation) return;
    setStatus(err instanceof Error ? err.message : 'Preview failed.', 'error');
  }
}

/**
 * Debounced schedule — cancels prior timer; in-flight PDF ignored via generation token.
 * @param {() => Parameters<typeof runChromiumPdfPreview>[0]} getOpts
 */
export function scheduleChromiumPdfPreview(getOpts) {
  ensureHost();
  document.body.classList.add('m2pdf-chromium-preview');
  window.clearTimeout(debounceTimer);
  setStatus('Updating print preview…', 'busy');
  debounceTimer = window.setTimeout(() => {
    debounceTimer = 0;
    void runChromiumPdfPreview(getOpts());
  }, PREVIEW_DEBOUNCE_MS);
}

/**
 * Cancel debounced preview and run one printToPDF+pdf.js pass immediately
 * (Export / audit prep so branding changes are not raced).
 * @param {() => Parameters<typeof runChromiumPdfPreview>[0]} getOpts
 */
export async function flushChromiumPdfPreview(getOpts) {
  ensureHost();
  document.body.classList.add('m2pdf-chromium-preview');
  window.clearTimeout(debounceTimer);
  debounceTimer = 0;
  await runChromiumPdfPreview(getOpts());
}

export function disposeChromiumPdfPreview() {
  window.clearTimeout(debounceTimer);
  debounceTimer = 0;
  generation += 1;
  clearPdfJsPreview();
  document.body.classList.remove('m2pdf-chromium-preview');
  document.getElementById('chromium-pdf-host')?.remove();
}
