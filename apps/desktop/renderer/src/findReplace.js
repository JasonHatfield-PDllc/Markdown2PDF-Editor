/**
 * Notepad-style Find / Replace — modeless bars; edit while searching.
 */

import {
  clearEditorFindHighlights,
  paintEditorFindHighlights,
  scrollTextareaToOffset,
  syncEditorFindScroll,
} from './findEditorOverlay.js';
import { clearPreviewFindHighlights, countPreviewMatches, findInPreview } from './findPreview.js';

/** @typedef {'editor' | 'preview' | 'both'} FindScope */

/**
 * Source highlight policy (see docs/DESKTOP-EVALUATION-2026-11-12.md).
 * - `active-only`: one mark on the current match (stable, fast)
 * - `all`: every match up to overlay cap (heavy on large docs)
 * - `off`: native selection only
 * @type {'active-only' | 'all' | 'off'}
 */
const SOURCE_FIND_PAINT_MODE = 'active-only';

/**
 * @param {HTMLTextAreaElement | null | undefined} ta
 * @param {string} q
 * @param {boolean} matchCase
 * @param {number} activeStart
 */
function paintSourceFind(ta, q, matchCase, activeStart, opts = {}) {
  if (!ta || !q) return;
  if (SOURCE_FIND_PAINT_MODE === 'off' || activeStart < 0) {
    clearEditorFindHighlights(ta);
    return;
  }
  if (opts.commit !== false) {
    lastCommittedFindStart = activeStart;
    lastCommittedFindQuery = q;
    lastMatchCase = matchCase;
  }
  if (SOURCE_FIND_PAINT_MODE === 'active-only') {
    paintEditorFindHighlights(ta, q, matchCase, activeStart, {
      matchStarts: [activeStart],
      maxMatches: 1,
    });
    return;
  }
  paintEditorFindHighlights(ta, q, matchCase, activeStart);
}

function clearCommittedFindAnchor() {
  lastCommittedFindStart = -1;
  lastCommittedFindQuery = '';
}

/**
 * @param {HTMLTextAreaElement | null | undefined} ta
 * @param {string} q
 * @param {boolean} matchCase
 * @param {number} activeStart
 * @returns {string}
 */
function editorMatchStatus(ta, q, matchCase, activeStart) {
  if (!ta || !q || activeStart < 0) return '';
  const starts = listEditorMatchStarts(ta, q, matchCase);
  if (!starts.length) return '';
  const idx = starts.indexOf(activeStart);
  const n = idx >= 0 ? idx + 1 : 1;
  return `Match ${n} of ${starts.length}`;
}

/** @type {string} */
const FIND_IDLE_HINT = 'Type a term, then Find or Enter (F3 for next match).';

/** False = focus Source so native selection shows the match (Notepad / VS Code pattern). */
function keepFindBarFocusAfterMatch() {
  return false;
}

function syncFindBarOpenClass() {
  const fb = document.getElementById('find-bar');
  const rb = document.getElementById('replace-bar');
  const open =
    (fb && !fb.classList.contains('hidden')) || (rb && !rb.classList.contains('hidden'));
  document.body.classList.toggle('m2pdf-find-bar-open', Boolean(open));
}

/** @type {string} */
let lastQuery = '';

/** @type {boolean} */
let lastMatchCase = false;

/** @type {FindScope} */
let lastSearchScope = 'editor';

/** Last match index committed by Find / F3 (not caret heuristics while typing). */
let lastCommittedFindStart = -1;
/** @type {string} */
let lastCommittedFindQuery = '';

/** Index for preview-only navigation. */
let previewMatchIndex = -1;

/** Flat index across source matches then preview matches (both mode). */
let bothFlatIndex = -1;

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} query
 * @param {boolean} matchCase
 * @returns {number[]}
 */
