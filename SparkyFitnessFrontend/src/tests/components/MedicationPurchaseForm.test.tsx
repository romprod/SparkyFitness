import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  allocateMedicationPurchase,
  type MedicationPurchaseView,
} from '@workspace/shared';
import type { MedicationPurchaseEditorData } from '@workspace/shared';
import { HttpApiError } from '@/api/api';
import MedicationPurchaseForm from '@/pages/Medications/MedicationPurchaseForm';
const mockSave = jest.fn();
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useSaveMedicationPurchase: () => ({
    mutateAsync: mockSave,
    isPending: false,
  }),
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const owner = '10000000-0000-4000-8000-000000000001';
const medId = '20000000-0000-4000-8000-000000000002';
const vial1 = '30000000-0000-4000-8000-000000000003';
const vial2 = '40000000-0000-4000-8000-000000000004';
const data = {
  medications: [{ id: medId, name: 'Synthetic medication' }],
  vials: [vial1, vial2].map((id, i) => ({
    id,
    medication_id: medId,
    medication_name: 'Synthetic medication',
    label: `Synthetic vial ${i + 1}`,
    status: i ? 'discarded' : 'sealed',
    lot_number: null,
    expiry_date: null,
    purchase_item_id: null,
  })),
  packs: [] as MedicationPurchaseEditorData['packs'],
};
const props = () => ({
  ownerId: owner,
  data,
  isCurrent: () => true,
  onDone: jest.fn(),
  onCancel: jest.fn(),
  onReload: jest.fn(),
});
beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockResolvedValue({});
});
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
it('uses source defaults and raw money strings with a live shared allocation preview', async () => {
  render(<MedicationPurchaseForm {...props()} />);
  expect(screen.getByLabelText('Currency')).toHaveValue('AUD');
  expect(screen.getByLabelText('Vials')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Unit cost'), {
    target: { value: '24.1234567890123456789' },
  });
  fireEvent.change(screen.getByLabelText('Shipping'), {
    target: { value: '5' },
  });
  expect(screen.getAllByText(/29\.12/).length).toBeGreaterThan(0);
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].body).toMatchObject({
    expected_owner_id: owner,
    operation_id: expect.any(String),
    currency: 'AUD',
    shipping_cost: '5',
    items: [
      expect.objectContaining({
        medication_id: medId,
        unit_cost: '24.1234567890123456789',
      }),
    ],
  });
});
it('allows all-status vial matching and overmatching as a warning', async () => {
  render(<MedicationPurchaseForm {...props()} />);
  const checks = screen.getAllByRole('checkbox');
  checks.forEach((check) => fireEvent.click(check));
  expect(screen.getByText(/More vials matched/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save invoice' })).toBeEnabled();
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].body.items[0].vial_ids).toEqual([
    vial1,
    vial2,
  ]);
});
it('clears matching when medication changes and excludes vials already picked on another line', () => {
  render(<MedicationPurchaseForm {...props()} />);
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));
  const cards = screen
    .getAllByText(/Line \d · Medication/)
    .map(
      (title) =>
        title.closest('[data-slot="card"]') ??
        title.parentElement!.parentElement!
    );
  expect(
    within(cards[1] as HTMLElement).queryByLabelText(/Synthetic vial 1/)
  ).not.toBeInTheDocument();
  const medicationSelect = screen.getAllByLabelText('Medication')[0]!;
  fireEvent.change(medicationSelect, { target: { value: '' } });
  expect(screen.getAllByText(/Match vials/)[0]).toHaveTextContent('(0 of 1)');
});
it('saves a consumable-only invoice without medication records', async () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{ medications: [], vials: [], packs: [] }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add consumable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }));
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Synthetic swabs' },
  });
  fireEvent.change(screen.getByLabelText('Currency'), {
    target: { value: 'local credits' },
  });
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].body.items).toEqual([
    expect.objectContaining({
      kind: 'consumable',
      medication_id: null,
      description: 'Synthetic swabs',
    }),
  ]);
});
it('does not silently turn invalid amounts into zero', () => {
  render(<MedicationPurchaseForm {...props()} />);
  fireEvent.change(screen.getByLabelText('Shipping'), {
    target: { value: 'mistyped' },
  });
  save();
  expect(screen.getByText(/Check the dates/)).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
it('retries an uncertain creation with the same operation and pinned payload', async () => {
  mockSave.mockRejectedValueOnce(new Error('Synthetic lost response'));
  render(<MedicationPurchaseForm {...props()} />);
  save();
  await screen.findByText('Synthetic lost response');
  const first = mockSave.mock.calls[0][0].body;
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
  expect(mockSave.mock.calls[1][0].body).toEqual(first);
});
it('drops an obsolete completion and refuses save after owner invalidation', async () => {
  let resolve!: (value: unknown) => void;
  let current = true;
  mockSave.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const p = props();
  render(<MedicationPurchaseForm {...p} isCurrent={() => current} />);
  save();
  current = false;
  resolve({});
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(p.onDone).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  expect(mockSave).toHaveBeenCalledTimes(1);
});
it('pins the original revision if the saved invoice refreshes while editing', async () => {
  const initial = {
    id: '50000000-0000-4000-8000-000000000005',
    revision: 1,
    vendor: '',
    reference: '',
    ordered_date: '2026-11-15',
    received_date: null,
    currency: 'AUD',
    shipping_cost: '0',
    tax_cost: '0',
    other_fees: '0',
    discount: '0',
    allocation_method: 'value',
    notes: '',
    items: [
      {
        id: '60000000-0000-4000-8000-000000000006',
        kind: 'medication',
        medication_id: medId,
        medication_name: 'Synthetic medication',
        category: null,
        description: '',
        quantity: 1,
        unit_cost: '20',
        units_per_pack: null,
        units_per_dose: null,
        vial_ids: [],
        pack_ids: [],
        subtotal: '20',
        allocated: '0',
        landed: '20',
        landed_unit: '20',
      },
    ],
    totals: allocateMedicationPurchase({
      lines: [],
      allocation_method: 'none',
    }),
    vials_expected: 1,
    vials_linked: 0,
    packs_linked: 0,
    created_at: '',
  } as MedicationPurchaseView;
  const p = props();
  const { rerender } = render(
    <MedicationPurchaseForm {...p} initial={initial} />
  );
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Synthetic draft' },
  });
  rerender(
    <MedicationPurchaseForm {...p} initial={{ ...initial, revision: 2 }} />
  );
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].body.expected_revision).toBe(1);
});

