import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StockPrescriptionLine from '@/pages/Medications/StockPrescriptionLine';
import {
  coveredFixture,
  prescriptionFixture,
  prescriptionIds,
} from '@/tests/fixtures/medicationPrescriptions';
import { courseIds } from '@/tests/fixtures/medicationCourses';
import type { MedicationPen } from '@/types/medications';

let mockRows: unknown[] = [];
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptions: () => ({ data: { prescriptions: mockRows } }),
}));
const pen = (changes: Partial<MedicationPen> = {}) =>
  ({
    id: courseIds.step,
    medication_id: courseIds.med,
    kind: 'vial',
    status: 'sealed',
    prescription_id: prescriptionIds.first,
    ...changes,
  }) as MedicationPen;
beforeEach(() => {
  mockRows = [];
});
it('shows only the source for a prescription that covers just this medicine', () => {
  mockRows = [prescriptionFixture({ source: 'Solo source' })];
  render(<StockPrescriptionLine pen={pen()} canWrite onChange={jest.fn()} />);
  expect(screen.getByText('Solo source')).toBeInTheDocument();
  expect(screen.queryByText(/also covers/)).toBeNull();
});
it('says which other medicines a shared prescription covers, deleted ones included', () => {
  mockRows = [
    coveredFixture(
      [
        { id: courseIds.med, name: 'Example medication' },
        { id: courseIds.rule, name: 'Second medication' },
        { id: null, name: 'Gone medication' },
      ],
      { source: 'Shared source' }
    ),
  ];
  render(<StockPrescriptionLine pen={pen()} canWrite onChange={jest.fn()} />);
  expect(screen.getByText('Shared source')).toBeInTheDocument();
  expect(
    screen.getByText(/also covers Second medication, Gone medication/)
  ).toBeInTheDocument();
});
it('keeps the add link for unlinked live stock and hides it once finished', () => {
  const { rerender } = render(
    <StockPrescriptionLine
      pen={pen({ prescription_id: null })}
      canWrite
      onChange={jest.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: '+ Add prescription' })
  ).toBeInTheDocument();
  rerender(
    <StockPrescriptionLine
      pen={pen({ prescription_id: null, status: 'finished' })}
      canWrite
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByRole('button')).toBeNull();
});
