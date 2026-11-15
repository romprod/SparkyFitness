import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationSyringeSettings from '@/pages/Medications/MedicationSyringeSettings';
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockDefault = jest.fn();
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: {
      syringes: [
        {
          id: 'used',
          name: 'Synthetic syringe',
          graduation_type: 'units',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '0.5',
        },
      ],
      default_syringe_id: 'used',
    },
  }),
  useSaveMedicationSyringe: () => ({ mutate: mockSave, isPending: false }),
  useDeleteMedicationSyringe: () => ({ mutate: mockRemove, isPending: false }),
  useDefaultMedicationSyringe: () => ({
    mutate: mockDefault,
    isPending: false,
  }),
}));
beforeEach(() => {
  mockSave.mockClear();
  mockRemove.mockClear();
  mockDefault.mockClear();
});
function open() {
  render(<MedicationSyringeSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage syringes' }));
}
it('saves validated syringe decimal settings and permits editing', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Smallest mark')).toHaveValue('0.5');
  fireEvent.change(screen.getByLabelText('Smallest mark'), {
    target: { value: '0.25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockSave).toHaveBeenCalledWith(
    {
      id: 'used',
      body: {
        name: 'Synthetic syringe',
        graduation_type: 'units',
        units_per_ml: 100,
        capacity_ml: '1',
        capacity_units: 100,
        increment: '0.25',
      },
    },
    expect.anything()
  );
});
it('supports clearing the default and removing previously used device configurations', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Clear default' }));
  expect(mockDefault).toHaveBeenCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(mockRemove).toHaveBeenCalledWith('used');
});
it('does not save an empty name or zero increment', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Add syringe' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Valid name' },
  });
  fireEvent.change(screen.getByLabelText('Smallest mark'), {
    target: { value: '0' },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
