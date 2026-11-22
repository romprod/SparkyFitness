import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeDoseInsights,
  INSIGHT_MIN_SAMPLE,
  type DoseInsightInput,
  type InsightDose,
  type InsightSymptom,
  type InsightWearableDay,
} from '@workspace/shared';

const today = '2026-11-22';
const day = (back: number) => addDays(today, -back);
const dose = (back: number, time = '09:00:00'): InsightDose => ({
  at: `${day(back)}T${time}.000Z`,
  day: day(back),
});
const wear = (
  back: number,
  patch: Partial<InsightWearableDay> = {}
): InsightWearableDay => ({
  day: day(back),
  sleep_seconds: null,
  resting_hr: null,
  body_battery_high: null,
  ...patch,
});
const symptom = (
  back: number,
  patch: Partial<InsightSymptom> = {}
): InsightSymptom => ({
  name: 'Nausea',
  day: day(back),
  at: `${day(back)}T12:00:00.000Z`,
  severity_label: null,
  severity: null,
  ...patch,
});
const input = (patch: Partial<DoseInsightInput> = {}): DoseInsightInput => ({
  today,
  doses: [],
  wearable: [],
  weights: [],
  weight_unit: 'kg',
  symptoms: [],
  adherence_pct: null,
  ...patch,
});
const kinds = (list: ReturnType<typeof computeDoseInsights>) =>
  list.map((i) => i.kind);

describe('dose-day comparisons', () => {
  // Doses on days 1-5 back; wearable data on days 1-10 back, so five dose days and five others.
  const doses = [1, 2, 3, 4, 5].map((back) => dose(back));
  const rows = Array.from({ length: 10 }, (_, i) =>
    wear(i + 1, {
      sleep_seconds: (i < 5 ? 7 : 8.5) * 3600,
      resting_hr: i < 5 ? 62 : 58,
      body_battery_high: i < 5 ? 80 : 90,
    })
  );

  it('compares sleep, resting heart rate and Body Battery on dose days with other days', () => {
    const out = computeDoseInsights(input({ doses, wearable: rows }));
    expect(kinds(out)).toEqual([
      'sleep_dose',
      'resting_hr_dose',
      'body_battery_dose',
    ]);
    expect(out[0]).toEqual({
      kind: 'sleep_dose',
      on_dose: 7,
      other: 8.5,
      samples: { on_dose: 5, other: 5 },
    });
    expect(out[1]).toMatchObject({ on_dose: 62, other: 58 });
    expect(out[2]).toMatchObject({ on_dose: 80, other: 90 });
  });

  it('rounds sleep to one decimal and the others to whole numbers', () => {
    const odd = Array.from({ length: 10 }, (_, i) =>
      wear(i + 1, {
        sleep_seconds: (i < 5 ? 7.26 : 8.04) * 3600,
        resting_hr: i < 5 ? 61.6 : 58.4,
      })
    );
    const [sleep, hr] = computeDoseInsights(input({ doses, wearable: odd }));
    expect(sleep).toMatchObject({ on_dose: 7.3, other: 8 });
    expect(hr).toMatchObject({ on_dose: 62, other: 58 });
  });

  it('leaves a comparison out unless both sides have enough days', () => {
    expect(INSIGHT_MIN_SAMPLE).toBe(5);
    const fewDoseDays = computeDoseInsights(
      input({ doses: doses.slice(0, 4), wearable: rows })
    );
    expect(kinds(fewDoseDays)).toEqual([]);
    const fewOtherDays = computeDoseInsights(
      input({ doses, wearable: rows.slice(0, 9) })
    );
    expect(kinds(fewOtherDays)).toEqual([]);
  });

  it('skips days with no reading for that metric, per metric', () => {
    const gaps = rows.map((row, i) =>
      i === 0 ? { ...row, body_battery_high: null } : row
    );
    const out = computeDoseInsights(input({ doses, wearable: gaps }));
    const battery = out.find((i) => i.kind === 'body_battery_dose');
    // The first of the five dose days has no Body Battery, so only four remain: left out.
    expect(battery).toBeUndefined();
    expect(out.find((i) => i.kind === 'sleep_dose')).toBeDefined();
  });

  it('ignores readings and doses outside the 90 day window', () => {
    const old = [95, 96, 97, 98, 99].map((back) =>
      wear(back, { sleep_seconds: 3600 })
    );
    expect(
      kinds(computeDoseInsights(input({ doses, wearable: [...rows, ...old] })))
    ).toContain('sleep_dose');
    const out = computeDoseInsights(
      input({
        doses: [95, 96, 97, 98, 99].map((back) => dose(back)),
        wearable: rows,
      })
    );
    expect(kinds(out)).toEqual([]);
    // Day 89 back is the first day of the window; day 90 back is outside it.
    const around = (first: number) => ({
      doses: [0, 1, 2, 3, 4].map((i) => dose(first - i)),
      wearable: Array.from({ length: 10 }, (_, i) =>
        wear(first - i, { sleep_seconds: 7 * 3600 })
      ),
    });
    expect(kinds(computeDoseInsights(input(around(89))))).toContain(
      'sleep_dose'
    );
    expect(kinds(computeDoseInsights(input(around(90))))).toEqual([]);
  });
});

