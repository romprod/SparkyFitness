import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1InventoryManager from '@/pages/Medications/Glp1InventoryManager';
import {
  inventoryForecastFixture,
  forecastCoverage,
} from '@/tests/fixtures/medicationInventoryForecast';
import type { Medication, MedicationPen } from '@/types/medications';

let mockRxReady = false;
let mockRxKey = 'owner:1';
const mockRxId = '00000000-0000-4000-8000-000000000071';
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptionScope: () => ({
    key: mockRxKey,
    ready: mockRxReady,
    canWrite: mockRxReady,
    isCurrent: () => mockRxReady,
  }),
  useMedicationPrescriptions: () => ({
    scope: {
      ready: mockRxReady,
      canWrite: mockRxReady,
      isCurrent: () => mockRxReady,
    },
    query: { isError: false, isFetching: false },
    data: {
      prescriptions: [
        {
          id: mockRxId,
          medication_id: 'medicine',
          source: 'Recorded Rx',
          status: 'cancelled',
          expiration: null,
        },
      ],
    },
  }),
}));
const mockSave = jest.fn();
const mockUpdate = jest.fn();
let mockPens: Partial<MedicationPen>[] = [];
jest.mock('@/pages/Medications/MedicationVialCostLink', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({ data: mockPens }),
  useCreatePenMutation: () => ({ mutate: mockSave, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: mockUpdate, isPending: false }),
  useDeletePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
  usePreparationReview: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
  }),
  useCorrectPreparationMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: { syringes: [], default_syringe_id: null },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => day,
  }),
}));
const med = { id: 'medicine', dose_amount: 0.6, dose_unit: 'mg' } as Medication;
beforeEach(() => {
  mockRxReady = false;
  mockRxKey = 'owner:1';
  mockPens = [];
  mockSave.mockClear();
  mockUpdate.mockClear();
});
async function openVial() {
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare a vial' }));
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  fireEvent.change(screen.getByLabelText('Prepared date'), {
    target: { value: '2026-11-15' },
  });
}
it('saves the calculated preparation using the existing vial form', async () => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
  expect(screen.getByText('4 mg/mL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'vial',
      preparation: expect.objectContaining({
        mass_value: '12',
        mass_unit: 'mg',
        final_volume_ml: '3',
        prepared_date: '2026-11-15',
      }),
      dose_mg: 0.6,
    }),
    expect.anything()
  );
});
it('prevents saving an incomplete preparation', async () => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value: '12' },
  });
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
});
it('displays actual mass remaining instead of nominal dose counts', () => {
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      doses_total: 4,
      doses_used: 3,
      status: 'in_use',
      stock: {
        totalMg: 12,
        usedMg: 2.1,
        remainingMg: 9.9,
        remainingMl: 2.475,
        overdrawnMg: 0,
      },
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  expect(screen.getByText('9.900 mg / 2.475 mL remaining')).toBeInTheDocument();
});

it('preserves a legacy BUD while editing unrelated metadata', () => {
  mockPens = [
    {
      id: 'legacy',
      kind: 'vial',
      label: 'Legacy',
      bud_date: '2026-12-01',
      opened_at: '2026-11-01',
      dose_mg: 0.5,
      volume_ml: 2,
      concentration_mg_ml: 5,
      doses_used: 0,
      reorder_flag: false,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  expect(screen.getByLabelText('BUD date')).toHaveValue('2026-12-01');
  fireEvent.change(screen.getByLabelText('Lot number'), {
    target: { value: 'LOT-A' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'legacy',
      body: expect.objectContaining({
        lot_number: 'LOT-A',
      }),
    }),
    expect.anything()
  );
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('preparation');
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('bud_date');
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('bud_mode');
});
const savedPreparation = {
  id: 'prep',
  mode: 'premixed' as const,
  mass_value: 500,
  mass_unit: 'mcg' as const,
  mass_mg: 0.5,
  final_volume_ml: 1,
  concentration_mg_ml: 0.5,
  prepared_date: '2026-11-12',
  diluent: 'Recorded diluent',
  created_at: '2026-11-12T12:00:00Z',
};
it('reopens original preparation inputs read-only and keeps them out of metadata updates', () => {
  mockPens = [
    {
      id: 'saved',
      kind: 'vial',
      preparation: savedPreparation,
      concentration_mg_ml: 0.5,
      volume_ml: 1,
      doses_used: 0,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  expect(screen.getByText('500 mcg')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  expect(screen.getAllByText('2026-11-12')).toHaveLength(2);
  expect(screen.getByLabelText('Volume (mL)')).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('Storage location'), {
    target: { value: 'Fridge shelf' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const body = mockUpdate.mock.calls[0][0].body;
  expect(body.storage_location).toBe('Fridge shelf');
  expect(body).not.toHaveProperty('preparation');
  expect(body).not.toHaveProperty('concentration_mg_ml');
  expect(body).not.toHaveProperty('volume_ml');
});
it('requires an explicit interval basis and source and permits a zero-day interval', async () => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value: '500' },
  });
  fireEvent.pointerDown(screen.getByLabelText('Mass unit'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'mcg' }));
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '1' },
  });
  fireEvent.pointerDown(screen.getByLabelText('Beyond-use date (BUD)'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Interval and source' })
  );
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('From date'), {
    target: { value: '2026-11-15' },
  });
  fireEvent.change(screen.getByLabelText('Days'), {
    target: { value: '0' },
  });
  fireEvent.change(screen.getByLabelText('BUD source'), {
    target: { value: 'Product instructions' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      bud_date: '2026-11-15',
      bud_interval_days: 0,
      bud_source: 'Product instructions',
      preparation: expect.objectContaining({
        mass_value: '500',
        mass_unit: 'mcg',
      }),
    }),
    expect.anything()
  );
});
it.each(['0', '-1'])('rejects invalid preparation mass %s', async (value) => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value },
  });
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '1' },
  });
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
});

