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
import { getUsableHeightPx, PAGE_MARGIN_MM, PAGE_MARGIN_MM_EVERY_PAGE } from '@m2pdf/core';
import {
  MAX_LOGO_DATA_URL_CHARS,
  addRecentLogoUrl,
  clearLogoSlot,
  loadBranding,
  loadDesktopSession,
  loadFooterRepeat,
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

/**
 * Load active document into the editor + preview and refresh tabs.
 */
function syncEditorFromActiveDoc() {
  const doc = getActiveDoc();
  if (!doc || !el.textareaMd) return;
  el.textareaMd.value = doc.text;
  syncMdSaveButton();
  renderTabs();
  renderMarkdown();
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
}

/**
 * @param {string} id
 */
function activateDocument(id) {
  if (id === session.activeId) return;
  if (!session.docs.some((d) => d.id === id)) return;
  flushActiveEditorToSession();
  session.activeId = id;
  syncEditorFromActiveDoc();
  persistSession();
}

function newDocument() {
  flushActiveEditorToSession();
  const doc = createDocument({ name: 'Untitled.md', dirty: false });
  session.docs.push(doc);
  session.activeId = doc.id;
  syncEditorFromActiveDoc();
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
      syncEditorFromActiveDoc();
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
  syncEditorFromActiveDoc();
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
      syncEditorFromActiveDoc();
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
  syncEditorFromActiveDoc();
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
  });
  syncRecentMenu();
}