it('requires a consumable description instead of silently dropping a priced line', () => {
  render(<MedicationPurchaseForm {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add consumable' }));
  const prices = screen.getAllByLabelText('Unit cost');
  fireEvent.change(prices[1]!, { target: { value: '12.50' } });
  save();
  expect(
    screen.getByText(/enter a consumable description/)
  ).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});

it('allows a named zero-cost consumable', async () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{ medications: [], vials: [], packs: [] }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add consumable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }));
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Synthetic included swabs' },
  });
  fireEvent.change(screen.getByLabelText('Unit cost'), {
    target: { value: '0' },
  });
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].body.items[0].unit_cost).toBe('0');
});

it('locks an uncertain create against edits and retries the original operation exactly', async () => {
  mockSave.mockRejectedValueOnce(new Error('Synthetic lost response'));
  render(<MedicationPurchaseForm {...props()} />);
  fireEvent.change(screen.getByLabelText('Supplier'), {
    target: { value: 'Synthetic original supplier' },
  });
  save();
  await screen.findByText('Synthetic lost response');
  const body = mockSave.mock.calls[0][0].body;
  expect(screen.getByLabelText('Supplier')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Supplier'), {
    target: { value: 'Synthetic edited supplier' },
  });
  expect(screen.getByLabelText('Supplier')).toHaveValue(
    'Synthetic original supplier'
  );
  expect(screen.getByRole('button', { name: 'Add consumable' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
  expect(mockSave.mock.calls[1][0].body).toEqual(body);
});

it('unlocks a deterministic rejected creation for correction', async () => {
  mockSave.mockRejectedValueOnce(
    new HttpApiError('Synthetic invalid line', 400)
  );
  render(<MedicationPurchaseForm {...props()} />);
  save();
  await screen.findByText('Synthetic invalid line');
  const oldOperation = mockSave.mock.calls[0][0].body.operation_id;
  expect(screen.getByLabelText('Supplier')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Supplier'), {
    target: { value: 'Synthetic corrected supplier' },
  });
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
  expect(mockSave.mock.calls[1][0].body.operation_id).not.toBe(oldOperation);
});

it.each([401, 403, 409])(
  'keeps the original uncertain operation after a retry receives %s',
  async (status) => {
    mockSave
      .mockRejectedValueOnce(new Error('Synthetic lost response'))
      .mockRejectedValueOnce(
        new HttpApiError('Synthetic retry refused', status)
      );
    render(<MedicationPurchaseForm {...props()} />);
    save();
    await screen.findByText('Synthetic lost response');
    const body = mockSave.mock.calls[0][0].body;
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await screen.findByText('Synthetic retry refused');
    expect(screen.getByLabelText('Supplier')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(3));
    expect(mockSave.mock.calls[2][0].body).toEqual(body);
  }
);

it('distinguishes otherwise identical vials by authoritative prepared content', () => {
  const same = {
    medication_id: medId,
    medication_name: 'Synthetic medication',
    label: 'Synthetic vial',
    status: 'sealed',
    lot_number: 'SYN-LOT',
    expiry_date: null,
    purchase_item_id: null,
  };
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{
        medications: data.medications,
        packs: [],
        vials: [
          { ...same, id: vial1, prepared_mass_mg: '10' },
          { ...same, id: vial2, prepared_mass_mg: '20' },
        ],
      }}
    />
  );
  expect(
    screen.getByRole('checkbox', { name: /Prepared content: 10 mg/ })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: /Prepared content: 20 mg/ })
  ).toBeInTheDocument();
});

