/**
 * Shared Chromium printToPDF options — Export, live Preview, and agent PDF audit
 * must stay identical.
 *
 * Every-page branding uses Chromium `displayHeaderFooter` + `footerTemplate`
 * (reliable repeat). CSS `position:fixed` footers fight the content box and
 * overlap body — do not use them for every-page mode.
 *
 * Last-page branding stays in the DOM; margins: none so CSS `@page` owns margins.
 *
 * @param {{ paper?: string, footerRepeat?: string, footerTemplate?: string, footerBottomMm?: number }} [payload]
 * @param {Record<string, string>} pageSizeMap
 */
function printToPdfOptions(payload, pageSizeMap) {
  const paper = payload?.paper === 'a4' || payload?.paper === 'legal' ? payload.paper : 'letter';
  const pageSize = pageSizeMap[paper] ?? 'Letter';
  const every =
    payload?.footerRepeat === 'every' &&
    typeof payload?.footerTemplate === 'string' &&
    payload.footerTemplate.length > 0;

  if (every) {
    // Inches — bottom tracks renderer-measured strip (logo scale / stacked footer items).
    const top = 16 / 25.4;
    const side = 14 / 25.4;
    const bottomMmRaw = Number(payload.footerBottomMm);
    const bottomMm =
      Number.isFinite(bottomMmRaw) && bottomMmRaw >= 14 ? Math.min(40, bottomMmRaw) : 24;
    const bottom = bottomMm / 25.4;
    return {
      printBackground: true,
      pageSize,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: payload.footerTemplate,
      margins: {
        marginType: 'custom',
        top,
        bottom,
        left: side,
        right: side,
      },
    };
  }

  return {
    printBackground: true,
    pageSize,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margins: { marginType: 'none' },
  };
}

module.exports = { printToPdfOptions };
