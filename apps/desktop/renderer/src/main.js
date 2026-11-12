import './main.css';
import DOMPurify from 'dompurify';
import { createMarkdownRenderer, preprocessMarkdown } from '@m2pdf/core';
import {
  applyHeadingLevel,
  indentLines,
  insertBlockquote,
  insertBold,
  insertBulletList,
  insertHorizontalRule,
  insertInlineCode,
  insertItalic,
  insertLink,
  insertNumberedList,
  insertTable,
  outdentLines,
} from '@m2pdf/core';
import {
  getContentWidthPx,
  getHeaderPlacementFlags,
  getInnerBandHeightPx,
  getSlotHeightForPage,
  MM_TO_PX,
  PAGE_MARGIN_MM,
  PAGE_MARGIN_MM_EVERY_PAGE,
  PAPERS,
} from '@m2pdf/core';
import { clearPreviewFindHighlights } from './findPreview.js';
import { clearEditorFindHighlights } from './findEditorOverlay.js';
import {
  MAX_LOGO_DATA_URL_CHARS,
  addRecentLogoUrl,
  clearLogoSlot,
  loadBranding,
  loadDesktopSession,
  loadFooterRepeat,
  loadFooterPageNum,
  saveFooterPageNum,
  loadFooterTextAlign,
  saveFooterTextAlign,
  loadLogoBundle,
  loadLogoLayout,
  loadMarkdownDraft,
  loadPageGuideSettings,
  loadPrintTitle,
  loadRecentFiles,
  loadRecentLogoUrls,
  loadSidebarWidthPx,
  saveDesktopSession,
  saveDisclaimer,
  saveFooterRepeat,
  saveLogoLayout,
  saveLogoSlot,
  savePageGuideSettings,
  savePrintTitle,
  saveSidebarWidthPx,
  touchRecentFile,
} from './storage.js';
import {
  createDocument,
  createEmptySession,
  ensureSession,
  findDocumentByPath,
  getActiveDocument,
  normalizeSession,
} from './session.js';
import { initFindReplaceUi } from './findReplace.js';
// printPreviewLayout / paginated stack: quarantined — only used if PREVIEW_ENGINE !== chromium-pdf.
import { getSheetSizePx, layoutPrintPreviewSheets, SHEET_GAP_PX } from './printPreviewLayout.js';
import { computePreviewFromSource, confirmPaperSelection } from './previewEngine.js';
import {
  bumpChromiumPdfGeneration,
  cancelChromiumPdfPreviewSchedule,
  disposeChromiumPdfPreview,
  flushChromiumPdfPreview,
  scheduleChromiumPdfPreview,
  setChromiumPdfStatus,
  showCachedChromiumPdfPreview,
} from './chromiumPdfPreview.js';
import { escapeFooterHtml, escapeHtmlAttr } from './footerHtml.js';

/**
 * Preview engine (Prefer B only in shipping builds).
 * - `chromium-pdf` — default: printToPDF → pdf.js (View ≡ Export).
 * - `document` / `paginated` — quarantined rollback paths; do not ship as default
 *   (`paginated` has known fold bugs). Flip only for local experiments.
 * @type {'document' | 'chromium-pdf' | 'paginated'}
 */
const PREVIEW_ENGINE = 'chromium-pdf';
const USE_CHROMIUM_PDF_PREVIEW = PREVIEW_ENGINE === 'chromium-pdf';

const md = createMarkdownRenderer();

const DEFAULT_SIDEBAR_PX = 352;
const MIN_SIDEBAR_PX = 260;
const HANDLE_PX = 12;
/** Minimum width left for the preview column (large screens). */
const MIN_MAIN_PX = 280;
/** Large docs can freeze the preview; pause render above this size. */
const MAX_MD_INPUT_CHARS = 600_000;
/** Block file-open above 2MB to avoid browser lockups. */
const MAX_MD_OPEN_BYTES = 2 * 1024 * 1024;
const RENDER_DEBOUNCE_MS = 140;

const el = {
  btnOpenMd: document.getElementById('btn-open-md'),
  textareaMd: document.getElementById('textarea-md'),
  mdInputWarning: document.getElementById('md-input-warning'),
  btnClear: document.getElementById('btn-clear'),
  btnSaveMd: document.getElementById('btn-save-md'),
  btnSaveAsMd: document.getElementById('btn-save-as-md'),
  inputLogoUrl: document.getElementById('input-logo-url'),
  fileLogo: document.getElementById('file-logo'),
  btnRemoveLogo: document.getElementById('btn-remove-logo'),
  selectLogoHeaderPlacement: document.getElementById('select-logo-header-placement'),
  selectLogoFooterPlacement: document.getElementById('select-logo-footer-placement'),
  inputLogoHeaderScale: document.getElementById('input-logo-header-scale'),
  inputLogoFooterScale: document.getElementById('input-logo-footer-scale'),
  inputPrintTitle: document.getElementById('input-print-title'),
  selectPrintTitleLevel: document.getElementById('select-print-title-level'),
  selectPrintTitleAlign: document.getElementById('select-print-title-align'),
  textareaDisclaimer: document.getElementById('textarea-disclaimer'),
  selectFooterRepeat: document.getElementById('select-footer-repeat'),
  selectFooterPageNum: document.getElementById('select-footer-pagenum'),
  selectFooterTextAlign: document.getElementById('select-footer-text-align'),
  mainPreview: document.getElementById('main-preview'),
  printFlow: document.getElementById('print-flow'),
  footerLastPageSpacer: document.getElementById('footer-last-page-spacer'),
  footerLastPageWrap: document.getElementById('footer-last-page-wrap'),
  footerLogoRow: document.getElementById('footer-logo-row'),
  footerTextRow: document.getElementById('footer-text-row'),
  footerPageNumber: document.getElementById('footer-page-number'),
  btnExportPdf: document.getElementById('btn-export-pdf'),
  printRoot: document.getElementById('print-root'),
  pageGuideOverlay: document.getElementById('page-guide-overlay'),
  pageGuideEnabled: document.getElementById('page-guide-enabled'),
  pageGuidePaper: document.getElementById('page-guide-paper'),
  mdPreview: document.getElementById('md-preview'),
  brandHeader: document.getElementById('brand-header'),
  brandHeaderInner: document.getElementById('brand-header-inner'),
  headerLogoColumn: document.getElementById('header-logo-column'),
  brandLogoHeaderImg: document.getElementById('brand-logo-header-img'),
  brandHeaderTitle: document.getElementById('brand-header-title'),
  printFooterBlock: document.getElementById('print-footer-block'),
  printFooterLayout: document.getElementById('print-footer-layout'),
  footerLogoColumn: document.getElementById('footer-logo-column'),
  brandFooterLogoInner: document.getElementById('brand-footer-logo-inner'),
  brandLogoFooterImg: document.getElementById('brand-logo-footer-img'),
  disclaimerFooter: document.getElementById('disclaimer-footer'),
  docTabs: document.getElementById('doc-tabs'),
};

/** @type {import('./session.js').AppSession} */
let session = createEmptySession();

function getActiveDoc() {
  return getActiveDocument(session);
}

function getMdSourceText() {
  return el.textareaMd?.value ?? '';
}

/**
 * Flush textarea into the active document (call before switching / persisting).
 */
function flushActiveEditorToSession() {
  const doc = getActiveDoc();
  if (!doc || !el.textareaMd) return;
  const text = el.textareaMd.value;
  if (doc.text !== text) {
    doc.text = text;
    doc.dirty = true;
  }
}

function persistSession() {
  flushActiveEditorToSession();
  saveDesktopSession({
    activeId: session.activeId,
    docs: session.docs.map((d) => ({
      id: d.id,
      text: d.text,
      path: d.path,
      name: d.name,
      dirty: d.dirty,
    })),
  });
  syncRecentMenu();
}

function syncRecentMenu() {
  const api = window.desktopAPI;
  if (typeof api?.setRecentFiles === 'function') {
    api.setRecentFiles(loadRecentFiles());
  }
}

function syncMdSaveButton() {
  // Always enabled — Save As runs when the tab has no path yet.
  if (el.btnSaveMd) el.btnSaveMd.disabled = false;
}

/** Skip preview layout during batched startup (footer/logo/page guide). */
let previewLayoutBatchDepth = 0;

/** @param {import('./session.js').DocumentTab} doc */
function isDocPreviewCacheFresh(doc) {
  return Boolean(doc.previewPdfBase64 && doc.previewForText === doc.text);
}

/** Keep at most this many inactive tab PDF previews in RAM. */
const MAX_TAB_PREVIEW_CACHES = 5;

function trimPreviewPdfCaches() {
  let count = session.docs.filter((d) => d.previewPdfBase64).length;
  if (count <= MAX_TAB_PREVIEW_CACHES) return;
  for (const d of session.docs) {
    if (d.id === session.activeId) continue;
    if (d.previewPdfBase64) {
      delete d.previewPdfBase64;
      delete d.previewForText;
      count -= 1;
    }
    if (count <= MAX_TAB_PREVIEW_CACHES) return;
  }
}

/** @param {import('./session.js').DocumentTab} doc @param {string} pdfBase64 */
function rememberDocPreview(doc, pdfBase64) {
  doc.previewPdfBase64 = pdfBase64;
  doc.previewForText = doc.text;
  trimPreviewPdfCaches();
}

function cancelTransientPreviewWork() {
  renderMarkdownDebounced.cancel?.();
  syncChromiumPrintDomDebounced.cancel?.();
  cancelChromiumPdfPreviewSchedule();
}

/**
 * Load active document into the editor + preview and refresh tabs.
 * @param {{ skipPreview?: boolean, tabSwitch?: boolean }} [opts]
 */
function syncEditorFromActiveDoc(opts = {}) {
  const doc = getActiveDoc();
  if (!doc || !el.textareaMd) return;
  el.textareaMd.value = doc.text;
  syncMdSaveButton();
  renderTabs();
  findReplaceApi?.refreshOpenFind?.();
  if (opts.skipPreview) return;
  cancelTransientPreviewWork();
  if (opts.tabSwitch) {
    bumpChromiumPdfGeneration();
    requestAnimationFrame(() => {
      void applyPreviewForTabSwitch(doc);
    });
    return;
  }
  renderMarkdown();
}

function rememberActiveDocPreviewFromResult(out) {
  const doc = getActiveDoc();
  if (doc && out?.ok && out.pdfBase64) rememberDocPreview(doc, out.pdfBase64);
}

