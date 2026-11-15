import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderAppointmentReportPdf } from '../services/appointmentReportPdf.ts';
import { appointmentReportFixture } from './fixtures/appointmentReportFixture.ts';
const parse = async (full = false) => {
  const bytes = await renderAppointmentReportPdf(
    appointmentReportFixture(full)
  );
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const result = await extractText(new Uint8Array(bytes), { mergePages: true });
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const raw: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({ disableNormalization: true });
    raw.push(
      content.items.map((item) => ('str' in item ? item.str : '')).join('')
    );
  }
  return { ...result, rawText: raw.join('\n') };
};
describe('private appointment PDF renderer', () => {
  it('renders all-empty facts as an actual PDF with explicit missing states', async () => {
    const result = await parse();
    expect(result.text).toContain(
      'No doses or medication events in this range.'
    );
    expect(result.text).toContain('No bloodwork recorded.');
    expect(result.text).toContain('Display name not recorded');
    expect(result.text).not.toContain('Font note:');
  });
  it('paginates complete records, repeats headers and preserves qualifiers and clinical glyphs', async () => {
    const result = await parse(true);
    expect(result.totalPages).toBeGreaterThan(3);
    for (let i = 0; i < 34; i++)
      expect(result.text).toContain(
        `Synthetic event ${String(i).padStart(2, '0')}`
      );
    for (let i = 0; i < 17; i++)
      expect(result.text).toContain(`Synthetic symptom ${i}`);
    for (const value of [
      'μ',
      '≤',
      '≥',
      '×',
      '⁹',
      '−',
      'Zoë',
      'Łukasz',
      'Ж',
      '≤ 0.0100',
      '≥ 2.50',
      '< 0.02',
      '> 10',
      'Not detected',
      '0.000123456789',
      '7 (unit not recorded)',
      'Not administered',
      'Interval: 3 days',
      'As-needed maximum per day: 0',
    ])
      expect(result.text).toContain(value);
    // PDF.js normalizes the micro sign to Greek mu by default; inspect raw mappings.
    expect(result.rawText).toContain('µ');
    expect(result.rawText).toContain('μ');
    expect(result.text).toContain('[U+4E2D]');
    expect(result.text).toContain('[U+1F600]');
    expect(result.text).toContain('Font note:');
    expect(result.text.match(/Tracking day \/ time/g)?.length).toBeGreaterThan(
      1
    );
    expect(result.text).toContain(
      'Average calories (kcal): 0.0 (1 recorded entries)'
    );
    expect(result.text).toContain(
      `Page ${result.totalPages} of ${result.totalPages}`
    );
  });
});
