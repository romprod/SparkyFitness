import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationPrescriptionLink from '@/pages/Medications/MedicationPrescriptionLink';
import {
  prescriptionFixture,
  prescriptionIds,
} from '@/tests/fixtures/medicationPrescriptions';
import {
  courseMedication,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
let mockReady = true;
const mockForm = jest.fn();
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptions: () => ({
    scope: { ready: mockReady, isCurrent: () => mockReady, canWrite: true },
    query: { isError: false, isFetching: false },
    data: {
      prescriptions: [
        prescriptionFixture({ source: 'Active source' }),
        prescriptionFixture({
          id: prescriptionIds.second,
          source: 'Cancelled source',
          status: 'cancelled',
        }),
        prescriptionFixture({
          id: courseIds.rule,
          source: 'Expired source',
          status: 'expired',
        }),
        prescriptionFixture({
          id: courseIds.step,
          medication_id: courseIds.rule,
          source: 'Other medication',
        }),
      ],
    },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => day }),
}));
jest.mock('@/pages/Medications/MedicationPrescriptionForm', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockForm(props);
    return <p>Regular fixed-target form</p>;
  },
}));
beforeEach(() => {
  mockReady = true;
  mockForm.mockReset();
});
it('includes every same-medication status, unlinks explicitly and never chooses a prescription automatically', () => {
  const change = jest.fn();
  render(
    <MedicationPrescriptionLink
      medication={courseMedication}
      value={null}
      onChange={change}
    />
  );
  const select = screen.getByRole('combobox');
  expect(select).toHaveValue('none');
  expect(
    screen.getByRole('option', { name: /Cancelled source/ })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('option', { name: /Expired source/ })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: /Other medication/ })
  ).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: prescriptionIds.second } });
  expect(change).toHaveBeenCalledWith(prescriptionIds.second);
  fireEvent.change(select, { target: { value: 'none' } });
  expect(change).toHaveBeenLastCalledWith(null);
});
it('opens the same regular form with the matching target fixed, without creating stock or doses', () => {
  render(
    <MedicationPrescriptionLink
      medication={courseMedication}
      value={undefined}
      onChange={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'New prescription' }));
  expect(mockForm).toHaveBeenCalledWith(
    expect.objectContaining({
      fixedMedicationId: courseIds.med,
      medications: [courseMedication],
    })
  );
});
it('hides private link controls entirely when the owner proof is unavailable', () => {
  mockReady = false;
  render(
    <MedicationPrescriptionLink
      medication={courseMedication}
      value={prescriptionIds.first}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText(/prescription/i)).not.toBeInTheDocument();
});