/** @param {import('./session.js').DocumentTab} doc */
async function applyPreviewForTabSwitch(doc) {
  if (USE_CHROMIUM_PDF_PREVIEW && window.desktopAPI?.previewPdf && isDocPreviewCacheFresh(doc)) {
    await showCachedChromiumPdfPreview(doc.previewPdfBase64);
  }
  updateMarkdownPreviewDom();
  if (!USE_CHROMIUM_PDF_PREVIEW || !window.desktopAPI?.previewPdf) {
    refreshPrintPreviewLayout();
    return;
  }
  syncChromiumPrintDomForPreview();
  if (isDocPreviewCacheFresh(doc)) return;
  const out = await flushChromiumPdfPreview(() => getChromiumPreviewOpts());
  if (out?.ok && out.pdfBase64) rememberDocPreview(doc, out.pdfBase64);
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * @param {string} message
 */
function setMdInputWarning(message) {
  const n = el.mdInputWarning;
  if (!n) return;
  n.textContent = message || '';
  n.classList.toggle('hidden', !message);
}

function normalizeMdSuggestedName(name) {
  let base = name?.trim() || 'document';
  const lower = base.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return base;
  if (lower.endsWith('.txt')) return `${base.slice(0, -4)}.md`;
  const lastDot = base.lastIndexOf('.');
  if (lastDot > 0) return `${base.slice(0, lastDot)}.md`;
  return `${base}.md`;
}

function renderTabs() {
  const host = el.docTabs;
  if (!host) return;
  host.replaceChildren();
  for (const doc of session.docs) {
    const isActive = doc.id === session.activeId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.dataset.docId = doc.id;
    btn.title = doc.path || doc.name;
    btn.className = [
      'group flex max-w-[12rem] shrink-0 items-center gap-1 rounded-t border px-2 py-1 text-left text-xs',
      isActive
        ? 'border-slate-300 border-b-white bg-white font-medium text-slate-900'
        : 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
    ].join(' ');

    const label = document.createElement('span');
    label.className = 'truncate';
    label.textContent = `${doc.dirty ? '• ' : ''}${doc.name}`;
    btn.appendChild(label);

    const close = document.createElement('span');
    close.className =
      'ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700';
    close.setAttribute('aria-label', `Close ${doc.name}`);
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDocument(doc.id);
    });
    btn.appendChild(close);

    btn.addEventListener('click', () => {
      activateDocument(doc.id);
    });
    host.appendChild(btn);
  }

  const addTab = document.createElement('button');
  addTab.type = 'button';
  addTab.title = 'New document (File → New)';
  addTab.setAttribute('aria-label', 'New document');
  addTab.className =
    'ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-base leading-none text-slate-600 hover:border-slate-400 hover:bg-slate-50';
  addTab.textContent = '+';
  addTab.addEventListener('click', () => newDocument());
  host.appendChild(addTab);
}

/** Update active tab dirty dot / label without rebuilding the tab strip (typing path). */
function syncActiveTabDirtyLabel() {
  const host = el.docTabs;
  const doc = getActiveDoc();
  if (!host || !doc) return;
  const btn = host.querySelector(`button[data-doc-id="${CSS.escape(doc.id)}"]`);
  if (!btn) {
    renderTabs();
    return;
  }
  const label = btn.querySelector(':scope > span.truncate');
  if (label) label.textContent = `${doc.dirty ? '• ' : ''}${doc.name}`;
}

/**
 * @param {string} id
 */
function activateDocument(id) {
  if (id === session.activeId) return;
  if (!session.docs.some((d) => d.id === id)) return;
  flushActiveEditorToSession();
  session.activeId = id;
  syncEditorFromActiveDoc({ tabSwitch: true });
  persistSessionDebounced();
}

function newDocument() {
  flushActiveEditorToSession();
  const doc = createDocument({ name: 'Untitled.md', dirty: false });
  session.docs.push(doc);
  session.activeId = doc.id;
  syncEditorFromActiveDoc({ tabSwitch: true });
  persistSession();
}

/**
 * @param {string} id
 */
async function closeDocument(id) {
  const doc = session.docs.find((d) => d.id === id);
  if (!doc) return;

  if (id === session.activeId) flushActiveEditorToSession();

  if (doc.dirty) {
    const api = window.desktopAPI;
    const choice =
      typeof api?.confirmDiscard === 'function'
        ? await api.confirmDiscard(doc.name)
        : window.confirm(`"${doc.name}" has unsaved changes. Close anyway?`)
          ? 'discard'
          : 'cancel';
    if (choice === 'cancel') return;
    if (choice === 'save') {
      session.activeId = id;
      syncEditorFromActiveDoc({ tabSwitch: true });
      const saved = await saveMdOverwriteOrAs();
      if (!saved) return;
    }
  }

  session.docs = session.docs.filter((d) => d.id !== id);
  if (!session.docs.length) {
    session = createEmptySession();
  } else if (!session.docs.some((d) => d.id === session.activeId)) {
    session.activeId = session.docs[session.docs.length - 1].id;
  }
  session = ensureSession(session);
  syncEditorFromActiveDoc({ tabSwitch: true });
  persistSession();
}

/**
 * Open or focus a document from disk / OS.
 * @param {{ text?: string, path?: string | null, name?: string, error?: string }} result
 */
function openOrFocusDocument(result) {
  if (result?.error) {
    window.alert(result.error);
    return;
  }
  if (typeof result?.text !== 'string') return;

  flushActiveEditorToSession();

  const path = result.path || null;
  if (path) {
    const existing = findDocumentByPath(session, path);
    if (existing) {
      existing.text = result.text;
      existing.name = result.name || existing.name;
      existing.dirty = false;
      session.activeId = existing.id;
      touchRecentFile(path);
      syncEditorFromActiveDoc({ tabSwitch: true });
      persistSession();
      return;
    }
  }

  const sole = session.docs.length === 1 ? session.docs[0] : null;
  const reusable =
    sole &&
    !sole.path &&
    !sole.dirty &&
    !sole.text.trim() &&
    sole.name === 'Untitled.md';

  if (reusable) {
    sole.text = result.text;
    sole.path = path;
    sole.name = result.name || 'Untitled.md';
    sole.dirty = false;
    session.activeId = sole.id;
  } else {
    const doc = createDocument({
      text: result.text,
      path,
      name: result.name || 'Untitled.md',
      dirty: false,
    });
    session.docs.push(doc);
    session.activeId = doc.id;
  }
  if (path) touchRecentFile(path);
  syncEditorFromActiveDoc({ tabSwitch: true });
  persistSession();
}

async function saveMdAs() {
  const doc = getActiveDoc();
  if (!doc) return;
  flushActiveEditorToSession();
  const text = doc.text;
  const suggested = normalizeMdSuggestedName(doc.name || 'document.md');
  const api = window.desktopAPI;
  if (!api?.saveMarkdown) return false;
  const result = await api.saveMarkdown({ text, suggestedName: suggested });
  if (result?.canceled) return false;
  if (result?.error) {
    window.alert(result.error);
    return false;
  }
  if (result?.path) {
    doc.path = result.path;
    doc.name = result.name || doc.name;
    doc.dirty = false;
    touchRecentFile(result.path);
    syncMdSaveButton();
    renderTabs();
    persistSession();
    return true;
  }
  return false;
}

async function saveMdOverwrite() {
  const doc = getActiveDoc();
  if (!doc?.path) return false;
  flushActiveEditorToSession();
  const api = window.desktopAPI;
  if (!api?.saveMarkdown) return false;
  const result = await api.saveMarkdown({ text: doc.text, path: doc.path });
  if (result?.error) {
    window.alert(result.error);
    doc.path = null;
    syncMdSaveButton();
    renderTabs();
    return false;
  }
  doc.dirty = false;
  touchRecentFile(doc.path);
  renderTabs();
  persistSession();
  return true;
}

/** @returns {Promise<boolean>} */
async function saveMdOverwriteOrAs() {
  const doc = getActiveDoc();
  if (!doc) return false;
  if (doc.path) return saveMdOverwrite();
  return saveMdAs();
}

async function openMdViaFilePicker() {
  const api = window.desktopAPI;
  if (!api?.openMarkdown) return;
  const result = await api.openMarkdown();
  if (result?.canceled) return;
  if (result?.error) {
    window.alert(result.error);
    return;
  }
  if (typeof result?.text === 'string') {
    openOrFocusDocument(result);
  }
}

async function openRecentPath(filePath) {
  const api = window.desktopAPI;
  if (!api?.openPath || !filePath) return;
  const result = await api.openPath(filePath);
  if (result?.canceled) return;
  if (result?.error) {
    window.alert(result.error);
    return;
  }
  if (typeof result?.text === 'string') {
    openOrFocusDocument(result);
  }
}

/**
 * Wire double-click / Open With launches from Windows into tabs.
 */
async function initDesktopOpenFromOs() {
  const api = window.desktopAPI;
  if (!api?.isDesktop) return;

  api.onOpenFromOs?.((payload) => {
    openOrFocusDocument(payload ?? {});
  });

  if (typeof api.takeLaunchOpen === 'function') {
    try {
      const pending = await api.takeLaunchOpen();
      if (pending) openOrFocusDocument(pending);
    } catch {
      /* ignore */
    }
  }
}

/** @type {ReturnType<typeof initFindReplaceUi> | null} */
let findReplaceApi = null;

function initDesktopMenu() {
  const api = window.desktopAPI;
  if (!api?.onMenuAction) return;
  api.onMenuAction((action, payload) => {
    if (action === 'new') newDocument();
    else if (action === 'open') openMdViaFilePicker();
    else if (action === 'close') closeDocument(session.activeId);
    else if (action === 'save') saveMdOverwriteOrAs();
    else if (action === 'save-as') saveMdAs();
    else if (action === 'export-pdf') exportPdf();
    else if (action === 'open-recent' && payload?.path) openRecentPath(payload.path);
    else if (action === 'find') findReplaceApi?.openFind();
    else if (action === 'find-next') findReplaceApi?.findNext();
    else if (action === 'find-previous') findReplaceApi?.findPrevious();
    else if (action === 'replace') findReplaceApi?.openReplace();
    else if (action === 'about') openAboutDialog();
  });
  syncRecentMenu();
}

function openAboutDialog() {
  const dlg = /** @type {HTMLDialogElement | null} */ (document.getElementById('dlg-about'));
  const verEl = document.getElementById('about-version');
  if (!dlg) return;
  const api = window.desktopAPI;
  if (api?.getAppInfo) {
    api.getAppInfo().then((info) => {
      if (verEl && info?.version) verEl.textContent = info.version;
      dlg.showModal();
    });
  } else {
    if (verEl) verEl.textContent = '—';
    dlg.showModal();
  }
}

function initAboutDialog() {
  const dlg = /** @type {HTMLDialogElement | null} */ (document.getElementById('dlg-about'));
  document.getElementById('about-ok')?.addEventListener('click', () => dlg?.close());
}

/** @type {number} last every-page footer strip bottom (mm) — keep @page in sync with printToPdfOptions */
let lastEveryPageBottomMm = 24;