function listEditorMatchStarts(ta, query, matchCase) {
  const q = query ?? '';
  if (!ta || !q) return [];
  const text = ta.value;
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();
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
 * @param {number} start
 * @param {number} end
 */
function selectRange(ta, start, end, opts = {}) {
  const prev = document.activeElement;
  // Focus textarea so setSelectionRange + scroll apply; restore Find bar focus after if needed.
  ta.focus();
  ta.setSelectionRange(start, end);
  scrollTextareaToOffset(ta, start);
  if (opts.keepFocus && prev instanceof HTMLElement && prev !== ta) {
    prev.focus({ preventScroll: true });
  }
  requestAnimationFrame(() => {
    scrollTextareaToOffset(ta, start);
    syncEditorFindScroll(ta);
  });
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} q
 * @param {boolean} matchCase
 * @returns {number}
 */
function resolveEditorActiveMatchStart(ta, q, matchCase) {
  const starts = listEditorMatchStarts(ta, q, matchCase);
  if (!starts.length) return -1;
  const { selectionStart, selectionEnd } = ta;
  if (selectionEnd > selectionStart) {
    const inSel = starts.find((s) => s >= selectionStart && s + q.length <= selectionEnd);
    if (inSel !== undefined) return inSel;
  }
  const atCaret = starts.find((s) => selectionStart >= s && selectionStart <= s + q.length);
  if (atCaret !== undefined) return atCaret;
  const after = starts.find((s) => s >= selectionStart);
  return after ?? starts[starts.length - 1];
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} query
 * @param {{ matchCase?: boolean, reverse?: boolean, fromSelection?: boolean, keepFocus?: boolean, paint?: boolean }} [opts]
 * @returns {boolean}
 */
export function findInEditor(ta, query, opts = {}) {
  const q = query ?? '';
  if (!ta || !q) return false;

  const matchCase = Boolean(opts.matchCase);
  const reverse = Boolean(opts.reverse);
  const keepFocus = Boolean(opts.keepFocus);
  const text = ta.value;
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();

  let from;
  if (opts.fromSelection === false) {
    from = reverse ? text.length : 0;
  } else if (reverse) {
    from = Math.max(0, ta.selectionStart - 1);
  } else {
    from = ta.selectionEnd;
  }

  let idx = reverse ? hay.lastIndexOf(needle, from) : hay.indexOf(needle, from);

  if (idx < 0) {
    idx = reverse ? hay.lastIndexOf(needle) : hay.indexOf(needle);
    if (idx < 0) {
      if (opts.paint !== false) clearEditorFindHighlights(ta);
      return false;
    }
  }

  lastQuery = q;
  lastMatchCase = matchCase;
  selectRange(ta, idx, idx + q.length, { keepFocus });
  if (opts.paint !== false) {
    paintSourceFind(ta, q, matchCase, idx);
    requestAnimationFrame(() => {
      scrollTextareaToOffset(ta, idx);
      syncEditorFindScroll(ta);
    });
  }
  return true;
}

export function replaceInEditor(ta, query, replacement, opts = {}) {
  const q = query ?? '';
  if (!ta || !q) return 'not-found';

  const matchCase = Boolean(opts.matchCase);
  const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  const matches = matchCase ? selected === q : selected.toLowerCase() === q.toLowerCase();

  if (matches && ta.selectionStart !== ta.selectionEnd) {
    const start = ta.selectionStart;
    ta.setRangeText(replacement, start, ta.selectionEnd, 'end');
    lastQuery = q;
    lastMatchCase = matchCase;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'replaced';
  }

  if (!findInEditor(ta, q, { matchCase, reverse: false })) return 'not-found';
  const start = ta.selectionStart;
  ta.setRangeText(replacement, start, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'replaced';
}

export function replaceAllInEditor(ta, query, replacement, opts = {}) {
  const q = query ?? '';
  if (!ta || !q) return 0;

  const matchCase = Boolean(opts.matchCase);
  const text = ta.value;
  if (matchCase) {
    if (!text.includes(q)) return 0;
    let count = 0;
    let i = 0;
    let out = '';
    while (i < text.length) {
      const idx = text.indexOf(q, i);
      if (idx < 0) {
        out += text.slice(i);
        break;
      }
      out += text.slice(i, idx) + replacement;
      i = idx + q.length;
      count += 1;
    }
    ta.value = out;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    lastQuery = q;
    lastMatchCase = matchCase;
    return count;
  }

  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!hay.includes(needle)) return 0;
  let count = 0;
  let i = 0;
  let out = '';
  while (i < text.length) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, idx) + replacement;
    i = idx + q.length;
    count += 1;
  }
  ta.value = out;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  lastQuery = q;
  lastMatchCase = matchCase;
  return count;
}

