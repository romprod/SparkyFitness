import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { hologicScanToPrefill, parseHologicReport } from '@workspace/shared';
import {
  MAX_ROW_TEXT_PDF_PAGES,
  readPdfRowText,
  renderPageText,
} from '../services/pdfRowText.js';
import { HOLOGIC_TEMPLATE as TEMPLATE } from './fixtures/hologicReportText.js';

const item = (str: string, x: number, y: number, width: number) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
});

describe('renderPageText', () => {
  it('separates cells of a row by a space when the gap is wide, and keeps adjacent glyph runs joined', () => {
    const text = renderPageText([
      item('L Arm', 40, 700, 27),
      item('200.00', 120, 700, 30),
      item('1000.0', 180, 700, 30),
      item('Sc', 40, 720, 10),
      item('an', 50.2, 720, 9), // a kerned run of one word, gap 0.2
      item('Header', 40, 740, 30),
    ]);
    expect(text).toBe('Header\nScan\nL Arm 200.00 1000.0');
  });

  it('puts items whose baselines differ by a point or two on one row, in left to right order', () => {
    expect(
      renderPageText([item('b', 100, 500.5, 5), item('a', 40, 500, 5)])
    ).toBe('a b');
  });

  it('ignores empty items', () => {
    expect(renderPageText([item('', 1, 1, 0), item('x', 1, 1, 5)])).toBe('x');
  });
});

/** A PDF whose table rows are SEPARATE positioned cells, as a scanner's report lays them out. */
async function buildPdf(
  lines: string[],
  options: { pages?: number; breakBefore?: string } = {}
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  doc.font('Helvetica').fontSize(9);
  let y = 40;
  const cellRow =
    /^(L Arm|R Arm|Trunk|L Leg|R Leg|Subtotal|Head|Total|Android \(A\)|Gynoid \(G\)|L Ribs|R Ribs|T Spine|L Spine|Pelvis) ((?:-?[\d.]+ ?)+)$/;
  for (const line of lines) {
    if (!line) continue;
    if (line === options.breakBefore) {
      doc.addPage();
      y = 40;
    }
    const m = cellRow.exec(line);
    if (m) {
      const cells = [m[1]!, ...m[2]!.trim().split(' ')];
      cells.forEach((c, i) =>
        doc.text(c, 40 + i * 70, y, { lineBreak: false })
      );
    } else doc.text(line, 40, y, { lineBreak: false });
    y += 13;
  }
  for (let page = 2; page <= (options.pages ?? 1); page += 1) {
    doc.addPage();
    doc.text(`Page ${page}`, 40, 40, { lineBreak: false });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe('readPdfRowText, end to end with a pdfkit report', () => {
  it('reads positioned table cells across two pages as rows, and the parser reads the same scan as from the plain text', async () => {
    const pdf = await buildPdf(TEMPLATE.split('\n'), {
      breakBefore: 'Body Composition Results',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const read = await readPdfRowText(new Uint8Array(pdf));
    if (read.kind !== 'text')
      throw new Error(`expected text, got ${read.kind}`);
    expect(read.pages).toBe(2);
    expect(read.text).toContain(
      'L Arm 200.00 1000.0 3500.0 3700.0 4700.0 21.3'
    );
    expect(read.text).toContain('Total 2333.33 2800.00 1.200 0.1 0.1');

    const parsed = parseHologicReport(read.text);
    expect(parsed.missing).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.scan).toEqual(parseHologicReport(TEMPLATE).scan);
    const prefill = hologicScanToPrefill(parsed.scan!);
    expect(prefill).toMatchObject({
      scanned_day: '2026-01-10',
      device_label: 'Hologic Horizon A',
      device_serial: 'TEST1',
      total_fat_g: 16400,
      bmd_t_score: 0.1,
      almi_am: 58,
    });
    expect(prefill.regions).toHaveLength(8);
  }, 30_000);

  it('gives an empty string for a PDF with no text', async () => {
    const read = await readPdfRowText(new Uint8Array(await buildPdf([''])));
    expect(read).toEqual({ kind: 'text', text: '', pages: 1 });
  });

  it('refuses a PDF with more pages than a report has, before reading any', async () => {
    const pdf = await buildPdf(['x'], { pages: MAX_ROW_TEXT_PDF_PAGES + 1 });
    expect(await readPdfRowText(new Uint8Array(pdf))).toEqual({
      kind: 'too_many_pages',
      pages: MAX_ROW_TEXT_PDF_PAGES + 1,
    });
  });

  it('says unreadable for bytes that are not a PDF', async () => {
    expect(
      await readPdfRowText(new TextEncoder().encode('%PDF-1.4 not really'))
    ).toEqual({ kind: 'unreadable' });
  });
});
