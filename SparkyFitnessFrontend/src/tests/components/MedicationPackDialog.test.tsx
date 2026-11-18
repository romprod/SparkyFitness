import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationPackView } from '@workspace/shared';
import MedicationPackDialog from '@/pages/Medications/MedicationPackDialog';
import { defaultPackUnit } from '@/pages/Medications/packUnit';
import type { Medication } from '@/types/medications';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/hooks/Medications/useMedicationPacks', () => ({
  useCreatePackMutation: () => ({ mutate: mockCreate, isPending: false }),
  useUpdatePackMutation: () => ({ mutate: mockUpdate, isPending: false }),
}));
const tablet = {
  id: 'med-1',
  name: 'Synthetic tablets',
  type_id: 'tablet',
  dose_amount: 2,
  dose_unit: 'tablet',
  is_active: true,
} as Medication;
beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
});

it('starts a new pack in the medication dose unit and saves exactly what was entered', () => {
  const close = jest.fn();
  render(
    <MedicationPackDialog open onOpenChange={close} medications={[tablet]} />
  );
  expect(screen.getByLabelText('Unit')).toHaveValue('tablets');
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Units in the pack'), {
    target: { value: '60' },
  });
  fireEvent.change(screen.getByLabelText('Warn when this few are left'), {
    target: { value: '10' },
  });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0]![0]).toEqual({
    medicationId: 'med-1',
    body: {
      label: null,
      unit_label: 'tablets',
      units_total: 60,
      expiry_date: null,
      lot_number: null,
      storage_location: null,
      reorder_threshold_units: 10,
      notes: null,
      status: 'sealed',
    },
  });
});

it('refuses a zero or non-numeric pack size', () => {
  render(
    <MedicationPackDialog
      open
      onOpenChange={jest.fn()}
      medications={[tablet]}
    />
  );
  for (const value of ['0', 'abc', '-3']) {
    fireEvent.change(screen.getByLabelText('Units in the pack'), {
      target: { value },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  }
});

it('edits an existing pack in place without letting its medication change', () => {
  const existing: MedicationPackView = {
    id: 'pack-1',
    medication_id: 'med-1',
    medication_name: 'Synthetic tablets',
    label: 'Bottle 1',
    unit_label: 'tablets',
    status: 'in_use',
    units_total: '60.000',
    units_used: '12.000',
    units_remaining: '48.000',
    overdrawn: false,
    doses_left: '24',
    observed_days_left: null,
    planned_days_left: null,
    planned_empty_date: null,
    low: false,
    opened_at: '2026-11-01',
    expiry_date: null,
    expired: false,
    lot_number: null,
    storage_location: null,
    reorder_threshold_units: null,
    notes: null,
  };
  render(
    <MedicationPackDialog
      open
      onOpenChange={jest.fn()}
      medications={[tablet]}
      pack={existing}
    />
  );
  expect(screen.getByLabelText('Medication or supplement')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Already used'), {
    target: { value: '14' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0]![0]).toMatchObject({
    id: 'pack-1',
    body: { units_total: 60, units_used: 14, label: 'Bottle 1' },
  });
  expect(mockUpdate.mock.calls[0]![0].body).not.toHaveProperty('status');
});

it('derives a plural unit from the dose unit and ignores bracketed detail', () => {
  expect(defaultPackUnit(tablet)).toBe('tablets');
  expect(defaultPackUnit({ dose_unit: 'scoop (10 ml)' } as Medication)).toBe(
    'scoops'
  );
  expect(defaultPackUnit({ dose_unit: 'capsules' } as Medication)).toBe(
    'capsules'
  );
  expect(defaultPackUnit(undefined)).toBe('');
});
