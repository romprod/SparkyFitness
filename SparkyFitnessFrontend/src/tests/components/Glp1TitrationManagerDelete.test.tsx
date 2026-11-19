import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1TitrationManager from '@/pages/Medications/Glp1TitrationManager';
import type { Medication, TitrationStep } from '@/types/medications';

const mockDelete = jest.fn();
const mockStep = {
  id: 'step',
  medication_id: 'med',
  dose_mg: 0.5,
  dose_unit: 'mg',
  start_date: '2026-11-10',
  planned_weeks: 4,
  status: 'active',
  is_taper: false,
} as unknown as TitrationStep;
jest.mock('@/hooks/useMedications', () => ({
  useMedicationTitration: () => ({ data: [mockStep] }),
  useAddTitrationStepMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateTitrationStepMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useDeleteTitrationStepMutation: () => ({
    mutate: mockDelete,
    isPending: false,
  }),
}));

const med = { id: 'med', name: 'Example' } as Medication;

beforeEach(() => mockDelete.mockClear());

it('asks before deleting a titration step and only deletes once confirmed', () => {
  render(<Glp1TitrationManager med={med} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete titration step' })
  );
  expect(mockDelete).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {
    name: 'Delete this titration step?',
  });
  expect(dialog).toHaveTextContent('Doses already logged are not affected.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith('step');
});

it('keeps the titration step when the confirmation is cancelled', () => {
  render(<Glp1TitrationManager med={med} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete titration step' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
