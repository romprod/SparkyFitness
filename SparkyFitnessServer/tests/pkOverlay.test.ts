import { describe, expect, it } from 'vitest';
import {
  buildPkOverlay,
  GENERIC_ABSORPTION_HOURS,
  MAX_HALF_LIFE_HOURS,
  medicationHalfLifeHours,
  missedDoseTimes,
  readHalfLifeHours,
  resolveMedicationPkProfile,
  type PkOverlaySeries,
} from '@workspace/shared';

const now = '2026-11-22T12:00:00.000Z';
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(now) + days * DAY);
const profile = { halfLifeDays: 6, tMaxDays: 1.5 };
const series = (patch: Partial<PkOverlaySeries> = {}): PkOverlaySeries => ({
  id: 'reta',
  name: 'Retatrutide',
  profile,
  taken: [-28, -21, -14, -7, -0.25].map((d) => ({ at: at(d), dose_mg: 2 })),
  planned: [],
  ...patch,
});
const build = (list: PkOverlaySeries[], windowDays = 14) =>
  buildPkOverlay({ series: list, now, window_days: windowDays });

describe('modeled profile of a medication', () => {
  it('uses the catalogue by name or by the saved drug', () => {
    expect(resolveMedicationPkProfile({ name: 'Retatrutide' })).toEqual({
      halfLifeDays: 6,
      tMaxDays: 1.5,
    });
    expect(
      resolveMedicationPkProfile({
        name: 'My vial',
        custom_fields: { glp1_drug: 'cagrilintide' },
      })
    ).toEqual({ halfLifeDays: 7.4, tMaxDays: 2 });
  });
  it('uses the person’s own half-life for a custom drug, with the usual defaults', () => {
    expect(
      resolveMedicationPkProfile({
        name: 'Custom',
        custom_fields: {
          glp1_drug: 'custom',
          custom_half_life_days: 3,
          custom_t_max_days: 0.5,
        },
      })
    ).toEqual({ halfLifeDays: 3, tMaxDays: 0.5 });
    expect(
      resolveMedicationPkProfile({
        name: 'Custom',
        custom_fields: { glp1_drug: 'custom' },
      })
    ).toEqual({ halfLifeDays: 7, tMaxDays: 1.5 });
  });
  it('has none for an unknown medication or invalid parameters', () => {
    expect(resolveMedicationPkProfile({ name: 'Sertraline' })).toBeNull();
    expect(
      resolveMedicationPkProfile({
        name: 'Custom',
        custom_fields: { glp1_drug: 'custom', custom_half_life_days: -2 },
      })
    ).toBeNull();
  });
});

describe('a half-life entered for any medication', () => {
  it('reads a positive number of hours, from a number or from text', () => {
    expect(readHalfLifeHours({ half_life_hours: 4 })).toBe(4);
    expect(readHalfLifeHours({ half_life_hours: '5.5' })).toBe(5.5);
    expect(readHalfLifeHours({ half_life_hours: 99999 })).toBe(
      MAX_HALF_LIFE_HOURS
    );
  });
  it('is none when it is missing, blank, zero, negative or not a number', () => {
    for (const fields of [
      undefined,
      null,
      'text',
      {},
      { half_life_hours: '' },
      { half_life_hours: '  ' },
      { half_life_hours: 0 },
      { half_life_hours: -3 },
      { half_life_hours: 'abc' },
      { half_life_hours: null },
      { half_life_hours: Number.NaN },
    ])
      expect(readHalfLifeHours(fields)).toBeNull();
  });
  it('models a medication with no catalogue entry from its own half-life, absorbed in about an hour', () => {
    const profile = resolveMedicationPkProfile({
      name: 'BPC-157',
      custom_fields: { half_life_hours: 4 },
    });
    expect(profile).not.toBeNull();
    expect(profile!.halfLifeDays).toBeCloseTo(4 / 24, 12);
    expect(profile!.tMaxDays).toBeCloseTo(GENERIC_ABSORPTION_HOURS / 24, 12);
  });
  it('caps the time to peak at half the half-life for a compound that clears within two hours', () => {
    const profile = resolveMedicationPkProfile({
      name: 'Quick',
      custom_fields: { half_life_hours: 1 },
    });
    expect(profile!.halfLifeDays).toBeCloseTo(1 / 24, 12);
    expect(profile!.tMaxDays).toBeCloseTo(1 / 48, 12);
  });
  it('wins over the catalogue, since it is the person’s own figure', () => {
    expect(
      resolveMedicationPkProfile({
        name: 'Retatrutide',
        custom_fields: { half_life_hours: 144 },
      })
    ).toMatchObject({ halfLifeDays: 6 });
    expect(
      resolveMedicationPkProfile({
        name: 'Retatrutide',
        custom_fields: { half_life_hours: 48 },
      })!.halfLifeDays
    ).toBeCloseTo(2, 12);
  });
  it('falls back to the catalogue or the custom GLP-1 figures when the entry is invalid', () => {
    expect(
      resolveMedicationPkProfile({
        name: 'Retatrutide',
        custom_fields: { half_life_hours: 'abc' },
      })
    ).toEqual({ halfLifeDays: 6, tMaxDays: 1.5 });
    expect(
      resolveMedicationPkProfile({
        name: 'Unknown',
        custom_fields: { half_life_hours: -1 },
      })
    ).toBeNull();
  });
});

