import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import type { EcgPdfContent, PdfPoint, PdfTextItem } from '@workspace/shared';

/**
 * pdf.js extraction for a Garmin ECG report: the positioned text items and the vector polylines
 * the waveform is drawn with. Ported from Pitstop's ecg-pdf. The parser is pure and lives in
 * shared (utils/ecgReport.ts); it takes what this returns.
 *
 * unpdf bundles pdf.js 6.x, whose `constructPath` operator differs from the 4.x Pitstop reads:
 * args are `[paintOp, [Float32Array], minMax]`. The array holds the path as DrawOPS codes, each
 * followed by its coordinates: moveTo 0 (x y), lineTo 1 (x y), curveTo 2 (x1 y1 x2 y2 x3 y3),
 * quadraticCurveTo 3 (x1 y1 x2 y2), closePath 4. The coordinates are NOT transformed, so the
 * current transform matrix is still tracked here and applied to every point.
 */

/**
 * One page. The ECG export is a single landscape page ("1 of 1" in its footer). pdf.js reports
 * every page in its own user space, so a second page would land on top of the first.
 */
const MAX_PAGES = 1;
/**
 * A path with at least this many points is a waveform strip, not page furniture. The grid is
 * thousands of 2-point lines and the logo about 30-point glyph outlines; a strip has ~1200.
 */
const MIN_TRACE_POINTS = 200;

/** pdf.js DrawOPS: the codes inside a constructPath's path data. */
const DRAW = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a ∘ b: b applied first, then a (PDF `cm` semantics). */
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): PdfPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every((v) => typeof v === 'number');

/**
 * Every point a path visits, in page space. Curves are reduced to their endpoints: Garmin draws
 * the trace as one cubic segment per sample, so the endpoint sequence is the sampled signal.
 * Returns [] for a path with a code this reader does not know, since reading on would
 * desynchronise every later point.
 */
function pathPoints(data: ArrayLike<number>, ctm: Matrix): PdfPoint[] {
  const pts: PdfPoint[] = [];
  let k = 0;
  while (k < data.length) {
    const code = data[k++];
    switch (code) {
      case DRAW.moveTo:
      case DRAW.lineTo:
        pts.push(apply(ctm, data[k]!, data[k + 1]!));
        k += 2;
        break;
      case DRAW.curveTo:
        pts.push(apply(ctm, data[k + 4]!, data[k + 5]!));
        k += 6;
        break;
      case DRAW.quadraticCurveTo:
        pts.push(apply(ctm, data[k + 2]!, data[k + 3]!));
        k += 4;
        break;
      case DRAW.closePath:
        break;
      default:
        return [];
    }
  }
  return pts;
}

/** The path data of a constructPath: one typed array, or several, read in order. */
function pathData(args: unknown): ArrayLike<number> | null {
  if (!Array.isArray(args) || !Array.isArray(args[1])) return null;
  const parts = args[1] as unknown[];
  if (parts.length === 1 && ArrayBuffer.isView(parts[0]))
    return parts[0] as unknown as ArrayLike<number>;
  const flat: number[] = [];
  for (const part of parts) {
    if (!ArrayBuffer.isView(part)) return null;
    const values = part as unknown as ArrayLike<number>;
    for (let i = 0; i < values.length; i += 1) flat.push(values[i]!);
  }
  return flat;
}

const isTextItem = (
  item: unknown
): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
} =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as { str?: unknown }).str === 'string' &&
  Array.isArray((item as { transform?: unknown }).transform);

/**
 * Text items and waveform polylines of an ECG PDF, in page coordinates (origin bottom-left, y up,
 * so a positive deflection has the larger y, as printed). A PDF with no text layer gives no
 * items; the parser reports that as an unreadable report. Throws when the bytes are not a PDF.
 */
export async function extractEcgPdf(bytes: Uint8Array): Promise<EcgPdfContent> {
  const { OPS } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    // Only text and paths are wanted, so no large image is ever decoded.
    maxImageSize: 1_000_000,
  });
  try {
    const items: PdfTextItem[] = [];
    const traces: PdfPoint[][] = [];
    const pages = Math.min(pdf.numPages, MAX_PAGES);
    for (let number = 1; number <= pages; number += 1) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent({
          disableNormalization: true,
        });
        for (const it of content.items as unknown[]) {
          if (!isTextItem(it) || !it.str) continue;
          items.push({
            str: it.str,
            x: it.transform[4] ?? 0,
            y: it.transform[5] ?? 0,
            width: it.width ?? 0,
            height: it.height ?? 0,
          });
        }

        // The transform is tracked by hand: constructPath coordinates are in the space current
        // when it was issued, and each strip sits under its own `cm`. save/restore/transform are
        // not the only operators that move it: pdf.js emits no save/restore around a form
        // XObject (push, the form's /Matrix and pop live in paintFormXObjectBegin/End), and
        // beginGroup/endGroup are another implicit pair. Skipping them would leak a matrix.
        const list = await page.getOperatorList();
        let ctm: Matrix = IDENTITY;
        const stack: Matrix[] = [];
        for (let j = 0; j < list.fnArray.length; j += 1) {
          const fn = list.fnArray[j];
          const args: unknown = list.argsArray[j];
          if (fn === OPS.save || fn === OPS.beginGroup) stack.push(ctm);
          else if (
            fn === OPS.restore ||
            fn === OPS.endGroup ||
            fn === OPS.paintFormXObjectEnd
          )
            ctm = stack.pop() ?? ctm;
          else if (fn === OPS.transform) {
            if (isMatrix(args)) ctm = mul(ctm, args);
          } else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            const matrix = Array.isArray(args) ? args[0] : null;
            if (isMatrix(matrix)) ctm = mul(ctm, matrix);
          } else if (fn === OPS.constructPath) {
            const data = pathData(args);
            // Each point takes at least 3 numbers (code, x, y), so a short array cannot qualify.
            if (!data || data.length < MIN_TRACE_POINTS * 3) continue;
            const pts = pathPoints(data, ctm);
            if (pts.length >= MIN_TRACE_POINTS) traces.push(pts);
          }
        }
      } finally {
        page.cleanup();
      }
    }
    return { items, traces };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
