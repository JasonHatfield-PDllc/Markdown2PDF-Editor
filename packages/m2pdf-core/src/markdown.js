import MarkdownIt from 'markdown-it';
import multimdTable from 'markdown-it-multimd-table';

/**
 * Replace leading ASCII spaces/tabs with NBSP so Word-like Indent shows in preview/PDF.
 * CommonMark strips leading spaces on paragraphs (and 4 spaces becomes a code block).
 * Skips list markers, blockquotes, headings, and indented list continuations.
 *
 * @param {string} chunk
 */
function leadingSpacesToNbsp(chunk) {
  const lines = chunk.split('\n');
  /** @type {string[]} */
  const out = [];
  let listContext = false;

  for (const line of lines) {
    if (!line.trim()) {
      listContext = false;
      out.push(line);
      continue;
    }

    if (/^\s{0,3}(```|~~~)/.test(line)) {
      listContext = false;
      out.push(line);
      continue;
    }

    if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) {
      listContext = false;
      out.push(line);
      continue;
    }

    if (/^\s*>/.test(line)) {
      listContext = false;
      out.push(line);
      continue;
    }

    if (/^\s*([-*+]|\d{1,9}[.)])(\s|$)/.test(line)) {
      listContext = true;
      out.push(line);
      continue;
    }

    if (listContext && /^[ \t]/.test(line)) {
      out.push(line);
      continue;
    }

    listContext = false;
    const m = line.match(/^([ \t]+)(.*)$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const spaceCount = m[1].replace(/\t/g, '    ').length;
    // One Indent click = 2 spaces → one &emsp; (Word-like). Remainder → &nbsp;.
    // Entity form — literal Unicode spaces are stripped by markdown-it; entities survive (html: false).
    const levels = Math.floor(spaceCount / 2);
    const rem = spaceCount % 2;
    out.push('&emsp;'.repeat(levels) + (rem ? '&nbsp;' : '') + m[2]);
  }

  return out.join('\n');
}

/**
 * CommonMark collapses 3+ consecutive newlines to the same gap as 2.
 * Expand those runs (outside fenced code) so extra Enter keys add visible vertical space.
 * Uses `&nbsp;` paragraphs — safe with `html: false` (entity text, not raw HTML).
 *
 * Also preserves Word-like leading Indent spaces as NBSP for preview/PDF.
 *
 * @param {string} raw
 */
export function preprocessMarkdown(raw) {
  if (!raw) return raw;
  const parts = raw.split(/(```[\s\S]*?```)/g);
  return parts
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk;
      const withGaps = chunk.replace(/\n{3,}/g, (m) => {
        const n = m.length;
        if (n <= 2) return m;
        const extras = n - 2;
        return Array.from({ length: extras }, () => '\n\n&nbsp;\n\n').join('');
      });
      return leadingSpacesToNbsp(withGaps);
    })
    .join('');
}

/**
 * @returns {import('markdown-it')}
 */
export function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true,
  });
  md.use(multimdTable);
  return md;
}
