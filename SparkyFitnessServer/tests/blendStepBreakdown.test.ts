import { describe, expect, it } from 'vitest';
import {
  blendMassCheck,
  blendVialMismatches,
  buildBlendStepBreakdown,
  type BlendComponentRatio,
} from '@workspace/shared';

const part = (
  id: string,
  mass: string,
  sort_index: number,
  source: BlendComponentRatio['source'] = 'label'
): BlendComponentRatio => ({
  component_medication_id: id,
  name: id.toUpperCase(),
  mass_mg: mass,
  source,
  sort_index,
});
const CJC = [part('c1', '5', 0), part('c2', '5', 1)];
const klow = [
  part('ghk', '50', 0),
  part('bpc', '10', 1),
  part('tb', '10', 2),
  part('kpv', '10', 3),
];
const step = (dose: string, unit: string, duration_days: number | null) => ({
  dose,
  unit,
  duration_days,
});

describe('buildBlendStepBreakdown', () => {
  it('builds the 200 to 500 mcg ladder in phase order', () => {
    const d = buildBlendStepBreakdown({
      steps: [
        step('200', 'mcg', 14),
        step('300', 'mcg', 14),
        step('400', 'mcg', 14),
        step('500', 'mcg', null),
      ],
      components: CJC,
    });
    expect(d!.component_names).toEqual(['C1', 'C2']);
    expect(d!.source).toBe('label');
    expect(
      d!.rows.map((r) => [r.number, r.dose_label, ...r.component_mcg])
    ).toEqual([
      [1, '200 mcg', 100, 100],
      [2, '300 mcg', 150, 150],
      [3, '400 mcg', 200, 200],
      [4, '500 mcg', 250, 250],
    ]);
    expect(d!.rows[3]!.duration_days).toBeNull();
  });

  it('reads per-administration doses a per-week plan has already divided', () => {
    // 1000 mcg a week over 5 administrations is 200 mcg each.
    const d = buildBlendStepBreakdown({
      steps: [step('200', 'mcg', null)],
      components: CJC,
    });
    expect(d!.rows[0]!.component_mcg).toEqual([100, 100]);
  });

  it('converts mg and splits mL only with the in-use concentration', () => {
    expect(
      buildBlendStepBreakdown({
        steps: [step('0.4', 'mg', null)],
        components: CJC,
      })!.rows[0]!.component_mcg
    ).toEqual([200, 200]);
    const ml = [step('0.5', 'mL', null)];
    expect(
      buildBlendStepBreakdown({ steps: ml, components: CJC })!.rows[0]!
        .component_mcg
    ).toEqual([null, null]);
    expect(
      buildBlendStepBreakdown({
        steps: ml,
        components: CJC,
        concentrationMgPerMl: 0,
      })!.rows[0]!.component_mcg
    ).toEqual([null, null]);
    // 0.5 mL x 2 mg/mL = 1 mg = 1000 mcg
    expect(
      buildBlendStepBreakdown({
        steps: ml,
        components: CJC,
        concentrationMgPerMl: '2',
      })!.rows[0]!.component_mcg
    ).toEqual([500, 500]);
  });

  it('leaves units, unknown units and unusable doses as null, never a number', () => {
    const d = buildBlendStepBreakdown({
      steps: [
        step('20', 'units', null),
        step('10', 'IU', 7),
        step('', 'mcg', 7),
      ],
      components: CJC,
      concentrationMgPerMl: 2,
    });
    expect(d!.rows.map((r) => r.component_mcg)).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(d!.rows[1]!.dose_label).toBe('10 IU');
  });

  it('rounds each row so the components add up to the rounded whole', () => {
    const d = buildBlendStepBreakdown({
      steps: [step('250', 'mcg', null)],
      components: klow,
    });
    const cells = d!.rows[0]!.component_mcg as number[];
    expect(Math.round(cells.reduce((a, b) => a + b, 0) * 10) / 10).toBe(250);
    expect(cells[0]).toBe(156.3);
  });

  it('presents the weakest ratio source', () => {
    const d = buildBlendStepBreakdown({
      steps: [step('600', 'mcg', null)],
      components: [part('ghk', '50', 0), part('kpv', '10', 1, 'assumed')],
    });
    expect(d!.source).toBe('assumed');
  });

  it('rounds the blend dose label to 1 dp', () => {
    const d = buildBlendStepBreakdown({
      steps: [step('266.666667', 'mcg', null)],
      components: CJC,
    });
    expect(d!.rows[0]!.dose_label).toBe('266.7 mcg');
  });

  it('is null with no phases or no components', () => {
    expect(buildBlendStepBreakdown({ steps: [], components: CJC })).toBeNull();
    expect(
      buildBlendStepBreakdown({
        steps: [step('200', 'mcg', null)],
        components: [],
      })
    ).toBeNull();
  });
});

describe('blendMassCheck', () => {
  it('agrees when the total equals the label, however it is written', () => {
    expect(blendMassCheck(klow, '80')).toEqual({
      ok: true,
      sum_mg: '80',
      expected_mg: '80',
    });
    expect(blendMassCheck(klow, 80.0).ok).toBe(true);
  });
  it('disagrees when they differ', () => {
    expect(blendMassCheck(klow, 100)).toEqual({
      ok: false,
      sum_mg: '80',
      expected_mg: '100',
    });
  });
  it('is advisory-ok with no label to compare', () => {
    expect(blendMassCheck(klow, null)).toEqual({
      ok: true,
      sum_mg: '80',
      expected_mg: null,
    });
    expect(blendMassCheck(klow, '').ok).toBe(true);
  });
});

describe('blendVialMismatches', () => {
  const vial = (
    label_mass_mg: string | null,
    status = 'in_use',
    extra: { label?: string; expiry_date?: string } = {}
  ) => ({ label_mass_mg, status, ...extra });
  it('lists each differing label once and names its vials', () => {
    expect(
      blendVialMismatches(klow, [
        vial('100', 'sealed', { label: 'A' }),
        vial('100', 'in_use', { expiry_date: '2027-01-31' }),
        vial('90'),
        vial('80'),
      ])
    ).toEqual([
      { sum_mg: '80', expected_mg: '100', vials: ['A', 'exp 2027-01-31'] },
      { sum_mg: '80', expected_mg: '90', vials: [] },
    ]);
  });
  it('ignores retired vials, unknown labels and an empty blend', () => {
    expect(
      blendVialMismatches(klow, [
        vial('100', 'finished'),
        vial('100', 'discarded'),
        vial(null),
      ])
    ).toEqual([]);
    expect(blendVialMismatches([], [vial('100')])).toEqual([]);
  });
});