async function exportPdf() {
  const api = window.desktopAPI;
  if (!api?.exportPdf) return;
  flushActiveEditorToSession();
  const doc = getActiveDoc();
  const paper = el.pageGuidePaper?.value;
  const result = await api.exportPdf({
    paper: paper === 'a4' || paper === 'legal' ? paper : 'letter',
    suggestedName: doc?.name || 'document.md',
    footerRepeat: readFooterRepeatFromForm(),
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

/**
 * One print-footer region: disclaimer text + optional footer logo, laid out by footer placement.
 */
function applyPrintFooterBlock() {
  const layout = readLogoLayoutFromForm();
  const srcF = getLogoSrcForSlot('footer');
  const showFooterLogo = Boolean(srcF) && layout.footerPlacement !== 'none';
  const disclaimerText = el.textareaDisclaimer?.value.trim() ?? '';
  const hasDisclaimer = Boolean(disclaimerText);

  const block = el.printFooterBlock;
  const layoutRoot = el.printFooterLayout;
  const logoCol = el.footerLogoColumn;
  if (!block || !layoutRoot || !logoCol || !el.brandLogoFooterImg || !el.brandFooterLogoInner || !el.disclaimerFooter) {
    return;
  }

  el.disclaimerFooter.textContent = disclaimerText;

  const showBlock = hasDisclaimer || showFooterLogo;
  block.classList.toggle('hidden', !showBlock);
  if (!showBlock) {
    if (!showFooterLogo) el.brandLogoFooterImg.removeAttribute('src');
    return;
  }

  if (showFooterLogo && srcF) {
    el.brandLogoFooterImg.src = srcF;
  } else {
    el.brandLogoFooterImg.removeAttribute('src');
  }

  const fs = layout.footerPlacement === 'none' ? 100 : layout.footerScale;

  logoCol.classList.toggle('hidden', !showFooterLogo);
  el.disclaimerFooter.classList.toggle('hidden', !hasDisclaimer);

  const fp = layout.footerPlacement;

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
  el.brandLogoFooterImg.style.objectFit = 'contain';

  if (showFooterLogo && hasDisclaimer) {
    if (fp === 'center') {
      layoutRoot.className = 'flex w-full min-w-0 flex-col gap-3';
      logoCol.className =
        'order-1 flex w-full min-w-0 max-w-full shrink justify-center self-center';
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
    layoutRoot.className = 'flex w-full min-w-0 flex-col';
    el.disclaimerFooter.className = `w-full min-w-0 ${DISCLAIMER_BODY_CLASS}`;
  }

  if (!showFooterLogo) {
    return;
  }

  /** Image fills the logo column; scale % applies to column width, not intrinsic bitmap width. */
  el.brandLogoFooterImg.style.width = '100%';
  el.brandLogoFooterImg.style.maxWidth = '100%';

  if (showFooterLogo && hasDisclaimer && (fp === 'left' || fp === 'right')) {
    const cap = Math.min(fs, 52);
    logoCol.style.flex = `0 1 ${cap}%`;
    logoCol.style.maxWidth = `${cap}%`;
    logoCol.style.minWidth = '0';
    el.disclaimerFooter.style.flex = '1 1 0%';
    el.disclaimerFooter.style.minWidth = '0';
  } else if (showFooterLogo && hasDisclaimer && fp === 'center') {
    logoCol.style.maxWidth = `${fs}%`;
    logoCol.style.minWidth = '0';
    logoCol.style.marginLeft = 'auto';
    logoCol.style.marginRight = 'auto';
  } else {
    logoCol.style.maxWidth = `${fs}%`;
    logoCol.style.minWidth = '0';
  }
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

/** Screen-only page-length bands; uses margins aligned with `pageGuide.js` + `@page` in main.css. */
function applyPageGuide() {
  const root = el.printRoot;
  const overlay = el.pageGuideOverlay;
  if (!root || !overlay) return;
  const v = el.pageGuidePaper?.value;
  const paper = v === 'a4' || v === 'legal' ? v : 'letter';
  const every = document.body.classList.contains('m2pdf-footer-every-page');
  const bottomMm = every ? PAGE_MARGIN_MM_EVERY_PAGE.bottom : PAGE_MARGIN_MM.bottom;
  const stepPx = getUsableHeightPx(paper, { bottomMm });
  root.style.setProperty('--m2pdf-guide-step', `${stepPx}px`);
  const on = Boolean(el.pageGuideEnabled?.checked);
  overlay.classList.toggle('hidden', !on);
}

const PRINT_PAGE_STYLE_ID = 'm2pdf-print-page';

/**
 * `@page` cannot be keyed off a body class — inject/update margins for last vs every-page footer.
 * @param {'last' | 'every'} mode
 */
function syncPrintPageMargins(mode) {
  const bottom = mode === 'every' ? PAGE_MARGIN_MM_EVERY_PAGE.bottom : PAGE_MARGIN_MM.bottom;
  let styleEl = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PRINT_PAGE_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
@page {
  margin: ${PAGE_MARGIN_MM.top}mm ${PAGE_MARGIN_MM.right}mm ${bottom}mm ${PAGE_MARGIN_MM.left}mm;
  @bottom-center {
    content: 'Page ' counter(page) ' of ' counter(pages);
    font-size: 9pt;
    line-height: 1.2;
    color: #64748b;
    font-family: ui-sans-serif, system-ui, sans-serif, 'Segoe UI', Roboto, Helvetica, Arial;
    vertical-align: top;
  }
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
function applyFooterRepeatMode(mode) {
  const m = mode ?? readFooterRepeatFromForm();
  document.body.classList.toggle('m2pdf-footer-every-page', m === 'every');
  if (el.selectFooterRepeat) el.selectFooterRepeat.value = m;
  syncPrintPageMargins(m);
  applyPageGuide();
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

function renderMarkdown() {
  const raw = el.textareaMd.value;
  if (!raw.trim()) {
    setMdInputWarning('');
    el.mdPreview.innerHTML =
      '<p class="text-slate-400">Open or paste Markdown to see the preview.</p>';
    return;
  }
  if (raw.length > MAX_MD_INPUT_CHARS) {
    setMdInputWarning(
      `Preview paused: source is ${raw.length.toLocaleString()} characters. Reduce below ${MAX_MD_INPUT_CHARS.toLocaleString()} characters to resume live rendering.`,
    );
    el.mdPreview.innerHTML =
      '<p class="text-amber-700">Preview paused for very large input. Reduce content size to continue live rendering.</p>';
    return;
  }
  setMdInputWarning('');
  const html = md.render(preprocessMarkdown(raw));
  el.mdPreview.innerHTML = DOMPurify.sanitize(html);
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

const persistDisclaimer = debounce(() => {
  saveDisclaimer(el.textareaDisclaimer.value);
}, 400);
const persistSessionDebounced = debounce(() => {
  flushActiveEditorToSession();
  persistSession();
}, 400);
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

  applyFooterRepeatMode(loadFooterRepeat());

  applyPrintTitleToForm(loadPrintTitle());

  const pg = loadPageGuideSettings();
  if (el.pageGuideEnabled) el.pageGuideEnabled.checked = pg.enabled;
  if (el.pageGuidePaper) el.pageGuidePaper.value = pg.paper;
  applyPageGuide();

  const hRadio = document.getElementById('logo-slot-header');
  if (hRadio) /** @type {HTMLInputElement} */ (hRadio).checked = true;
  logoSlotLastFlushed = 'header';
  syncLogoUrlFieldFromSlot('header');
  const b = loadLogoBundle();
  updateLogoPersistHint(b.header, 'header');
  populateLogoRecentDatalist();
  applyLogoLayoutToForm(loadLogoLayout());
  applyLogoBranding();

  syncEditorFromActiveDoc();
  persistSession();
}

el.textareaMd.addEventListener('input', () => {
  renderMarkdownDebounced();
  const doc = getActiveDoc();
  if (doc) doc.dirty = true;
  renderTabs();
  persistSessionDebounced();
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
    renderTabs();
    persistSession();
  });
}

initFromStorage();
initSidebarResize();
initMdToolbar();
initDesktopMenu();
initDesktopOpenFromOs().finally(() => {
  renderMarkdown();
  renderTabs();
});
