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
  coveredFixture,
  prescriptionFixture,
  prescriptionIds,
} from '@/tests/fixtures/medicationPrescriptions';
import { HttpApiError } from '@/api/api';
const mockListRefresh = jest.fn();
const mockCreate = jest.fn(),
  mockUpdate = jest.fn(),
  mockReload = jest.fn();
let mockCurrent = true;
let mockRegister: { prescriptions: unknown[] } | undefined;
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescription: () => ({ query: { refetch: mockReload } }),
  useMedicationPrescriptions: () => ({
    query: { refetch: mockListRefresh },
    data: mockRegister,
  }),
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
  mockRegister = undefined;
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

describe('a prescription that covers several medicines', () => {
  const second = {
    ...courseMedication,
    id: '00000000-0000-4000-8000-0000000000b1',
    name: 'Second medication',
    display_name: 'Second medication',
  };
  const third = {
    ...courseMedication,
    id: '00000000-0000-4000-8000-0000000000b2',
    name: 'Third medication',
    display_name: 'Third medication',
  };
  const many = () => ({
    ...props(),
    medications: [courseMedication, second, third],
  });
  const add = (id: string) =>
    fireEvent.change(screen.getByLabelText('Also covers another medication'), {
      target: { value: id },
    });
  const save = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
  it('sends one medicine as medication_id, exactly as before several existed', async () => {
    render(<MedicationPrescriptionForm {...many()} />);
    expect(
      screen.queryByRole('list', { name: 'Medications covered' })
    ).toBeNull();
    save();
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      medication_id: courseIds.med,
    });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('medication_ids');
  });
  it('picks several medicines as ordered chips with a primary and sends medication_ids in that order', async () => {
    render(<MedicationPrescriptionForm {...many()} />);
    add(second.id);
    add(third.id);
    const chips = screen.getByRole('list', { name: 'Medications covered' });
    expect(chips).toHaveTextContent(/1\. Example medication\s*Primary/);
    expect(chips).toHaveTextContent('2. Second medication');
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third medication up' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Second medication' })
    );
    expect(chips).not.toHaveTextContent('Second medication');
    add(second.id);
    save();
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      medication_ids: [courseIds.med, third.id, second.id],
    });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('medication_id');
  });
  it('keeps a fixed target as the primary while letting more be added around it', () => {
    render(
      <MedicationPrescriptionForm
        {...many()}
        fixedMedicationId={courseIds.med}
      />
    );
    add(second.id);
    expect(screen.getByLabelText('Medication')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove Example medication' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Second medication up' })
    ).toBeDisabled();
  });
  it('sends the covered set on an edit only when it changed, and shows deleted medicines read-only', async () => {
    const initial = coveredFixture(
      [
        { id: courseIds.med, name: 'Example medication' },
        { id: null, name: 'Gone medication' },
      ],
      { cost: '30' }
    );
    render(<MedicationPrescriptionForm {...many()} initial={initial} />);
    expect(
      screen.getByRole('list', { name: 'Medications covered' })
    ).toHaveTextContent('Gone medication · Deleted medication');
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'x' },
    });
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('medication_ids');
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('medication_id');
    add(second.id);
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect(mockUpdate.mock.calls[1][1]).toMatchObject({
      medication_ids: [courseIds.med, second.id],
    });
  });
  it('names what still links a medicine that cannot be removed and lets the owner keep editing', async () => {
    mockUpdate.mockRejectedValueOnce(
      new HttpApiError(
        'Cannot remove Second medication while 1 stock item and 0 plan revisions still link this prescription. Unlink them first.',
        409,
        'prescription_medication_linked'
      )
    );
    const initial = coveredFixture([
      { id: courseIds.med, name: 'Example medication' },
      { id: second.id, name: 'Second medication' },
    ]);
    render(<MedicationPrescriptionForm {...many()} initial={initial} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Second medication' })
    );
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('1 stock item')
    );
    // Not a stale record: no reload is demanded and the draft stays editable.
    expect(
      screen.queryByRole('button', { name: /Reload saved prescription/ })
    ).toBeNull();
    expect(screen.getByLabelText('Source')).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Save prescription' })
    ).toBeEnabled();
  });
  it('labels the cost a total for several medicines and confirms only the whole-prescription basis', async () => {
    render(<MedicationPrescriptionForm {...many()} />);
    add(second.id);
    expect(screen.getByLabelText('Total cost')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cost per vial')).toBeNull();
    fireEvent.change(screen.getByLabelText('Total cost'), {
      target: { value: '90' },
    });
    save();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    // Typing a cost on several medicines never confirms a per-vial price.
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('cost_basis');
    fireEvent.change(screen.getByLabelText('Price basis'), {
      target: { value: 'per_prescription' },
    });
    save();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockCreate.mock.calls[1][0]).toMatchObject({
      cost: '90',
      cost_basis: 'per_prescription',
    });
  });
  it('clears a per-vial confirmation when a second medicine is added and says so', async () => {
    const initial = prescriptionFixture({ cost: '12', cost_basis: 'per_vial' });
    render(<MedicationPrescriptionForm {...many()} initial={initial} />);
    expect(
      screen.queryByText(/saving clears its per-vial confirmation/)
    ).toBeNull();
    add(second.id);
    expect(
      screen.getByText(/saving clears its per-vial confirmation/)
    ).toBeInTheDocument();
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({
      medication_ids: [courseIds.med, second.id],
      cost_basis: null,
    });
  });
  it('keeps a single medicine with a whole-prescription price on that basis through unrelated edits', async () => {
    const initial = prescriptionFixture({
      cost: '60',
      cost_basis: 'per_prescription',
    });
    render(<MedicationPrescriptionForm {...many()} initial={initial} />);
    expect(screen.getByLabelText('Price basis')).toHaveValue(
      'per_prescription'
    );
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'x' },
    });
    save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('cost_basis');
  });
  it('cannot add medicines against a server that answers in the one-medicine shape', () => {
    mockRegister = { prescriptions: [prescriptionFixture()] };
    render(<MedicationPrescriptionForm {...many()} />);
    const choose = screen.getByLabelText('Also covers another medication');
    expect(choose).toBeDisabled();
    expect(choose).toHaveTextContent('Needs a server update');
  });
  it('allows at most twenty medicines', () => {
    const twenty = Array.from({ length: 21 }, (_, i) => ({
      ...courseMedication,
      id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
      name: `Medication ${i}`,
      display_name: `Medication ${i}`,
    }));
    render(
      <MedicationPrescriptionForm
        {...props()}
        medications={twenty}
        fixedMedicationId={twenty[0]!.id}
      />
    );
    for (const med of twenty.slice(1, 20)) add(med.id);
    expect(
      screen.getByLabelText('Also covers another medication')
    ).toBeDisabled();
  });
});
