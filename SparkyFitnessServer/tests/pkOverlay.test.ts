import { describe, expect, it } from 'vitest';
import {
  buildPkOverlay,
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
