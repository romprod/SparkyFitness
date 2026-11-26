import type { LifeEvent } from '@workspace/shared';
import {
  DAY_MS,
  DEFAULT_BMD_CV_PCT,
  FORWARD_DAYS,
  bandEndTime,
  bmdNoiseBand,
  buildSeriesPanels,
  dayMs,
  lifeEventShades,
  msDay,
  panelAxisRange,
  panelValueRange,
  scansOldestFirst,
  seriesTimeRange,
  showSeriesLine,
} from '@/pages/Labs/bodyCompSeriesModel';
import type { ScaleBackground } from '@/pages/Labs/bodyCompScaleModel';
import { makeScan } from './bodyCompTestKit';

const test = (day: string, kcal: number) => ({
  tested_day: day,
  measured_rmr_kcal: kcal,
});
const panel = (panels: ReturnType<typeof buildSeriesPanels>, key: string) =>
  panels.find((p) => p.key === key);

describe('buildSeriesPanels', () => {
  it('lists the panels in Pitstop order, each with its own bands', () => {
    const panels = buildSeriesPanels([makeScan()], [test('2026-08-12', 1800)]);
    expect(panels.map((p) => p.key)).toEqual([
      'fat',
      'lean',
      'pctFat',
      'alm',
      'vat',
      'bmd',
      'rmr',
      'weight',
    ]);
    const fat = panel(panels, 'fat')!.points[0]!;
    expect(fat.v).toBeCloseTo(20);
    // 20 kg x 0.78 % x 2.77, and 1.9 times that over days.
    expect(fat.band!.technical).toBeCloseTo(0.43212, 4);
    expect(fat.band!.practical).toBeCloseTo(0.43212 * 1.9, 4);
    const lean = panel(panels, 'lean')!.points[0]!;
    expect(lean.band!.technical).toBeCloseTo(60 * 0.0052 * 2.77, 4);
    expect(lean.band!.practical).toBeCloseTo(60 * 0.0052 * 2.77 * 3.4, 4);
    const pct = panel(panels, 'pctFat')!.points[0]!;
    expect(pct.band).toEqual({ technical: 0.5, practical: 0.5 * 3.4 });
    // 29 kg ALM from the four limbs; technical only.
    const alm = panel(panels, 'alm')!.points[0]!;
    expect(alm.v).toBeCloseTo(29);
    expect(alm.band!.technical).toBeCloseTo(29 * 0.01 * 2.77, 4);
    expect(alm.band!.practical).toBeNull();
    const vat = panel(panels, 'vat')!.points[0]!;
    expect(vat.band!.technical).toBeCloseTo(800 * 0.0263 * 2.77, 4);
    expect(vat.band!.practical).toBeCloseTo(800 * 0.0263 * 2.77 * 2, 4);
    const rmr = panel(panels, 'rmr')!.points[0]!;
    expect(rmr.band!.technical).toBeCloseTo(1800 * 0.08 * 2.77, 4);
    expect(rmr.band!.practical).toBeNull();
  });

  it('gives weight the clinic weight and no band', () => {
    const weight = panel(buildSeriesPanels([makeScan()], []), 'weight')!;
    expect(weight.points[0]).toMatchObject({ v: 83, band: null });
  });

  it('leaves out a panel that has no point', () => {
    const bare = makeScan({
      vat_mass_g: null,
      total_bmd_gcm2: null,
      clinic_weight_kg: null,
      regions: [],
    });
    const keys = buildSeriesPanels([bare], []).map((p) => p.key);
    expect(keys).toEqual(['fat', 'lean', 'pctFat']);
  });

  it('uses the scan’s own BMD CV when printed, otherwise the default', () => {
    const printed = makeScan({ bmd_cv_pct: 2 });
    const plain = makeScan({ id: 'b', scanned_day: '2026-11-01' });
    const bmd = panel(buildSeriesPanels([printed, plain], []), 'bmd')!;
    expect(bmd.points[0]!.band!.technical).toBeCloseTo(1.31 * 0.02 * 2.77, 5);
    expect(bmd.points[1]!.band!.technical).toBeCloseTo(
      1.31 * (DEFAULT_BMD_CV_PCT / 100) * 2.77,
      5
    );
    expect(bmd.points[1]!.band!.practical).toBeNull();
  });

  it('treats a printed zero CV as not printed', () => {
    expect(bmdNoiseBand(1.3, 0).technical).toBeCloseTo(1.3 * 0.01 * 2.77, 6);
    expect(bmdNoiseBand(1.3, null).technical).toBeCloseTo(1.3 * 0.01 * 2.77, 6);
  });

  it('orders points oldest first whichever way the scans arrive', () => {
    const newer = makeScan({ id: 'n', scanned_day: '2026-11-02' });
    const older = makeScan({ id: 'o' });
    const points = panel(buildSeriesPanels([newer, older], []), 'fat')!.points;
    expect(points.map((p) => p.day)).toEqual(['2026-08-10', '2026-11-02']);
    expect(scansOldestFirst([newer, older]).map((s) => s.id)).toEqual([
      'o',
      'n',
    ]);
  });

  it('takes RMR points from the metabolic tests, oldest first', () => {
    const rmr = panel(
      buildSeriesPanels(
        [makeScan()],
        [test('2026-09-01', 1900), test('2026-07-01', 1800)]
      ),
      'rmr'
    )!;
    expect(rmr.points.map((p) => p.v)).toEqual([1800, 1900]);
  });
});

