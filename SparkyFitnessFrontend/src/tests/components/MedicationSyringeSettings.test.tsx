import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationSyringeSettings from '@/pages/Medications/MedicationSyringeSettings';
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockDefault = jest.fn();
let mockShared = false;
let mockDeviceType = 'syringe';
let mockDefaultId: string | null = 'used';
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: {
      syringes: [
        {
          id: 'used',
          name: 'Synthetic syringe',
          device_type: mockDeviceType,
          is_shared: mockShared,
          graduation_type: 'units',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '0.5',
        },
      ],
      default_syringe_id: mockDefaultId,
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
  mockDefaultId = 'used';
  mockShared = false;
  mockDeviceType = 'syringe';
  mockSave.mockClear();
  mockRemove.mockClear();
  mockDefault.mockClear();
});
function open() {
  render(<MedicationSyringeSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage devices' }));
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
        device_type: 'syringe',
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
  expect(mockRemove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('alertdialog');
  expect(
    within(dialog).getByText('Delete Synthetic syringe?')
  ).toBeInTheDocument();
  expect(dialog).toHaveTextContent("This can't be undone.");
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(mockRemove).toHaveBeenCalledWith('used');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('does not delete when the confirmation is cancelled', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  );
  expect(mockRemove).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('does not save an empty name or zero increment', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Valid name' },
  });
  fireEvent.change(screen.getByLabelText('Smallest mark'), {
    target: { value: '0' },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it('lets shared devices be defaulted while hiding edit and delete', () => {
  mockShared = true;
  open();
  expect(screen.getByText('Shared · read only')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Delete' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear default' }));
  expect(mockDefault).toHaveBeenCalledWith(null);
});
it('uses source blank calibration defaults and normalizes pump fields on save', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
  expect(screen.getByLabelText('Name')).toHaveValue('');
  expect(screen.getByLabelText('Units per mL')).toHaveValue('100');
  expect(screen.getByLabelText('Capacity (mL)')).toHaveValue('1');
  expect(screen.getByLabelText('Capacity (units)')).toHaveValue('100');
  expect(screen.getByLabelText('Smallest mark')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Synthetic pump' },
  });
  fireEvent.click(screen.getByLabelText('Device type'));
  fireEvent.click(
    await screen.findByRole('option', {
      name: 'Nasal pump (fixed spray volume)',
    })
  );
  expect(screen.queryByLabelText('Units per mL')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Graduation scale')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Bottle fill (mL)'), {
    target: { value: '10' },
  });
  fireEvent.change(screen.getByLabelText('Spray volume (mL per pump)'), {
    target: { value: '0.1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockSave).toHaveBeenCalledWith(
    {
      id: undefined,
      body: {
        name: 'Synthetic pump',
        device_type: 'pump',
        graduation_type: 'ml',
        units_per_ml: 100,
        capacity_ml: '10',
        capacity_units: 100,
        increment: '0.1',
      },
    },
    expect.anything()
  );
});
it('discards incompatible pump calibration on switching to a pen', async () => {
  mockDeviceType = 'pump';
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Spray volume (mL per pump)'), {
    target: { value: '0.123' },
  });
  fireEvent.click(screen.getByLabelText('Device type'));
  fireEvent.click(
    await screen.findByRole('option', { name: 'Pen (dial a dose)' })
  );
  expect(screen.getByLabelText('Smallest mark')).toHaveValue('1');
  expect(screen.getByLabelText('Capacity (units)')).toHaveValue('100');
  expect(
    within(screen.getByLabelText('Graduation scale')).getByText('Units')
  ).toBeInTheDocument();
});

it('sets a shared device as the per-owner default', () => {
  mockShared = true;
  mockDefaultId = null;
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Set default' }));
  expect(mockDefault).toHaveBeenCalledWith('used');
});
it('preserves injectable calibration when switching a syringe to a pen', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Units per mL'), {
    target: { value: '40' },
  });
  fireEvent.click(screen.getByLabelText('Device type'));
  fireEvent.click(
    await screen.findByRole('option', { name: 'Pen (dial a dose)' })
  );
  expect(screen.getByLabelText('Units per mL')).toHaveValue('40');
  expect(screen.getByLabelText('Smallest mark')).toHaveValue('0.5');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        device_type: 'pen',
        units_per_ml: 40,
        increment: '0.5',
      }),
    }),
    expect.anything()
  );
});
