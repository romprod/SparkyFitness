import type {
  LabComparisonPanel,
  LabComparisonResult,
} from '@workspace/shared';
import {
  LAB_SUBSET,
  buildNearestLabs,
  findNearestPanel,
  labAliasRank,
  matchLabResult,
  normaliseLabName,
  referenceText,
} from '@/pages/Labs/bodyCompNearestLabsModel';

const result = (
  over: Partial<LabComparisonResult> = {}
): LabComparisonResult => ({
  id: 'r',
  marker_key: 'hba1c',
  custom_marker_id: null,
  entry_date: '2026-10-30',
  value_numeric: 5.1,
  value_text: null,
  unit: '%',
  ref_range_low: 4,
  ref_range_high: 5.6,
  ...over,
});
const panel = (
  id: string,
  collected_on: string | null,
  results: LabComparisonResult[] = [],
  over: Partial<LabComparisonPanel> = {}
): LabComparisonPanel => ({
  id,
  collected_on,
  lab_name: null,
  notes: null,
  origin: 'manual',
  created_at: '2026-10-30T00:00:00.000Z',
  results,
  ...over,
});
const def = (label: string) => LAB_SUBSET.find((d) => d.label === label)!;
const SCAN = '2026-11-02';

describe('findNearestPanel', () => {
  it('picks the panel closest to the scan day', () => {
    const near = panel('near', '2026-10-30');
    const far = panel('far', '2026-10-10');
    expect(findNearestPanel([far, near], SCAN)?.id).toBe('near');
  });

  it('includes a panel exactly 30 days away and excludes 31', () => {
    expect(findNearestPanel([panel('edge', '2026-10-03')], SCAN)?.id).toBe(
      'edge'
    );
    expect(findNearestPanel([panel('after', '2026-12-02')], SCAN)?.id).toBe(
      'after'
    );
    expect(findNearestPanel([panel('out', '2026-10-02')], SCAN)).toBeNull();
    expect(findNearestPanel([panel('out', '2026-12-03')], SCAN)).toBeNull();
  });

  it('takes the earlier panel on a tie, whichever order they arrive in', () => {
    const before = panel('before', '2026-10-30');
    const after = panel('after', '2026-11-05');
    expect(findNearestPanel([after, before], SCAN)?.id).toBe('before');
    expect(findNearestPanel([before, after], SCAN)?.id).toBe('before');
  });

  it('ignores a panel with no collection day', () => {
    expect(findNearestPanel([panel('none', null)], SCAN)).toBeNull();
  });
});

describe('name aliases', () => {
  it('matches on whole tokens only', () => {
    expect(normaliseLabName('Free T4 (pmol/L)')).toBe('free t4 pmol l');
    expect(labAliasRank('Free T4', def('Free testosterone'))).toBeNull();
    expect(labAliasRank('Free T', def('Free testosterone'))).toBe(1);
    expect(labAliasRank('Free Testosterone', def('Free testosterone'))).toBe(0);
    expect(labAliasRank('Free T4', def('Free T4'))).toBe(0);
    expect(labAliasRank('FT4', def('Free T4'))).toBe(1);
  });

  it('excludes names that hold an excluded token', () => {
    expect(labAliasRank('Free Testosterone', def('Total testosterone'))).toBe(
      null
    );
    expect(labAliasRank('Testosterone, total', def('Total testosterone'))).toBe(
      0
    );
    expect(labAliasRank('Fasting Glucose (AST)', def('AST'))).toBeNull();
    expect(labAliasRank('AST', def('AST'))).toBe(0);
    expect(labAliasRank('Last', def('AST'))).toBeNull();
  });

  it('ranks the specific CRP name above the plain one', () => {
    const crp = def('hsCRP');
    expect(labAliasRank('hs-CRP', crp)).toBeLessThan(labAliasRank('CRP', crp)!);
    expect(labAliasRank('CRP (hs)', crp)).not.toBeNull();
  });
});

describe('matchLabResult', () => {
  const custom = new Map([
    ['c-crp', 'CRP'],
    ['c-hscrp', 'hs-CRP'],
    ['c-ft', 'Free T4'],
  ]);

  it('matches a built-in result by its marker key first', () => {
    const builtIn = result({ id: 'b', marker_key: 'crp' });
    const named = result({
      id: 'n',
      marker_key: null,
      custom_marker_id: 'c-hscrp',
    });
    expect(matchLabResult([named, builtIn], def('hsCRP'), custom)?.id).toBe(
      'b'
    );
  });

  it('falls back to a custom result’s name and picks the most specific alias', () => {
    const plain = result({
      id: 'p',
      marker_key: null,
      custom_marker_id: 'c-crp',
    });
    const hs = result({
      id: 'h',
      marker_key: null,
      custom_marker_id: 'c-hscrp',
    });
    expect(matchLabResult([plain, hs], def('hsCRP'), custom)?.id).toBe('h');
    expect(matchLabResult([plain], def('hsCRP'), custom)?.id).toBe('p');
  });

  it('never matches a built-in result by its name, only by key', () => {
    const other = result({ id: 'o', marker_key: 'fasting_glucose' });
    expect(matchLabResult([other], def('AST'), custom)).toBeNull();
  });

  it('does not let a custom Free T4 stand in for free testosterone', () => {
    const ft = result({ id: 'f', marker_key: null, custom_marker_id: 'c-ft' });
    expect(matchLabResult([ft], def('Free testosterone'), custom)).toBeNull();
    expect(matchLabResult([ft], def('Free T4'), custom)?.id).toBe('f');
  });
});