describe('weight trend', () => {
  const weights = (backs: number[], value = (back: number) => 90 - back / 10) =>
    backs.map((back) => ({ day: day(back), value: value(back) }));

  it('reports the change from the first to the latest reading in each look-back window', () => {
    // 95 kg 85 days back, then a kilo lost every ten days.
    const out = computeDoseInsights(
      input({
        weights: weights(
          [85, 80, 50, 45, 40, 20, 15, 10, 5, 0],
          (back) => 95 - (85 - back) / 10
        ),
      })
    );
    const trend = out.find((i) => i.kind === 'weight_trend');
    expect(trend).toMatchObject({ unit: 'kg' });
    if (trend?.kind !== 'weight_trend') throw new Error('no trend');
    expect(trend.windows.map((w) => w.days)).toEqual([30, 60, 90]);
    const byDays = Object.fromEntries(trend.windows.map((w) => [w.days, w]));
    // 30 days: points on days 20, 15, 10, 5, 0 back.
    expect(byDays[30]).toEqual({ days: 30, delta: -2, samples: 5 });
    // 60 days: the eight points from 50 days back.
    expect(byDays[60]).toEqual({ days: 60, delta: -5, samples: 8 });
    // 90 days: all ten points, 85 back to today.
    expect(byDays[90]).toEqual({ days: 90, delta: -8.5, samples: 10 });
  });

  it('counts a window as its last N days including today, so the day N back is outside it', () => {
    const out = computeDoseInsights(
      input({ weights: weights([30, 29, 20, 10, 0]) })
    );
    const trend = out.find((i) => i.kind === 'weight_trend');
    if (trend?.kind !== 'weight_trend') throw new Error('no trend');
    // 30 days back is not in the 30-day window, leaving four points: no 30-day line.
    expect(trend.windows.map((w) => w.days)).toEqual([60, 90]);
  });

  it('says nothing when no window has enough readings, and ignores non-numbers', () => {
    expect(
      kinds(computeDoseInsights(input({ weights: weights([3, 2, 1, 0]) })))
    ).toEqual([]);
    const withBad = [
      ...weights([4, 3, 2, 1]),
      { day: day(0), value: Number.NaN },
    ];
    expect(kinds(computeDoseInsights(input({ weights: withBad })))).toEqual([]);
  });

  it('shows a flat weight as a change of zero', () => {
    const flat = weights([4, 3, 2, 1, 0], () => 80);
    const trend = computeDoseInsights(input({ weights: flat })).find(
      (i) => i.kind === 'weight_trend'
    );
    if (trend?.kind !== 'weight_trend') throw new Error('no trend');
    expect(trend.windows[0]).toEqual({ days: 30, delta: 0, samples: 5 });
  });
});

