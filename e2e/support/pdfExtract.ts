/**
 * Extract per-page text + positions from a Chromium printToPDF / Playwright page.pdf buffer.
 * PDF user space: origin bottom-left; y increases upward.
 */
import { getDocument, type TextItem } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfTextItem = {
  str: string;
  /** Left edge in PDF points */
  x: number;
  /** Baseline y from page bottom in PDF points */
  y: number;
  width: number;
  height: number;
};

export type PdfPageExtract = {
  pageIndex: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  /** Whitespace-joined text in content-stream order */
  text: string;
};

function isTextItem(item: TextItem | { type: string }): item is TextItem {
  return 'str' in item && typeof (item as TextItem).str === 'string';
}

export async function extractPdfPages(pdfBuffer: Buffer | Uint8Array): Promise<PdfPageExtract[]> {
  const data = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer;
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pages: PdfPageExtract[] = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const raw of content.items) {
      if (!isTextItem(raw) || !raw.str.trim()) continue;
      const t = raw.transform;
      items.push({
        str: raw.str,
        x: t[4],
        y: t[5],
        width: raw.width ?? 0,
        height: raw.height ?? 0,
      });
    }

    pages.push({
      pageIndex: i - 1,
      width: viewport.width,
      height: viewport.height,
      items,
      text: items.map((it) => it.str).join(' '),
    });
  }

  return pages;
}

/** Full-document text (pages joined). */
export function joinPdfText(pages: PdfPageExtract[]): string {
  return pages.map((p) => p.text).join('\n');
}

/**
 * Body markers must sit above the reserved footer band (points from page bottom).
 * Returns items that violate the clearance (likely clipped under footer).
 */
export function findItemsBelowClearance(
  page: PdfPageExtract,
  markerSubstring: string,
  minYFromBottomPt: number,
): PdfTextItem[] {
  return page.items.filter(
    (it) => it.str.includes(markerSubstring) && it.y < minYFromBottomPt,
  );
}

/** mm → PDF points (1/72") */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}
