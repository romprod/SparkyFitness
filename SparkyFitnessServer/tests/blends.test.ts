import { describe, expect, it } from 'vitest';
import {
  MAX_BLEND_COMPONENTS,
  blendTotalMg,
  expandBlendDose,
  medicationBlendInputSchema,
  roundSplitForDisplay,
  splitCostByComponent,
  weakestBlendSource,
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
// A vendor vial of 80 mg: 50 + 10 + 10 + 10.
const klow = [
  part('ghk', '50', 0),
  part('bpc', '10', 1),
  part('tb', '10', 2),
  part('kpv', '10', 3),
];

describe('blend arithmetic', () => {
  it('totals the vial and splits a dose by each share, in saved order', () => {
    expect(blendTotalMg(klow)).toBe('80');
    const split = expandBlendDose('0.8', [...klow].reverse());
    expect(split.map((s) => [s.component_medication_id, s.dose_mg])).toEqual([
      ['ghk', '0.5'],
      ['bpc', '0.1'],
      ['tb', '0.1'],
      ['kpv', '0.1'],
    ]);
    expect(split[0]!.fraction).toBe('0.625');
  });

  it('keeps exact shares that do not terminate and never loses mass', () => {
    const thirds = [part('a', '1', 0), part('b', '1', 1), part('c', '1', 2)];
    const split = expandBlendDose(1, thirds);
    expect(split).toHaveLength(3);
    const sum = split.reduce((s, c) => s + Number(c.dose_mg), 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('returns nothing for a non-blend, an unusable dose or unusable masses', () => {
    expect(expandBlendDose('1', [])).toEqual([]);
    expect(expandBlendDose(null, klow)).toEqual([]);
    expect(expandBlendDose('abc', klow)).toEqual([]);
    expect(expandBlendDose(-1, klow)).toEqual([]);
    expect(expandBlendDose(1, [part('a', '0', 0), part('b', 'x', 1)])).toEqual(
      []
    );
    // A zero dose delivers zero of each, not nothing.
    expect(expandBlendDose(0, klow).map((s) => s.dose_mg)).toEqual([
      '0',
      '0',
      '0',
      '0',
    ]);
  });

  it('skips a component with no usable mass but splits the rest', () => {
    const split = expandBlendDose('2', [
      part('a', '3', 0),
      part('b', '0', 1),
      part('c', '1', 2),
    ]);
    expect(split.map((s) => [s.component_medication_id, s.dose_mg])).toEqual([
      ['a', '1.5'],
      ['c', '0.5'],
    ]);
  });

  it('claims the weakest source: one assumed ratio taints the lot', () => {
    expect(weakestBlendSource(klow)).toBe('label');
    expect(
      weakestBlendSource([part('a', '1', 0, 'coa'), part('b', '1', 1)])
    ).toBe('coa');
    expect(
      weakestBlendSource([
        part('a', '1', 0, 'label'),
        part('b', '1', 1, 'assumed'),
        part('c', '1', 2, 'coa'),
      ])
    ).toBe('assumed');
    expect(weakestBlendSource([])).toBe('label');
  });

  it('rounds the parts so they add up to the rounded whole', () => {
    // Rounded one by one these print 156.3 + 31.3 + 31.3 + 31.3 = 250.2 beside 250.0.
    const raw = [156.25, 31.25, 31.25, 31.25];
    const shown = roundSplitForDisplay(raw);
    expect(shown.reduce((s, v) => s + v, 0)).toBeCloseTo(250, 9);
    expect(roundSplitForDisplay([])).toEqual([]);
    expect(
      roundSplitForDisplay([1 / 3, 1 / 3, 1 / 3], 2).reduce((s, v) => s + v, 0)
    ).toBeCloseTo(1, 9);
  });

  it('shares out what the blend cost by label mass and creates no spend', () => {
    const costs = splitCostByComponent('80', klow);
    expect(costs.map((c) => [c.name, c.cost])).toEqual([
      ['GHK', '50'],
      ['BPC', '10'],
      ['TB', '10'],
      ['KPV', '10'],
    ]);
    const odd = splitCostByComponent('10', [
      part('a', '1', 0),
      part('b', '2', 1),
    ]);
    expect(odd.reduce((s, c) => s + Number(c.cost), 0)).toBeCloseTo(10, 12);
    expect(splitCostByComponent(null, klow)).toEqual([]);
    expect(splitCostByComponent('abc', klow)).toEqual([]);
    expect(splitCostByComponent('10', [])).toEqual([]);
  });
});

describe('blend input', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it('accepts masses as numbers or decimal strings and writes them plainly', () => {
    const parsed = medicationBlendInputSchema.parse({
      components: [
        { component_medication_id: id(1), mass_mg: 50 },
        {
          component_medication_id: id(2),
          mass_mg: ' 0.0000001e1 ',
          source: 'coa',
        },
      ],
    });
    expect(parsed.components).toEqual([
      { component_medication_id: id(1), mass_mg: '50', source: 'label' },
      { component_medication_id: id(2), mass_mg: '0.000001', source: 'coa' },
    ]);
  });

  it('allows no components, which says the medication is not a blend', () => {
    expect(
      medicationBlendInputSchema.parse({ components: [] }).components
    ).toEqual([]);
  });

  it('refuses a missing or non-positive mass, too many decimals, a repeat, an unknown source and too many rows', () => {
    const bad = (components: unknown) =>
      medicationBlendInputSchema.safeParse({ components }).success;
    expect(bad([{ component_medication_id: id(1), mass_mg: 0 }])).toBe(false);
    expect(bad([{ component_medication_id: id(1), mass_mg: '-1' }])).toBe(
      false
    );
    expect(bad([{ component_medication_id: id(1), mass_mg: 'ten' }])).toBe(
      false
    );
    expect(
      bad([{ component_medication_id: id(1), mass_mg: '1.0000001' }])
    ).toBe(false);
    expect(bad([{ component_medication_id: id(1), mass_mg: '1000001' }])).toBe(
      false
    );
    expect(
      bad([
        { component_medication_id: id(1), mass_mg: 1 },
        { component_medication_id: id(1), mass_mg: 2 },
      ])
    ).toBe(false);
    expect(
      bad([{ component_medication_id: id(1), mass_mg: 1, source: 'guess' }])
    ).toBe(false);
    expect(bad([{ component_medication_id: 'nope', mass_mg: 1 }])).toBe(false);
    const many = Array.from({ length: MAX_BLEND_COMPONENTS + 1 }, (_, n) => ({
      component_medication_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      mass_mg: 1,
    }));
    expect(bad(many)).toBe(false);
    expect(bad(many.slice(0, MAX_BLEND_COMPONENTS))).toBe(true);
  });
});
