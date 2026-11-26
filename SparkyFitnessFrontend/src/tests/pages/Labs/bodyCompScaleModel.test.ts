import {
  biaOffset,
  buildScaleBackground,
  calibrateBia,
  cleanWeightSeries,
  scaleReadings,
} from '@/pages/Labs/bodyCompScaleModel';

const scale = [
  { day: '2026-01-09', bodyFatPct: 16.1, weightKg: 81.9 },
  { day: '2026-01-10', bodyFatPct: 16.4, weightKg: 82.2 },
  { day: '2026-01-11', bodyFatPct: 16.0, weightKg: 82.0 },
];

describe('biaOffset', () => {
  it('uses the same-day reading first, then one day either side, and null beyond', () => {
    expect(biaOffset(24.0, scale, '2026-01-10')).toEqual({
      offsetPts: 7.6,
      scaleDay: '2026-01-10',
      anchorWeightKg: 82.2,
    });
    expect(
      biaOffset(
        24.0,
        scale.filter((s) => s.day !== '2026-01-10'),
        '2026-01-10'
      )?.scaleDay
    ).toBe('2026-01-09');
    expect(biaOffset(24.0, [], '2026-01-10')).toBeNull();
    expect(biaOffset(24.0, scale, '2026-01-13')).toBeNull();
  });

  it('skips readings with no body fat', () => {
    expect(
      biaOffset(
        24,
        [{ day: '2026-01-10', bodyFatPct: null, weightKg: 82 }],
        '2026-01-10'
      )
    ).toBeNull();
  });
});

describe('calibrateBia', () => {
  it('adds the offset and drops readings over 3 kg from the anchor weight', () => {
    const out = calibrateBia(
      [
        { day: '2026-02-01', bodyFatPct: 16.5, weightKg: 82.5 },
        { day: '2026-02-02', bodyFatPct: 15.0, weightKg: 78.0 },
        { day: '2026-02-03', bodyFatPct: null, weightKg: 82.0 },
      ],
      7.6,
      82.2
    );
    expect(out[0]?.calibratedPct).toBeCloseTo(24.1, 6);
    expect(out[1]?.calibratedPct).toBeNull();
    expect(out[2]?.calibratedPct).toBeNull();
  });

  it('keeps every reading with a body fat when there is no anchor weight', () => {
    const out = calibrateBia(
      [{ day: '2026-02-02', bodyFatPct: 15.0, weightKg: 70 }],
      1,
      null
    );
    expect(out[0]?.calibratedPct).toBeCloseTo(16, 6);
  });
});

describe('cleanWeightSeries', () => {
  it('excludes a reading over 3 kg from its neighbours median and counts it', () => {
    const rows = ['01', '02', '03', '04', '05', '06', '07', '08'].map(
      (d, i) => ({
        day: `2026-01-${d}`,
        weightKg: i === 5 ? 74.0 : 82 + (i % 2) * 0.2,
      })
    );
    const r = cleanWeightSeries(rows);
    expect(r.excluded.map((x) => x.day)).toEqual(['2026-01-06']);
    expect(r.kept).toHaveLength(7);
  });

  it('ignores rows without a weight and keeps a lone reading', () => {
    const r = cleanWeightSeries([
      { day: '2026-01-02', weightKg: 80 },
      { day: '2026-01-01', weightKg: null },
    ]);
    expect(r.kept).toEqual([{ day: '2026-01-02', weightKg: 80 }]);
    expect(r.excluded).toEqual([]);
  });
});

describe('scaleReadings', () => {
  it('makes one reading a day, oldest first, preferring the row with body fat', () => {
    const out = scaleReadings([
      { entry_date: '2026-11-06', weight: 80, body_fat_percentage: null },
      { entry_date: '2026-11-06', weight: 80.5, body_fat_percentage: 18 },
      { entry_date: '2026-11-06', weight: 81, body_fat_percentage: null },
      { entry_date: '2026-11-05T00:00:00.000Z', weight: 79 },
      { entry_date: '2026-11-04', weight: null, body_fat_percentage: null },
    ]);
    expect(out).toEqual([
      { day: '2026-11-05', weightKg: 79, bodyFatPct: null },
      { day: '2026-11-06', weightKg: 80.5, bodyFatPct: 18 },
    ]);
  });
});

describe('buildScaleBackground', () => {
  it('is null with no readings', () => {
    expect(buildScaleBackground([], [])).toBeNull();
  });

  it('has no offset and no calibrated series with no scan, but the raw body fat', () => {
    const bg = buildScaleBackground(scale, [])!;
    expect(bg.offsetPts).toBeNull();
    expect(bg.calibrated).toEqual([]);
    expect(bg.raw).toHaveLength(3);
    expect(bg.weight.kept).toHaveLength(3);
  });

  it('offsets to the latest scan', () => {
    const bg = buildScaleBackground(scale, [
      { scanned_day: '2025-12-01', pct_fat: 30 },
      { scanned_day: '2026-01-10', pct_fat: 24.0 },
    ])!;
    expect(bg.offsetPts).toBe(7.6);
    expect(bg.scaleDay).toBe('2026-01-10');
    expect(bg.calibrated[1]?.calibratedPct).toBeCloseTo(24, 6);
  });
});
