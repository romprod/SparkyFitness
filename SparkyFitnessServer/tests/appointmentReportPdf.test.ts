import { describe, expect, it } from 'vitest';
import type { AppointmentReportData } from '@workspace/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import { renderAppointmentReportPdf } from '../services/appointmentReportPdf.ts';
import { appointmentReportFixture } from './fixtures/appointmentReportFixture.ts';
const parse = async (full = false, data?: AppointmentReportData) => {
  const bytes = await renderAppointmentReportPdf(
    data ?? appointmentReportFixture(full)
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

describe('bounded appointment hydration and timing facts', () => {
  it.each([
    {
      water: [-100, 0, 1000, null],
      target: 2000,
      expected:
        'Average water: 500 mL/day vs current saved target 2000 mL/day (25%)',
    },
    {
      water: [0],
      target: 2000,
      expected:
        'Average water: 0 mL/day vs current saved target 2000 mL/day (0%)',
    },
    {
      water: [333, 334],
      target: 1000,
      expected:
        'Average water: 334 mL/day vs current saved target 1000 mL/day (33%)',
    },
    { water: [250], target: null, expected: 'Average water: 250 mL/day' },
    {
      water: [null],
      target: 1800,
      expected:
        'Current saved hydration target: 1800 mL/day (no water logged in range)',
    },
    {
      water: [],
      target: 1800,
      expected:
        'Current saved hydration target: 1800 mL/day (no water logged in range)',
    },
  ])(
    'keeps observed hydration and current goal distinct: $expected',
    async ({ water, target, expected }) => {
      const data = appointmentReportFixture();
      data.wellness.water = water.map((millilitres, index) => ({
        day: `2026-11-${String(index + 1).padStart(2, '0')}`,
        millilitres,
      }));
      data.wellness.hydrationTargetMl = target;
      const result = await parse(false, data);
      expect(result.text).toContain(expected);
      if (target === null)
        expect(result.text).not.toContain('vs current saved target');
    }
  );
  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not invent hydration goals or missing observations: %s',
    async (target) => {
      const data = appointmentReportFixture();
      data.wellness.hydrationTargetMl = target;
      const result = await parse(false, data);
      expect(result.text).not.toContain('Average water:');
      expect(result.text).not.toContain('hydration target:');
      expect(result.text).not.toContain('vs current saved target');
    }
  );
  it('prints signed factual timing only for administered events with a known delta', async () => {
    const data = appointmentReportFixture();
    const prototype = appointmentReportFixture(true).doseLog[0]!;
    data.doseLog = [0, 12, -5, null, 12].map((delta, index) => ({
      ...prototype,
      id: `timing-${index}`,
      name: `Synthetic timing event ${index}`,
      administered: index !== 4,
      status: index === 4 ? 'skipped' : 'taken',
      timingDeltaMinutes: delta,
    }));
    const result = await parse(false, data);
    for (const label of [
      'Recorded timing: on time',
      'Recorded timing: +12m (late)',
      'Recorded timing: −5m (early)',
    ])
      expect(result.text.replace(/\s+/g, ' ')).toContain(label);
    expect(result.text.match(/Recorded timing: —/g)).toHaveLength(2);
    expect(result.text.match(/Recorded timing: \+12m/g)).toHaveLength(1);
    expect(result.text).toContain('Not administered');
  });
});

it('preserves date-only legacy facts without presenting invented midnight timing', async () => {
  const data = appointmentReportFixture();
  const prototype = appointmentReportFixture(true).doseLog[0]!;
  data.doseLog = [
    {
      ...prototype,
      occurredAt: '2026-11-01',
      scheduledFor: '2026-11-01',
      timingDeltaMinutes: null,
    },
  ];
  const result = await parse(false, data);
  expect(result.text).toContain('Scheduled: 2026-11-01');
  expect(result.text).toContain('Recorded timing: —');
  expect(result.text).not.toContain('00:00');
});

it('prints current and historic authored managed plans without fabricating dose events', async () => {
  const data = appointmentReportFixture();
  data.managedPlans = [1, 2].map((revisionNo) => ({
    courseId: 'synthetic-course',
    revisionId: `revision-${revisionNo}`,
    revisionNo,
    medicationId: 'synthetic-medication',
    medicationName: 'Synthetic managed medication',
    timezone: 'Europe/London',
    name: `Synthetic plan ${revisionNo}`,
    current: revisionNo === 2,
    status: revisionNo === 1 ? ('completed' as const) : ('paused' as const),
    deleted: false,
    startDate: revisionNo === 1 ? '2026-01-01' : '2026-02-01',
    endDate: null,
    closedDate: revisionNo === 1 ? '2026-01-31' : null,
    targetDose: '0.25',
    doseUnit: 'mg',
    doseBasis: 'per_injection' as const,
    schedules: appointmentReportFixture(true).currentMedications[0]!.schedules,
    steps: [{ doseAmount: '0.25', doseUnit: 'mg', durationDays: 28 }],
    activity: [
      { fromAt: '2026-01-01T08:00:00Z', untilAt: '2026-02-01T08:00:00Z' },
    ],
  }));
  const parsed = await parse(false, data);
  expect(parsed.text).toContain('Managed plan current and revision history');
  expect(parsed.text).toContain('Plan timezone: Europe/London.');
  expect(parsed.text).toContain('revision 1 | historical | completed');
  expect(parsed.text).toContain('revision 2 | current | paused');
  expect(parsed.text).toContain('Authored step 1: 0.25 mg; duration 28 days.');
  expect(parsed.text).toContain('No doses or medication events in this range.');
});
