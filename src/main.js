import './main.css';
import DOMPurify from 'dompurify';
import { createMarkdownRenderer, preprocessMarkdown } from './markdown.js';
import {
  applyHeadingLevel,
  insertBlockquote,
  insertBold,
  insertBulletList,
  insertHorizontalRule,
  insertInlineCode,
  insertItalic,
  insertLink,
  insertNumberedList,
} from './mdToolbar.js';
import { getUsableHeightPx } from './pageGuide.js';
import {
  MAX_LOGO_DATA_URL_CHARS,
  addRecentLogoUrl,
  clearLogoSlot,
  loadBranding,
  loadLogoBundle,
  loadLogoLayout,
  loadPageGuideSettings,
  loadRecentLogoUrls,
  loadSidebarWidthPx,
  saveDisclaimer,
  saveLogoLayout,
  saveLogoSlot,
  savePageGuideSettings,
  saveSidebarWidthPx,
} from './storage.js';

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
  fileMd: document.getElementById('file-md'),
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
  textareaDisclaimer: document.getElementById('textarea-disclaimer'),
  btnPrint: document.getElementById('btn-print'),
  printRoot: document.getElementById('print-root'),
  pageGuideOverlay: document.getElementById('page-guide-overlay'),
  pageGuideEnabled: document.getElementById('page-guide-enabled'),
  pageGuidePaper: document.getElementById('page-guide-paper'),
  mdPreview: document.getElementById('md-preview'),
  brandHeader: document.getElementById('brand-header'),
  brandHeaderInner: document.getElementById('brand-header-inner'),
  brandLogoHeaderImg: document.getElementById('brand-logo-header-img'),
  printFooterBlock: document.getElementById('print-footer-block'),
  printFooterLayout: document.getElementById('print-footer-layout'),
  footerLogoColumn: document.getElementById('footer-logo-column'),
  brandFooterLogoInner: document.getElementById('brand-footer-logo-inner'),
  brandLogoFooterImg: document.getElementById('brand-logo-footer-img'),
  disclaimerFooter: document.getElementById('disclaimer-footer'),
};

/** Writable handle when Open / Save As used the File System Access API (Chrome/Edge). */
let mdFileHandle = null;
/** Default filename for Save As and the save picker. */
let mdSuggestedFilename = 'document.md';

function getMdSourceText() {
  return el.textareaMd?.value ?? '';
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

/**
 * @param {File} file
 * @returns {boolean} true when blocked
 */
function rejectOversizeMdFile(file) {
  if (!file || file.size <= MAX_MD_OPEN_BYTES) return false;
  const msg = `Open blocked: "${file.name}" is ${formatBytes(file.size)}; max file size is ${formatBytes(MAX_MD_OPEN_BYTES)}.`;
  setMdInputWarning(msg);
  window.alert(`${msg}\n\nTip: split very large docs into smaller sections.`);
  return true;
}

function syncMdSaveButton() {
  if (el.btnSaveMd) el.btnSaveMd.disabled = !mdFileHandle;
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {string} text
 */
async function writeMdToHandle(handle, text) {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
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

async function saveMdAs() {
  const text = getMdSourceText();
  const suggested = normalizeMdSuggestedName(mdSuggestedFilename);
  try {
    if (typeof window.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [
          {
            description: 'Markdown',
            accept: {
              'text/markdown': ['.md'],
              'text/plain': ['.md', '.markdown', '.txt'],
            },
          },
        ],
      });
      await writeMdToHandle(handle, text);
      mdFileHandle = handle;
      mdSuggestedFilename = handle.name;
      syncMdSaveButton();
      return;
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return;
    /* fall through to download */
  }
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = suggested;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mdFileHandle = null;
  syncMdSaveButton();
}

async function saveMdOverwrite() {
  if (!mdFileHandle) return;
  try {
    await writeMdToHandle(mdFileHandle, getMdSourceText());
  } catch {
    mdFileHandle = null;
    syncMdSaveButton();
  }
}

async function openMdViaFilePicker() {
  try {
    if (typeof window.showOpenFilePicker === 'function') {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Markdown',
            accept: {
              'text/markdown': ['.md'],
              'text/plain': ['.md', '.markdown', '.txt'],
            },
          },
        ],
      });
      const file = await handle.getFile();
      if (rejectOversizeMdFile(file)) return;
      const text = await file.text();
      el.textareaMd.value = text;
      mdFileHandle = handle;
      mdSuggestedFilename = file.name || 'document.md';
      syncMdSaveButton();
      renderMarkdown();
      return;
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return;
    /* fall through to legacy file input */
  }
  el.fileMd?.click();
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
    headerScale: clampLogoScale(el.inputLogoHeaderScale?.valueAsNumber ?? 100),
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