/**
 * Prefer B off-screen #print-root must match paper width (CSS var; was locked to Letter 8.5in).
 * @param {'letter' | 'a4' | 'legal'} paper
 */
function applyPrintPaperWidthCss(paper) {
  const p = PAPERS[paper] ?? PAPERS.letter;
  const width = `${p.widthMm}mm`;
  document.documentElement.style.setProperty('--m2pdf-print-paper-width', width);
  if (el.printRoot) {
    el.printRoot.style.setProperty('--m2pdf-print-paper-width', width);
  }
}

/** Text line budget inside Chromium footerTemplate (page #). Disclaimer may use 2×. */
const FOOTER_TEMPLATE_TEXT_LINE_MM = 3.5;
const FOOTER_TEMPLATE_DISC_MAX_MM = 7;
/** Soft logo height cap in template (~Tailwind max-h-48 is for DOM; strip uses mm). */
const FOOTER_TEMPLATE_LOGO_MAX_H_MM = 28;
/** Match @page / printToPdfOptions side inset so logo & page # are not edge-flush. */
const FOOTER_TEMPLATE_SIDE_PAD_MM = 14;

/**
 * Ensure a data: URL for footerTemplate (Chromium rejects many http(s) URLs there).
 * Prefer the original bitmap — never downscale for display sharpness.
 * @param {HTMLImageElement} img
 * @returns {Promise<string>}
 */
async function footerLogoDataUrlForTemplate(img) {
  const src = img?.src ?? '';
  if (src.startsWith('data:')) return src;
  if (!src || !(img.naturalWidth > 0)) return '';
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Prefer B every-page footer. Logo sizing mirrors Header: column max-width %,
 * img width:auto / max-width:100% / height:auto — original data URL, no tiny canvas.
 * @returns {Promise<{ html: string, bottomMm: number }>}
 */
async function buildEveryPageFooterTemplate() {
  const layout = readLogoLayoutFromForm();
  const logoAlign = layout.footerPlacement;
  const pageAlign = readFooterPageNumFromForm();
  const discAlign = readFooterTextAlignFromForm();
  const discRaw = el.textareaDisclaimer?.value.trim() ?? '';
  const disc = escapeFooterHtml(discRaw);

  const fs = Math.min(100, Math.max(1, layout.footerScale));
  // Same soft cap as DOM when logo + disclaimer share a side.
  const effectiveFs =
    discRaw &&
    (logoAlign === 'left' || logoAlign === 'right') &&
    discAlign === logoAlign
      ? Math.min(fs, 52)
      : fs;

  const img = el.brandLogoFooterImg;
  const showLogo = Boolean(img?.src) && logoAlign !== 'none';
  if (showLogo && img && typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      /* continue */
    }
  }

  let logoHtml = '';
  let logoHMm = 0;
  if (showLogo && img) {
    try {
      const dataUrl = await footerLogoDataUrlForTemplate(img);
      if (dataUrl.startsWith('data:')) {
        const paperRaw = el.pageGuidePaper?.value;
        const paper = paperRaw === 'a4' || paperRaw === 'legal' ? paperRaw : 'letter';
        const contentW = getContentWidthPx(paper);
        const maxW = Math.max(24, contentW * (effectiveFs / 100));
        const natW = Math.max(1, img.naturalWidth || maxW);
        const natH = Math.max(1, img.naturalHeight || 48);
        const hFromWidth = (maxW * natH) / natW;
        const maxHPx = (FOOTER_TEMPLATE_LOGO_MAX_H_MM * 96) / 25.4;
        logoHMm = Math.min(FOOTER_TEMPLATE_LOGO_MAX_H_MM, (Math.min(hFromWidth, maxHPx) * 25.4) / 96);
        // Header contract in template CSS: wrapper = column %, img fills column.
        const safeSrc = escapeHtmlAttr(dataUrl);
        logoHtml = `<div style="max-width:${effectiveFs}%;width:auto;box-sizing:border-box;">
<img src="${safeSrc}" alt="" style="width:auto;max-width:100%;height:auto;max-height:${FOOTER_TEMPLATE_LOGO_MAX_H_MM}mm;object-fit:contain;display:block;border:0;" />
</div>`;
      }
    } catch {
      logoHtml = '';
      logoHMm = 0;
    }
  }

  const pageHtml =
    pageAlign === 'off'
      ? ''
      : `<span style="white-space:nowrap;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`;

  // Allow wrap (up to 2 lines) so long legal copy is not silently truncated in PDF.
  const discHtml = discRaw
    ? `<span style="max-width:100%;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.25;white-space:normal;word-break:break-word;">${disc}</span>`
    : '';

  // Chromium footerTemplate often ignores CSS padding on the root. Use a table with
  // fixed-width side spacer cells (inches = same unit as printToPdfOptions margins).
  const sideIn = `${(FOOTER_TEMPLATE_SIDE_PAD_MM / 25.4).toFixed(4)}in`;

  /**
   * @param {'left' | 'center' | 'right'} align
   */
  function column(align) {
    const items = [];
    if (logoHtml && logoAlign === align) items.push(logoHtml);
    if (discHtml && discAlign === align) items.push(discHtml);
    if (pageHtml && pageAlign === align) items.push(pageHtml);

    const justify =
      align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
    const ta = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
    return `<td style="vertical-align:bottom;text-align:${ta};width:33%;padding:0;margin:0;">
<div style="display:flex;flex-direction:column;justify-content:flex-end;align-items:${justify};gap:2px;text-align:${ta};overflow:visible;">${items.join('')}</div>
</td>`;
  }

  /** @param {'left' | 'center' | 'right'} align */
  function stackHeightMm(align) {
    let h = 0;
    let n = 0;
    if (logoHtml && logoAlign === align) {
      h += logoHMm;
      n += 1;
    }
    if (discHtml && discAlign === align) {
      h += FOOTER_TEMPLATE_DISC_MAX_MM;
      n += 1;
    }
    if (pageHtml && pageAlign === align) {
      h += FOOTER_TEMPLATE_TEXT_LINE_MM;
      n += 1;
    }
    if (n > 1) h += 0.5 * (n - 1);
    return h;
  }

  const contentMm = Math.max(
    stackHeightMm('left'),
    stackHeightMm('center'),
    stackHeightMm('right'),
    FOOTER_TEMPLATE_TEXT_LINE_MM,
  );
  const stripMm = Math.max(14, Math.ceil(contentMm + 3));
  const bottomMm = Math.min(40, Math.max(18, stripMm + 4));

  const spacer = `<td style="width:${sideIn};min-width:${sideIn};max-width:${sideIn};padding:0;margin:0;border:none;"></td>`;
  const html = `<table style="width:100%;border-collapse:collapse;border-spacing:0;height:${stripMm}mm;font-size:9px;line-height:1.2;color:#334155;font-family:system-ui,Segoe UI,sans-serif;table-layout:fixed;">
<tr>
${spacer}${column('left')}${column('center')}${column('right')}${spacer}
</tr>
</table>`;

  return { html, bottomMm };
}

/**
 * Payload shared by Export + Prefer B preview + agent PDF audit.
 * @returns {Promise<{ paper: string, footerRepeat: 'last' | 'every', footerTemplate?: string, footerBottomMm?: number }>}
 */
async function buildPrintPdfPayload() {
  const paperRaw = el.pageGuidePaper?.value;
  const paper = paperRaw === 'a4' || paperRaw === 'legal' ? paperRaw : 'letter';
  const footerRepeat = readFooterRepeatFromForm();
  /** @type {{ paper: string, footerRepeat: 'last' | 'every', footerTemplate?: string, footerBottomMm?: number }} */
  const payload = { paper, footerRepeat };
  if (footerRepeat === 'every') {
    const built = await buildEveryPageFooterTemplate();
    payload.footerTemplate = built.html;
    payload.footerBottomMm = built.bottomMm;
    lastEveryPageBottomMm = built.bottomMm;
  }
  return payload;
}

/** Cancel debounced preview work and await assets + footerTemplate before Export. */
async function flushPreviewPipelineForExport() {
  await waitForPrintAssets();
  const paper = readPaperFromForm();
  applyPrintPaperWidthCss(paper);
  const every = readFooterRepeatFromForm() === 'every';
  syncPrintPageMargins(every ? 'every' : 'last');
  if (USE_CHROMIUM_PDF_PREVIEW && window.desktopAPI?.previewPdf) {
    const ctx = rebuildPreviewContext();
    const trimmed = (el.textareaMd?.value ?? '').trim();
    await flushChromiumPdfPreview(() => getChromiumPreviewOpts());
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

async function exportPdf() {
  const api = window.desktopAPI;
  if (!api?.exportPdf) return;
  flushActiveEditorToSession();
  const doc = getActiveDoc();
  await flushPreviewPipelineForExport();
  const printPayload = await buildPrintPdfPayload();
  if (printPayload.footerRepeat === 'every' && printPayload.footerBottomMm) {
    lastEveryPageBottomMm = printPayload.footerBottomMm;
    syncPrintPageMargins('every');
  }
  const result = await api.exportPdf({
    ...printPayload,
    suggestedName: doc?.name || 'document.md',
  });
  if (result?.canceled) return;
  if (result?.error) window.alert(result.error);
}

/** Last slot we flushed URL input for (keeps radio + storage in sync). */
let logoSlotLastFlushed = 'header';

function getActiveLogoSlot() {
  const h = document.getElementById('logo-slot-header');
  if (h && /** @type {HTMLInputElement} */ (h).checked) return 'header';
  return 'footer';
}

function getAppShell() {
  return document.getElementById('app-shell');
}

function getMaxSidebarPx() {
  const shell = getAppShell();
  if (!shell) return 832;
  const sw = shell.clientWidth;
  const cap832 = 52 * 16;
  const byMain = sw - HANDLE_PX - MIN_MAIN_PX;
  const byFrac = Math.floor(sw * 0.65);
  return Math.max(MIN_SIDEBAR_PX, Math.min(byMain, byFrac, cap832));
}

function clampSidebarWidth(px) {
  return Math.min(getMaxSidebarPx(), Math.max(MIN_SIDEBAR_PX, px));
}

/** @returns {number} applied width in px */
function applySidebarWidth(px) {
  const shell = getAppShell();
  if (!shell) return clampSidebarWidth(px);
  const w = clampSidebarWidth(px);
  shell.style.setProperty('--m2pdf-sidebar', `${w}px`);
  return w;
}

function initSidebarResize() {
  const shell = getAppShell();
  const handle = document.getElementById('sidebar-resize-handle');
  const aside = document.getElementById('sidebar');
  if (!shell || !handle || !aside) return;

  const saved = loadSidebarWidthPx();
  if (saved != null) {
    applySidebarWidth(saved);
  }

  let dragging = false;

  function setDragging(on) {
    dragging = on;
    document.body.classList.toggle('m2pdf-resizing', on);
    if (!on) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const rect = shell.getBoundingClientRect();
    const x = e.clientX - rect.left - HANDLE_PX / 2;
    applySidebarWidth(x);
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);
    const w = Math.round(aside.getBoundingClientRect().width);
    saveSidebarWidthPx(w);
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);

  handle.addEventListener('dblclick', () => {
    const w = applySidebarWidth(DEFAULT_SIDEBAR_PX);
    saveSidebarWidthPx(w);
  });

  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 32 : 12;
    const w0 = aside.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const w = applySidebarWidth(w0 - step);
      saveSidebarWidthPx(w);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const w = applySidebarWidth(w0 + step);
      saveSidebarWidthPx(w);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const w = applySidebarWidth(MIN_SIDEBAR_PX);
      saveSidebarWidthPx(w);
    } else if (e.key === 'End') {
      e.preventDefault();
      const w = applySidebarWidth(getMaxSidebarPx());
      saveSidebarWidthPx(w);
    }
  });

  let resizeT = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeT);
    resizeT = window.setTimeout(() => {
      const w0 = aside.getBoundingClientRect().width;
      const w = clampSidebarWidth(w0);
      if (w !== w0) {
        applySidebarWidth(w);
        saveSidebarWidthPx(w);
      }
    }, 100);
  });
}

