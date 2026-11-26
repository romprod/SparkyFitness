import {
  coversMedication,
  liveCoveredIds,
  otherCoveredNames,
  prescriptionBasisIntent,
  prescriptionCoverage,
} from '@/pages/Medications/medicationPrescriptionPresentation';
import {
  coveredFixture,
  prescriptionFixture,
} from '@/tests/fixtures/medicationPrescriptions';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const many = coveredFixture([
  { id: courseIds.med, name: 'One' },
  { id: courseIds.rule, name: 'Two' },
  { id: null, name: 'Gone' },
]);
it('falls back to the single legacy target when an older server sends no covered list', () => {
  const legacy = prescriptionFixture({ medication_name: 'Legacy name' });
  expect(prescriptionCoverage(legacy)).toEqual([
    {
      medication_id: courseIds.med,
      medication_name: 'Legacy name',
      position: 0,
    },
  ]);
  expect(coversMedication(legacy, courseIds.med)).toBe(true);
  expect(coversMedication(legacy, courseIds.rule)).toBe(false);
  const orphan = prescriptionFixture({ medication_id: null });
  expect(liveCoveredIds(orphan)).toEqual([]);
});
it('covers each live medicine of a shared prescription and never a deleted or unrelated one', () => {
  expect(coversMedication(many, courseIds.med)).toBe(true);
  expect(coversMedication(many, courseIds.rule)).toBe(true);
  expect(coversMedication(many, courseIds.step)).toBe(false);
  expect(liveCoveredIds(many)).toEqual([courseIds.med, courseIds.rule]);
  expect(otherCoveredNames(many, courseIds.med)).toEqual(['Two', 'Gone']);
});
describe('the price basis a save states', () => {
  const base = {
    medicationCount: 1,
    baseBasis: undefined,
    hasBase: false,
    costTouched: false,
    cost: '',
    choice: '' as const,
  };
  it('keeps the single-medicine rule: typing a cost confirms it per vial', () => {
    expect(prescriptionBasisIntent(base)).toEqual({});
    expect(
      prescriptionBasisIntent({ ...base, costTouched: true, cost: '5' })
    ).toEqual({ cost_basis: 'per_vial' });
    expect(
      prescriptionBasisIntent({ ...base, costTouched: true, cost: ' ' })
    ).toEqual({ cost_basis: null });
    expect(
      prescriptionBasisIntent({
        ...base,
        hasBase: true,
        baseBasis: 'per_vial',
        cost: '5',
      })
    ).toEqual({ cost_basis: 'per_vial' });
  });
  it('never confirms per-vial for several medicines and clears an earlier confirmation', () => {
    const several = {
      ...base,
      medicationCount: 2,
      costTouched: true,
      cost: '9',
    };
    expect(prescriptionBasisIntent(several)).toEqual({});
    expect(
      prescriptionBasisIntent({
        ...several,
        hasBase: true,
        baseBasis: 'per_vial',
      })
    ).toEqual({ cost_basis: null });
    expect(
      prescriptionBasisIntent({ ...several, choice: 'per_prescription' })
    ).toEqual({ cost_basis: 'per_prescription' });
    // Without a cost there is nothing to confirm.
    expect(
      prescriptionBasisIntent({
        ...several,
        cost: '',
        choice: 'per_prescription',
      })
    ).toEqual({});
  });
  it('leaves a saved whole-prescription basis alone unless the cost or the choice changes', () => {
    const saved = {
      ...base,
      medicationCount: 2,
      hasBase: true,
      baseBasis: 'per_prescription' as const,
      cost: '9',
      choice: 'per_prescription' as const,
    };
    expect(prescriptionBasisIntent(saved)).toEqual({});
    expect(prescriptionBasisIntent({ ...saved, costTouched: true })).toEqual({
      cost_basis: 'per_prescription',
    });
    expect(prescriptionBasisIntent({ ...saved, choice: '' })).toEqual({
      cost_basis: null,
    });
  });
});
