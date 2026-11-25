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
  defaultCurrency: 'GBP',
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
  expect(screen.getByLabelText('Currency')).toHaveValue('GBP');
  expect(screen.queryByLabelText('Stored status')).not.toBeInTheDocument();
  for (const label of [
    'Quantity',
    'Refills authorized',
    'Refills remaining',
    'Reorder lead time (days)',
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Cost per vial'), {
    target: { value: '0.1234567890123456789' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    medication_id: courseIds.med,
    currency: 'GBP',
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
it('rejects fractional counters and a prescription that expires before it was written', async () => {
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
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Date written must be on or before'
  );
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Expiry date'), {
    target: { value: '2027-11-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    date_written: '2026-11-20',
    expiration: '2027-11-01',
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
  expect(screen.getByLabelText('Cost per vial')).toHaveValue('0');
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

it('does not confirm an untouched legacy cost on focus, blur or unrelated changes', async () => {
  render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({ cost: '20' })}
    />
  );
  const input = screen.getByLabelText('Cost per vial');
  fireEvent.focus(input);
  fireEvent.blur(input);
  fireEvent.change(screen.getByLabelText('Prescriber'), {
    target: { value: 'Updated prescriber' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0][1]).toHaveProperty('cost', '20');
  expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('cost_basis');
});
it.each(['20', '0'])(
  'confirms deliberate same-value input %s under Cost per vial',
  async (cost) => {
    render(
      <MedicationPrescriptionForm
        {...props()}
        initial={prescriptionFixture({ cost })}
      />
    );
    fireEvent.input(screen.getByLabelText('Cost per vial'), {
      target: { value: cost },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({
      cost,
      cost_basis: 'per_vial',
    });
  }
);
it('clears a blank cost and preserves only an already confirmed basis on currency edits', async () => {
  const view = render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({ cost: '20', cost_basis: 'per_vial' })}
    />
  );
  fireEvent.change(screen.getByLabelText('Cost per vial'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  expect(mockUpdate.mock.calls[0][1]).toMatchObject({
    cost: null,
    cost_basis: null,
  });
  view.unmount();
  render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({ cost: '20', cost_basis: 'per_vial' })}
    />
  );
  fireEvent.change(screen.getByLabelText('Currency'), {
    target: { value: 'USD' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
  expect(mockUpdate.mock.calls[1][1]).toMatchObject({
    cost: '20',
    currency: 'USD',
  });
  expect(mockUpdate.mock.calls[1][1]).toHaveProperty('cost_basis', 'per_vial');
  view.unmount();
});
it('does not confirm an untouched legacy cost on a currency edit', async () => {
  render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({ cost: '20' })}
    />
  );
  fireEvent.change(screen.getByLabelText('Currency'), {
    target: { value: 'EUR' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  expect(mockUpdate.mock.calls[0][1]).toMatchObject({
    cost: '20',
    currency: 'EUR',
  });
  expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('cost_basis');
});
it('discards prior cost-input intent when explicitly reloading a stale saved record', async () => {
  mockUpdate
    .mockRejectedValueOnce(new HttpApiError('stale', 409))
    .mockResolvedValueOnce({
      id: prescriptionIds.first,
      version: 3,
      deleted: false,
    });
  render(
    <MedicationPrescriptionForm
      {...props()}
      initial={prescriptionFixture({ cost: '10' })}
    />
  );
  fireEvent.change(screen.getByLabelText('Cost per vial'), {
    target: { value: '20' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await screen.findByRole('button', {
    name: 'Reload saved prescription (discards this draft)',
  });
  mockReload.mockResolvedValueOnce({
    isSuccess: true,
    data: { prescription: prescriptionFixture({ cost: '20', version: 2 }) },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reload saved prescription (discards this draft)',
    })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save prescription' })
    ).toBeEnabled()
  );
  fireEvent.change(screen.getByLabelText('Source'), {
    target: { value: 'Only metadata' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
  expect(mockUpdate.mock.calls[0][1]).toHaveProperty('cost_basis', 'per_vial');
  expect(mockUpdate.mock.calls[1][1]).not.toHaveProperty('cost_basis');
});

it('starts the currency empty with no history, refuses to save until one is entered and then keeps it', async () => {
  const p = { ...props(), defaultCurrency: undefined };
  render(<MedicationPrescriptionForm {...p} />);
  const currency = screen.getByLabelText('Currency');
  expect(currency).toHaveValue('');
  expect(currency).toHaveAttribute('placeholder', 'e.g. GBP');
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a currency, for example GBP.'
  );
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.change(currency, { target: { value: ' usd ' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ currency: 'usd' });
});
it('fills the default when history loads after opening, but never over what the user typed', () => {
  const p = { ...props(), defaultCurrency: undefined };
  const view = render(<MedicationPrescriptionForm {...p} />);
  view.rerender(<MedicationPrescriptionForm {...p} defaultCurrency="EUR" />);
  expect(screen.getByLabelText('Currency')).toHaveValue('EUR');
  fireEvent.change(screen.getByLabelText('Currency'), {
    target: { value: 'CHF' },
  });
  view.rerender(<MedicationPrescriptionForm {...p} defaultCurrency="GBP" />);
  expect(screen.getByLabelText('Currency')).toHaveValue('CHF');
});
it('keeps an existing prescription its own currency whatever the default is', () => {
  render(
    <MedicationPrescriptionForm
      {...props()}
      defaultCurrency="GBP"
      initial={prescriptionFixture({ currency: 'AUD' })}
    />
  );
  expect(screen.getByLabelText('Currency')).toHaveValue('AUD');
});
