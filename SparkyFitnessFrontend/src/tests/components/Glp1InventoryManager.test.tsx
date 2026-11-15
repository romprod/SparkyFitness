import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1InventoryManager from '@/pages/Medications/Glp1InventoryManager';
import type { Medication, MedicationPen } from '@/types/medications';

const mockSave = jest.fn();
let mockPens: Partial<MedicationPen>[] = [];
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({ data: mockPens }),
  useCreatePenMutation: () => ({ mutate: mockSave, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useDeletePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const med = { id: 'medicine', dose_amount: 0.6 } as Medication;
beforeEach(() => {
  mockPens = [];
  mockSave.mockClear();
});
async function openVial() {
  render(<Glp1InventoryManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  fireEvent.pointerDown(screen.getByLabelText('Kind'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Vial' }));
}
it('saves the calculated preparation using the existing vial form', async () => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Vial content (mg)'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Volume (mL)'), {
    target: { value: '3' },
  });
  expect(
    screen.getByText('4 mg/mL · 0.15 mL per entered dose')
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'vial',
      concentration_mg_ml: 4,
      volume_ml: 3,
      dose_mg: 0.6,
    }),
    expect.anything()
  );
});
it('prevents saving an incomplete preparation', async () => {
  await openVial();
  fireEvent.change(screen.getByLabelText('Vial content (mg)'), {
    target: { value: '12' },
  });
  expect(screen.getByRole('button', { name: 'Add Inventory' })).toBeDisabled();
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
