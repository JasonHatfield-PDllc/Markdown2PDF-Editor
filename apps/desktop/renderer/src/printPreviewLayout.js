/**
 * Paginated print preview: block breaks + measured header/footer bands (screen only).
 * Export PDF still uses #print-flow + #footer-last-page-wrap in @media print.
 */

import {
  getHeaderPlacementFlags,
  getInnerBandHeightPx,
  getPageMarginPx,
  getSheetSizePx,
  getSlotHeightForPage,
} from '@m2pdf/core';
import {
  breakUnitsToHtml,
  collectBreakUnits,
  createMeasureProbe,
  demoteWidowHeadings,
  paginateBreakUnits,
  reflowPagesAvoidFold,
  removeMeasureProbe,
} from './previewPagination.js';

export const SHEET_GAP_PX = 20;

export { getSheetSizePx };

/**
 * @param {HTMLElement} footerBlock
 * @param {number} pageIndex 1-based
 * @param {number} pageTotal
 * @param {'off' | 'left' | 'center' | 'right'} pageNumAlign
 */
function buildScreenFooter(footerBlock, pageIndex, pageTotal, pageNumAlign) {
  const wrap = document.createElement('div');
  wrap.className = 'm2pdf-screen-footer pt-1';
  const inner = footerBlock.cloneNode(true);
  inner.removeAttribute('id');
  inner.classList.remove('hidden', 'border-t', 'pt-2', 'print:pt-2');
  const pageEl = inner.querySelector('.m2pdf-footer-pagenum');
  if (pageEl) {
    if (pageNumAlign === 'off') {
      pageEl.textContent = '';
      pageEl.classList.add('hidden');
    } else {
      pageEl.textContent = `Page ${pageIndex} of ${pageTotal}`;
      pageEl.classList.remove('hidden');
      pageEl.dataset.align = pageNumAlign;
      pageEl.classList.remove('order-first', 'order-last', 'ml-auto', 'mr-auto', 'mx-auto', 'w-full');
      if (pageNumAlign === 'left') pageEl.classList.add('order-first', 'text-left');
      else if (pageNumAlign === 'center') pageEl.classList.add('mx-auto', 'text-center');
      else if (pageNumAlign === 'right') pageEl.classList.add('ml-auto', 'text-right');
    }
  }
  wrap.appendChild(inner);
  return wrap;
}

/**
 * @param {HTMLElement} headerEl
 */
function buildScreenHeader(headerEl) {
  const wrap = document.createElement('header');
  wrap.className = headerEl.className.replace(/\bhidden\b/g, '').trim();
  wrap.classList.add('mb-6', 'pb-4');
  const inner = headerEl.querySelector('#brand-header-inner') ?? headerEl.firstElementChild;
  if (inner) wrap.appendChild(inner.cloneNode(true));
  return wrap;
}

/**
 * @param {HTMLElement} el
 */
function measureElementHeight(el) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-12000px;top:0;visibility:hidden;pointer-events:none;width:100%;';
  box.appendChild(el.cloneNode(true));
  document.body.appendChild(box);
  const h = box.offsetHeight;
  box.remove();
  return h;
}

/**
 * @param {HTMLElement | null} printRoot
 * @param {'letter' | 'a4' | 'legal'} paper
 * @param {{
 *   everyPageFooter?: boolean,
 *   footerBlock?: HTMLElement | null,
 *   pageNumAlign?: 'off' | 'left' | 'center' | 'right',
 *   marginPx?: { top: number, right: number, bottom: number, left: number },
 *   showPageGuides?: boolean,
 *   guideStepPx?: number,
 *   sourceHasContent?: boolean,
 *   previewMessage?: string,
 *   repeatHeaderEachPage?: boolean,
 *   previewContext?: ReturnType<import('@m2pdf/core').buildPrintPreviewContext>,
 * }} [options]
 * @returns {number}
 */