it('does not invent content for a legacy vial without saved preparation', () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{
        medications: data.medications,
        packs: [],
        vials: [{ ...data.vials[0]!, prepared_mass_mg: null }],
      }}
    />
  );
  expect(
    screen.getByRole('checkbox', { name: /Synthetic vial 1/ })
  ).toBeInTheDocument();
  expect(screen.queryByText(/Prepared content:/)).not.toBeInTheDocument();
});

it('prefers an explicit vial label amount over preparation content in matching labels', () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{
        medications: data.medications,
        packs: [],
        vials: [
          { ...data.vials[0]!, label_mass_mg: '20', prepared_mass_mg: '10' },
        ],
      }}
    />
  );
  expect(
    screen.getByRole('checkbox', { name: /Vial label amount: 20 mg/ })
  ).toBeInTheDocument();
  expect(screen.queryByText(/Prepared content: 10 mg/)).not.toBeInTheDocument();
});
const packOf = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  medication_id: medId,
  medication_name: 'Synthetic medication',
  label: `Synthetic pack ${id.slice(0, 1)}`,
  unit_label: 'tablets',
  units_total: '60',
  status: 'sealed',
  lot_number: null,
  expiry_date: null,
  purchase_item_id: null,
  ...over,
});
const pack1 = '50000000-0000-4000-8000-000000000005';
const pack2 = '60000000-0000-4000-8000-000000000006';
it('matches packs to a line, counts them with vials and saves their ids', async () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{
        medications: data.medications,
        vials: [],
        packs: [packOf(pack1), packOf(pack2)],
      }}
    />
  );
  expect(screen.getByText(/Match packs/)).toHaveTextContent('(0 of 1)');
  expect(
    screen.queryByText(/No unmatched vials for this medication/)
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Synthetic pack 5/));
  expect(screen.getByText(/Match packs/)).toHaveTextContent('(1 of 1)');
  expect(screen.queryByText(/More vials matched/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Synthetic pack 6/));
  expect(screen.getByText(/More vials matched/)).toBeInTheDocument();
  save();
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].body.items[0]).toMatchObject({
    vial_ids: [],
    pack_ids: [pack1, pack2],
  });
});
it('offers vials and packs together and hides a pack already picked on another line', () => {
  render(
    <MedicationPurchaseForm
      {...props()}
      data={{ ...data, packs: [packOf(pack1)] }}
    />
  );
  expect(screen.getByText(/Match vials and packs/)).toHaveTextContent(
    '(0 of 1)'
  );
  fireEvent.click(screen.getByLabelText(/Synthetic pack 5/));
  fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));
  expect(screen.getAllByLabelText(/Synthetic pack 5/)).toHaveLength(1);
});

