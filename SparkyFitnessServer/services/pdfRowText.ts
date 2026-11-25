import { getDocumentProxy } from 'unpdf';

/**
 * A PDF's text layer as printed rows. pdf.js's own text joiner glues cells of one row together
 * with no separator ("L Arm200.001000.0"), which breaks every table anchor a report reader
 * relies on. Here the text items are grouped into rows by baseline, ordered left to right, and
 * separated by a space wherever the gap between two items is wider than a fraction of the text
 * height. Ported from Pitstop's pdf-text.
 */

/** The part of a pdf.js text item the row layout needs. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** Vertical distance, in PDF units, within which two items are on the same row. */
const ROW_TOLERANCE = 2;
/** A report is two to four pages; a PDF with more is not one, and each page is read on the server's only thread. */
export const MAX_ROW_TEXT_PDF_PAGES = 8;

/** One page's items as rows, top to bottom, each cell separated by a space, adjacent glyph runs of one word kept joined. */
export function renderPageText(items: readonly PdfTextItem[]): string {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5] ?? 0;
    const row = rows.find((r) => Math.abs(r.y - y) <= ROW_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }
  // PDF user space: a larger y is higher on the page.
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      const sorted = [...row.items].sort(
        (a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0)
      );
      let text = '';
      let previousEnd: number | null = null;
      for (const item of sorted) {
        const x = item.transform[4] ?? 0;
        const gap = Math.max(0.15 * (item.height || 10), 0.5);
        if (
          previousEnd !== null &&
          x - previousEnd > gap &&
          !text.endsWith(' ') &&
          !item.str.startsWith(' ')
        )
          text += ' ';
        text += item.str;
        previousEnd = x + (item.width || 0);
      }
      return text;
    })
    .join('\n');
}

const isTextItem = (item: unknown): item is PdfTextItem =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as { str?: unknown }).str === 'string' &&
  Array.isArray((item as { transform?: unknown }).transform);

export type PdfRowTextResult =
  | { kind: 'text'; text: string; pages: number }
  | { kind: 'too_many_pages'; pages: number }
  | { kind: 'unreadable' };

/**
 * Reads a PDF's text layer as rows, pages separated by a blank line. A PDF with no text at all
 * (a scan) gives an empty string. A file that cannot be opened is `unreadable`; one with more
 * than MAX_ROW_TEXT_PDF_PAGES pages is refused before any page is read.
 */
export async function readPdfRowText(
  bytes: Uint8Array
): Promise<PdfRowTextResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(bytes, {
      // Only text is wanted, so no large image is ever decoded.
      maxImageSize: 1_000_000,
    });
    if (pdf.numPages > MAX_ROW_TEXT_PDF_PAGES)
      return { kind: 'too_many_pages', pages: pdf.numPages };
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      try {
        // Not normalised: the report reader folds superscripts and no-break spaces itself.
        const content = await page.getTextContent({
          disableNormalization: true,
        });
        pages.push(
          renderPageText((content.items as unknown[]).filter(isTextItem))
        );
      } finally {
        page.cleanup();
      }
    }
    const text = pages.join('\n\n');
    return {
      kind: 'text',
      text: /\S/.test(text) ? text : '',
      pages: pdf.numPages,
    };
  } catch {
    return { kind: 'unreadable' };
  } finally {
    await pdf?.loadingTask.destroy().catch(() => undefined);
  }
}