it('can attach preparation to an unused legacy vial without inventing original content', () => {
  mockPens = [
    {
      id: 'legacy',
      kind: 'vial',
      doses_used: 0,
      volume_ml: 2,
      concentration_mg_ml: 5,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Prepare a vial' })[1]!
  );
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  expect(screen.getByLabelText('Powder in the vial')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
});

it('does not send lifecycle intent or status for an unrelated edit', () => {
  mockPens = [
    { id: 'auto-finished', kind: 'vial', status: 'finished', doses_used: 4 },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByText('Finished / discarded (1)'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.change(screen.getByLabelText('Lot number'), {
    target: { value: 'A' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('status');
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
    'lifecycle_intent'
  );
});
it('can deliberately discard or reopen stock without rewriting its quantity', async () => {
  mockPens = [
    {
      id: 'closed',
      kind: 'vial',
      status: 'discarded',
      doses_used: 2,
      volume_ml: 3,
      concentration_mg_ml: 4,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByText('Finished / discarded (1)'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.pointerDown(screen.getByLabelText('Status'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'in use' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      status: 'in_use',
      lifecycle_intent: true,
    })
  );
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('volume_ml');
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
    'concentration_mg_ml'
  );
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('doses_used');
});

it('reopens exact vial label mass independently and omits it on unrelated edits', () => {
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      status: 'in_use',
      doses_used: 1,
      label_mass_mg: '20.00000000000000000001',
      dose_mg: 0.5,
      preparation: {
        id: 'prep',
        mode: 'reconstituted',
        mass_value: 10,
        mass_unit: 'mg',
        mass_mg: 10,
        concentration_mg_ml: 5,
        final_volume_ml: 2,
        prepared_date: '2026-11-15',
        created_at: '',
      },
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  expect(screen.getByLabelText('Vial label amount (mg)')).toHaveValue(
    '20.00000000000000000001'
  );
  fireEvent.change(screen.getByLabelText('Lot number'), {
    target: { value: 'SYN-LOT' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const body = mockUpdate.mock.calls[0][0].body;
  expect(body).not.toHaveProperty('label_mass_mg');
  expect(body).not.toHaveProperty('preparation');
  expect(body).not.toHaveProperty('doses_used');
  expect(body).not.toHaveProperty('dose_mg');
});
it('sends an explicit null only when the saved label amount is cleared', () => {
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      status: 'sealed',
      doses_used: 0,
      label_mass_mg: '20',
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.change(screen.getByLabelText('Vial label amount (mg)'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[0][0].body.label_mass_mg).toBeNull();
});
it('creates vial label metadata as an exact raw string without prefilling a dose or preparation amount', async () => {
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  fireEvent.pointerDown(screen.getByLabelText('Kind'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Vial' }));
  expect(screen.getByLabelText('Vial label amount (mg)')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Vial label amount (mg)'), {
    target: { value: '20.00000000000000000001' },
  });
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Add Inventory' }).at(-1)!
  );
  expect(mockSave.mock.calls[0][0].label_mass_mg).toBe(
    '20.00000000000000000001'
  );
  expect(mockSave.mock.calls[0][0].dose_mg).toBe(0.6);
});
it.each(['0', '-1', 'Infinity', 'mistyped'])(
  'rejects invalid explicit vial label amount %s',
  (value) => {
    mockPens = [{ id: 'vial', kind: 'vial', status: 'sealed', doses_used: 0 }];
    render(<Glp1InventoryManager med={med} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.change(screen.getByLabelText('Vial label amount (mg)'), {
      target: { value },
    });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(mockUpdate).not.toHaveBeenCalled();
  }
);

it('requires an explicit label clear before converting labelled vial stock to a pen', async () => {
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      status: 'sealed',
      doses_used: 0,
      label_mass_mg: '20',
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.pointerDown(screen.getByLabelText('Kind'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Pen' }));
  expect(screen.getByLabelText('Vial label amount (mg)')).toHaveValue('20');
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Vial label amount (mg)'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[0][0].body).toMatchObject({
    kind: 'pen',
    label_mass_mg: null,
  });
});

it('preserves exact legacy physical values behind a lossy DTO during a label-only edit', () => {
  const stored: Record<string, string | null> = {
    dose_mg: '0.123456789012345678901',
    concentration_mg_ml: '5.123456789012345678901',
    volume_ml: '2.123456789012345678901',
    doses_total: '23',
    label_mass_mg: null,
  };
  const before = { ...stored };
  mockPens = [
    {
      id: 'legacy-precise',
      kind: 'vial',
      status: 'sealed',
      doses_used: 0,
      dose_mg: Number(stored['dose_mg']),
      concentration_mg_ml: Number(stored['concentration_mg_ml']),
      volume_ml: Number(stored['volume_ml']),
      doses_total: Number(stored['doses_total']),
    },
  ];
  mockUpdate.mockImplementationOnce(
    ({ body }: { body: Record<string, unknown> }) => {
      for (const field of Object.keys(stored)) {
        if (field in body)
          stored[field] = body[field] === null ? null : String(body[field]);
      }
    }
  );
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.change(screen.getByLabelText('Vial label amount (mg)'), {
    target: { value: '20.00000000000000000001' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const body = mockUpdate.mock.calls[0][0].body;
  for (const field of [
    'dose_mg',
    'concentration_mg_ml',
    'volume_ml',
    'doses_total',
  ]) {
    expect(body).not.toHaveProperty(field);
    expect(stored[field]).toBe(before[field]);
  }
  expect(stored['label_mass_mg']).toBe('20.00000000000000000001');
});

it('retains a deliberate physical edit while omitting the other untouched values', () => {
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      status: 'sealed',
      doses_used: 0,
      dose_mg: 0.5,
      concentration_mg_ml: 5,
      volume_ml: 2,
      doses_total: 20,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.change(screen.getByLabelText(/Dose strength.*mg/i), {
    target: { value: '0.75' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const body = mockUpdate.mock.calls[0][0].body;
  expect(body.dose_mg).toBe(0.75);
  expect(body).not.toHaveProperty('concentration_mg_ml');
  expect(body).not.toHaveProperty('volume_ml');
  expect(body).not.toHaveProperty('doses_total');
});

it('preserves hidden concentration and volume on an unchanged legacy pen', () => {
  mockPens = [
    {
      id: 'legacy-pen',
      kind: 'pen',
      status: 'sealed',
      doses_used: 0,
      dose_mg: 0.5,
      concentration_mg_ml: 5.123456789012345,
      volume_ml: 2.123456789012345,
      doses_total: 4,
    },
  ];
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.change(screen.getByLabelText('Lot number'), {
    target: { value: 'SYN-PEN-LOT' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const body = mockUpdate.mock.calls[0][0].body;
  expect(body.lot_number).toBe('SYN-PEN-LOT');
  for (const field of [
    'dose_mg',
    'concentration_mg_ml',
    'volume_ml',
    'doses_total',
  ])
    expect(body).not.toHaveProperty(field);
});

it('attaches a prepared-container forecast only to its matching existing stock record', () => {
  mockPens = [
    {
      id: 'matching',
      kind: 'vial',
      status: 'in_use',
      label: 'Prepared example',
    },
    { id: 'other', kind: 'vial', status: 'sealed', label: 'Other stock' },
  ];
  const forecast = inventoryForecastFixture().medications[0]!;
  forecast.containers = [
    {
      container_id: 'matching',
      remaining_doses: 7,
      current_dose: null,
      coverage: forecastCoverage(),
    },
    {
      container_id: 'not-listed',
      remaining_doses: 99,
      current_dose: null,
      coverage: forecastCoverage(),
    },
  ];
  render(<Glp1InventoryManager med={med} forecast={forecast} />);
  expect(screen.getAllByText('Prepared-container forecast')).toHaveLength(1);
  expect(
    screen.getByText(/Remaining measurable administrations/)
  ).toHaveTextContent(': 7');
  expect(screen.queryByText(/: 99/)).not.toBeInTheDocument();
});

it('preserves omitted prescription binding on ordinary edits and sends only explicit link/unlink choices', () => {
  mockRxReady = true;
  mockPens = [
    {
      id: 'pen',
      medication_id: 'medicine',
      kind: 'vial',
      status: 'sealed',
      label: 'Existing vial',
      dose_mg: 1,
      doses_total: 10,
      doses_used: 0,
      prescription_id: mockRxId,
    },
  ];
  const view = render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
    'prescription_id'
  );
  fireEvent.change(screen.getByLabelText('Prescription (optional)'), {
    target: { value: 'none' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate.mock.calls[1][0].body).toHaveProperty(
    'prescription_id',
    null
  );
  expect(mockUpdate.mock.calls[1][0].body).not.toHaveProperty('dose_mg');
  view.unmount();
});

it.each(['medication', 'profile'])(
  'does not carry a private prescription draft into a new %s session',
  (kind) => {
    mockRxReady = true;
    mockPens = [
      {
        id: 'pen',
        medication_id: med.id,
        kind: 'vial',
        status: 'sealed',
        label: 'Existing vial',
        dose_mg: 1,
        doses_total: 10,
        doses_used: 0,
      },
    ];
    const view = render(<Glp1InventoryManager med={med} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.change(screen.getByLabelText('Prescription (optional)'), {
      target: { value: mockRxId },
    });
    expect(screen.getByLabelText('Prescription (optional)')).toHaveValue(
      mockRxId
    );
    view.rerender(<Glp1InventoryManager med={med} />);
    expect(screen.getByLabelText('Prescription (optional)')).toHaveValue(
      mockRxId
    );
    const nextMed =
      kind === 'medication' ? { ...med, id: 'other-medication' } : med;
    if (kind === 'profile') mockRxKey = 'owner:new-generation';
    view.rerender(<Glp1InventoryManager med={nextMed} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    expect(screen.getByLabelText('Prescription (optional)')).toHaveValue(
      'none'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
      'prescription_id'
    );
  }
);

it('stock-only cards retain Details and exact edit target while Cabinet keeps its original controls', () => {
  mockPens = [
    {
      id: 'used',
      medication_id: 'medicine',
      kind: 'vial',
      status: 'in_use',
      label: 'Custom used vial',
      label_mass_mg: '20',
      doses_used: 2,
      doses_total: 10,
      dose_mg: 1,
      concentration_mg_ml: 5,
      volume_ml: 2,
    },
  ];
  const medication = { ...med, name: 'Synthetic medication' };
  const view = render(
    <Glp1InventoryManager med={medication} stockView="active" stockCanWrite />
  );
  const card = screen.getByRole('article', {
    name: 'Synthetic medication · Custom used vial',
  });
  expect(card.querySelector('summary')).toHaveTextContent('Details');
  expect(card.querySelector('details')).not.toHaveAttribute('open');
  expect(screen.getByText('In use')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Add Inventory' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Label / Name')).toHaveValue('Custom used vial');
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'used' }),
    expect.anything()
  );
  view.unmount();
  render(<Glp1InventoryManager med={medication} />);
  expect(
    screen.getByRole('button', { name: 'Add Inventory' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Edit pen/vial' })
  ).toBeInTheDocument();
});
it('preserves the stock-only read view but closes a write draft when permission is revoked', () => {
  const view = render(
    <Glp1InventoryManager med={med} stockView="controls" stockCanWrite />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  view.rerender(
    <Glp1InventoryManager
      med={med}
      stockView="controls"
      stockCanWrite={false}
    />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Add Inventory' })
  ).not.toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});

it('keeps legacy recorded dose, concentration, count and manual reorder warning accessible in stock Details', () => {
  mockPens = [
    {
      id: 'legacy',
      medication_id: 'medicine',
      kind: 'vial',
      status: 'in_use',
      label: 'Legacy prepared vial',
      dose_mg: 2,
      concentration_mg_ml: 4,
      volume_ml: 2,
      doses_total: 4,
      doses_used: 3,
      reorder_flag: true,
      reorder_threshold: 1,
      preparation: null,
      stock: null,
    },
  ];
  const { container } = render(
    <Glp1InventoryManager
      med={{ ...med, name: 'Synthetic medication' }}
      stockView="active"
      stockCanWrite
    />
  );
  const details = container.querySelector('article details')!;
  expect(details).toHaveTextContent('Recorded dose2 mg');
  expect(details).toHaveTextContent('Concentration (mg/mL)4 mg/mL');
  expect(details).toHaveTextContent('Stock balance1/4 doses');
  expect(details).toHaveTextContent('Reorder');
  expect(details.querySelector('summary')).toHaveTextContent('Details');
});