describe('most-logged symptoms', () => {
  it('lists the three most frequent by days logged, with the label most entries carry', () => {
    const symptoms = [
      symptom(1, { name: 'Nausea', severity_label: 'Mild', severity: 2 }),
      symptom(2, { name: 'nausea', severity_label: 'Moderate', severity: 5 }),
      symptom(3, { name: 'Nausea', severity_label: 'Moderate', severity: 5 }),
      symptom(1, { name: 'Headache', severity_label: 'Mild', severity: 2 }),
      symptom(2, { name: 'Headache' }),
      symptom(4, { name: 'Fatigue' }),
      symptom(5, { name: 'Bloating' }),
    ];
    const out = computeDoseInsights(input({ symptoms }));
    const found = out.find((i) => i.kind === 'symptom_frequency');
    if (found?.kind !== 'symptom_frequency') throw new Error('none');
    expect(found.top).toEqual([
      { name: 'Nausea', days: 3, mostly: 'moderate' },
      { name: 'Headache', days: 2, mostly: 'mild' },
      // Tied on one day each: alphabetical, so Bloating before Fatigue.
      { name: 'Bloating', days: 1, mostly: null },
    ]);
  });

  it('counts days, not entries, when a symptom is logged twice on a day', () => {
    const out = computeDoseInsights(
      input({
        symptoms: [
          symptom(1, { at: `${day(1)}T08:00:00.000Z` }),
          symptom(1, { at: `${day(1)}T20:00:00.000Z` }),
        ],
      })
    );
    const found = out.find((i) => i.kind === 'symptom_frequency');
    if (found?.kind !== 'symptom_frequency') throw new Error('none');
    expect(found.top).toEqual([{ name: 'Nausea', days: 1, mostly: null }]);
  });

  it('breaks a tie between labels toward the milder one', () => {
    const symptoms = [
      symptom(1, { severity_label: 'Severe', severity: 9 }),
      symptom(2, { severity_label: 'Mild', severity: 2 }),
    ];
    const found = computeDoseInsights(input({ symptoms })).find(
      (i) => i.kind === 'symptom_frequency'
    );
    if (found?.kind !== 'symptom_frequency') throw new Error('none');
    expect(found.top[0]?.mostly).toBe('mild');
  });

  it('ignores symptoms outside the window and blank names', () => {
    const out = computeDoseInsights(
      input({
        symptoms: [symptom(120), symptom(1, { name: '   ' })],
      })
    );
    expect(kinds(out)).toEqual([]);
  });
});

