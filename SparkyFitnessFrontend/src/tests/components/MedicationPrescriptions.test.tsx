import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationPrescriptions from '@/pages/Medications/MedicationPrescriptions';
import { prescriptionRefillNotice } from '@/pages/Medications/medicationPrescriptionPresentation';
import {
  prescriptionFixture,
  prescriptionIds,
} from '@/tests/fixtures/medicationPrescriptions';
import { courseMedication } from '@/tests/fixtures/medicationCourses';
import { HttpApiError } from '@/api/api';
let mockReady = true,
  mockCurrent = true,
  mockMobile = true,
  mockError = false;
let mockRecords = [prescriptionFixture()];
const mockListRefresh = jest.fn();
const mockRemove = jest.fn(),
  mockReload = jest.fn();
jest.mock('@/hooks/Medications/useLastUsedMedicationCurrency', () => ({
  useLastUsedMedicationCurrency: () => 'GBP',
}));
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptions: () => ({
    scope: {
      ready: mockReady,
      key: 'owner',
      canWrite: true,
      isCurrent: () => mockCurrent,
    },
    query: { isError: mockError, isLoading: false, refetch: mockListRefresh },
    data: { prescriptions: mockRecords },
  }),
  useMedicationPrescription: () => ({ query: { refetch: mockReload } }),
  useMedicationPrescriptionActions: () => ({ remove: mockRemove }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => day,
  }),
}));
jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mockMobile }));
jest.mock('@/pages/Medications/MedicationPrescriptionForm', () => ({
  __esModule: true,
  default: () => <p>Full basic form</p>,
}));
beforeEach(() => {
  mockReady = true;
  mockCurrent = true;
  mockMobile = true;
  mockError = false;
  mockRecords = [prescriptionFixture()];
  mockRemove.mockReset();
  mockReload.mockReset();
  mockListRefresh.mockReset();
  mockRemove.mockResolvedValue({
    id: prescriptionIds.first,
    version: null,
    deleted: true,
  });
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000099',
  });
});
it('shows all stored statuses without filters and preserves known zero versus unknown facts', () => {
  mockRecords = [
    prescriptionFixture({
      source: 'Named source',
      cost: '0',
      quantity: 0,
      refills_remaining: 0,
      refills_authorized: 0,
    }),
    prescriptionFixture({
      id: prescriptionIds.second,
      status: 'cancelled',
      medication_id: null,
      medication_name: 'Known deleted target',
    }),
  ];
  const view = render(
    <MedicationPrescriptions medications={[courseMedication]} />
  );
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(
    screen.getByText(/Recorded cost \(basis unconfirmed\): AUD 0.00/)
  ).toBeInTheDocument();
  expect(screen.getByText('Refills remaining: 0 / 0')).toBeInTheDocument();
  expect(screen.getByText('Known deleted target')).toBeInTheDocument();
  expect(view.container.querySelector('details')).not.toHaveAttribute('open');
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: 'Edit' })[0]!.closest('details')
  ).toBeNull();
});
it('keeps an orphan register available without a medication but disables new creation', () => {
  render(<MedicationPrescriptions medications={[]} />);
  expect(
    screen.getByRole('button', { name: 'Basic prescription' })
  ).toBeDisabled();
  expect(screen.getByText('Synthetic medication')).toBeInTheDocument();
});
it('uses explicit delete confirmation, keeps Cancel side-effect-free and pins uncertain retry', async () => {
  mockRemove
    .mockRejectedValueOnce(new Error('lost response'))
    .mockRejectedValueOnce(new HttpApiError('stale', 409))
    .mockResolvedValueOnce({
      id: prescriptionIds.first,
      version: null,
      deleted: true,
    });
  render(<MedicationPrescriptions medications={[courseMedication]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Stock quantities, doses and plan history are kept.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByRole('button', { name: 'Retry same deletion' });
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same deletion' }));
  await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Retry same deletion' }));
  await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(3));
  expect(mockRemove.mock.calls[1]).toEqual(mockRemove.mock.calls[0]);
  expect(mockRemove.mock.calls[2]).toEqual(mockRemove.mock.calls[0]);
});
it('does not expose retained private records on error, unproven identity or stale profile', () => {
  mockError = true;
  const view = render(
    <MedicationPrescriptions medications={[courseMedication]} />
  );
  expect(screen.queryByText('Synthetic medication')).not.toBeInTheDocument();
  mockReady = false;
  view.rerender(<MedicationPrescriptions medications={[courseMedication]} />);
  expect(screen.queryByText('Prescriptions')).not.toBeInTheDocument();
  mockReady = true;
  mockCurrent = false;
  view.rerender(<MedicationPrescriptions medications={[courseMedication]} />);
  expect(screen.queryByText('Synthetic medication')).not.toBeInTheDocument();
});
it.each([
  ['2026-11-24', null, true],
  ['2026-11-25', null, false],
  ['2026-11-01', null, true],
  ['2026-11-17', '2026-11-17', true],
  ['2026-11-17', '2026-11-16', false],
  [null, null, false],
])(
  'uses exact civil refill/expiry boundaries (%s, %s)',
  (next_refill, expiration, expected) => {
    const record = prescriptionFixture({
      next_refill,
      expiration,
      status: 'cancelled',
      refills_remaining: 0,
    });
    expect(prescriptionRefillNotice(record, '2026-11-17')).toBe(expected);
    expect(record.status).toBe('cancelled');
    expect(record.refills_remaining).toBe(0);
  }
);

it.each([false, true])(
  'allows cancelling a confirmed missing delete target after unknown=%s',
  async (priorUnknown) => {
    if (priorUnknown)
      mockRemove.mockRejectedValueOnce(new Error('lost response'));
    mockRemove.mockRejectedValueOnce(new HttpApiError('missing', 404));
    render(<MedicationPrescriptions medications={[courseMedication]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    if (priorUnknown) {
      await screen.findByRole('button', { name: 'Retry same deletion' });
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry same deletion' })
      );
    }
    await screen.findByText(
      'This prescription or medication is no longer available. Close and refresh the list.'
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Retry same deletion' })
    ).not.toBeInTheDocument();
    expect(mockListRefresh).toHaveBeenCalledTimes(1);
  }
);
it.each([true, false])(
  'keeps focus in the register after deleting its final row (target present: %s)',
  async (hasMedication) => {
    mockRecords = [
      prescriptionFixture({
        medication_id: hasMedication ? courseMedication.id : null,
      }),
    ];
    const meds = hasMedication ? [courseMedication] : [];
    const view = render(<MedicationPrescriptions medications={meds} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    mockRecords = [];
    view.rerender(<MedicationPrescriptions medications={meds} />);
    await waitFor(() =>
      expect(
        hasMedication
          ? screen.getByRole('button', { name: 'Basic prescription' })
          : screen.getByRole('heading', { name: 'Prescriptions' })
      ).toHaveFocus()
    );
  }
);
it('returns Cancel focus to the invoking Delete control without deleting', async () => {
  render(<MedicationPrescriptions medications={[courseMedication]} />);
  const trigger = screen.getByRole('button', { name: 'Delete' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(mockRemove).not.toHaveBeenCalled();
});
