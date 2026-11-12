/**
 * pdf.js TextLayerBuilder appends endOfContent; raw TextLayer does not.
 * Preview text selection is disabled in CSS — layer exists for Find highlights only.
 */

/** @type {Set<HTMLElement>} */
const textLayers = new Set();

export function detachAllPdfTextLayerSelections() {
  textLayers.clear();
}

/**
 * @param {HTMLElement} textLayerDiv
 */
export function attachPdfTextLayerSelection(textLayerDiv) {
  if (!textLayerDiv.classList.contains('textLayer')) return;

  if (!textLayerDiv.querySelector(':scope > .endOfContent')) {
    const end = document.createElement('div');
    end.className = 'endOfContent';
    textLayerDiv.append(end);
  }

  textLayers.add(textLayerDiv);
}

/** @deprecated Preview selection off — kept so imports stay stable. */
export function tightenTextLayerSpanHitBoxes(_textLayerDiv) {}