function populateLogoRecentDatalist() {
  const dl = document.getElementById('logo-recent-datalist');
  if (!dl) return;
  dl.replaceChildren();
  for (const u of loadRecentLogoUrls()) {
    const opt = document.createElement('option');
    opt.value = u;
    dl.appendChild(opt);
  }
}

/** @param {{ mode: 'url', url: string } | { mode: 'data', dataUrl: string, name?: string } | null} state @param {'header'|'footer'} slot */
function updateLogoPersistHint(state, slot) {
  const hint = document.getElementById('logo-persist-hint');
  if (!hint) return;
  const which = slot === 'footer' ? 'Footer' : 'Header';
  if (!state) {
    hint.textContent = `${which}: no image yet. URL and upload are saved separately for header vs footer.`;
  } else if (state.mode === 'data') {
    hint.textContent = `${which}: saved upload in this browser (same rules as the disclaimer).`;
  } else {
    hint.textContent = `${which}: saved URL. Recent URLs appear in the field dropdown.`;
  }
}

/** Flush the URL field into storage for the slot that was active while typing. */
function flushInputToLogoSlot(slot) {
  const v = el.inputLogoUrl.value.trim();
  const b = loadLogoBundle();
  const cur = slot === 'header' ? b.header : b.footer;
  if (!v) {
    if (cur?.mode === 'url') {
      try {
        saveLogoSlot(slot, null);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (isValidHttpUrl(v)) {
    try {
      saveLogoSlot(slot, { mode: 'url', url: v });
      addRecentLogoUrl(v);
    } catch {
      /* ignore */
    }
  }
}

function syncLogoUrlFieldFromSlot(slot) {
  const b = loadLogoBundle();
  const s = slot === 'header' ? b.header : b.footer;
  if (s?.mode === 'url') el.inputLogoUrl.value = s.url;
  else el.inputLogoUrl.value = '';
}

/** Resolve image URL for preview/print for one region. */
function getLogoSrcForSlot(slot) {
  const active = getActiveLogoSlot();
  const typed = el.inputLogoUrl.value.trim();
  if (slot === active && typed) return typed;
  const b = loadLogoBundle();
  const s = slot === 'header' ? b.header : b.footer;
  if (!s) return '';
  if (s.mode === 'data') return s.dataUrl;
  if (s.mode === 'url') return s.url.trim();
  return '';
}

function clampLogoScale(n) {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function readLogoLayoutFromForm() {
  const hp = el.selectLogoHeaderPlacement?.value ?? 'left';
  const fp = el.selectLogoFooterPlacement?.value ?? 'none';
  return {
    headerPlacement: /** @type {'left'|'center'|'right'|'none'} */ (hp),
    footerPlacement: /** @type {'left'|'center'|'right'|'none'} */ (fp),
    headerScale: clampLogoScale(el.inputLogoHeaderScale?.valueAsNumber ?? 35),
    footerScale: clampLogoScale(el.inputLogoFooterScale?.valueAsNumber ?? 100),
  };
}

function updateLogoScaleControlsEnabled() {
  const hNone = el.selectLogoHeaderPlacement?.value === 'none';
  const fNone = el.selectLogoFooterPlacement?.value === 'none';
  if (el.inputLogoHeaderScale) el.inputLogoHeaderScale.disabled = Boolean(hNone);
  if (el.inputLogoFooterScale) el.inputLogoFooterScale.disabled = Boolean(fNone);
}

function applyLogoLayoutToForm(layout) {
  if (el.selectLogoHeaderPlacement) el.selectLogoHeaderPlacement.value = layout.headerPlacement;
  if (el.selectLogoFooterPlacement) el.selectLogoFooterPlacement.value = layout.footerPlacement;
  if (el.inputLogoHeaderScale) el.inputLogoHeaderScale.value = String(layout.headerScale);
  if (el.inputLogoFooterScale) el.inputLogoFooterScale.value = String(layout.footerScale);
  updateLogoScaleControlsEnabled();
}

/** Flex justification for header strip (logo-only or centered logo+title group). */
const LOGO_JUSTIFY = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  none: 'justify-start',
};

/** Match `#md-preview.prose.prose-sm` sizes from @tailwindcss/typography (14px base). */
const TITLE_LEVEL_CLASS = {
  h1: 'text-3xl font-semibold leading-[1.2] text-slate-900', // 30px — same as prose-sm h1
  h2: 'text-xl font-semibold leading-[1.4] text-slate-900', // 20px
  h3: 'text-lg font-semibold leading-[1.555] text-slate-900', // 18px
  p: 'text-sm font-medium leading-relaxed text-slate-800', // 14px
};

const TITLE_ALIGN_JUSTIFY = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

/** `whitespace-pre-line` keeps line breaks from the textarea; long lines still wrap. */
const DISCLAIMER_BODY_CLASS = 'text-xs leading-relaxed text-slate-600 whitespace-pre-line';

function readPrintTitleFromForm() {
  const levelRaw = el.selectPrintTitleLevel?.value ?? 'h1';
  const level =
    levelRaw === 'h2' || levelRaw === 'h3' || levelRaw === 'p' ? levelRaw : 'h1';
  const alignRaw = el.selectPrintTitleAlign?.value ?? 'left';
  const align =
    alignRaw === 'center' || alignRaw === 'right' ? alignRaw : 'left';
  return {
    text: el.inputPrintTitle?.value ?? '',
    level: /** @type {'h1'|'h2'|'h3'|'p'} */ (level),
    align: /** @type {'left'|'center'|'right'} */ (align),
  };
}

function applyPrintTitleToForm(settings) {
  if (el.inputPrintTitle) el.inputPrintTitle.value = settings.text ?? '';
  if (el.selectPrintTitleLevel) el.selectPrintTitleLevel.value = settings.level ?? 'h1';
  if (el.selectPrintTitleAlign) el.selectPrintTitleAlign.value = settings.align ?? 'left';
}

/**
 * Header chrome: optional logo column (scale = max-width %) + optional print title.
 * Smart layout: logo-only / title-only / logo+title row / hidden when neither.
 */
function applyLogoBranding() {
  const srcH = getLogoSrcForSlot('header');
  const layout = readLogoLayoutFromForm();
  const titleSettings = readPrintTitleFromForm();
  const titleText = titleSettings.text.trim();
  const titleAlign = titleSettings.align === 'center' || titleSettings.align === 'right'
    ? titleSettings.align
    : 'left';
  const showLogo = Boolean(srcH) && layout.headerPlacement !== 'none';
  const showTitle = Boolean(titleText);
  const showHeader = showLogo || showTitle;

  const logoCol = el.headerLogoColumn;
  const titleEl = el.brandHeaderTitle;
  const inner = el.brandHeaderInner;

  if (srcH && el.brandLogoHeaderImg) {
    el.brandLogoHeaderImg.src = srcH;
  } else if (el.brandLogoHeaderImg) {
    el.brandLogoHeaderImg.removeAttribute('src');
  }

  el.brandHeader?.classList.toggle('hidden', !showHeader);

  if (logoCol) {
    logoCol.classList.toggle('hidden', !showLogo);
    logoCol.style.maxWidth = '';
    logoCol.style.minWidth = '';
    logoCol.style.flex = '';
    logoCol.style.order = '';
  }
  if (el.brandLogoHeaderImg) {
    el.brandLogoHeaderImg.style.width = '';
    el.brandLogoHeaderImg.style.maxWidth = '';
    el.brandLogoHeaderImg.style.height = 'auto';
  }
  if (titleEl) {
    titleEl.classList.toggle('hidden', !showTitle);
    titleEl.textContent = titleText;
    titleEl.style.order = '';
    titleEl.style.flex = '';
    titleEl.style.textAlign = '';
    const levelClass = TITLE_LEVEL_CLASS[titleSettings.level] ?? TITLE_LEVEL_CLASS.h1;
    titleEl.className = showTitle
      ? `min-w-0 ${levelClass}`
      : 'hidden min-w-0 flex-1 text-slate-900';
  }

  if (!showHeader || !inner) {
    applyPrintFooterBlock();
    return;
  }

  const hp = layout.headerPlacement;
  const hs = layout.headerPlacement === 'none' ? 35 : layout.headerScale;

  if (showLogo && logoCol && el.brandLogoHeaderImg) {
    logoCol.style.maxWidth = `${hs}%`;
    logoCol.style.minWidth = '0';
    logoCol.style.flex = '0 1 auto';
    el.brandLogoHeaderImg.style.width = 'auto';
    el.brandLogoHeaderImg.style.maxWidth = '100%';
    el.brandLogoHeaderImg.style.height = 'auto';
  }

  if (showLogo && showTitle && titleEl && logoCol) {
    inner.className = 'flex w-full min-w-0 items-center gap-4';
    titleEl.className = `min-w-0 flex-1 ${TITLE_LEVEL_CLASS[titleSettings.level] ?? TITLE_LEVEL_CLASS.h1}`;
    titleEl.style.textAlign = titleAlign;
    if (hp === 'right') {
      titleEl.style.order = '1';
      logoCol.style.order = '2';
      inner.className += ' justify-end';
    } else if (hp === 'center') {
      logoCol.style.order = '1';
      titleEl.style.order = '2';
      titleEl.style.flex = '0 1 auto';
      titleEl.className = `min-w-0 shrink ${TITLE_LEVEL_CLASS[titleSettings.level] ?? TITLE_LEVEL_CLASS.h1}`;
      titleEl.style.textAlign = titleAlign;
      inner.className += ' justify-center';
    } else {
      logoCol.style.order = '1';
      titleEl.style.order = '2';
      inner.className += ' justify-start';
    }
  } else if (showLogo && logoCol) {
    const hj = LOGO_JUSTIFY[hp] ?? 'justify-start';
    inner.className = `flex w-full min-w-0 items-center ${hj}`;
  } else if (showTitle && titleEl) {
    const tj = TITLE_ALIGN_JUSTIFY[titleAlign] ?? 'justify-start';
    inner.className = `flex w-full min-w-0 items-center ${tj}`;
    titleEl.className = `min-w-0 w-full ${TITLE_LEVEL_CLASS[titleSettings.level] ?? TITLE_LEVEL_CLASS.h1}`;
    titleEl.style.textAlign = titleAlign;
  }

  applyPrintFooterBlock();
}

/** @returns {'off' | 'left' | 'center' | 'right'} */
function readFooterPageNumFromForm() {
  const v = el.selectFooterPageNum?.value;
  if (v === 'left' || v === 'center' || v === 'right') return v;
  return 'off';
}

/** @returns {'left' | 'center' | 'right'} */
function readFooterTextAlignFromForm() {
  const v = el.selectFooterTextAlign?.value;
  if (v === 'center' || v === 'right') return v;
  return 'left';
}

/** Apply disclaimer left/center/right on the in-flow (last-page / screen) footer. */
function applyFooterTextAlign() {
  const disc = el.disclaimerFooter;
  if (!disc) return;
  const align = readFooterTextAlignFromForm();
  disc.classList.remove('text-left', 'text-center', 'text-right', 'ml-auto', 'mr-auto', 'mx-auto');
  if (align === 'center') disc.classList.add('text-center', 'mx-auto');
  else if (align === 'right') disc.classList.add('text-right', 'ml-auto');
  else disc.classList.add('text-left');
  disc.style.textAlign = align;
}

function applyFooterPageNumberRow() {
  const align = readFooterPageNumFromForm();
  const show = align !== 'off';
  const pageEl = el.footerPageNumber;
  const textRow = el.footerTextRow;
  const disc = el.disclaimerFooter;
  if (!pageEl || !textRow || !disc) return;

  pageEl.classList.toggle('hidden', !show);
  pageEl.dataset.align = align;
  // Never bake "Page N of N" into the DOM — printToPDF would freeze wrong counts
  // and stack with broken CSS counters ("page 0 of 0Page 1 of 1"). Screen chrome
  // can show a hint; print uses @page margin boxes only.
  if (show) {
    pageEl.textContent = USE_CHROMIUM_PDF_PREVIEW ? '' : `Page ${estimatePrintedPageCount()} of ${estimatePrintedPageCount()}`;
    if (USE_CHROMIUM_PDF_PREVIEW) pageEl.setAttribute('aria-label', 'Page number (shown in PDF margin)');
  } else {
    pageEl.textContent = '';
    pageEl.removeAttribute('aria-label');
  }
  pageEl.classList.remove(
    'order-first',
    'order-last',
    'ml-auto',
    'mr-auto',
    'mx-auto',
    'w-full',
    'text-left',
    'text-center',
    'text-right',
  );
  disc.classList.remove('w-full', 'flex-1', 'min-w-0');

  const applySingleRow = () => {
    textRow.className = 'flex w-full min-w-0 items-end gap-3';
    disc.classList.add('flex-1', 'min-w-0');
    if (align === 'left') pageEl.classList.add('order-first', 'text-left');
    else if (align === 'center') pageEl.classList.add('mx-auto', 'text-center');
    else if (align === 'right') pageEl.classList.add('ml-auto', 'text-right');
  };

  const applyMultiRow = () => {
    textRow.className = 'flex w-full min-w-0 flex-col gap-1';
    disc.classList.add('w-full');
    pageEl.classList.add('w-full');
    if (align === 'left') pageEl.classList.add('text-left');
    else if (align === 'center') pageEl.classList.add('text-center');
    else if (align === 'right') pageEl.classList.add('text-right');
  };

  if (!show) {
    textRow.className = 'flex w-full min-w-0 items-end justify-between gap-3';
    return;
  }

  requestAnimationFrame(() => {
    const lh = Number.parseFloat(getComputedStyle(disc).lineHeight) || 16;
    const multi = disc.scrollHeight > lh * 1.75;
    if (multi) applyMultiRow();
    else applySingleRow();
  });
}

function estimatePrintedPageCount() {
  const frames = document.querySelectorAll('#print-pages-stack .m2pdf-preview-page-frame');
  if (frames.length) return frames.length;
  return 1;
}

function layoutLastPageFooter() {
  const spacer = el.footerLastPageSpacer;
  const wrap = el.footerLastPageWrap;
  const flow = el.printFlow;
  const block = el.printFooterBlock;
  const root = el.printRoot;
  if (!spacer || !wrap || !flow || !block || !root) return;

  if (block.classList.contains('hidden') || readFooterRepeatFromForm() === 'every') {
    spacer.classList.add('hidden');
    spacer.style.height = '0px';
    return;
  }

  const stepRaw = getComputedStyle(root).getPropertyValue('--m2pdf-guide-step').trim();
  const step = Number.parseFloat(stepRaw) || 900;
  const flowH = flow.offsetHeight;
  const rem = flowH % step;
  const footerH = wrap.offsetHeight;
  let pad = 0;
  if (rem > 0 && step > footerH) {
    pad = Math.max(0, step - rem - footerH - 4);
  }
  spacer.style.height = `${pad}px`;
  spacer.classList.toggle('hidden', pad < 2);
}

/**
 * One print-footer region: disclaimer + optional footer logo.
 * Logo scale matches Header: column maxWidth %, img width auto / max 100% / height auto.
 */
function applyPrintFooterBlock() {
  const layout = readLogoLayoutFromForm();
  const srcF = getLogoSrcForSlot('footer');
  const showFooterLogo = Boolean(srcF) && layout.footerPlacement !== 'none';
  const disclaimerText = el.textareaDisclaimer?.value.trim() ?? '';
  const hasDisclaimer = Boolean(disclaimerText);
  const pageNumAlign = readFooterPageNumFromForm();

  const block = el.printFooterBlock;
  const layoutRoot = el.printFooterLayout;
  const logoCol = el.footerLogoColumn;
  const logoRow = el.footerLogoRow;
  if (!block || !layoutRoot || !logoCol || !el.brandLogoFooterImg || !el.brandFooterLogoInner || !el.disclaimerFooter) {
    return;
  }

  el.disclaimerFooter.textContent = disclaimerText;

  const showBlock = hasDisclaimer || showFooterLogo || pageNumAlign !== 'off';
  block.classList.toggle('hidden', !showBlock);
  if (!showBlock) {
    if (!showFooterLogo) el.brandLogoFooterImg.removeAttribute('src');
    layoutLastPageFooter();
    syncPrintPageMargins(readFooterRepeatFromForm(), pageNumAlign);
    applyPageGuide();
    return;
  }

  if (showFooterLogo && srcF) {
    el.brandLogoFooterImg.src = srcF;
  } else {
    el.brandLogoFooterImg.removeAttribute('src');
  }

  const fs = layout.footerPlacement === 'none' ? 100 : layout.footerScale;
  const fp = layout.footerPlacement;

  logoRow?.classList.toggle('hidden', !showFooterLogo);
  logoCol.classList.toggle('hidden', !showFooterLogo);
  el.disclaimerFooter.classList.toggle('hidden', !hasDisclaimer);

  /** Reset inline sizing (avoid leaking between layout modes). */
  logoCol.style.flex = '';
  logoCol.style.maxWidth = '';
  logoCol.style.minWidth = '';
  logoCol.style.marginLeft = '';
  logoCol.style.marginRight = '';
  el.disclaimerFooter.style.flex = '';
  el.disclaimerFooter.style.minWidth = '';
  el.brandLogoFooterImg.style.width = '';
  el.brandLogoFooterImg.style.maxWidth = '';
  el.brandLogoFooterImg.style.height = 'auto';
  el.brandLogoFooterImg.style.maxHeight = '';
  el.brandLogoFooterImg.style.objectFit = 'contain';

  if (showFooterLogo && hasDisclaimer) {
    if (fp === 'center') {
      layoutRoot.className = 'flex w-full min-w-0 flex-col gap-3';
      logoCol.className = 'order-1 flex w-full min-w-0 max-w-full shrink justify-center self-center';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-center';
      el.disclaimerFooter.className = `order-2 w-full min-w-0 text-left ${DISCLAIMER_BODY_CLASS}`;
    } else if (fp === 'left') {
      layoutRoot.className = 'flex w-full min-w-0 flex-row items-start gap-4';
      logoCol.className = 'order-1 min-w-0 self-start';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-start';
      el.disclaimerFooter.className = `order-2 min-w-0 flex-1 basis-0 ${DISCLAIMER_BODY_CLASS}`;
    } else if (fp === 'right') {
      layoutRoot.className = 'flex w-full min-w-0 flex-row items-start gap-4';
      el.disclaimerFooter.className = `order-1 min-w-0 flex-1 basis-0 ${DISCLAIMER_BODY_CLASS}`;
      logoCol.className = 'order-2 min-w-0 self-start';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-end';
    }
  } else if (showFooterLogo && !hasDisclaimer) {
    if (fp === 'center') {
      layoutRoot.className = 'flex w-full min-w-0 flex-col items-center justify-center gap-2';
      logoCol.className = 'flex w-full min-w-0 shrink justify-center';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-center';
    } else if (fp === 'left') {
      layoutRoot.className = 'flex w-full min-w-0 flex-row justify-start';
      logoCol.className = 'min-w-0';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-start';
    } else if (fp === 'right') {
      layoutRoot.className = 'flex w-full min-w-0 flex-row justify-end';
      logoCol.className = 'min-w-0';
      el.brandFooterLogoInner.className = 'flex w-full min-w-0 justify-end';
    }
  } else {
    layoutRoot.className = 'flex w-full min-w-0 flex-col gap-1';
    el.disclaimerFooter.className = `w-full min-w-0 ${DISCLAIMER_BODY_CLASS}`;
  }

  if (showFooterLogo) {
    // Header parity: scale % on the column; image contains inside it.
    el.brandLogoFooterImg.style.width = 'auto';
    el.brandLogoFooterImg.style.maxWidth = '100%';
    el.brandLogoFooterImg.style.height = 'auto';

    if (hasDisclaimer && (fp === 'left' || fp === 'right')) {
      const cap = Math.min(fs, 52);
      logoCol.style.flex = `0 1 ${cap}%`;
      logoCol.style.maxWidth = `${cap}%`;
      logoCol.style.minWidth = '0';
      el.disclaimerFooter.style.flex = '1 1 0%';
      el.disclaimerFooter.style.minWidth = '0';
    } else if (hasDisclaimer && fp === 'center') {
      logoCol.style.maxWidth = `${fs}%`;
      logoCol.style.minWidth = '0';
      logoCol.style.marginLeft = 'auto';
      logoCol.style.marginRight = 'auto';
    } else {
      logoCol.style.maxWidth = `${fs}%`;
      logoCol.style.minWidth = '0';
    }
  }

  applyFooterTextAlign();
  applyFooterPageNumberRow();
  syncPrintPageMargins(readFooterRepeatFromForm(), pageNumAlign);
  layoutLastPageFooter();
  applyPageGuide();
}

/** @param {File} file */
function setLogoFromFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    applyLogoBranding();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    if (dataUrl.length > MAX_LOGO_DATA_URL_CHARS) {
      window.alert(
        'That image is too large to store in the browser. Use a smaller file or an https image URL instead.',
      );
      return;
    }
    try {
      const slot = getActiveLogoSlot();
      saveLogoSlot(slot, { mode: 'data', dataUrl, name: file.name });
      el.inputLogoUrl.value = '';
      const b = loadLogoBundle();
      const st = slot === 'header' ? b.header : b.footer;
      updateLogoPersistHint(st, slot);
      applyLogoBranding();
    } catch {
      window.alert('Could not save the logo (browser storage may be full). Try a smaller image or a URL.');
    }
  };
  reader.readAsDataURL(file);
}

function syncDisclaimerDisplay() {
  applyPrintFooterBlock();
}

/** Measured header / footer bands for preview page math (px). */
function readPreviewChromeBands(everyPageFooter) {
  const showFooter = el.printFooterBlock && !el.printFooterBlock.classList.contains('hidden');
  const footerBandPx = showFooter ? Math.max(0, el.printFooterBlock.offsetHeight) : 0;
  const showHeader = el.brandHeader && !el.brandHeader.classList.contains('hidden');
  const headerBandPx = showHeader ? Math.max(0, el.brandHeader.offsetHeight) : 0;
  const headerFlags = getHeaderPlacementFlags(Boolean(showHeader), false);
  return {
    headerBandPx,
    footerBandPx,
    footerOnEveryPage: everyPageFooter && showFooter,
    repeatHeaderEachPage: headerFlags.repeatHeaderEachPage,
    headerOnFirstPageOnly: headerFlags.headerOnFirstPageOnly,
  };
}

function previewGuideStepPx(paper, everyPageFooter) {
  const { heightPx } = getSheetSizePx(paper);
  // Same bottom margin Export uses — fixed 36mm floor drifted from measured @page.
  const bottomMm = everyPageFooter
    ? resolvePrintBottomMarginMm('every')
    : PAGE_MARGIN_MM.bottom;
  const marginPx = {
    top: PAGE_MARGIN_MM.top * MM_TO_PX,
    right: PAGE_MARGIN_MM.right * MM_TO_PX,
    bottom: bottomMm * MM_TO_PX,
    left: PAGE_MARGIN_MM.left * MM_TO_PX,
  };
  const innerBand = getInnerBandHeightPx(heightPx, marginPx);
  const chrome = readPreviewChromeBands(everyPageFooter);
  return getSlotHeightForPage(1, 2, innerBand, chrome);
}

/** Screen-only page-length bands; uses margins aligned with `pageGuide.js` + `@page` in main.css. */
function applyPageGuide() {
  const root = el.printRoot;
  const overlay = el.pageGuideOverlay;
  if (!root || !overlay) return;
  const v = el.pageGuidePaper?.value;
  const paper = v === 'a4' || v === 'legal' ? v : 'letter';
  const every = document.body.classList.contains('m2pdf-footer-every-page');
  const stepPx = previewGuideStepPx(paper, every);
  root.style.setProperty('--m2pdf-guide-step', `${stepPx}px`);
  document.documentElement.style.setProperty('--m2pdf-guide-step', `${stepPx}px`);

  const { widthPx: sheetWidthPx } = getSheetSizePx(paper);
  const padTop = PAGE_MARGIN_MM.top * MM_TO_PX;
  const padRight = PAGE_MARGIN_MM.right * MM_TO_PX;
  const padBottom = PAGE_MARGIN_MM.bottom * MM_TO_PX;
  const padLeft = PAGE_MARGIN_MM.left * MM_TO_PX;

  root.style.width = `${sheetWidthPx}px`;
  root.style.maxWidth = '100%';
  root.style.padding = '0';
  root.style.boxSizing = 'border-box';
  root.style.margin = '0 auto';


  const on = Boolean(el.pageGuideEnabled?.checked);
  overlay.classList.toggle('hidden', !on);
  layoutLastPageFooter();
  if (previewLayoutBatchDepth === 0) refreshPrintPreviewLayout();
}

/** @type {ReturnType<typeof computePreviewFromSource> | null} */
let lastPreviewContext = null;

/** @returns {'letter' | 'a4' | 'legal'} */
function readPaperFromForm() {
  const paper = confirmPaperSelection(el.pageGuidePaper?.value);
  if (el.pageGuidePaper && el.pageGuidePaper.value !== paper) {
    el.pageGuidePaper.value = paper;
    savePageGuideSettings({
      enabled: Boolean(el.pageGuideEnabled?.checked),
      paper,
    });
  }
  return paper;
}

function rebuildPreviewContext() {
  const paper = readPaperFromForm();
  const every = readFooterRepeatFromForm() === 'every';
  lastPreviewContext = computePreviewFromSource({
    sourceText: el.textareaMd?.value ?? '',
    paper,
    everyPageFooter: every,
    maxSourceChars: MAX_MD_INPUT_CHARS,
    chrome: readPreviewChromeBands(every),
  });
  return lastPreviewContext;
}

/** Shared opts for Prefer B preview + Export flush. */
function getChromiumPreviewOpts() {
  const ctx = rebuildPreviewContext();
  const trimmed = (el.textareaMd?.value ?? '').trim();
  const every = readFooterRepeatFromForm() === 'every';
  return {
    paper: ctx.paper,
    footerRepeat: every ? 'every' : 'last',
    hasContent: Boolean(trimmed) && !ctx.source.paused,
    paused: ctx.source.paused,
    pauseMessage: ctx.source.paused
      ? `Preview paused (${ctx.source.charCount.toLocaleString()} characters). Reduce below ${MAX_MD_INPUT_CHARS.toLocaleString()} to resume.`
      : undefined,
  };
}

/** Off-screen print DOM only (no printToPDF) — safe to run while typing. */
function syncChromiumPrintDomForPreview() {
  const ctx = rebuildPreviewContext();
  const paper = ctx.paper;
  const every = readFooterRepeatFromForm() === 'every';

  document.body.classList.add('m2pdf-chromium-preview');
  el.printRoot?.querySelector('#print-pages-stack')?.replaceChildren();
  applyPrintPaperWidthCss(paper);
  const { widthPx } = getSheetSizePx(paper);
  if (el.printRoot) {
    el.printRoot.style.width = `${widthPx}px`;
    el.printRoot.style.maxWidth = `${widthPx}px`;
    el.printRoot.style.padding = '0';
    el.printRoot.style.margin = '0';
  }
  if (el.printFlow) {
    el.printFlow.style.visibility = 'visible';
    el.printFlow.style.position = 'static';
    el.printFlow.style.left = '';
    el.printFlow.style.pointerEvents = 'auto';
  }
  if (el.footerLastPageWrap) {
    el.footerLastPageWrap.style.display = '';
  }
  layoutLastPageFooter();
  applyFooterPageNumberRow();
  syncPrintPageMargins(every ? 'every' : 'last');
}

/**
 * @param {'source' | 'branding'} [previewKind]
 */
function refreshPrintPreviewLayout(previewKind = 'branding') {
  const ctx = rebuildPreviewContext();
  const paper = ctx.paper;
  const every = readFooterRepeatFromForm() === 'every';
  const trimmed = (el.textareaMd?.value ?? '').trim();
  const paused = ctx.source.paused;

  if (USE_CHROMIUM_PDF_PREVIEW && window.desktopAPI?.previewPdf) {
    syncChromiumPrintDomForPreview();
    scheduleChromiumPdfPreview(
      () => getChromiumPreviewOpts(),
      previewKind,
      rememberActiveDocPreviewFromResult,
    );
    findReplaceApi?.refreshOpenFind?.();
    return;
  }

  document.body.classList.remove('m2pdf-chromium-preview');
  disposeChromiumPdfPreview();

  // Continuous document View (default): same #print-flow Export uses — no fake pages, no PDF iframe.
  if (PREVIEW_ENGINE !== 'paginated') {
    document.body.classList.add('m2pdf-document-preview');
    document.body.classList.remove('m2pdf-chromium-preview');
    el.printRoot?.querySelector('#print-pages-stack')?.replaceChildren();
    const { widthPx } = getSheetSizePx(paper);
    const bottomMm = every ? resolvePrintBottomMarginMm('every') : PAGE_MARGIN_MM.bottom;
    if (el.printRoot) {
      el.printRoot.style.width = `${widthPx}px`;
      el.printRoot.style.maxWidth = '100%';
      el.printRoot.style.padding = `${PAGE_MARGIN_MM.top * MM_TO_PX}px ${PAGE_MARGIN_MM.right * MM_TO_PX}px ${bottomMm * MM_TO_PX}px ${PAGE_MARGIN_MM.left * MM_TO_PX}px`;
      el.printRoot.style.margin = '0 auto';
      el.printRoot.style.background = 'white';
      el.printRoot.style.boxShadow = '0 2px 10px rgb(0 0 0 / 0.35)';
      el.printRoot.style.position = 'relative';
      el.printRoot.style.left = '';
      el.printRoot.style.visibility = 'visible';
      el.printRoot.style.pointerEvents = 'auto';
    }
    if (el.printFlow) {
      el.printFlow.style.visibility = 'visible';
      el.printFlow.style.position = 'static';
      el.printFlow.style.left = '';
      el.printFlow.style.pointerEvents = 'auto';
      el.printFlow.style.width = '';
    }
    if (el.footerLastPageWrap) {
      el.footerLastPageWrap.style.display = '';
      el.footerLastPageWrap.style.visibility = 'visible';
    }
    syncPrintPageMargins(every ? 'every' : 'last');
    layoutLastPageFooter();
    applyFooterPageNumberRow();
    findReplaceApi?.refreshOpenFind?.();
    return;
  }

  document.body.classList.remove('m2pdf-document-preview');

  const padTop = PAGE_MARGIN_MM.top * MM_TO_PX;
  const padRight = PAGE_MARGIN_MM.right * MM_TO_PX;
  const padBottom = PAGE_MARGIN_MM.bottom * MM_TO_PX;
  const padLeft = PAGE_MARGIN_MM.left * MM_TO_PX;
  const guideStepPx = previewGuideStepPx(paper, every);

  layoutPrintPreviewSheets(el.printRoot, paper, {
    everyPageFooter: every,
    footerBlock: el.printFooterBlock,
    pageNumAlign: readFooterPageNumFromForm(),
    marginPx: { top: padTop, right: padRight, bottom: padBottom, left: padLeft },
    showPageGuides: Boolean(el.pageGuideEnabled?.checked),
    guideStepPx,
    sourceHasContent: Boolean(trimmed) && !paused,
    previewMessage: paused
      ? `Preview paused (${ctx.source.charCount.toLocaleString()} characters). Reduce below ${MAX_MD_INPUT_CHARS.toLocaleString()} to resume.`
      : undefined,
    previewContext: ctx,
  });

  applyFooterPageNumberRow();
  findReplaceApi?.refreshOpenFind?.();
}

function debounce(fn, ms) {
  let t = 0;
  /** @param {...unknown} args */
  const wrapped = (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    window.clearTimeout(t);
    t = 0;
  };
  return wrapped;
}

const syncChromiumPrintDomDebounced = debounce(syncChromiumPrintDomForPreview, 140);

const PRINT_PAGE_STYLE_ID = 'm2pdf-print-page';

/**
 * `@page` cannot be keyed off a body class — inject/update margins for last vs every-page footer.
 * @param {'last' | 'every'} mode
 * @param {'off' | 'left' | 'center' | 'right'} [pageNumInFooter]
 */
/** Room for @page page-number margin box under the brand strip. */
const FOOTER_PAGE_NUM_BAND_MM = 5;
/**
 * Fixed every-page brand strip height (mm). CSS clamps logo/disclaimer to fit.
 * Predictable reserve-and-break — measured logos previously blew @page to ⅓ page.
 */
const FOOTER_STRIP_MM = 12;
/** @page bottom = strip + page# + pad — body breaks above this band. */
const FOOTER_BOTTOM_EVERY_MM = FOOTER_STRIP_MM + FOOTER_PAGE_NUM_BAND_MM + 3;

/** @deprecated kept for call sites; every-page uses FOOTER_STRIP_MM. */
function measurePrintFooterHeightMm() {
  const block = el.printFooterBlock;
  if (!block || block.classList.contains('hidden')) return 0;
  return FOOTER_STRIP_MM;
}

/** Wait for footer/header images so height measure matches Export. */
async function waitForPrintAssets() {
  const root = el.printRoot;
  if (!root) return;
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      if (typeof img.decode === 'function') return img.decode().catch(() => {});
      return new Promise((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
}

/**
 * @page bottom margin: footer band + page-# band + pad (forces clean break above footer).
 * @param {'last' | 'every'} mode
 */
function resolvePrintBottomMarginMm(mode) {
  if (mode !== 'every') return PAGE_MARGIN_MM.bottom;
  const block = el.printFooterBlock;
  if (!block || block.classList.contains('hidden')) return PAGE_MARGIN_MM_EVERY_PAGE.bottom;
  return Math.max(PAGE_MARGIN_MM_EVERY_PAGE.bottom, FOOTER_BOTTOM_EVERY_MM);
}

function syncPrintPageMargins(mode, pageNumInFooter = readFooterPageNumFromForm()) {
  const every = mode === 'every';
  // Every-page: Electron footerTemplate + matching @page bottom (same mm as printToPdfOptions).
  // Last-page: DOM footer + @page page-# margin boxes.
  const bottom = every
    ? Math.min(40, Math.max(18, lastEveryPageBottomMm || FOOTER_BOTTOM_EVERY_MM))
    : resolvePrintBottomMarginMm(mode);

  document.documentElement.style.setProperty('--m2pdf-print-footer-height', every ? '0mm' : '0mm');
  document.documentElement.style.setProperty('--m2pdf-print-bottom-margin', `${bottom}mm`);
  document.documentElement.style.setProperty('--m2pdf-print-pagenum-band', `0mm`);
  document.documentElement.style.setProperty('--m2pdf-print-footer-clearance', `3mm`);

  const pageNumCss = `
    content: 'Page ' counter(page) ' of ' counter(pages);
    font-size: 9pt;
    line-height: 1.2;
    color: #64748b;
    font-family: ui-sans-serif, system-ui, sans-serif, 'Segoe UI', Roboto, Helvetica, Arial;
    vertical-align: top;
  `;
  let marginBox =
    `@bottom-center { content: none; } @bottom-left { content: none; } @bottom-right { content: none; }`;
  if (!every) {
    if (pageNumInFooter === 'center') {
      marginBox = `@bottom-left { content: none; } @bottom-right { content: none; } @bottom-center { ${pageNumCss} }`;
    } else if (pageNumInFooter === 'left') {
      marginBox = `@bottom-center { content: none; } @bottom-right { content: none; } @bottom-left { ${pageNumCss} }`;
    } else if (pageNumInFooter === 'right') {
      marginBox = `@bottom-center { content: none; } @bottom-left { content: none; } @bottom-right { ${pageNumCss} }`;
    } else {
      marginBox = `@bottom-left { content: none; } @bottom-right { content: none; } @bottom-center { ${pageNumCss} }`;
    }
  }
  let styleEl = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PRINT_PAGE_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
@page {
  margin: ${PAGE_MARGIN_MM.top}mm ${PAGE_MARGIN_MM.right}mm ${bottom}mm ${PAGE_MARGIN_MM.left}mm;
  ${marginBox}
}
`;
}

/** @returns {'last' | 'every'} */
function readFooterRepeatFromForm() {
  return el.selectFooterRepeat?.value === 'every' ? 'every' : 'last';
}

/**
 * Body class + @page margins for every-page footer; screen preview stays in-flow.
 * @param {'last' | 'every'} [mode]
 */
/**
 * @param {'last' | 'every'} [mode]
 * @param {{ skipPageGuide?: boolean }} [opts]
 */
function applyFooterRepeatMode(mode, opts = {}) {
  const m = mode ?? readFooterRepeatFromForm();
  document.body.classList.toggle('m2pdf-footer-every-page', m === 'every');
  if (el.selectFooterRepeat) el.selectFooterRepeat.value = m;
  syncPrintPageMargins(m);
  if (!opts.skipPageGuide) applyPageGuide();
}

function persistFooterRepeat() {
  const m = readFooterRepeatFromForm();
  saveFooterRepeat(m);
  applyFooterRepeatMode(m);
}

function persistPageGuide() {
  const v = el.pageGuidePaper?.value;
  const paper = v === 'a4' || v === 'legal' ? v : 'letter';
  savePageGuideSettings({
    enabled: Boolean(el.pageGuideEnabled?.checked),
    paper,
  });
  applyPageGuide();
}

function updateMarkdownPreviewDom() {
  clearPreviewFindHighlights();
  const raw = el.textareaMd.value;
  if (!raw.trim()) {
    setMdInputWarning('');
    el.mdPreview.innerHTML =
      '<p class="text-slate-400">Open or paste Markdown to see the preview.</p>';
    delete el.mdPreview.dataset.m2pdfRendered;
    layoutLastPageFooter();
    return false;
  }
  if (raw.length > MAX_MD_INPUT_CHARS) {
    setMdInputWarning(
      `Preview paused: source is ${raw.length.toLocaleString()} characters. Reduce below ${MAX_MD_INPUT_CHARS.toLocaleString()} characters to resume live rendering.`,
    );
    el.mdPreview.innerHTML =
      '<p class="text-amber-700">Preview paused for very large input. Reduce content size to continue live rendering.</p>';
    delete el.mdPreview.dataset.m2pdfRendered;
    return false;
  }
  setMdInputWarning('');
  const html = md.render(preprocessMarkdown(raw));
  el.mdPreview.innerHTML = DOMPurify.sanitize(html);
  el.mdPreview.dataset.m2pdfRendered = '1';
  applyPrintFooterBlock();
  return true;
}

function renderMarkdown() {
  const ok = updateMarkdownPreviewDom();
  if (!ok) {
    refreshPrintPreviewLayout();
    return;
  }
  if (USE_CHROMIUM_PDF_PREVIEW && window.desktopAPI?.previewPdf) {
    syncChromiumPrintDomDebounced();
    scheduleChromiumPdfPreview(
      () => getChromiumPreviewOpts(),
      'source',
      rememberActiveDocPreviewFromResult,
    );
  } else {
    refreshPrintPreviewLayout();
  }
}

const persistDisclaimer = debounce(() => {
  saveDisclaimer(el.textareaDisclaimer.value);
}, 400);
const persistSessionDebounced = debounce(() => {
  flushActiveEditorToSession();
  persistSession();
}, 750);
const renderMarkdownDebounced = debounce(() => {
  renderMarkdown();
}, RENDER_DEBOUNCE_MS);

function isValidHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const persistLogoUrlState = debounce(() => {
  const v = el.inputLogoUrl.value.trim();
  const slot = getActiveLogoSlot();
  if (!v || !isValidHttpUrl(v)) return;
  try {
    saveLogoSlot(slot, { mode: 'url', url: v });
    addRecentLogoUrl(v);
    populateLogoRecentDatalist();
    updateLogoPersistHint({ mode: 'url', url: v }, slot);
  } catch {
    /* ignore */
  }
}, 400);

function initFromStorage() {
  const { disclaimer } = loadBranding();
  el.textareaDisclaimer.value = disclaimer;
  syncDisclaimerDisplay();

  const rawSession = loadDesktopSession();
  const normalized = normalizeSession(rawSession);
  if (normalized) {
    session = ensureSession(normalized);
  } else {
    const legacy = loadMarkdownDraft();
    if (legacy) {
      const doc = createDocument({
        text: legacy,
        name: 'Untitled.md',
        dirty: true,
      });
      session = { docs: [doc], activeId: doc.id };
    } else {
      session = createEmptySession();
    }
  }

  applyFooterRepeatMode(loadFooterRepeat(), { skipPageGuide: true });
  if (el.selectFooterPageNum) {
    el.selectFooterPageNum.value = loadFooterPageNum();
  }
  if (el.selectFooterTextAlign) {
    el.selectFooterTextAlign.value = loadFooterTextAlign();
  }

  applyPrintTitleToForm(loadPrintTitle());

  const pg = loadPageGuideSettings();
  if (el.pageGuideEnabled) el.pageGuideEnabled.checked = pg.enabled;
  if (el.pageGuidePaper) el.pageGuidePaper.value = confirmPaperSelection(pg.paper);

  const hRadio = document.getElementById('logo-slot-header');
  if (hRadio) /** @type {HTMLInputElement} */ (hRadio).checked = true;
  logoSlotLastFlushed = 'header';
  syncLogoUrlFieldFromSlot('header');
  const b = loadLogoBundle();
  updateLogoPersistHint(b.header, 'header');
  populateLogoRecentDatalist();
  applyLogoLayoutToForm(loadLogoLayout());

  previewLayoutBatchDepth += 1;
  syncEditorFromActiveDoc({ skipPreview: true });
  applyLogoBranding();
  applyPageGuide();
  previewLayoutBatchDepth -= 1;
  persistSession();
  requestAnimationFrame(() => renderMarkdown());
}

el.textareaMd.addEventListener('input', () => {
  findReplaceApi?.onSourceInput?.();
  renderMarkdownDebounced();
  const doc = getActiveDoc();
  if (doc) doc.dirty = true;
  syncActiveTabDirtyLabel();
  persistSessionDebounced();
});

/** Leave Source: refresh PDF once (debounced) so Preview catches up without jumping while typing. */
let sourceBlurPreviewTimer = 0;
el.textareaMd?.addEventListener('blur', () => {
  if (!USE_CHROMIUM_PDF_PREVIEW || !window.desktopAPI?.previewPdf) return;
  window.clearTimeout(sourceBlurPreviewTimer);
  sourceBlurPreviewTimer = window.setTimeout(() => {
    sourceBlurPreviewTimer = 0;
    if (document.activeElement === el.textareaMd) return;
    syncChromiumPrintDomForPreview();
    void flushChromiumPdfPreview(() => getChromiumPreviewOpts()).then(
      rememberActiveDocPreviewFromResult,
    );
  }, 150);
});

el.btnOpenMd?.addEventListener('click', () => {
  openMdViaFilePicker();
});

el.btnClear.addEventListener('click', () => {
  const doc = getActiveDoc();
  if (!doc) return;
  el.textareaMd.value = '';
  doc.text = '';
  doc.dirty = true;
  syncMdSaveButton();
  renderTabs();
  persistSession();
  renderMarkdown();
});

el.btnSaveMd?.addEventListener('click', () => {
  saveMdOverwriteOrAs();
});

el.btnSaveAsMd?.addEventListener('click', () => {
  saveMdAs();
});

el.inputLogoUrl.addEventListener('input', () => {
  el.fileLogo.value = '';
  const slot = getActiveLogoSlot();
  const v = el.inputLogoUrl.value.trim();
  if (!v) {
    const b = loadLogoBundle();
    const cur = slot === 'header' ? b.header : b.footer;
    if (cur?.mode === 'url') {
      try {
        saveLogoSlot(slot, null);
      } catch {
        /* ignore */
      }
    }
    const after = loadLogoBundle();
    updateLogoPersistHint(slot === 'header' ? after.header : after.footer, slot);
    applyLogoBranding();
    return;
  }
  applyLogoBranding();
  persistLogoUrlState();
});

function onLogoSlotChange() {
  const prev = logoSlotLastFlushed;
  flushInputToLogoSlot(prev);
  populateLogoRecentDatalist();
  const next = getActiveLogoSlot();
  logoSlotLastFlushed = next;
  syncLogoUrlFieldFromSlot(next);
  const b = loadLogoBundle();
  const st = next === 'header' ? b.header : b.footer;
  updateLogoPersistHint(st, next);
  applyLogoBranding();
}

document.getElementById('logo-slot-header')?.addEventListener('change', onLogoSlotChange);
document.getElementById('logo-slot-footer')?.addEventListener('change', onLogoSlotChange);

el.fileLogo.addEventListener('change', () => {
  const f = el.fileLogo.files?.[0];
  if (f) {
    el.inputLogoUrl.value = '';
    setLogoFromFile(f);
  }
  el.fileLogo.value = '';
});

el.btnRemoveLogo.addEventListener('click', () => {
  const slot = getActiveLogoSlot();
  el.inputLogoUrl.value = '';
  el.fileLogo.value = '';
  try {
    clearLogoSlot(slot);
  } catch {
    /* ignore */
  }
  updateLogoPersistHint(null, slot);
  applyLogoBranding();
});

function persistLogoLayoutFromForm() {
  saveLogoLayout(readLogoLayoutFromForm());
}

el.selectLogoHeaderPlacement?.addEventListener('change', () => {
  updateLogoScaleControlsEnabled();
  persistLogoLayoutFromForm();
  applyLogoBranding();
});

el.selectLogoFooterPlacement?.addEventListener('change', () => {
  updateLogoScaleControlsEnabled();
  persistLogoLayoutFromForm();
  applyLogoBranding();
});

function onLogoScaleInput() {
  if (el.inputLogoHeaderScale) el.inputLogoHeaderScale.value = String(clampLogoScale(el.inputLogoHeaderScale.valueAsNumber));
  if (el.inputLogoFooterScale) el.inputLogoFooterScale.value = String(clampLogoScale(el.inputLogoFooterScale.valueAsNumber));
  persistLogoLayoutFromForm();
  applyLogoBranding();
}

el.inputLogoHeaderScale?.addEventListener('input', () => {
  applyLogoBranding();
});
el.inputLogoHeaderScale?.addEventListener('change', onLogoScaleInput);
el.inputLogoHeaderScale?.addEventListener('blur', onLogoScaleInput);
el.inputLogoFooterScale?.addEventListener('input', () => {
  applyLogoBranding();
});
el.inputLogoFooterScale?.addEventListener('change', onLogoScaleInput);
el.inputLogoFooterScale?.addEventListener('blur', onLogoScaleInput);

el.textareaDisclaimer.addEventListener('input', () => {
  syncDisclaimerDisplay();
  persistDisclaimer();
});
el.selectFooterRepeat?.addEventListener('change', persistFooterRepeat);
el.selectFooterPageNum?.addEventListener('change', () => {
  saveFooterPageNum(readFooterPageNumFromForm());
  applyPrintFooterBlock();
});
el.selectFooterTextAlign?.addEventListener('change', () => {
  saveFooterTextAlign(readFooterTextAlignFromForm());
  applyPrintFooterBlock();
});

const persistPrintTitleDebounced = debounce(() => {
  savePrintTitle(readPrintTitleFromForm());
}, 400);

el.inputPrintTitle?.addEventListener('input', () => {
  applyLogoBranding();
  persistPrintTitleDebounced();
});

el.selectPrintTitleLevel?.addEventListener('change', () => {
  savePrintTitle(readPrintTitleFromForm());
  applyLogoBranding();
});

el.selectPrintTitleAlign?.addEventListener('change', () => {
  savePrintTitle(readPrintTitleFromForm());
  applyLogoBranding();
});

el.btnExportPdf?.addEventListener('click', () => {
  exportPdf();
});

el.pageGuideEnabled?.addEventListener('change', persistPageGuide);
el.pageGuidePaper?.addEventListener('change', persistPageGuide);

function initMdToolbar() {
  const tb = document.getElementById('md-toolbar');
  if (!tb || !el.textareaMd) return;
  tb.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md-insert]');
    if (!btn) return;
    e.preventDefault();
    const ta = el.textareaMd;
    if (!ta) return;
    const action = btn.getAttribute('data-md-insert');
    if (action === 'bold') insertBold(ta);
    else if (action === 'italic') insertItalic(ta);
    else if (action === 'h1') applyHeadingLevel(ta, 1);
    else if (action === 'h2') applyHeadingLevel(ta, 2);
    else if (action === 'h3') applyHeadingLevel(ta, 3);
    else if (action === 'p') applyHeadingLevel(ta, 0);
    else if (action === 'ul') insertBulletList(ta);
    else if (action === 'ol') insertNumberedList(ta);
    else if (action === 'indent') indentLines(ta);
    else if (action === 'outdent') outdentLines(ta);
    else if (action === 'table') insertTable(ta);
    else if (action === 'link') insertLink(ta);
    else if (action === 'quote') insertBlockquote(ta);
    else if (action === 'code') insertInlineCode(ta);
    else if (action === 'hr') insertHorizontalRule(ta);
    renderMarkdown();
    const doc = getActiveDoc();
    if (doc) {
      doc.text = ta.value;
      doc.dirty = true;
    }
    syncActiveTabDirtyLabel();
    persistSession();
  });
}

initFromStorage();
/** Used by chromium PDF preview + agent audit prep before printToPDF. */
window.__m2pdfPreparePrintPdf = async () => {
  await waitForPrintAssets();
  applyPrintPaperWidthCss(readPaperFromForm());
  const mode = readFooterRepeatFromForm();
  if (mode === 'every') {
    const built = await buildEveryPageFooterTemplate();
    lastEveryPageBottomMm = built.bottomMm;
  }
  syncPrintPageMargins(mode);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

/** Export / Prefer B / Playwright audit — same footerTemplate + paper payload. */
window.__m2pdfBuildPrintPdfPayload = () => buildPrintPdfPayload();

initAboutDialog();
if (el.printFlow && typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    layoutLastPageFooter();
    applyFooterPageNumberRow();
  });
  ro.observe(el.printFlow);
  if (el.footerLastPageWrap) ro.observe(el.footerLastPageWrap);
  if (el.printFooterBlock) ro.observe(el.printFooterBlock);
  if (el.printRoot) ro.observe(el.printRoot);
}
initSidebarResize();
initMdToolbar();

/** Which pane Find should default to when opening the dialog (not selection-based). */
let lastFindPane = 'editor';
document.addEventListener(
  'focusin',
  (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (t === el.textareaMd) lastFindPane = 'editor';
    else if (el.mainPreview?.contains(t) || el.mdPreview?.contains(t)) lastFindPane = 'preview';
  },
  true,
);
el.mainPreview?.addEventListener('mousedown', () => {
  el.mainPreview?.focus({ preventScroll: true });
});

findReplaceApi = initFindReplaceUi({
  sourceFindOnly: USE_CHROMIUM_PDF_PREVIEW,
  getTextarea: () => el.textareaMd,
  getPreviewRoot: () => {
    if (USE_CHROMIUM_PDF_PREVIEW && document.body.classList.contains('m2pdf-chromium-preview')) {
      return document.getElementById('pdfjs-pages') ?? el.mdPreview;
    }
    return document.getElementById('print-pages-stack') ?? el.mdPreview;
  },
  onPreviewFindResult: ({ query, matchCount, activeIndex }) => {
    if (!USE_CHROMIUM_PDF_PREVIEW) return;
    if (!query) {
      setChromiumPdfStatus('', 'ready');
      return;
    }
    if (matchCount <= 0) {
      setChromiumPdfStatus(`No matches for “${query}” in preview`, 'find');
      return;
    }
    const n = activeIndex >= 0 ? activeIndex + 1 : 1;
    setChromiumPdfStatus(`Find in preview: ${n} of ${matchCount} for “${query}”`, 'find');
  },
  getDefaultSearchTarget: () => lastFindPane,
});
initDesktopMenu();
initDesktopOpenFromOs().finally(() => {
  renderTabs();
});