export function getLastFindState() {
  return { query: lastQuery, matchCase: lastMatchCase, scope: lastSearchScope };
}

/**
 * @param {{
 *   getTextarea: () => HTMLTextAreaElement | null,
 *   getPreviewRoot?: () => HTMLElement | null,
 *   onPreviewFindResult?: (info: { query: string, matchCount: number, activeIndex: number }) => void,
 *   getDefaultSearchTarget?: () => 'editor' | 'preview',
 *   sourceFindOnly?: boolean,
 * }} api
 */
export function initFindReplaceUi(api) {
  const findBar = document.getElementById('find-bar');
  const replaceBar = document.getElementById('replace-bar');
  if (!findBar || !replaceBar) return;

  const findInput = /** @type {HTMLInputElement} */ (document.getElementById('find-query'));
  const findMatchCase = /** @type {HTMLInputElement} */ (document.getElementById('find-match-case'));
  const findScope = /** @type {HTMLSelectElement} */ (document.getElementById('find-scope'));
  const findStatus = document.getElementById('find-status');

  const replaceFindInput = /** @type {HTMLInputElement} */ (
    document.getElementById('replace-query')
  );
  const replaceWithInput = /** @type {HTMLInputElement} */ (
    document.getElementById('replace-with')
  );
  const replaceMatchCase = /** @type {HTMLInputElement} */ (
    document.getElementById('replace-match-case')
  );
  const replaceScope = /** @type {HTMLSelectElement} */ (document.getElementById('replace-scope'));
  const replaceStatus = document.getElementById('replace-status');

  const sourceFindOnly = Boolean(api.sourceFindOnly);
  if (sourceFindOnly) {
    document.body.classList.add('m2pdf-source-find-only');
    for (const sel of [findScope, replaceScope]) {
      if (sel) sel.value = 'editor';
    }
  }

  const isFindOpen = () => !findBar.classList.contains('hidden');
  const isReplaceOpen = () => !replaceBar.classList.contains('hidden');
  const isAnyFindUiOpen = () => isFindOpen() || isReplaceOpen;

  /** @returns {FindScope} */
  function readScopeFromFindUi() {
    if (sourceFindOnly) return 'editor';
    const v = findScope?.value;
    if (v === 'preview' || v === 'both') return v;
    return 'editor';
  }

  /** @returns {FindScope} */
  function readScopeFromReplaceUi() {
    if (sourceFindOnly) return 'editor';
    const v = replaceScope?.value;
    if (v === 'preview' || v === 'both') return v;
    return 'editor';
  }

  /** @returns {FindScope} */
  function resolveScope() {
    if (isFindOpen()) return readScopeFromFindUi();
    if (isReplaceOpen()) return readScopeFromReplaceUi();
    return lastSearchScope;
  }

  /** @param {FindScope} scope */
  function setScopeOnBothSelects(scope) {
    const v = scope === 'preview' || scope === 'both' ? scope : 'editor';
    if (findScope) findScope.value = v;
    if (replaceScope) replaceScope.value = v;
  }

  /** @param {'editor' | 'preview'} pane */
  function defaultScopeFromPane(pane) {
    return pane === 'preview' ? 'preview' : 'editor';
  }

  function setStatus(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('text-amber-700', isError);
    el.classList.toggle('text-slate-500', !isError);
  }

  function syncFromLast(intoFind) {
    const { query, matchCase, scope } = getLastFindState();
    if (intoFind) {
      if (findInput && query) findInput.value = query;
      if (findMatchCase) findMatchCase.checked = matchCase;
      setScopeOnBothSelects(scope);
    } else {
      if (replaceFindInput && query) replaceFindInput.value = query;
      if (replaceMatchCase) replaceMatchCase.checked = matchCase;
      setScopeOnBothSelects(scope);
    }
  }

  function closeFindBar() {
    findBar.classList.add('hidden');
    syncFindBarOpenClass();
    clearCommittedFindAnchor();
    clearEditorFindHighlights(api.getTextarea());
    if (!isReplaceOpen()) clearPreviewFindHighlights();
  }

  function closeReplaceBar() {
    replaceBar.classList.add('hidden');
    syncFindBarOpenClass();
    clearCommittedFindAnchor();
    clearEditorFindHighlights(api.getTextarea());
    if (!isFindOpen()) clearPreviewFindHighlights();
  }

  /**
   * @param {string} q
   * @param {boolean} matchCase
   * @param {FindScope} scope
   * @param {number} editorActive
   * @param {number} previewActive
   */
  function paintForScope(q, matchCase, scope, editorActive, previewActive) {
    const ta = api.getTextarea();
    const root = api.getPreviewRoot?.();

    if (scope === 'editor' || scope === 'both') {
      if (ta && q) paintSourceFind(ta, q, matchCase, editorActive);
      else clearEditorFindHighlights(ta);
    } else {
      clearEditorFindHighlights(ta);
    }

    if (scope === 'preview' || scope === 'both') {
      if (root && q) {
        findInPreview(root, q, { matchCase, matchIndex: Math.max(0, previewActive) });
        const matchCount = countPreviewMatches(root, q, matchCase);
        api.onPreviewFindResult?.({
          query: q,
          matchCount,
          activeIndex: Math.max(0, previewActive),
        });
      } else {
        clearPreviewFindHighlights();
        api.onPreviewFindResult?.({ query: q, matchCount: 0, activeIndex: -1 });
      }
    } else {
      clearPreviewFindHighlights();
    }
  }

  /**
   * @param {string} q
   * @param {boolean} matchCase
   * @param {FindScope} scope
   * @param {boolean} reverse
   */
  function runBothModeFind(q, matchCase, reverse) {
    const ta = api.getTextarea();
    const root = api.getPreviewRoot?.();
    if (!ta || !q) return false;

    const editorStarts = listEditorMatchStarts(ta, q, matchCase);
    const previewCount = root ? countPreviewMatches(root, q, matchCase) : 0;
    const total = editorStarts.length + previewCount;
    if (!total) {
      clearEditorFindHighlights(ta);
      clearPreviewFindHighlights();
      return false;
    }

    if (bothFlatIndex < 0) bothFlatIndex = reverse ? total - 1 : 0;
    else if (reverse) bothFlatIndex -= 1;
    else bothFlatIndex += 1;

    while (bothFlatIndex < 0) bothFlatIndex += total;
    bothFlatIndex %= total;

    lastQuery = q;
    lastMatchCase = matchCase;
    lastSearchScope = 'both';

    if (bothFlatIndex < editorStarts.length) {
      const start = editorStarts[bothFlatIndex];
      selectRange(ta, start, start + q.length, { keepFocus: keepFindBarFocusAfterMatch() });
      paintSourceFind(ta, q, matchCase, start);
      if (root && previewCount) {
        findInPreview(root, q, { matchCase, matchIndex: 0 });
      } else {
        clearPreviewFindHighlights();
      }
    } else {
      const pIdx = bothFlatIndex - editorStarts.length;
      previewMatchIndex = pIdx;
      if (editorStarts.length) {
        paintSourceFind(ta, q, matchCase, editorStarts[0]);
      } else {
        clearEditorFindHighlights(ta);
      }
      if (root) findInPreview(root, q, { matchCase, matchIndex: pIdx });
    }
    return true;
  }

  /**
   * @param {string} q
   * @param {boolean} matchCase
   * @param {boolean} reverse
   * @param {FindScope} scope
   */
  function runFindOnScope(q, matchCase, reverse, scope) {
    const effectiveScope = sourceFindOnly ? 'editor' : scope;
    lastSearchScope = effectiveScope;
    lastQuery = q;
    lastMatchCase = matchCase;

    if (!q) {
      clearEditorFindHighlights(api.getTextarea());
      clearPreviewFindHighlights();
      return false;
    }

    if (effectiveScope === 'both') {
      return runBothModeFind(q, matchCase, reverse);
    }

    bothFlatIndex = -1;

    if (effectiveScope === 'preview') {
      const root = api.getPreviewRoot?.();
      if (!root) return false;
      clearEditorFindHighlights(api.getTextarea());
      if (reverse) previewMatchIndex -= 1;
      else previewMatchIndex = previewMatchIndex < 0 ? 0 : previewMatchIndex + 1;
      const ok = findInPreview(root, q, {
        matchCase,
        reverse,
        matchIndex: previewMatchIndex,
      });
      if (!ok) previewMatchIndex = -1;
      const matchCount = countPreviewMatches(root, q, matchCase);
      api.onPreviewFindResult?.({
        query: q,
        matchCount,
        activeIndex: ok ? Math.max(0, previewMatchIndex) : -1,
      });
      return ok;
    }

    previewMatchIndex = -1;
    clearPreviewFindHighlights();
    const ta = api.getTextarea();
    if (!ta) return false;
    return findInEditor(ta, q, {
      matchCase,
      reverse,
      keepFocus: keepFindBarFocusAfterMatch(),
    });
  }

  /**
   * @param {HTMLTextAreaElement} ta
   * @param {string} q
   * @param {boolean} matchCase
   */
  function refreshEditorFindActive(ta, q, matchCase) {
    if (!q) {
      clearEditorFindHighlights(ta);
      return;
    }
    const findHasFocus =
      document.activeElement === findInput || document.activeElement === replaceFindInput;
    if (findHasFocus) {
      /* Typing a query — do not measure/paint until Find or F3. */
      return;
    }
    if (
      lastCommittedFindStart >= 0 &&
      lastCommittedFindQuery === q &&
      lastMatchCase === matchCase
    ) {
      paintSourceFind(ta, q, matchCase, lastCommittedFindStart, { commit: false });
      syncEditorFindScroll(ta);
      return;
    }
    const active = resolveEditorActiveMatchStart(ta, q, matchCase);
    if (active < 0) clearEditorFindHighlights(ta);
    else paintSourceFind(ta, q, matchCase, active);
  }

  /** Reposition highlight after Source edit without jumping to another match. */
  function onSourceEditWhileFindOpen() {
    const ta = api.getTextarea();
    if (!ta || !isAnyFindUiOpen()) return;
    const q = isFindOpen()
      ? (findInput?.value ?? '')
      : (replaceFindInput?.value ?? '');
    const matchCase = isFindOpen()
      ? Boolean(findMatchCase?.checked)
      : Boolean(replaceMatchCase?.checked);
    if (
      !q ||
      q !== lastCommittedFindQuery ||
      lastCommittedFindStart < 0 ||
      matchCase !== lastMatchCase
    ) {
      return;
    }
    const hay = matchCase ? ta.value : ta.value.toLowerCase();
    const needle = matchCase ? q : q.toLowerCase();
    const slice = hay.slice(
      lastCommittedFindStart,
      lastCommittedFindStart + needle.length,
    );
    if (slice !== needle) {
      return;
    }
    paintSourceFind(ta, q, matchCase, lastCommittedFindStart, { commit: false });
    syncEditorFindScroll(ta);
  }

  function refreshFindHighlightsFromDialog() {
    if (!isAnyFindUiOpen()) return;

    const scope = isFindOpen() ? readScopeFromFindUi() : readScopeFromReplaceUi();
    const q = isFindOpen() ? (findInput?.value ?? '') : (replaceFindInput?.value ?? '');
    const matchCase = isFindOpen()
      ? Boolean(findMatchCase?.checked)
      : Boolean(replaceMatchCase?.checked);

    if (!q) {
      clearEditorFindHighlights(api.getTextarea());
      clearPreviewFindHighlights();
      return;
    }

    if (sourceFindOnly || scope === 'editor') {
      clearPreviewFindHighlights();
      const ta = api.getTextarea();
      if (!ta) return;
      refreshEditorFindActive(ta, q, matchCase);
      return;
    }

    if (scope === 'both') {
      const ta = api.getTextarea();
      const root = api.getPreviewRoot?.();
      const editorStarts = ta ? listEditorMatchStarts(ta, q, matchCase) : [];
      if (editorStarts.length && ta) {
        selectRange(ta, editorStarts[0], editorStarts[0] + q.length, { keepFocus: true });
        paintForScope(q, matchCase, 'both', editorStarts[0], 0);
      } else if (root && countPreviewMatches(root, q, matchCase)) {
        findInPreview(root, q, { matchCase, matchIndex: 0 });
        clearEditorFindHighlights(ta);
      }
      return;
    }

    if (scope === 'preview') {
      clearEditorFindHighlights(api.getTextarea());
      const root = api.getPreviewRoot?.();
      if (root) findInPreview(root, q, { matchCase, matchIndex: 0 });
      return;
    }

  }

  function openFind() {
    closeReplaceBar();
    syncFromLast(true);
    previewMatchIndex = -1;
    bothFlatIndex = -1;
    if (sourceFindOnly) {
      setScopeOnBothSelects('editor');
      lastSearchScope = 'editor';
    } else {
      const pane = api.getDefaultSearchTarget?.() ?? 'editor';
      if (lastSearchScope === 'editor' && pane === 'preview') {
        setScopeOnBothSelects('preview');
      } else if (lastSearchScope === 'editor') {
        setScopeOnBothSelects(defaultScopeFromPane(pane));
      }
    }
    const ta = api.getTextarea();
    const sel = ta?.value.slice(ta.selectionStart, ta.selectionEnd) ?? '';
    const scope = readScopeFromFindUi();
    if (sel && !sel.includes('\n') && findInput && (scope === 'editor' || scope === 'both')) {
      findInput.value = sel;
    }
    setStatus(findStatus, sourceFindOnly ? FIND_IDLE_HINT : '', false);
    findBar.classList.remove('hidden');
    syncFindBarOpenClass();
    findInput?.focus();
    findInput?.select();
    refreshFindHighlightsFromDialog();
  }

  function openReplace() {
    closeFindBar();
    syncFromLast(false);
    previewMatchIndex = -1;
    bothFlatIndex = -1;
    if (sourceFindOnly) {
      setScopeOnBothSelects('editor');
      lastSearchScope = 'editor';
    }
    const ta = api.getTextarea();
    const sel = ta?.value.slice(ta.selectionStart, ta.selectionEnd) ?? '';
    if (sel && !sel.includes('\n') && replaceFindInput) replaceFindInput.value = sel;
    setStatus(replaceStatus, '');
    replaceBar.classList.remove('hidden');
    syncFindBarOpenClass();
    replaceFindInput?.focus();
    replaceFindInput?.select();
    refreshFindHighlightsFromDialog();
  }

  /**
   * @param {boolean} ok
   * @param {string} q
   * @param {boolean} matchCase
   */
  function reportSourceFindToUi(ok, q, matchCase) {
    const ta = api.getTextarea();
    const idx = ta?.selectionStart ?? -1;
    if (isFindOpen() && findStatus) {
      setStatus(
        findStatus,
        ok ? editorMatchStatus(ta, q, matchCase, idx) || FIND_IDLE_HINT : `Cannot find "${q}"`,
        !ok,
      );
    }
    if (ok && ta && q && idx >= 0 && (sourceFindOnly || resolveScope() === 'editor')) {
      paintSourceFind(ta, q, matchCase, idx);
      scrollTextareaToOffset(ta, idx);
    }
  }

  function runFind(reverse) {
    const q = findInput?.value ?? '';
    const matchCase = Boolean(findMatchCase?.checked);
    const scope = readScopeFromFindUi();
    if (scope !== 'both' && scope !== 'preview') previewMatchIndex = -1;
    if (scope !== 'both') bothFlatIndex = -1;
    if (scope === 'preview') {
      if (reverse) previewMatchIndex -= 1;
      else previewMatchIndex = previewMatchIndex < 0 ? 0 : previewMatchIndex + 1;
    }
    const ok = runFindOnScope(q, matchCase, reverse, scope);
    if (!ok) {
      previewMatchIndex = -1;
      bothFlatIndex = -1;
      if (scope === 'editor' || scope === 'both') clearEditorFindHighlights(api.getTextarea());
    }
    if (scope === 'editor' || scope === 'both' || sourceFindOnly) {
      reportSourceFindToUi(ok, q, matchCase);
    } else if (!ok) {
      setStatus(findStatus, `Cannot find "${q}"`, true);
    } else {
      setStatus(findStatus, '', false);
    }
  }

  function runReplaceFind(reverse) {
    const q = replaceFindInput?.value ?? '';
    const matchCase = Boolean(replaceMatchCase?.checked);
    const scope = readScopeFromReplaceUi();
    if (scope === 'both') {
      const ok = runBothModeFind(q, matchCase, reverse);
      setStatus(replaceStatus, ok ? '' : `Cannot find "${q}"`, !ok);
      return;
    }
    if (scope === 'preview') {
      if (reverse) previewMatchIndex -= 1;
      else previewMatchIndex = previewMatchIndex < 0 ? 0 : previewMatchIndex + 1;
      const root = api.getPreviewRoot?.();
      const ok = root
        ? findInPreview(root, q, { matchCase, reverse, matchIndex: previewMatchIndex })
        : false;
      setStatus(replaceStatus, ok ? '' : `Cannot find "${q}"`, !ok);
      return;
    }
    const ta = api.getTextarea();
    if (!ta) return;
    const ok = findInEditor(ta, q, { matchCase, reverse, keepFocus: keepFindBarFocusAfterMatch() });
    const idx = ta.selectionStart ?? -1;
    setStatus(
      replaceStatus,
      ok ? editorMatchStatus(ta, q, matchCase, idx) : `Cannot find "${q}"`,
      !ok,
    );
  }

  document.getElementById('find-go')?.addEventListener('click', () => {
    bothFlatIndex = -1;
    previewMatchIndex = -1;
    runFind(false);
  });
  document.getElementById('find-next')?.addEventListener('click', () => runFind(false));
  document.getElementById('find-prev')?.addEventListener('click', () => runFind(true));
  document.getElementById('find-close')?.addEventListener('click', () => closeFindBar());

  document.getElementById('replace-find-next')?.addEventListener('click', () => runReplaceFind(false));
  document.getElementById('replace-one')?.addEventListener('click', () => {
    const ta = api.getTextarea();
    if (!ta) return;
    const q = replaceFindInput?.value ?? '';
    const result = replaceInEditor(ta, q, replaceWithInput?.value ?? '', {
      matchCase: replaceMatchCase?.checked,
    });
    setStatus(
      replaceStatus,
      result === 'replaced' ? '' : `Cannot find "${q}"`,
      result !== 'replaced',
    );
    refreshFindHighlightsFromDialog();
  });
  document.getElementById('replace-all')?.addEventListener('click', () => {
    const ta = api.getTextarea();
    if (!ta) return;
    const q = replaceFindInput?.value ?? '';
    const n = replaceAllInEditor(ta, q, replaceWithInput?.value ?? '', {
      matchCase: replaceMatchCase?.checked,
    });
    setStatus(
      replaceStatus,
      n === 0 ? `Cannot find "${q}"` : `Replaced ${n} occurrence${n === 1 ? '' : 's'}.`,
      n === 0,
    );
    refreshFindHighlightsFromDialog();
  });
  document.getElementById('replace-close')?.addEventListener('click', () => closeReplaceBar());

  findInput?.addEventListener('input', () => {
    if (!(findInput?.value ?? '').trim()) refreshFindHighlightsFromDialog();
  });
  replaceFindInput?.addEventListener('input', () => {
    if (!(replaceFindInput?.value ?? '').trim()) refreshFindHighlightsFromDialog();
  });
  findMatchCase?.addEventListener('change', () => refreshFindHighlightsFromDialog());
  replaceMatchCase?.addEventListener('change', () => refreshFindHighlightsFromDialog());
  findScope?.addEventListener('change', () => {
    previewMatchIndex = -1;
    bothFlatIndex = -1;
    if (replaceScope) replaceScope.value = findScope.value;
    refreshFindHighlightsFromDialog();
  });
  replaceScope?.addEventListener('change', () => {
    previewMatchIndex = -1;
    bothFlatIndex = -1;
    if (findScope) findScope.value = replaceScope.value;
    refreshFindHighlightsFromDialog();
  });

  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bothFlatIndex = -1;
      previewMatchIndex = -1;
      runFind(e.shiftKey);
    }
  });

  replaceFindInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runReplaceFind(e.shiftKey);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isFindOpen()) closeFindBar();
    else if (isReplaceOpen()) closeReplaceBar();
  });

  return {
    openFind,
    openReplace,
    findNext() {
      const { query, matchCase, scope } = getLastFindState();
      const q = query || findInput?.value || replaceFindInput?.value || '';
      if (!q) {
        openFind();
        return;
      }
      const s = scope || resolveScope();
      if (s === 'preview') previewMatchIndex += 1;
      else if (s === 'both') bothFlatIndex = bothFlatIndex < 0 ? 0 : bothFlatIndex + 1;
      const ok = runFindOnScope(q, matchCase, false, s);
      if (!ok) {
        previewMatchIndex = -1;
        bothFlatIndex = -1;
        if (isFindOpen()) setStatus(findStatus, `Cannot find "${q}"`, true);
      } else if (s === 'editor' || sourceFindOnly) {
        reportSourceFindToUi(true, q, matchCase);
      }
    },
    findPrevious() {
      const { query, matchCase, scope } = getLastFindState();
      const q = query || findInput?.value || replaceFindInput?.value || '';
      if (!q) {
        openFind();
        return;
      }
      const s = scope || resolveScope();
      if (s === 'preview') previewMatchIndex -= 1;
      else if (s === 'both') bothFlatIndex = bothFlatIndex < 0 ? 0 : bothFlatIndex - 1;
      const ok = runFindOnScope(q, matchCase, true, s);
      if (!ok) {
        previewMatchIndex = -1;
        bothFlatIndex = -1;
        if (isFindOpen()) setStatus(findStatus, `Cannot find "${q}"`, true);
      } else if (s === 'editor' || sourceFindOnly) {
        reportSourceFindToUi(true, q, matchCase);
      }
    },
    clearPreviewHighlights: clearPreviewFindHighlights,
    clearEditorHighlights: () => clearEditorFindHighlights(api.getTextarea()),
    refreshOpenFind: () => refreshFindHighlightsFromDialog(),
    isFindUiOpen: () => isAnyFindUiOpen(),
    onSourceInput() {
      if (isAnyFindUiOpen()) onSourceEditWhileFindOpen();
      else {
        clearCommittedFindAnchor();
        clearEditorFindHighlights(api.getTextarea());
        clearPreviewFindHighlights();
      }
    },
  };
}
