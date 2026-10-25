/**
 * Scan Markdown Source into typed blocks for preview layout (real-time, no DOM).
 */

import {
  createTypographyMetrics,
  estimateBlockHeightPx,
} from './previewTypography.js';

/**
 * @typedef {{
 *   id: number,
 *   type: 'h1'|'h2'|'h3'|'h4'|'h5'|'h6'|'p'|'li'|'blockquote'|'hr'|'pre'|'table'|'empty',
 *   text: string,
 *   lineCount?: number,
 *   rowCount?: number,
 *   charCount: number,
 *   estimatedHeightPx: number,
 *   sourceStartLine: number,
 * }} SourceBlock
 */

/**
 * @typedef {{
 *   blocks: SourceBlock[],
 *   stats: {
 *     charCount: number,
 *     lineCount: number,
 *     headings: Record<string, number>,
 *     listItems: number,
 *     tables: number,
 *     horizontalRules: number,
 *     codeBlocks: number,
 *     paragraphs: number,
 *   },
 * }} SourceInventory
 */

/**
 * @param {string} raw
 * @returns {SourceInventory['stats']}
 */
function emptyStats() {
  return {
    charCount: 0,
    lineCount: 0,
    headings: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    listItems: 0,
    tables: 0,
    horizontalRules: 0,
    codeBlocks: 0,
    paragraphs: 0,
  };
}

/**
 * @param {string} line
 */
function isHrLine(line) {
  return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

/**
 * @param {string} line
 * @returns {'h1'|'h2'|'h3'|'h4'|'h5'|'h6'|null}
 */
function headingType(line) {
  const m = line.match(/^\s{0,3}(#{1,6})(?:\s|$)/);
  if (!m) return null;
  return /** @type {'h1'|'h2'|'h3'|'h4'|'h5'|'h6'} */ (`h${m[1].length}`);
}

/**
 * @param {string} line
 */
function listItemText(line) {
  const m = line.match(/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/);
  return m ? m[1] : line.trim();
}

/**
 * @param {string} line
 */
function isListLine(line) {
  return /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(line);
}

/**
 * @param {string} line
 */
function isTableLine(line) {
  return /^\s*\|.+\|\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line);
}

/**
 * @param {string[]} tableLines
 */
function tableRowCount(tableLines) {
  return tableLines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|\s*$/.test(l)).length;
}

/**
 * @param {string} raw
 * @param {number} contentWidthPx
 * @returns {SourceInventory}
 */
export function inventoryMarkdownSource(raw, contentWidthPx) {
  const metrics = createTypographyMetrics(contentWidthPx);
  const stats = emptyStats();
  stats.charCount = raw.length;
  stats.lineCount = raw ? raw.split('\n').length : 0;

  /** @type {SourceBlock[]} */
  const blocks = [];
  if (!raw.trim()) {
    return { blocks, stats };
  }

  const lines = raw.split('\n');
  let id = 0;
  let i = 0;
  let inFence = false;
  let fenceChar = '';
  /** @type {string[]} */
  let fenceLines = [];
  let fenceStart = 0;
  /** @type {string[]} */
  let paraLines = [];
  let paraStart = 0;
  /** @type {string[]} */
  let tableLines = [];
  let tableStart = 0;

  const flushParagraph = () => {
    if (!paraLines.length) return;
    const text = paraLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      paraLines = [];
      return;
    }
    /** @type {SourceBlock} */
    const block = {
      id: id++,
      type: 'p',
      text,
      charCount: text.length,
      sourceStartLine: paraStart,
      estimatedHeightPx: 0,
    };
    block.estimatedHeightPx = estimateBlockHeightPx(block, metrics);
    blocks.push(block);
    stats.paragraphs += 1;
    paraLines = [];
  };

  const flushTable = () => {
    if (tableLines.length < 2) {
      paraLines.push(...tableLines);
      tableLines = [];
      return;
    }
    const rows = tableRowCount(tableLines);
    /** @type {SourceBlock} */
    const block = {
      id: id++,
      type: 'table',
      text: tableLines.join('\n'),
      rowCount: rows,
      charCount: tableLines.join('').length,
      sourceStartLine: tableStart,
      estimatedHeightPx: 0,
    };
    block.estimatedHeightPx = estimateBlockHeightPx(block, metrics);
    blocks.push(block);
    stats.tables += 1;
    tableLines = [];
  };

  const pushBlock = (partial) => {
    /** @type {SourceBlock} */
    const block = {
      id: id++,
      charCount: (partial.text ?? '').length,
      estimatedHeightPx: 0,
      sourceStartLine: partial.sourceStartLine ?? i,
      ...partial,
    };
    block.estimatedHeightPx = estimateBlockHeightPx(block, metrics);
    blocks.push(block);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s{0,3}(```|~~~)/.test(line)) {
      flushParagraph();
      flushTable();
      const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      const mark = m ? m[1][0] : '`';
      if (!inFence) {
        inFence = true;
        fenceChar = mark;
        fenceLines = [];
        fenceStart = i + 1;
      } else if (line.trim().startsWith(fenceChar.repeat(3))) {
        const body = fenceLines.join('\n');
        pushBlock({
          type: 'pre',
          text: body,
          lineCount: Math.max(1, fenceLines.length),
          sourceStartLine: fenceStart,
        });
        stats.codeBlocks += 1;
        inFence = false;
        fenceLines = [];
      }
      i += 1;
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushTable();
      i += 1;
      continue;
    }

    if (isHrLine(line)) {
      flushParagraph();
      flushTable();
      pushBlock({ type: 'hr', text: line.trim(), sourceStartLine: i });
      stats.horizontalRules += 1;
      i += 1;
      continue;
    }

    const ht = headingType(line);
    if (ht) {
      flushParagraph();
      flushTable();
      const text = line.replace(/^\s{0,3}#{1,6}\s*/, '').trim();
      pushBlock({ type: ht, text, sourceStartLine: i });
      stats.headings[ht] += 1;
      i += 1;
      continue;
    }

    if (isTableLine(line)) {
      flushParagraph();
      if (!tableLines.length) tableStart = i;
      tableLines.push(line);
      i += 1;
      continue;
    }

    if (tableLines.length) flushTable();

    if (/^\s{0,3}>/.test(line)) {
      flushParagraph();
      const text = line.replace(/^\s{0,3}>\s?/, '').trim();
      pushBlock({ type: 'blockquote', text, sourceStartLine: i });
      i += 1;
      continue;
    }

    if (isListLine(line)) {
      flushParagraph();
      const text = listItemText(line);
      pushBlock({ type: 'li', text, sourceStartLine: i });
      stats.listItems += 1;
      i += 1;
      continue;
    }

    if (!paraLines.length) paraStart = i;
    paraLines.push(line.trim());
    i += 1;
  }

  if (inFence && fenceLines.length) {
    pushBlock({
      type: 'pre',
      text: fenceLines.join('\n'),
      lineCount: fenceLines.length,
      sourceStartLine: fenceStart,
    });
    stats.codeBlocks += 1;
  }

  flushParagraph();
  flushTable();

  return { blocks, stats };
}