describe('buildNearestLabs', () => {
  it('lists the fixed subset in order with its three statuses', () => {
    const inPanel = panel('p1', '2026-10-30', [
      result({ id: 'a', marker_key: 'hba1c' }),
      result({
        id: 'b',
        marker_key: 'tsh',
        value_numeric: 3.1,
        unit: 'mIU/L',
        ref_range_low: 0.4,
        ref_range_high: 4,
      }),
    ]);
    const older = panel('p0', '2026-01-10', [
      result({
        id: 'c',
        marker_key: 'ferritin',
        value_numeric: 90,
        unit: 'ng/mL',
      }),
    ]);
    const labs = buildNearestLabs([older, inPanel], [], SCAN)!;
    expect(labs.rows.map((r) => r.label)).toEqual(
      LAB_SUBSET.map((d) => d.label)
    );
    expect(labs.rows.map((r) => r.label).slice(0, 4)).toEqual([
      'IGF-1',
      'Total testosterone',
      'Free testosterone',
      'SHBG',
    ]);
    const row = (label: string) => labs.rows.find((r) => r.label === label)!;
    expect(row('HbA1c')).toMatchObject({
      status: 'present',
      value: 5.1,
      unit: '%',
    });
    expect(row('Ferritin').status).toBe('not_in_panel');
    expect(row('IGF-1').status).toBe('never_measured');
    expect(row('IGF-1').value).toBeNull();
  });

  it('flags low, high and borderline and leaves in-range unflagged by status', () => {
    const labs = buildNearestLabs(
      [
        panel('p', '2026-11-02', [
          // Above the lab range.
          result({ id: '1', marker_key: 'hba1c', value_numeric: 6.2 }),
          // Below the lab range.
          result({
            id: '2',
            marker_key: 'tsh',
            value_numeric: 0.1,
            unit: 'mIU/L',
            ref_range_low: 0.4,
            ref_range_high: 4,
          }),
          // Inside the lab range but past the optimal 5.4 ceiling.
          result({
            id: '3',
            marker_key: 'alt',
            value_numeric: 20,
            unit: 'U/L',
            ref_range_low: 0,
            ref_range_high: 40,
          }),
        ]),
      ],
      [],
      SCAN
    )!;
    const flag = (label: string) =>
      labs.rows.find((r) => r.label === label)!.flag;
    expect(flag('HbA1c')).toBe('high');
    expect(flag('TSH')).toBe('low');
    expect(flag('ALT')).toBe('in_range');
    const borderline = buildNearestLabs(
      [panel('p', '2026-11-02', [result({ id: '4', value_numeric: 5.5 })])],
      [],
      SCAN
    )!;
    expect(borderline.rows.find((r) => r.label === 'HbA1c')!.flag).toBe(
      'borderline'
    );
  });

  it('gives the distance from the scan, signed, with the lab name and notes', () => {
    const before = buildNearestLabs(
      [
        panel('p', '2026-10-30', [], {
          lab_name: 'City lab',
          notes: ' fasted ',
        }),
      ],
      [],
      SCAN
    )!;
    expect(before).toMatchObject({
      panelDay: '2026-10-30',
      daysFromScan: -3,
      labName: 'City lab',
      notes: ' fasted ',
    });
    expect(
      buildNearestLabs([panel('p', '2026-11-05')], [], SCAN)!.daysFromScan
    ).toBe(3);
    const same = buildNearestLabs(
      [panel('p', SCAN, [], { notes: '   ' })],
      [],
      SCAN
    )!;
    expect(same.daysFromScan).toBe(0);
    expect(same.notes).toBeNull();
  });

  it('is null with no panel within 30 days', () => {
    expect(buildNearestLabs([panel('p', '2026-06-01')], [], SCAN)).toBeNull();
    expect(buildNearestLabs([], [], SCAN)).toBeNull();
  });

  it('finds a custom-named result through the marker list', () => {
    const labs = buildNearestLabs(
      [
        panel('p', '2026-11-01', [
          result({
            id: 'x',
            marker_key: null,
            custom_marker_id: 'c-1',
            value_numeric: 210,
            unit: 'ng/mL',
          }),
        ]),
      ],
      [{ id: 'c-1', name: 'Ferritin' }],
      SCAN
    )!;
    expect(labs.rows.find((r) => r.label === 'Ferritin')).toMatchObject({
      status: 'present',
      value: 210,
    });
  });
});

describe('referenceText', () => {
  it('prints one-sided ranges with a sign, never a dangling dash', () => {
    expect(referenceText(4, 5.6)).toBe('4–5.6');
    expect(referenceText(49, null)).toBe('≥ 49');
    expect(referenceText(null, 4)).toBe('≤ 4');
    expect(referenceText(null, null)).toBeNull();
  });
});