describe('overlay lines', () => {
  it('scales a medication to its own peak and ends the taken part at now', () => {
    const [line] = build([series()]);
    const levels = line!.historical.map((p) => p.level);
    expect(
      Math.max(...levels, ...line!.forecast.map((p) => p.level))
    ).toBeCloseTo(1, 10);
    expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true);
    expect(line!.historical.at(-1)!.t).toBe(Date.parse(now));
    expect(line!.now_level).toBeGreaterThan(0);
    expect(line!.now_level).toBeLessThanOrEqual(1);
    // Doses already taken keep acting ahead of now, so the forecast is never empty.
    expect(line!.includes_planned).toBe(false);
    expect(line!.forecast[0]!.t).toBe(Date.parse(now));
    expect(line!.forecast.at(-1)!.t).toBe(Date.parse(now) + 14 * DAY);
  });
  it('spans the window either side of now at six-hour steps', () => {
    const [line] = build([series()], 7);
    const all = [...line!.historical];
    expect(all[0]!.t).toBe(Date.parse(now) - 7 * DAY);
    expect(all[1]!.t - all[0]!.t).toBe(6 * 3_600_000);
  });
  it('still counts a dose taken before the window, which has not cleared', () => {
    const [line] = build([series({ taken: [{ at: at(-10), dose_mg: 1 }] })], 3);
    // Falling from its peak well before the window, so the window starts at its own peak.
    expect(line!.historical[0]!.level).toBeCloseTo(1, 10);
    expect(line!.now_level).toBeLessThan(1);
  });
  it('adds planned doses to a forecast that joins at now, and leaves taken history unchanged', () => {
    const without = build([series()])[0]!;
    const withPlan = build([
      series({ planned: [{ at: at(2), dose_mg: 4 }] }),
    ])[0]!;
    expect(withPlan.includes_planned).toBe(true);
    expect(without.includes_planned).toBe(false);
    expect(withPlan.forecast[0]!.t).toBe(Date.parse(now));
    expect(withPlan.forecast.at(-1)!.t).toBe(Date.parse(now) + 14 * DAY);
    // A larger planned dose reshapes the peak, so only the shape up to now is compared.
    const ratio = (a: number, b: number) => a / b;
    const first = ratio(
      without.historical[10]!.level,
      without.historical[20]!.level
    );
    const second = ratio(
      withPlan.historical[10]!.level,
      withPlan.historical[20]!.level
    );
    expect(second).toBeCloseTo(first, 8);
    expect(withPlan.forecast.some((p) => p.level > withPlan.now_level)).toBe(
      true
    );
  });
  it('ignores planned doses already past, taken doses still ahead, and unusable doses', () => {
    const [line] = build([
      series({
        taken: [
          { at: at(-1), dose_mg: 2 },
          { at: at(3), dose_mg: 2 },
          { at: at(-2), dose_mg: 0 },
          { at: 'not a date', dose_mg: 2 },
        ],
        planned: [{ at: at(-0.5), dose_mg: 9 }],
      }),
    ]);
    expect(line!.includes_planned).toBe(false);
    const single = build([series({ taken: [{ at: at(-1), dose_mg: 2 }] })])[0]!;
    expect(line!.now_level).toBeCloseTo(single.now_level, 12);
  });
  it('leaves out a medication with no usable dose', () => {
    expect(build([series({ taken: [], planned: [] })])).toEqual([]);
    expect(build([series({ taken: [{ at: at(-1), dose_mg: 0 }] })])).toEqual(
      []
    );
  });
  it('scales each medication separately and lists them by name', () => {
    const lines = build([
      series({
        id: 'z',
        name: 'Zeta',
        profile: { halfLifeDays: 0.5, tMaxDays: 0.3 },
      }),
      series({ id: 'a', name: 'Alpha' }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(['Alpha', 'Zeta']);
    for (const line of lines)
      expect(
        Math.max(...[...line.historical, ...line.forecast].map((p) => p.level))
      ).toBeCloseTo(1, 10);
  });
  it('returns nothing for a nonsense window or time', () => {
    expect(build([series()], 0)).toEqual([]);
    expect(
      buildPkOverlay({ series: [series()], now: 'nope', window_days: 7 })
    ).toEqual([]);
  });
});

describe('sampling a short half-life', () => {
  const short: PkOverlaySeries = {
    id: 'bpc',
    name: 'BPC-157',
    profile: { halfLifeDays: 4 / 24, tMaxDays: 1 / 24 },
    // A dose every day at the same hour, for a week before now.
    taken: [-7, -6, -5, -4, -3, -2, -1].map((d) => ({
      at: at(d),
      dose_mg: 0.25,
    })),
    planned: [],
  };

  it('samples a quarter of the half-life apart, so each daily peak shows', () => {
    const [line] = build([short], 7);
    // Hourly: 4 hours / 4, over 14 days either side of now.
    const times = line!.historical.map((p) => p.t);
    const gaps = new Set(times.slice(1).map((t, i) => t - times[i]!));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(3_600_000);
    expect(times.length).toBeGreaterThan(160);
  });
  it('never samples finer than half an hour', () => {
    const [line] = build(
      [{ ...short, profile: { halfLifeDays: 0.5 / 24, tMaxDays: 0.25 / 24 } }],
      2
    );
    const times = line!.historical.map((p) => p.t);
    const smallest = Math.min(...times.slice(1).map((t, i) => t - times[i]!));
    expect(smallest).toBeGreaterThanOrEqual(30 * 60_000 - 1);
  });
  it('leaves a half-life of days at the six-hour step', () => {
    const [line] = build([series()]);
    const times = line!.historical.map((p) => p.t);
    const gaps = new Set(times.slice(1).map((t, i) => t - times[i]!));
    expect(Math.max(...gaps)).toBe(6 * 3_600_000);
  });
  it('leaves almost nothing of a 4-hour half-life a day after the last dose', () => {
    const [line] = build([short], 7);
    const level = (hoursAfterNow: number) =>
      [...line!.historical, ...line!.forecast].find(
        (p) => p.t === Date.parse(now) + hoursAfterNow * 3_600_000
      )!.level;
    // The last dose was a day before now: six half-lives, so under 2% of a peak remains.
    expect(level(0)).toBeLessThan(0.05);
    expect(level(24)).toBeLessThan(0.001);
  });
});

describe('medicationHalfLifeHours', () => {
  it('reads the person’s own figure, a GLP-1 profile, or nothing', () => {
    expect(
      medicationHalfLifeHours({
        name: 'BPC-157',
        custom_fields: { half_life_hours: 4 },
      })
    ).toBe(4);
    expect(medicationHalfLifeHours({ name: 'Semaglutide' })).toBe(168);
    expect(medicationHalfLifeHours({ name: 'BPC-157' })).toBeNull();
  });
});

describe('missed dose markers', () => {
  const nowIso = '2026-11-23T12:00:00Z';
  const ids = new Set(['reta']);
  const slot = (over: Record<string, unknown> = {}) => ({
    medication_id: 'reta',
    status: 'missed',
    scheduled_for: '2026-11-20T09:00:00Z',
    ...over,
  });
  const marks = (slots: ReturnType<typeof slot>[], days = 14) =>
    missedDoseTimes({
      slots,
      medication_ids: ids,
      now: nowIso,
      window_days: days,
    });

  it('lists missed planned doses of the drawn medications in the window, earliest first, once each', () => {
    expect(
      marks([
        slot({ scheduled_for: '2026-11-20T09:00:00Z' }),
        slot({ scheduled_for: '2026-11-13T09:00:00Z' }),
        slot({ scheduled_for: '2026-11-20T09:00:00Z' }),
      ])
    ).toEqual([
      Date.parse('2026-11-13T09:00:00Z'),
      Date.parse('2026-11-20T09:00:00Z'),
    ]);
  });

  it('leaves out other statuses, other medications, doses outside the window and ahead of now', () => {
    expect(
      marks([
        slot({ status: 'taken' }),
        slot({ status: 'planned' }),
        slot({ status: 'skipped' }),
        slot({ medication_id: 'other' }),
        slot({ medication_id: null }),
        slot({ scheduled_for: null }),
        slot({ scheduled_for: '2026-11-01T09:00:00Z' }),
        slot({ scheduled_for: '2026-11-24T09:00:00Z' }),
        slot({ scheduled_for: 'soon' }),
      ])
    ).toEqual([]);
    expect(
      marks([slot({ scheduled_for: '2026-11-01T09:00:00Z' })], 30)
    ).toHaveLength(1);
  });

  it('marks nothing for a bad clock or window', () => {
    expect(
      missedDoseTimes({
        slots: [slot()],
        medication_ids: ids,
        now: 'x',
        window_days: 14,
      })
    ).toEqual([]);
    expect(marks([slot()], 0)).toEqual([]);
  });
});
