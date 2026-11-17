import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import MedicationPrescriptionForm from '@/pages/Medications/MedicationPrescriptionForm';
import {
  courseMedication,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
import {
  prescriptionFixture,
  prescriptionIds,
} from '@/tests/fixtures/medicationPrescriptions';
import { HttpApiError } from '@/api/api';
const mockListRefresh = jest.fn();
const mockCreate = jest.fn(),
  mockUpdate = jest.fn(),
  mockReload = jest.fn();
let mockCurrent = true;
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescription: () => ({ query: { refetch: mockReload } }),
  useMedicationPrescriptions: () => ({ query: { refetch: mockListRefresh } }),
  useMedicationPrescriptionActions: () => ({
    create: mockCreate,
    update: mockUpdate,
  }),
}));
const scope = {
  ready: true,
  key: 'owner',
  ownerId: courseIds.owner,
  actorId: courseIds.owner,
  generation: 1,
  canWrite: true,
  isCurrent: () => mockCurrent,
};
const props = () => ({
  scope,
  medications: [courseMedication],
  onClose: jest.fn(),
  onSaved: jest.fn(),
});
beforeEach(() => {
  mockCurrent = true;
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockReload.mockReset();
  mockListRefresh.mockReset();
  mockCreate.mockResolvedValue({
    id: prescriptionIds.first,
    version: 1,
    deleted: false,
  });
  mockUpdate.mockResolvedValue({
    id: prescriptionIds.first,
    version: 2,
    deleted: false,
  });
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000099',
  });
});
it('uses source defaults, full fields, exact cost and zero counters without touching other records', async () => {
  const p = props();
  render(<MedicationPrescriptionForm {...p} />);
  expect(screen.getByLabelText('Medication')).toHaveValue(courseIds.med);
  expect(screen.getByLabelText('Currency')).toHaveValue('AUD');
  expect(screen.queryByLabelText('Stored status')).not.toBeInTheDocument();
  for (const label of [
    'Quantity',
    'Refills authorized',
    'Refills remaining',
    'Reorder lead time (days)',
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Cost'), {
    target: { value: '0.1234567890123456789' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    medication_id: courseIds.med,
    currency: 'AUD',
    status: 'active',
    cost: '0.1234567890123456789',
    quantity: 0,
    refills_authorized: 0,
    refills_remaining: 0,
    lead_time_days: 0,
    source: null,
    pharmacy: null,
  });
  expect(p.onSaved).toHaveBeenCalledWith(prescriptionIds.first);
});
it('rejects fractional counters without inventing cross-field date restrictions', async () => {
  render(<MedicationPrescriptionForm {...props()} />);
  fireEvent.change(screen.getByLabelText('Refills remaining'), {
    target: { value: '1.9' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  expect(screen.getByRole('alert')).toHaveTextContent('whole number');
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Refills remaining'), {
    target: { value: '2' },
  });
  fireEvent.change(screen.getByLabelText('Date written'), {
    target: { value: '2026-11-20' },
  });
  fireEvent.change(screen.getByLabelText('Expiry date'), {
    target: { value: '2026-11-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    date_written: '2026-11-20',
    expiration: '2026-11-01',
  });
});
it('locks the medication target on edit, retains blanks as null and never changes the target', async () => {
  render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({
        cost: '0',
        quantity: 0,
        prescriber: 'Recorded prescriber',
        status: 'cancelled',
      })}
    />
  );
  expect(screen.getByLabelText('Medication')).toBeDisabled();
  expect(screen.getByLabelText('Cost')).toHaveValue('0');
  expect(screen.getByLabelText('Quantity')).toHaveValue('0');
  fireEvent.change(screen.getByLabelText('Prescriber'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0][1]).toMatchObject({
    expected_version: 1,
    prescriber: null,
    status: 'cancelled',
  });
  expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('medication_id');
});
it('pins an uncertain create across attempted field edits and later deterministic errors', async () => {
  mockCreate
    .mockRejectedValueOnce(new Error('response lost'))
    .mockRejectedValueOnce(new HttpApiError('conflict', 409))
    .mockResolvedValueOnce({
      id: prescriptionIds.first,
      version: 1,
      deleted: false,
    });
  render(<MedicationPrescriptionForm {...props()} />);
  fireEvent.change(screen.getByLabelText('Source'), {
    target: { value: 'Original source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await screen.findByRole('button', { name: 'Retry same save' });
  expect(screen.getByLabelText('Source')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Source'), {
    target: { value: 'Attempted replacement' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3));
  expect(mockCreate.mock.calls[1][0]).toEqual(mockCreate.mock.calls[0][0]);
  expect(mockCreate.mock.calls[2][0]).toEqual(mockCreate.mock.calls[0][0]);
});
it('retains a stale edit draft until an explicit successful reload; failed reload does not replace it', async () => {
  mockUpdate.mockRejectedValue(new HttpApiError('stale', 409));
  const p = props();
  render(<MedicationPrescriptionForm {...p} initial={prescriptionFixture()} />);
  fireEvent.change(screen.getByLabelText('Source'), {
    target: { value: 'Unsaved source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await screen.findByRole('button', {
    name: 'Reload saved prescription (discards this draft)',
  });
  expect(screen.getByLabelText('Source')).toHaveValue('Unsaved source');
  mockReload.mockResolvedValueOnce({
    isSuccess: false,
    data: {
      prescription: prescriptionFixture({ version: 2, source: 'Cached old' }),
    },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reload saved prescription (discards this draft)',
    })
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reload')
  );
  expect(screen.getByLabelText('Source')).toHaveValue('Unsaved source');
  mockReload.mockResolvedValueOnce({
    isSuccess: true,
    data: {
      prescription: prescriptionFixture({
        version: 3,
        source: 'Saved current',
      }),
    },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reload saved prescription (discards this draft)',
    })
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Source')).toHaveValue('Saved current')
  );
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it('uses a fixed same-medication target for inline basic creation and supports a deleted-target edit snapshot', () => {
  const p = props();
  const view = render(
    <MedicationPrescriptionForm {...p} fixedMedicationId={courseIds.med} />
  );
  expect(screen.getByLabelText('Medication')).toBeDisabled();
  view.unmount();
  render(
    <MedicationPrescriptionForm
      {...p}
      initial={prescriptionFixture({
        medication_id: null,
        medication_name: 'Known historical name',
      })}
    />
  );
  expect(screen.getByLabelText('Medication')).toHaveTextContent(
    'Known historical name · Deleted medication'
  );
});
it('ignores late save completion after profile change and blocks new submissions', async () => {
  let resolve!: (value: unknown) => void;
  mockCreate.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const p = props();
  render(<MedicationPrescriptionForm {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  mockCurrent = false;
  await act(async () =>
    resolve({ id: prescriptionIds.first, version: 1, deleted: false })
  );
  expect(p.onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'allows closing a confirmed missing edit target after unknown=%s',
  async (priorUnknown) => {
    if (priorUnknown)
      mockUpdate.mockRejectedValueOnce(new Error('lost response'));
    mockUpdate.mockRejectedValueOnce(new HttpApiError('missing', 404));
    const p = props();
    render(
      <MedicationPrescriptionForm {...p} initial={prescriptionFixture()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
    if (priorUnknown) {
      await screen.findByRole('button', { name: 'Retry same save' });
      fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    }
    await screen.findByText(
      'This prescription or medication is no longer available. Close and refresh the list.'
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Retry same save' })
    ).not.toBeInTheDocument();
    expect(mockListRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalled();
  }
);
