import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationStackDialog from '@/pages/Medications/MedicationStackDialog';
import { useSaveStackMutation } from '@/hooks/Medications/useMedicationStacks';
import { useMedications } from '@/hooks/useMedications';

jest.mock('@/hooks/Medications/useMedicationStacks', () => ({
  useSaveStackMutation: jest.fn(),
}));
jest.mock('@/hooks/useMedications', () => ({ useMedications: jest.fn() }));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const meds = [
  { id: id(1), name: 'Sertraline', display_name: null, is_supplement: false },
  { id: id(2), name: 'Omega 3', display_name: 'Fish oil', is_supplement: true },
];

const setup = (
  props: Partial<Parameters<typeof MedicationStackDialog>[0]> = {}
) => {
  const mutate = jest.fn();
  jest.mocked(useSaveStackMutation).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSaveStackMutation>);
  jest.mocked(useMedications).mockReturnValue({
    data: meds,
    isLoading: false,
  } as unknown as ReturnType<typeof useMedications>);
  const onClose = jest.fn();
  render(<MedicationStackDialog onClose={onClose} {...props} />);
  return { mutate, onClose };
};

it('groups medications and supplements and saves the chosen order', () => {
  const { mutate } = setup();
  expect(screen.getByText('Medications')).toBeInTheDocument();
  expect(screen.getByText('Supplements')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: ' Morning ' },
  });
  fireEvent.click(screen.getByLabelText('Fish oil'));
  fireEvent.click(screen.getByLabelText('Sertraline'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate).toHaveBeenCalledWith(
    {
      id: undefined,
      body: { name: 'Morning', notes: null, medication_ids: [id(2), id(1)] },
    },
    expect.any(Object)
  );
});

it('asks for a name and at least one item before saving', () => {
  const { mutate } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give the stack a name');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Choose at least one medication or supplement'
  );
  expect(mutate).not.toHaveBeenCalled();
});

it('edits an existing stack, keeping a member that is no longer active', () => {
  const { mutate } = setup({
    stack: {
      id: id(100),
      name: 'Evening',
      notes: null,
      created_at: '2026-11-19T00:00:00.000Z',
      members: [
        {
          medication_id: id(1),
          name: 'Sertraline',
          is_supplement: false,
          is_active: true,
        },
        {
          medication_id: id(9),
          name: 'Old thing',
          is_supplement: false,
          is_active: false,
        },
      ],
    },
  });
  expect(screen.getByText('No longer active')).toBeInTheDocument();
  expect(screen.getByLabelText('Old thing')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate.mock.calls[0]![0]).toEqual({
    id: id(100),
    body: { name: 'Evening', notes: null, medication_ids: [id(1), id(9)] },
  });
});
