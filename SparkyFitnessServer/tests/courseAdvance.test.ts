import { describe, expect, it } from 'vitest';
import {
  courseAdvanceProposal,
  type MedicationCourseRevision,
} from '@workspace/shared';

const step = (
  id: string,
  index: number,
  dose: string,
  days: number | null,
  unit = 'mg'
) => ({
  id,
  step_index: index,
  dose,
  dose_unit: unit,
  duration_days: days,
  notes: null,
});
const weekly = (days: number[]) => ({
  schedule_type_id: 'weekly',
  days_of_week: days,
  start_date: null,
  end_date: null,
});
const revision = (
  steps: ReturnType<typeof step>[],
  rules: Record<string, unknown>[] = [weekly([6])],
  basis: 'per_injection' | 'per_week' = 'per_injection'
) =>
  ({
    steps,
    rules,
    start_date: '2026-11-01',
    end_date: null,
    dose_basis: basis,
  }) as unknown as MedicationCourseRevision;

const ladder = revision([
  step('a', 0, '0.25', 28),
  step('b', 1, '0.5', 28),
  step('c', 2, '1', null),
]);

describe('course advance proposal', () => {
  it('proposes the phases from the matched one, with the taken dose counted', () => {
    expect(
      courseAdvanceProposal({
        revision: ladder,
        attributedStepId: 'a',
        loggedDose: { amount: '0.5', unit: 'mg' },
      })
    ).toEqual({
      from_phase: 1,
      to_phase: 2,
      phase_count: 3,
      matched_dose: '0.5',
      matched_dose_unit: 'mg',
      shortened: true,
      steps: [
        { dose: '0.5', dose_unit: 'mg', duration_days: 21, notes: null },
        { dose: '1', dose_unit: 'mg', duration_days: null, notes: null },
      ],
    });
  });

  it('compares by mass, so micrograms match milligrams', () => {
    const proposal = courseAdvanceProposal({
      revision: ladder,
      attributedStepId: 'a',
      loggedDose: { amount: 500, unit: 'mcg' },
    });
    expect(proposal?.to_phase).toBe(2);
  });

  it('allows 0.5 percent and nothing more', () => {
    const at = (amount: string) =>
      courseAdvanceProposal({
        revision: ladder,
        attributedStepId: 'a',
        loggedDose: { amount, unit: 'mg' },
      });
    expect(at('0.5024')).not.toBeNull();
    expect(at('0.51')).toBeNull();
  });

  it('stays quiet when the dose is the current phase', () => {
    expect(
      courseAdvanceProposal({
        revision: ladder,
        attributedStepId: 'a',
        loggedDose: { amount: '0.25', unit: 'mg' },
      })
    ).toBeNull();
  });

  it('stays quiet when the dose matches no later phase', () => {
    expect(
      courseAdvanceProposal({
        revision: ladder,
        attributedStepId: 'a',
        loggedDose: { amount: '0.4', unit: 'mg' },
      })
    ).toBeNull();
    // Skipping ahead two phases is not offered; only the next phase is.
    expect(
      courseAdvanceProposal({
        revision: ladder,
        attributedStepId: 'a',
        loggedDose: { amount: '1', unit: 'mg' },
      })
    ).toBeNull();
  });

  it('stays quiet on the last phase and when the step is unknown', () => {
    const last = {
      revision: ladder,
      loggedDose: { amount: '1', unit: 'mg' },
    };
    expect(
      courseAdvanceProposal({ ...last, attributedStepId: 'c' })
    ).toBeNull();
    expect(
      courseAdvanceProposal({ ...last, attributedStepId: 'missing' })
    ).toBeNull();
    expect(
      courseAdvanceProposal({ ...last, attributedStepId: null })
    ).toBeNull();
    expect(
      courseAdvanceProposal({
        revision: revision([step('a', 0, '1', null)]),
        attributedStepId: 'a',
        loggedDose: { amount: '1', unit: 'mg' },
      })
    ).toBeNull();
  });

  it('does not compare doses that are not a mass', () => {
    const units = revision([
      step('a', 0, '10', 28, 'units'),
      step('b', 1, '20', null, 'units'),
    ]);
    expect(
      courseAdvanceProposal({
        revision: units,
        attributedStepId: 'a',
        loggedDose: { amount: '20', unit: 'units' },
      })
    ).toBeNull();
  });

  it('turns a per-week figure into a per-administration dose first', () => {
    const perWeek = revision(
      [step('a', 0, '1', 28), step('b', 1, '2', null)],
      [weekly([1, 4])],
      'per_week'
    );
    // 1 mg a week over two doses is 0.5 mg each; 2 mg a week is 1 mg each.
    const proposal = courseAdvanceProposal({
      revision: perWeek,
      attributedStepId: 'a',
      loggedDose: { amount: '1', unit: 'mg' },
    });
    expect(proposal?.matched_dose).toBe('1');
    // The kept phase is open-ended, so there is nothing to shorten.
    expect(proposal?.shortened).toBe(false);
    expect(proposal?.steps[0]?.duration_days).toBeNull();
  });

  it('gives no per-week proposal when the weekly rhythm is unknown', () => {
    const irregular = revision(
      [step('a', 0, '1', 28), step('b', 1, '2', null)],
      [{ schedule_type_id: 'monthly', start_date: null, end_date: null }],
      'per_week'
    );
    expect(
      courseAdvanceProposal({
        revision: irregular,
        attributedStepId: 'a',
        loggedDose: { amount: '2', unit: 'mg' },
      })
    ).toBeNull();
  });

  it('keeps durations unchanged when the rhythm is unknown or the phase is one interval', () => {
    const monthly = revision(
      [step('a', 0, '0.25', 28), step('b', 1, '0.5', 28)],
      [{ schedule_type_id: 'monthly', start_date: null, end_date: null }]
    );
    const unknown = courseAdvanceProposal({
      revision: monthly,
      attributedStepId: 'a',
      loggedDose: { amount: '0.5', unit: 'mg' },
    });
    expect(unknown?.shortened).toBe(false);
    expect(unknown?.steps[0]?.duration_days).toBe(28);

    const short = revision([
      step('a', 0, '0.25', 28),
      step('b', 1, '0.5', 7),
      step('c', 2, '1', null),
    ]);
    const oneInterval = courseAdvanceProposal({
      revision: short,
      attributedStepId: 'a',
      loggedDose: { amount: '0.5', unit: 'mg' },
    });
    expect(oneInterval?.shortened).toBe(false);
    expect(oneInterval?.steps[0]?.duration_days).toBe(7);
  });
});
