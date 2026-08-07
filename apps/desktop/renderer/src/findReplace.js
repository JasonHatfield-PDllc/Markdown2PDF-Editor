/**
 * Notepad-style Find / Replace for the Markdown editor textarea (desktop).
 */

/** @type {string} */
let lastQuery = '';

/** @type {boolean} */
let lastMatchCase = false;

/**
 * @param {HTMLTextAreaElement} ta
 * @param {number} start
 * @param {number} end
 */
function selectRange(ta, start, end) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // Approximate scroll-into-view for the caret line.
  const before = ta.value.slice(0, start);
  const lineIndex = before.split('\n').length - 1;
  const styles = window.getComputedStyle(ta);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const target = paddingTop + lineIndex * lineHeight - ta.clientHeight / 3;
  ta.scrollTop = Math.max(0, target);
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} query
 * @param {{ matchCase?: boolean, reverse?: boolean, fromSelection?: boolean }} [opts]
 * @returns {boolean} true if a match was selected
 */
export function findInEditor(ta, query, opts = {}) {
  const q = query ?? '';
  if (!ta || !q) return false;

  const matchCase = Boolean(opts.matchCase);
  const reverse = Boolean(opts.reverse);
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

  // Wrap around (Notepad-style).
  if (idx < 0) {
    idx = reverse ? hay.lastIndexOf(needle) : hay.indexOf(needle);
    if (idx < 0) return false;
    // Avoid false "success" if we only re-selected the same match mid-search without wrap sense —
    // wrap is intentional; notify caller via return true.
  }

  lastQuery = q;
  lastMatchCase = matchCase;
  selectRange(ta, idx, idx + q.length);
  return true;
}

/**
 * Replace current selection if it matches query; otherwise Find Next then replace if found.
 * @param {HTMLTextAreaElement} ta
 * @param {string} query
 * @param {string} replacement
 * @param {{ matchCase?: boolean }} [opts]
 * @returns {'replaced' | 'not-found'}
 */
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
  const end = ta.selectionEnd;
  ta.setRangeText(replacement, start, end, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'replaced';
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} query
 * @param {string} replacement
 * @param {{ matchCase?: boolean }} [opts]
 * @returns {number} count replaced
 */
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
  return { query: lastQuery, matchCase: lastMatchCase };
}

/**
 * @param {{ getTextarea: () => HTMLTextAreaElement | null }} api
 */
export function initFindReplaceUi(api) {
  const findDlg = /** @type {HTMLDialogElement | null} */ (document.getElementById('dlg-find'));
  const replaceDlg = /** @type {HTMLDialogElement | null} */ (
    document.getElementById('dlg-replace')
  );
  if (!findDlg || !replaceDlg) return;

  const findInput = /** @type {HTMLInputElement} */ (document.getElementById('find-query'));
  const findMatchCase = /** @type {HTMLInputElement} */ (document.getElementById('find-match-case'));
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
  const replaceStatus = document.getElementById('replace-status');

  /**
   * @param {HTMLElement | null} el
   * @param {string} msg
   * @param {boolean} [isError]
   */
  function setStatus(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('text-amber-700', isError);
    el.classList.toggle('text-slate-500', !isError);
  }

  function syncFromLast(intoFind) {
    const { query, matchCase } = getLastFindState();
    if (intoFind) {
      if (findInput && query) findInput.value = query;
      if (findMatchCase) findMatchCase.checked = matchCase;
    } else {
      if (replaceFindInput && query) replaceFindInput.value = query;
      if (replaceMatchCase) replaceMatchCase.checked = matchCase;
    }
  }

  function openFind() {
    if (replaceDlg.open) replaceDlg.close();
    syncFromLast(true);
    const ta = api.getTextarea();
    const sel = ta?.value.slice(ta.selectionStart, ta.selectionEnd) ?? '';
    if (sel && !sel.includes('\n') && findInput) findInput.value = sel;
    setStatus(findStatus, '');
    findDlg.showModal();
    findInput?.focus();
    findInput?.select();
  }

  function openReplace() {
    if (findDlg.open) findDlg.close();
    syncFromLast(false);
    const ta = api.getTextarea();
    const sel = ta?.value.slice(ta.selectionStart, ta.selectionEnd) ?? '';
    if (sel && !sel.includes('\n') && replaceFindInput) replaceFindInput.value = sel;
    setStatus(replaceStatus, '');
    replaceDlg.showModal();
    replaceFindInput?.focus();
    replaceFindInput?.select();
  }

  function runFind(reverse) {
    const ta = api.getTextarea();
    if (!ta) return;
    const q = findInput?.value ?? '';
    const ok = findInEditor(ta, q, {
      matchCase: findMatchCase?.checked,
      reverse,
    });
    setStatus(findStatus, ok ? '' : `Cannot find "${q}"`, !ok);
  }

  function runReplaceFind(reverse) {
    const ta = api.getTextarea();
    if (!ta) return;
    const q = replaceFindInput?.value ?? '';
    const ok = findInEditor(ta, q, {
      matchCase: replaceMatchCase?.checked,
      reverse,
    });
    setStatus(replaceStatus, ok ? '' : `Cannot find "${q}"`, !ok);
  }

  document.getElementById('find-next')?.addEventListener('click', () => runFind(false));
  document.getElementById('find-prev')?.addEventListener('click', () => runFind(true));
  document.getElementById('find-close')?.addEventListener('click', () => findDlg.close());

  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(e.shiftKey);
    }
  });

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
  });
  document.getElementById('replace-close')?.addEventListener('click', () => replaceDlg.close());

  replaceFindInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runReplaceFind(e.shiftKey);
    }
  });

  return {
    openFind,
    openReplace,
    findNext() {
      const ta = api.getTextarea();
      if (!ta) return;
      const { query, matchCase } = getLastFindState();
      const q = query || findInput?.value || replaceFindInput?.value || '';
      if (!q) {
        openFind();
        return;
      }
      const ok = findInEditor(ta, q, { matchCase, reverse: false });
      if (!ok && findDlg.open) setStatus(findStatus, `Cannot find "${q}"`, true);
    },
    findPrevious() {
      const ta = api.getTextarea();
      if (!ta) return;
      const { query, matchCase } = getLastFindState();
      const q = query || findInput?.value || replaceFindInput?.value || '';
      if (!q) {
        openFind();
        return;
      }
      const ok = findInEditor(ta, q, { matchCase, reverse: true });
      if (!ok && findDlg.open) setStatus(findStatus, `Cannot find "${q}"`, true);
    },
  };
}
