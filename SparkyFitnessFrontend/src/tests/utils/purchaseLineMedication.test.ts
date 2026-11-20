import { suggestMedicationForLine } from '@/pages/Medications/purchaseLineMedication';

const meds = [
  { id: 'a', name: 'Cagrilintide' },
  { id: 'b', name: 'Cagrilintide / Semaglutide' },
  { id: 'c', name: 'Retatrutide' },
];

describe('suggestMedicationForLine', () => {
  it('picks the one medication the description names', () => {
    expect(
      suggestMedicationForLine('Cagrilintide 10mg CAG10-1016 × 1', meds)?.id
    ).toBe('a');
    expect(suggestMedicationForLine('10× 20mg RETATRUTIDE', meds)?.id).toBe(
      'c'
    );
  });
  it('prefers the longer name when one contains the other', () => {
    expect(
      suggestMedicationForLine('Cagrilintide / Semaglutide 10mg', meds)?.id
    ).toBe('b');
  });
  it('suggests nothing when nothing, or two equal names, match', () => {
    expect(suggestMedicationForLine('Bacteriostatic water', meds)).toBeNull();
    expect(
      suggestMedicationForLine('Retatrutide', [
        { id: 'x', name: 'Retatrutide' },
        { id: 'y', name: 'retatrutide' },
      ])
    ).toBeNull();
    expect(
      suggestMedicationForLine('ab', [{ id: 'z', name: 'ab' }])
    ).toBeNull();
  });
});
