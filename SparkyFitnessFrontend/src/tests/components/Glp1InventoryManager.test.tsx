import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1InventoryManager from '@/pages/Medications/Glp1InventoryManager';
import type { Medication, MedicationPen } from '@/types/medications';

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
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const med = { id: 'medicine', dose_amount: 0.6, dose_unit: 'mg' } as Medication;
beforeEach(() => {
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
      volume_ml: 3,
      concentration_mg_ml: 4,
    })
  );
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('doses_used');
});
