import {
  FAT_HUE_DOMAIN,
  FIGURE_REGIONS,
  buildBodyFigureModel,
  fatFillColor,
  fatHueT,
  pctFatBand,
} from '@/pages/Labs/bodyCompFigureModel';
import { isDrawnRegion } from '@/pages/Labs/bodyCompSilhouette';
import { SIX_REGIONS, makeScan, region } from './bodyCompTestKit';

const withPct = (name: Parameters<typeof region>[0], pct: number) =>
  region(name, 1000, 4000, 200, { pct_fat: pct });

describe('buildBodyFigureModel', () => {
  it('has a cell per printed region in figure order, with the shares worked out', () => {
    const model = buildBodyFigureModel(
      makeScan({
        regions: [
          ...SIX_REGIONS().reverse(),
          region('android', 2000, 5000, null),
          region('gynoid', 3000, 7000, null),
        ],
      })
    );
    expect(model.regions.map((c) => c.region)).toEqual([...FIGURE_REGIONS]);
    expect(model.bands.map((c) => c.region)).toEqual(['android', 'gynoid']);
    expect(model.missing).toEqual([]);
    const trunk = model.regions.find((c) => c.region === 'trunk')!;
    // 10 / 27 / 0.9 kg of 37.9 kg.
    expect(trunk.pctFat).toBeCloseTo(26.4, 1);
    expect(trunk.pctLean).toBeCloseTo((27000 / 37900) * 100, 4);
    expect(trunk.pctBone).toBeCloseTo((900 / 37900) * 100, 4);
    expect(trunk.fatKg).toBe(10);
    expect(trunk.leanKg).toBe(27);
    const android = model.bands[0]!;
    expect(android.pctBone).toBeNull();
    expect(android.bmcG).toBeNull();
  });

  it('lists the regions the report did not print as missing and leaves them out', () => {
    const model = buildBodyFigureModel(
      makeScan({ regions: SIX_REGIONS().filter((r) => r.region !== 'head') })
    );
    expect(model.regions.map((c) => c.region)).not.toContain('head');
    expect(model.missing).toEqual(['head', 'android', 'gynoid']);
  });

  it('carries the whole-body totals, ratios and asymmetry', () => {
    const model = buildBodyFigureModel(
      makeScan({
        regions: [
          ...SIX_REGIONS(),
          region('android', 2000, 5000, null),
          region('gynoid', 3000, 7000, null),
        ],
      })
    );
    expect(model.wholeBody).toMatchObject({
      massKg: 83,
      clinicWeightKg: 83,
      fatKg: 20,
      leanKg: 60,
      bmcKg: 3,
      pctFat: 24.1,
      totalBmdGcm2: 1.31,
    });
    expect(model.wholeBody.ffmi).toBeCloseTo(63 / 1.8 ** 2, 4);
    expect(model.wholeBody.almi).toBeCloseTo(29 / 1.8 ** 2, 4);
    expect(model.ratios.android_gynoid).not.toBeNull();
    expect(model.ratios.trunk_limb_fat).not.toBeNull();
    // 4.4 against 4.0 kg of arm lean, right over left.
    expect(model.asymmetry.arms_pct).toBeCloseTo(
      ((4400 - 4000) / 4200) * 100,
      4
    );
    expect(model.asymmetry.legs_pct).not.toBeNull();
  });

  it('has no change at one scan', () => {
    const model = buildBodyFigureModel(makeScan());
    expect(model.change).toBeNull();
    expect(model.regions.every((c) => c.delta === null)).toBe(true);
  });

  describe('against a previous scan', () => {
    const prev = makeScan({
      id: 'prev',
      scanned_day: '2026-05-01',
      regions: [
        withPct('l_arm', 20),
        withPct('r_arm', 20),
        withPct('trunk', 20),
        withPct('head', 20),
      ],
    });
    const now = (extra: Parameters<typeof makeScan>[0] = {}) =>
      makeScan({
        regions: [
          withPct('l_arm', 20.3),
          withPct('r_arm', 21),
          withPct('trunk', 19.0),
          withPct('head', 20),
          withPct('l_leg', 18),
        ],
        ...extra,
      });

    it('tiers each region’s % fat change against the whole-body % fat band', () => {
      const model = buildBodyFigureModel(now(), { prev });
      expect(model.change).toMatchObject({
        prevScanId: 'prev',
        prevDay: '2026-05-01',
        demoted: false,
        band: pctFatBand(),
      });
      expect(model.change!.band).toEqual({ technical: 0.5, practical: 1.7 });
      const delta = (name: string) =>
        model.regions.find((c) => c.region === name)!.delta;
      // 0.3 is inside the 0.5 technical limit.
      expect(delta('l_arm')).toMatchObject({
        tier: 'within_noise',
        demoted: false,
      });
      expect(delta('l_arm')!.fatPts).toBeCloseTo(0.3, 6);
      // 1.0 is past technical and short of practical.
      expect(delta('r_arm')).toMatchObject({ tier: 'indeterminate' });
      expect(delta('r_arm')!.multipleOfTechnical).toBeCloseTo(2, 6);
      // -1.0 as well, and the sign is kept.
      expect(delta('trunk')!.fatPts).toBeCloseTo(-1, 6);
      expect(delta('head')).toMatchObject({ tier: 'within_noise', fatPts: 0 });
      expect(delta('trunk')!.fatKg).toBeCloseTo(
        model.regions.find((c) => c.region === 'trunk')!.fatKg - 1,
        6
      );
    });

    it('has a delta only for regions the previous report printed', () => {
      const model = buildBodyFigureModel(now(), { prev });
      expect(model.regions.find((c) => c.region === 'l_leg')!.delta).toBeNull();
    });

    it('calls a change beyond the practical limit exceeding', () => {
      const model = buildBodyFigureModel(
        now({ regions: [withPct('head', 22)] }),
        { prev }
      );
      expect(model.regions[0]!.delta).toMatchObject({
        tier: 'exceeds_lsc',
        rawTier: 'exceeds_lsc',
        demoted: false,
      });
    });

    it('hides the change when the scans are not comparable', () => {
      const model = buildBodyFigureModel(now({ device_serial: 'S2' }), {
        prev,
      });
      expect(model.change).toBeNull();
      expect(model.regions.every((c) => c.delta === null)).toBe(true);
      const software = buildBodyFigureModel(now({ software_version: '14.0' }), {
        prev,
      });
      expect(software.change).toBeNull();
    });

    it('demotes each tier a step when the scans were not taken alike', () => {
      const model = buildBodyFigureModel(
        now({
          regions: [
            withPct('head', 22),
            withPct('r_arm', 21),
            withPct('l_arm', 20.1),
          ],
          prep: { ...makeScan().prep, fasted: false },
        }),
        { prev }
      );
      expect(model.change).toMatchObject({ demoted: true });
      expect(model.change!.reasons).toContain('fasted: differs');
      const delta = (name: string) =>
        model.regions.find((c) => c.region === name)!.delta!;
      expect(delta('head')).toMatchObject({
        tier: 'indeterminate',
        rawTier: 'exceeds_lsc',
        demoted: true,
      });
      expect(delta('r_arm')).toMatchObject({
        tier: 'within_noise',
        rawTier: 'indeterminate',
        demoted: true,
      });
      expect(delta('l_arm')).toMatchObject({
        tier: 'within_noise',
        demoted: true,
      });
    });
  });
});

describe('fat fill', () => {
  it('runs from cool at 12 % to warm at 28 % and holds either side', () => {
    expect([...FAT_HUE_DOMAIN]).toEqual([12, 28]);
    expect(fatHueT(12)).toBe(0);
    expect(fatHueT(20)).toBe(0.5);
    expect(fatHueT(28)).toBe(1);
    expect(fatHueT(5)).toBe(0);
    expect(fatHueT(40)).toBe(1);
    expect(fatFillColor(12)).toBe('hsl(200 65% 50%)');
    expect(fatFillColor(28)).toBe('hsl(25 65% 50%)');
    expect(fatFillColor(40)).toBe(fatFillColor(28));
  });
});

describe('silhouette', () => {
  it('draws the six body regions and not android or gynoid', () => {
    for (const name of FIGURE_REGIONS) expect(isDrawnRegion(name)).toBe(true);
    expect(isDrawnRegion('android')).toBe(false);
    expect(isDrawnRegion('gynoid')).toBe(false);
  });
});