describe('time axis and bands', () => {
  const scans = [
    makeScan({ scanned_day: '2026-08-10' }),
    makeScan({ id: 'b', scanned_day: '2026-11-02' }),
  ];
  const panels = buildSeriesPanels(scans, []);

  it('runs from the first point to 112 days past the latest scan', () => {
    const { tMin, tMax } = seriesTimeRange(panels, scans);
    expect(tMin).toBe(dayMs('2026-08-10'));
    expect(tMax).toBe(dayMs('2026-11-02') + FORWARD_DAYS * DAY_MS);
    expect(msDay(tMax)).toBe('2027-02-22');
  });

  it('runs a band to the next point, and 112 days forward for the last', () => {
    const points = panel(panels, 'fat')!.points;
    expect(bandEndTime(points, 0)).toBe(dayMs('2026-11-02'));
    expect(bandEndTime(points, 1)).toBe(
      dayMs('2026-11-02') + FORWARD_DAYS * DAY_MS
    );
  });

  it('draws no line until there are three scans and three points', () => {
    expect(showSeriesLine(2, 2)).toBe(false);
    expect(showSeriesLine(3, 2)).toBe(false);
    expect(showSeriesLine(2, 3)).toBe(false);
    expect(showSeriesLine(3, 3)).toBe(true);
  });

  it('opens out a flat axis and pads the span', () => {
    const flat = panelValueRange([
      { t: 0, day: 'a', v: 10, band: null },
      { t: 1, day: 'b', v: 10, band: null },
    ]);
    expect(flat.lo).toBeLessThan(10);
    expect(flat.hi).toBeGreaterThan(10);
    const banded = panelValueRange([
      { t: 0, day: 'a', v: 10, band: { technical: 1, practical: 2 } },
    ]);
    // The wider (practical) band sizes the axis: 8 to 12, plus 15 % each side.
    expect(banded.lo).toBeCloseTo(8 - 4 * 0.15);
    expect(banded.hi).toBeCloseTo(12 + 4 * 0.15);
  });
});

describe('lifeEventShades', () => {
  const event = (patch: Partial<LifeEvent>): LifeEvent => ({
    id: 'e1',
    kind: 'illness',
    start_day: '2026-09-01',
    end_day: '2026-09-03',
    label: 'flu',
    notes: null,
    ...patch,
  });
  const tMin = dayMs('2026-08-10');
  const tMax = dayMs('2026-11-02');

  it('covers the end day in full', () => {
    const [shade] = lifeEventShades([event({})], tMin, tMax);
    expect(shade).toMatchObject({
      kind: 'illness',
      t0: dayMs('2026-09-01'),
      t1: dayMs('2026-09-03') + DAY_MS,
      title: 'illness: flu 2026-09-01 → 2026-09-03',
    });
  });

  it('drops windows outside the plotted range and never widens it', () => {
    const shades = lifeEventShades(
      [
        event({ id: 'before', start_day: '2026-01-01', end_day: '2026-01-05' }),
        event({ id: 'after', start_day: '2027-03-01', end_day: '2027-03-05' }),
        event({ id: 'edge', start_day: '2026-08-01', end_day: '2026-08-10' }),
        event({ id: 'in', kind: 'travel', label: null }),
      ],
      tMin,
      tMax
    );
    expect(shades.map((s) => s.key)).toEqual(['edge', 'in']);
    expect(shades[1]!.title).toBe('travel 2026-09-01 → 2026-09-03');
  });
});