describe('symptom timing after a dose', () => {
  it('buckets each symptom day by hours since the dose before it', () => {
    // One dose every 7 days; a symptom 3h, 20h, 30h, 70h and 100h after a dose.
    const doses: InsightDose[] = [
      { at: '2026-11-01T09:00:00.000Z', day: '2026-11-01' },
      { at: '2026-11-08T09:00:00.000Z', day: '2026-11-08' },
      { at: '2026-11-15T09:00:00.000Z', day: '2026-11-15' },
    ];
    const at = (iso: string): InsightSymptom => ({
      name: 'Nausea',
      day: iso.slice(0, 10),
      at: iso,
      severity_label: null,
      severity: null,
    });
    const symptoms = [
      at('2026-11-01T12:00:00.000Z'), // 3h
      at('2026-11-09T05:00:00.000Z'), // 20h
      at('2026-11-16T15:00:00.000Z'), // 30h
      at('2026-11-11T07:00:00.000Z'), // 70h
      at('2026-11-12T13:00:00.000Z'), // 100h
    ];
    const timing = computeDoseInsights(input({ doses, symptoms })).find(
      (i) => i.kind === 'symptom_timing'
    );
    expect(timing).toEqual({
      kind: 'symptom_timing',
      total: 5,
      within_24h: 2,
      from_24h_to_72h: 2,
      after_72h: 1,
    });
  });

  it('times a symptom from the dose taken earlier the same day, not the one before', () => {
    const doses: InsightDose[] = [
      { at: '2026-11-01T09:00:00.000Z', day: '2026-11-01' },
      { at: '2026-11-08T09:00:00.000Z', day: '2026-11-08' },
    ];
    const symptoms = Array.from({ length: 5 }, (_, i): InsightSymptom => {
      const dayKey = `2026-11-0${i + 1}`;
      return {
        name: 'Nausea',
        day: dayKey,
        at: `${dayKey}T21:00:00.000Z`,
        severity_label: null,
        severity: null,
      };
    });
    const timing = computeDoseInsights(input({ doses, symptoms })).find(
      (i) => i.kind === 'symptom_timing'
    );
    if (timing?.kind !== 'symptom_timing') throw new Error('no timing');
    // 12h after the 1 Nov dose, then 36h, 60h, 84h and 108h after it.
    expect(timing.within_24h).toBe(1);
    expect(timing.from_24h_to_72h).toBe(2);
    expect(timing.after_72h).toBe(2);
  });

  it('counts a day once however many symptoms it has, and skips days before any dose', () => {
    const doses: InsightDose[] = [
      { at: '2026-11-10T09:00:00.000Z', day: '2026-11-10' },
    ];
    const entry = (iso: string, name = 'Nausea'): InsightSymptom => ({
      name,
      day: iso.slice(0, 10),
      at: iso,
      severity_label: null,
      severity: null,
    });
    const symptoms = [
      entry('2026-11-05T09:00:00.000Z'), // before any dose: not timed
      entry('2026-11-11T08:00:00.000Z'),
      entry('2026-11-11T09:00:00.000Z', 'Headache'),
      entry('2026-11-12T08:00:00.000Z'),
      entry('2026-11-13T08:00:00.000Z'),
      entry('2026-11-14T08:00:00.000Z'),
      entry('2026-11-15T08:00:00.000Z'),
    ];
    const timing = computeDoseInsights(input({ doses, symptoms })).find(
      (i) => i.kind === 'symptom_timing'
    );
    if (timing?.kind !== 'symptom_timing') throw new Error('no timing');
    expect(timing.total).toBe(5);
  });

  it('is left out with fewer than five timed days', () => {
    const doses = [{ at: '2026-11-10T09:00:00.000Z', day: '2026-11-10' }];
    const symptoms = [
      {
        name: 'Nausea',
        day: '2026-11-11',
        at: '2026-11-11T08:00:00.000Z',
        severity_label: null,
        severity: null,
      },
    ];
    expect(
      kinds(computeDoseInsights(input({ doses, symptoms })))
    ).not.toContain('symptom_timing');
  });
});

describe('adherence beside weight', () => {
  const weights = [4, 3, 2, 1, 0].map((back) => ({
    day: day(back),
    value: 80 - back,
  }));

  it('pairs adherence with the longest weight window, as a neutral observation', () => {
    const out = computeDoseInsights(
      input({ weights, adherence_pct: 92, weight_unit: 'lbs' })
    );
    expect(out.at(-1)).toEqual({
      kind: 'adherence_weight',
      adherence_pct: 92,
      unit: 'lbs',
      weight: { days: 90, delta: 4, samples: 5 },
    });
  });

  it('needs both an adherence figure and a weight trend', () => {
    expect(
      kinds(computeDoseInsights(input({ weights, adherence_pct: null })))
    ).not.toContain('adherence_weight');
    expect(
      kinds(computeDoseInsights(input({ adherence_pct: 90 })))
    ).not.toContain('adherence_weight');
  });
});

it('returns nothing at all when there is no data', () => {
  expect(computeDoseInsights(input())).toEqual([]);
});

it('keeps the insights in a fixed order', () => {
  const doses = [1, 2, 3, 4, 5].map((back) => dose(back));
  const wearable = Array.from({ length: 10 }, (_, i) =>
    wear(i + 1, { sleep_seconds: 7 * 3600, resting_hr: 60 })
  );
  const weights = [4, 3, 2, 1, 0].map((back) => ({
    day: day(back),
    value: 80,
  }));
  const symptoms = [1, 2, 3, 4, 5].map((back) => symptom(back));
  expect(
    kinds(
      computeDoseInsights(
        input({ doses, wearable, weights, symptoms, adherence_pct: 100 })
      )
    )
  ).toEqual([
    'sleep_dose',
    'resting_hr_dose',
    'weight_trend',
    'symptom_frequency',
    'symptom_timing',
    'adherence_weight',
  ]);
});