describe('an imported invoice line with no medication', () => {
  const imported = (description: string) =>
    ({
      id: '50000000-0000-4000-8000-000000000015',
      revision: 1,
      vendor: 'Supplier',
      reference: '',
      ordered_date: '2026-11-13',
      received_date: null,
      currency: 'GBP',
      shipping_cost: '0',
      tax_cost: '0',
      other_fees: '0',
      discount: '0',
      allocation_method: 'value',
      notes: '',
      items: [
        {
          id: '60000000-0000-4000-8000-000000000016',
          kind: 'medication',
          medication_id: null,
          medication_name: null,
          category: null,
          description,
          quantity: 10,
          unit_cost: '11.2',
          units_per_pack: null,
          units_per_dose: null,
          vial_ids: [],
          pack_ids: [],
          subtotal: '112',
          allocated: '0',
          landed: '112',
          landed_unit: '11.2',
        },
      ],
      totals: allocateMedicationPurchase({
        lines: [],
        allocation_method: 'none',
      }),
      vials_expected: 10,
      vials_linked: 0,
      packs_linked: 0,
      created_at: '',
    }) as unknown as MedicationPurchaseView;

  it('starts from the medication the description names, so its vials can be ticked', async () => {
    render(
      <MedicationPurchaseForm
        {...props()}
        initial={imported('Synthetic medication 10mg LOT-1 × 1')}
      />
    );
    expect(screen.getByLabelText('Medication')).toHaveValue(medId);
    expect(
      screen.getByText(
        /It looks like Synthetic medication from the description/
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    save();
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const line = mockSave.mock.calls[0][0].body.items[0];
    expect(line.medication_id).toBe(medId);
    expect(line.vial_ids).toEqual([vial1]);
  });

  it('says why no vial is offered when the description names nothing', () => {
    render(
      <MedicationPurchaseForm
        {...props()}
        initial={imported('Something else entirely')}
      />
    );
    expect(screen.getByLabelText('Medication')).toHaveValue('');
    expect(
      screen.getByRole('option', { name: 'Choose a medication…' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /This line has no medication, so no vials can be matched/
      )
    ).toBeInTheDocument();
  });

  it('tells how many vials belong to other medications when none match', () => {
    const other = '70000000-0000-4000-8000-000000000007';
    const p = props();
    render(
      <MedicationPurchaseForm
        {...p}
        data={{
          ...data,
          medications: [
            ...data.medications,
            { id: other, name: 'Another medication' },
          ],
        }}
        initial={
          {
            ...imported('x'),
            items: [
              {
                ...imported('x').items[0]!,
                medication_id: other,
                medication_name: 'Another medication',
              },
            ],
          } as unknown as MedicationPurchaseView
        }
      />
    );
    expect(
      screen.getByText(
        /Unmatched vials for other medications are not listed here \(2\)/
      )
    ).toBeInTheDocument();
  });
});