describe('buildSeriesPanels with a scale background', () => {
  const scale = (over: Partial<ScaleBackground> = {}): ScaleBackground => ({
    offsetPts: 1,
    scaleDay: '2026-08-10',
    weight: {
      kept: [
        { day: '2026-08-01', weightKg: 82 },
        { day: '2026-08-02', weightKg: 82.4 },
      ],
      excluded: [{ day: '2026-08-03', weightKg: 70 }],
    },
    calibrated: [{ day: '2026-08-01', calibratedPct: 20 }],
    raw: [{ day: '2026-08-01', bodyFatPct: 18 }],
    ...over,
  });
  const scans2 = [
    makeScan({ id: 'a', scanned_day: '2026-08-10' }),
    makeScan({ id: 'b', scanned_day: '2026-11-02' }),
  ];

  it('puts the weight background and excluded count on the weight panel', () => {
    const w = panel(
      buildSeriesPanels([makeScan()], [], undefined, scale()),
      'weight'
    )!;
    expect(w.bg.map((b) => b.v)).toEqual([82, 82.4]);
    expect(w.bg[0]?.t).toBe(dayMs('2026-08-01'));
    expect(w.bgKind).toBe('weight');
    expect(w.bgSharesAxis).toBe(true);
    expect(w.excludedCount).toBe(1);
  });

  it('adds the calibrated body fat to the body fat panel only from two scans, off the axis', () => {
    const one = panel(
      buildSeriesPanels([makeScan()], [], undefined, scale()),
      'pctFat'
    )!;
    expect(one.bg).toEqual([]);
    const two = panel(
      buildSeriesPanels(scans2, [], undefined, scale()),
      'pctFat'
    )!;
    expect(two.bg).toHaveLength(1);
    expect(two.bgKind).toBe('bia');
    expect(two.bgSharesAxis).toBe(false);
    expect(panelAxisRange(two)).toEqual(panelValueRange(two.points));
  });

  it('leaves out calibrated points that are null', () => {
    const two = panel(
      buildSeriesPanels(
        scans2,
        [],
        undefined,
        scale({ calibrated: [{ day: '2026-08-01', calibratedPct: null }] })
      ),
      'pctFat'
    )!;
    expect(two.bg).toEqual([]);
    expect(two.bgKind).toBeNull();
  });

  it('with no scan, builds only the weight and raw scale body fat panels', () => {
    const panels = buildSeriesPanels([], [], undefined, scale());
    expect(panels.map((p) => p.key)).toEqual(['weight', 'biaRaw']);
    const raw = panel(panels, 'biaRaw')!;
    expect(raw.points).toEqual([]);
    expect(raw.bgKind).toBe('biaRaw');
    // Nothing else sizes it, so the background does.
    expect(panelAxisRange(raw).lo).toBeLessThan(18);
    expect(panelAxisRange(raw).hi).toBeGreaterThan(18);
  });

  it('shows no raw panel once a scan exists, and none without a background', () => {
    expect(
      buildSeriesPanels([makeScan()], [], undefined, scale()).map((p) => p.key)
    ).not.toContain('biaRaw');
    expect(buildSeriesPanels([], [], undefined, null)).toEqual([]);
  });

  it('lets the background widen the time range', () => {
    const panels = buildSeriesPanels([], [], undefined, scale());
    expect(seriesTimeRange(panels, [])).toEqual({
      tMin: dayMs('2026-08-01'),
      tMax: dayMs('2026-08-02'),
    });
  });
});
