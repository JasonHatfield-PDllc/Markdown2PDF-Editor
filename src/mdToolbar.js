/**
 * Insert-markdown helpers for the Source textarea (plain text, not WYSIWYG).
 * @param {HTMLTextAreaElement} ta
 */
export function insertBold(ta) {
  wrapInline(ta, '**', '**');
}

/** @param {HTMLTextAreaElement} ta */
export function insertItalic(ta) {
  wrapInline(ta, '*', '*');
}

/** @param {HTMLTextAreaElement} ta */
export function insertInlineCode(ta) {
  wrapInline(ta, '`', '`');
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} before
 * @param {string} after
 */
function wrapInline(ta, before, after) {
  const v = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = v.slice(start, end);
  if (start === end) {
    const ins = before + after;
    ta.value = v.slice(0, start) + ins + v.slice(end);
    const pos = start + before.length;
    ta.setSelectionRange(pos, pos);
  } else {
    ta.value = v.slice(0, start) + before + sel + after + v.slice(end);
    const newStart = start + before.length;
    const newEnd = newStart + sel.length;
    ta.setSelectionRange(newStart, newEnd);
  }
  ta.focus();
}

/**
 * @param {HTMLTextAreaElement} ta
 * @returns {{ v: string, blockStart: number, blockEnd: number }}
 */
function getBlockBounds(ta) {
  const v = ta.value;
  const a = ta.selectionStart;
  const b = ta.selectionEnd;
  const selMin = Math.min(a, b);
  const selMax = Math.max(a, b);
  const blockStart = v.lastIndexOf('\n', selMin - 1) + 1;
  let blockEnd = v.indexOf('\n', selMax);
  if (blockEnd === -1) blockEnd = v.length;
  return { v, blockStart, blockEnd };
}

/** Strip leading list markers (-, *, 1.) for re-prefixing. */
function stripListMarkers(line) {
  return line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
}

/** Strip blockquote prefix for re-prefixing. */
function stripBlockquote(line) {
  return line.replace(/^\s*>\s?/, '');
}

/**
 * Set heading level for each line in the current selection (or current line).
 * @param {HTMLTextAreaElement} ta
 * @param {0 | 1 | 2 | 3} level 0 = paragraph (strip # prefixes)
 */
export function applyHeadingLevel(ta, level) {
  const { v, blockStart, blockEnd } = getBlockBounds(ta);
  const block = v.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  const transformed = lines.map((line) => {
    const stripped = line.replace(/^#{1,6}\s+/, '');
    if (level === 0) return stripped;
    return `${'#'.repeat(level)} ${stripped}`;
  });
  const newBlock = transformed.join('\n');
  ta.value = v.slice(0, blockStart) + newBlock + v.slice(blockEnd);
  const newEnd = blockStart + newBlock.length;
  ta.setSelectionRange(blockStart, newEnd);
  ta.focus();
}

/** Bullet list: prefix `- ` on each non-empty line (selection or current line). */
export function insertBulletList(ta) {
  const { v, blockStart, blockEnd } = getBlockBounds(ta);
  const block = v.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  const transformed = lines.map((line) => {
    if (line.trim() === '') return line;
    const stripped = stripListMarkers(stripBlockquote(line));
    return `- ${stripped}`;
  });
  applyBlock(ta, v, blockStart, blockEnd, transformed.join('\n'));
}

/** Numbered list: prefix `1. `, `2. `, … on each non-empty line. */
export function insertNumberedList(ta) {
  const { v, blockStart, blockEnd } = getBlockBounds(ta);
  const block = v.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  let n = 1;
  const transformed = lines.map((line) => {
    if (line.trim() === '') return line;
    const stripped = stripListMarkers(stripBlockquote(line));
    return `${n++}. ${stripped}`;
  });
  applyBlock(ta, v, blockStart, blockEnd, transformed.join('\n'));
}

/** Blockquote: prefix `> ` on each non-empty line. */
export function insertBlockquote(ta) {
  const { v, blockStart, blockEnd } = getBlockBounds(ta);
  const block = v.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  const transformed = lines.map((line) => {
    if (line.trim() === '') return line;
    const stripped = stripListMarkers(stripBlockquote(line));
    return `> ${stripped}`;
  });
  applyBlock(ta, v, blockStart, blockEnd, transformed.join('\n'));
}

/**
 * @param {HTMLTextAreaElement} ta
 * @param {string} v
 * @param {number} blockStart
 * @param {number} blockEnd
 * @param {string} newBlock
 */
function applyBlock(ta, v, blockStart, blockEnd, newBlock) {
  ta.value = v.slice(0, blockStart) + newBlock + v.slice(blockEnd);
  const newEnd = blockStart + newBlock.length;
  ta.setSelectionRange(blockStart, newEnd);
  ta.focus();
}

/**
 * Link: [text](url). With selection → wraps; without → inserts placeholder and selects label.
 * @param {HTMLTextAreaElement} ta
 */
export function insertLink(ta) {
  const v = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = v.slice(start, end);
  const labelPlaceholder = 'link text';
  if (sel) {
    const insert = `[${sel}](https://)`;
    ta.value = v.slice(0, start) + insert + v.slice(end);
    // Select `https://` inside the parens (after `[sel](`).
    const urlStart = start + sel.length + 3;
    ta.setSelectionRange(urlStart, urlStart + 8);
  } else {
    const insert = `[${labelPlaceholder}](https://)`;
    ta.value = v.slice(0, start) + insert + v.slice(end);
    ta.setSelectionRange(start + 1, start + 1 + labelPlaceholder.length);
  }
  ta.focus();
}

/** Horizontal rule on its own line (`---`). */
export function insertHorizontalRule(ta) {
  const v = ta.value;
  const start = ta.selectionStart;
  const ins = start === 0 ? '---\n\n' : '\n\n---\n\n';
  ta.value = v.slice(0, start) + ins + v.slice(start);
  const pos = start + ins.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
}
