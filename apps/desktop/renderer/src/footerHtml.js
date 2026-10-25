/**
 * Shared HTML escaping for Chromium footerTemplate / print chrome.
 * Kept small so Prefer B Export and DOM disclaimer paths stay consistent.
 */

/**
 * Escape text nodes for footerTemplate HTML.
 * @param {string} s
 */
export function escapeFooterHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape attribute values (e.g. logo data: URLs in img src).
 * @param {string} s
 */
export function escapeHtmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}