/** Flex justification for header logo strip only */
const LOGO_JUSTIFY = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  none: 'justify-start',
};

/** `whitespace-pre-line` keeps line breaks from the textarea; long lines still wrap. */
const DISCLAIMER_BODY_CLASS = 'text-xs leading-relaxed text-slate-600 whitespace-pre-line';

function applyLogoBranding() {
  const srcH = getLogoSrcForSlot('header');
  const layout = readLogoLayoutFromForm();

  const showHeader = Boolean(srcH) && layout.headerPlacement !== 'none';

  if (srcH) {
    el.brandLogoHeaderImg.src = srcH;
  } else {
    el.brandLogoHeaderImg.removeAttribute('src');
  }

  el.brandHeader.classList.toggle('hidden', !showHeader);

  const hj = LOGO_JUSTIFY[layout.headerPlacement] ?? 'justify-start';
  if (el.brandHeaderInner) el.brandHeaderInner.className = `flex w-full ${hj}`;

  const hs = layout.headerPlacement === 'none' ? 100 : layout.headerScale;
  if (el.brandLogoHeaderImg) {
    el.brandLogoHeaderImg.style.width = showHeader ? `${hs}%` : '';
    el.brandLogoHeaderImg.style.height = 'auto';
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
  const stepPx = getUsableHeightPx(paper);
  root.style.setProperty('--m2pdf-guide-step', `${stepPx}px`);
  const on = Boolean(el.pageGuideEnabled?.checked);
  overlay.classList.toggle('hidden', !on);
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
}

el.textareaMd.addEventListener('input', () => {
  renderMarkdownDebounced();
});

el.btnOpenMd?.addEventListener('click', () => {
  openMdViaFilePicker();
});

el.fileMd.addEventListener('change', () => {
  const file = el.fileMd.files?.[0];
  if (!file) return;
  if (rejectOversizeMdFile(file)) {
    el.fileMd.value = '';
    return;
  }
  mdFileHandle = null;
  mdSuggestedFilename = file.name || 'document.md';
  syncMdSaveButton();
  const reader = new FileReader();
  reader.onload = () => {
    el.textareaMd.value = typeof reader.result === 'string' ? reader.result : '';
    renderMarkdown();
  };
  reader.readAsText(file, 'UTF-8');
  el.fileMd.value = '';
});

el.btnClear.addEventListener('click', () => {
  el.textareaMd.value = '';
  mdFileHandle = null;
  mdSuggestedFilename = 'document.md';
  syncMdSaveButton();
  renderMarkdown();
});

el.btnSaveMd?.addEventListener('click', () => {
  saveMdOverwrite();
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

el.btnPrint.addEventListener('click', () => {
  window.print();
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
    else if (action === 'link') insertLink(ta);
    else if (action === 'quote') insertBlockquote(ta);
    else if (action === 'code') insertInlineCode(ta);
    else if (action === 'hr') insertHorizontalRule(ta);
    renderMarkdown();
  });
}

initFromStorage();
initSidebarResize();
initMdToolbar();
renderMarkdown();
