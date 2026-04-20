import MarkdownIt from 'markdown-it';
import multimdTable from 'markdown-it-multimd-table';

/**
 * CommonMark collapses 3+ consecutive newlines to the same gap as 2.
 * Expand those runs (outside fenced code) so extra Enter keys add visible vertical space.
 * Uses `&nbsp;` paragraphs — safe with `html: false` (entity text, not raw HTML).
 *
 * @param {string} raw
 */
export function preprocessMarkdown(raw) {
  if (!raw) return raw;
  const parts = raw.split(/(```[\s\S]*?```)/g);
  return parts
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk;
      return chunk.replace(/\n{3,}/g, (m) => {
        const n = m.length;
        if (n <= 2) return m;
        const extras = n - 2;
        return Array.from({ length: extras }, () => '\n\n&nbsp;\n\n').join('');
      });
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