export function layoutPrintPreviewSheets(printRoot, paper, options = {}) {
  if (!printRoot) return 1;

  const flow = printRoot.querySelector('#print-flow');
  const footerWrap = printRoot.querySelector('#footer-last-page-wrap');
  const mdPreview = flow?.querySelector('#md-preview');
  const headerEl = flow?.querySelector('#brand-header');
  if (!flow || !mdPreview) return 1;

  let stack = printRoot.querySelector('#print-pages-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'print-pages-stack';
    printRoot.insertBefore(stack, printRoot.firstChild);
  }

  printRoot.querySelector('#print-preview-sheets')?.remove();
  printRoot.querySelector('#print-preview-every-footers')?.remove();

  const { widthPx, heightPx } = getSheetSizePx(paper);
  const m = options.marginPx ?? getPageMarginPx(Boolean(options.everyPageFooter));
  const contentW = widthPx - m.left - m.right;
  const innerBand = getInnerBandHeightPx(heightPx, m);

  const hasContent = options.sourceHasContent !== false;

  printRoot.style.width = `${widthPx}px`;
  printRoot.style.padding = '0';
  printRoot.style.margin = '0 auto';
  printRoot.style.minHeight = '';

  flow.style.width = `${contentW}px`;
  flow.style.padding = `${m.top}px ${m.right}px 0 ${m.left}px`;
  flow.style.boxSizing = 'border-box';
  flow.style.visibility = 'visible';
  flow.style.position = 'static';
  flow.style.left = '';
  flow.style.height = 'auto';

  if (footerWrap) {
    footerWrap.style.padding = `0 ${m.right}px ${m.bottom}px ${m.left}px`;
    footerWrap.style.boxSizing = 'border-box';
  }

  const every = Boolean(options.everyPageFooter);
  const showFooter = options.footerBlock && !options.footerBlock.classList.contains('hidden');
  const showHeader = headerEl && !headerEl.classList.contains('hidden');

  if (!hasContent) {
    stack.replaceChildren();
    const ph = document.createElement('p');
    ph.className = 'py-16 text-center text-sm text-slate-500';
    ph.textContent =
      options.previewMessage ??
      'Open or paste Markdown to see the print preview.';
    stack.appendChild(ph);
    flow.style.visibility = 'hidden';
    flow.style.position = 'absolute';
    flow.style.left = '-9999px';
    flow.style.pointerEvents = 'none';
    return 1;
  }

  const footerBandPx =
    showFooter && options.footerBlock
      ? measureElementHeight(buildScreenFooter(options.footerBlock, 1, 1, options.pageNumAlign ?? 'off'))
      : 0;

  const headerBandPx =
    showHeader && headerEl ? measureElementHeight(buildScreenHeader(headerEl)) : 0;

  const headerFlags = getHeaderPlacementFlags(
    Boolean(showHeader),
    Boolean(options.repeatHeaderEachPage),
  );

  const chrome = {
    headerBandPx,
    footerBandPx,
    footerOnEveryPage: every && showFooter,
    repeatHeaderEachPage: headerFlags.repeatHeaderEachPage,
    headerOnFirstPageOnly: headerFlags.headerOnFirstPageOnly,
  };

  const proseClass = mdPreview.className;
  const measureKit = createMeasureProbe(proseClass, contentW);
  const { probe, clipHost } = measureKit;
  const units = collectBreakUnits(mdPreview);

  const slotForPage = (pageIndex, pageCountHint) =>
    getSlotHeightForPage(pageIndex, pageCountHint, innerBand, chrome);

  /** @type {import('./previewPagination.js').BreakUnit[][]} */
  let pageUnits = paginateBreakUnits(units, probe, clipHost, slotForPage);
  demoteWidowHeadings(pageUnits);
  pageUnits = reflowPagesAvoidFold(pageUnits, probe, clipHost, slotForPage);
  demoteWidowHeadings(pageUnits);
  pageUnits = reflowPagesAvoidFold(pageUnits, probe, clipHost, slotForPage);

  const flowExtraClass = 'prose prose-sm prose-slate max-w-none';
  const ctx = options.previewContext;

  /**
   * @param {import('./previewPagination.js').BreakUnit[][]} pages
   */
  function renderStack(pages) {
    const pageCount = Math.max(1, pages.filter((p) => p.length).length || pages.length);
    const activePages = pages.filter((p) => p.length);
    const toRender = activePages.length ? activePages : pages;

    stack.replaceChildren();

    for (let i = 0; i < toRender.length; i++) {
      const slotPx = getSlotHeightForPage(i, toRender.length, innerBand, chrome);
      const showHeaderOnPage =
        showHeader &&
        (chrome.repeatHeaderEachPage || (chrome.headerOnFirstPageOnly && i === 0));

      const frame = document.createElement('article');
      frame.className = 'm2pdf-preview-page-frame';
      frame.setAttribute('data-page', String(i + 1));
      frame.style.height = `${heightPx}px`;

      const inset = document.createElement('div');
      inset.className = 'm2pdf-preview-page-inset';
      inset.style.height = '100%';
      inset.style.width = '100%';
      inset.style.padding = `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`;
      inset.style.boxSizing = 'border-box';
      inset.style.display = 'flex';
      inset.style.flexDirection = 'column';

      if (showHeaderOnPage && headerEl) {
        inset.appendChild(buildScreenHeader(headerEl));
      }

      const body = document.createElement('div');
      body.className = 'm2pdf-preview-page-body';
      body.style.width = '100%';
      body.style.minWidth = '0';
      body.style.boxSizing = 'border-box';
      body.style.height = `${slotPx}px`;
      body.style.minHeight = `${slotPx}px`;
      body.style.maxHeight = `${slotPx}px`;
      body.style.overflow = 'hidden';
      body.style.flex = '0 0 auto';

      const content = document.createElement('article');
      content.className = `m2pdf-page-prose ${flowExtraClass}`;
      content.style.width = `${contentW}px`;
      content.style.maxWidth = '100%';
      content.style.minWidth = '0';
      content.style.boxSizing = 'border-box';
      content.style.margin = '0';
      content.innerHTML = breakUnitsToHtml(toRender[i] ?? []);

      body.appendChild(content);
      inset.appendChild(body);

      const foot = document.createElement('div');
      foot.className = 'm2pdf-preview-page-footer-area shrink-0';

      if (showFooter && options.footerBlock) {
        if (every) {
          foot.appendChild(
            buildScreenFooter(
              options.footerBlock,
              i + 1,
              toRender.length,
              options.pageNumAlign ?? 'off',
            ),
          );
        } else if (i === toRender.length - 1) {
          foot.appendChild(
            buildScreenFooter(
              options.footerBlock,
              toRender.length,
              toRender.length,
              options.pageNumAlign ?? 'off',
            ),
          );
        }
      }

      inset.appendChild(foot);
      frame.appendChild(inset);
      stack.appendChild(frame);
    }
  }

  renderStack(pageUnits);

  removeMeasureProbe(measureKit);

  const pageCount = stack.querySelectorAll('.m2pdf-preview-page-frame').length || 1;

  if (ctx) {
    printRoot.dataset.m2pdfPaper = ctx.paper;
    printRoot.dataset.m2pdfPages = String(pageCount);
    printRoot.dataset.m2pdfSourceBlocks = String(ctx.inventory.blocks.length);
  }

  flow.style.visibility = 'hidden';
  flow.style.position = 'absolute';
  flow.style.left = '-9999px';
  flow.style.pointerEvents = 'none';

  if (footerWrap) {
    footerWrap.style.display = 'none';
  }

  return pageCount;
}
