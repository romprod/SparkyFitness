import PDFDocument from 'pdfkit';

/**
 * A synthetic Garmin ECG report, built with pdfkit. A real export is personal health data and is
 * never committed; this reproduces the page's shape: values above their labels in the same
 * column, an identifying block on the right of the same rows, a footer of versions and three
 * ten-second strips drawn as vector polylines.
 */

export const WIDTH = 792;
export const HEIGHT = 612;
export const UNITS_PER_MM = 72 / 25.4;
export const UNITS_PER_SEC = 25 * UNITS_PER_MM;
export const UNITS_PER_MV = 10 * UNITS_PER_MM;

/** Left edge every strip starts from, and its width in PDF units. */
export const STRIP_X0 = 33;
export const STRIP_W = 10 * UNITS_PER_SEC;

export async function build(
  draw: (doc: PDFKit.PDFDocument) => void
): Promise<Buffer> {
  const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  draw(doc);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** One flat strip with a spike, drawn top-down the way pdfkit places things. */
export function drawStrip(
  doc: PDFKit.PDFDocument,
  topDownY: number,
  spikeMv: number,
  spikeAt: number,
  points = 250
): void {
  doc.save().lineWidth(0.4).strokeColor('#000');
  for (let i = 0; i < points; i++) {
    const x = STRIP_X0 + (i * STRIP_W) / (points - 1);
    // pdfkit's y grows downward, so a POSITIVE deflection is a smaller y here.
    const y = topDownY - (i === spikeAt ? spikeMv : 0) * UNITS_PER_MV;
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  }
  doc.stroke().restore();
}

export async function syntheticReport(
  options: { recordedAt?: string; points?: number; result?: string } = {}
): Promise<Buffer> {
  const points = options.points ?? 250;
  return build((doc) => {
    doc.font('Helvetica');

    // Title row — the subject's name sits far to the right of it.
    doc
      .fontSize(14)
      .text('ECG Recording - Sinus Rhythm', 66, 22, { lineBreak: false });
    doc.fontSize(10).text('Jordan Fixtureson', 640, 24, { lineBreak: false });
    // Recording time row — date of birth, age and sex beside it.
    doc
      .fontSize(10)
      .text(options.recordedAt ?? '12 June 2024 @ 9:17 AM', 66, 40, {
        lineBreak: false,
      });
    doc
      .fontSize(7)
      .text('4 March 1979 (45 yr) - Female', 640, 42, { lineBreak: false });

    // Values, then the labels underneath them, in three columns.
    doc.fontSize(12);
    doc.text(options.result ?? 'Sinus Rhythm', 30, 78, { lineBreak: false });
    doc.text('61 bpm', 224, 78, { lineBreak: false });
    doc.text('--', 419, 78, { lineBreak: false });
    doc.fontSize(7);
    doc.text('Result', 30, 95, { lineBreak: false });
    doc.text('Average Heart Rate', 224, 95, { lineBreak: false });
    doc.text('Symptoms Reported', 419, 95, { lineBreak: false });

    doc
      .fontSize(12)
      .text('This ECG recording does not show signs of AFib.', 30, 116, {
        lineBreak: false,
      });
    doc.fontSize(7).text('Summary', 30, 133, { lineBreak: false });

    // Three strips, each with its own second axis under it.
    const stripTops = [250, 360, 470];
    stripTops.forEach((top, strip) => {
      drawStrip(
        doc,
        top,
        strip === 0 ? 1 : strip === 1 ? 0.5 : -0.25,
        strip === 0 ? 100 : strip === 1 ? 50 : 150,
        points
      );
      doc.fontSize(7);
      for (let s = 0; s < 10; s++) {
        doc.text(
          `${strip * 10 + s}s`,
          STRIP_X0 + 6 + (s * STRIP_W) / 10,
          top + 22,
          { lineBreak: false }
        );
      }
    });

    doc
      .fontSize(8)
      .text(
        '25mm/s, 10mm/mV, 512Hz, fenix 9 Pro - inReach, 43 mm SW 6.38, Garmin ECG App: 1.1.4, Garmin Connect Web 5.28.0.26a, PDF Template 1.2.114, Garmin Connect Backend 25.16.0.',
        30,
        552,
        { lineBreak: false }
      );
    doc
      .fontSize(8)
      .text(
        'This waveform is similar to a Lead I ECG. For more information, see Instructions for Use.',
        30,
        566,
        { lineBreak: false }
      );
    doc
      .fontSize(7)
      .text('Report downloaded from Garmin Connect on 13 June 2024', 30, 585, {
        lineBreak: false,
      });
    doc
      .fontSize(7)
      .text('Recorded on fenix 9 Pro - inReach, 43 mm 6.38', 30, 596, {
        lineBreak: false,
      });
  });
}
