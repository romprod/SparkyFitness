import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import PeptideStock from '@/pages/Medications/PeptideStock';
import type { Medication } from '@/types/medications';
const mockSave = jest.fn();
const mockPens = jest.fn((_id: string) => ({ data: [] }));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: (id: string) => mockPens(id),
  useCreatePenMutation: () => ({ mutate: mockSave, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
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
    data: {
      syringes: [
        {
          id: 'device',
          name: 'Synthetic U100',
          graduation_type: 'units',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '1',
        },
      ],
      default_syringe_id: null,
    },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
jest.mock('@/pages/Medications/AddMedicationDialog', () => ({
  __esModule: true,
  default: ({ defaultTypeId }: { defaultTypeId: string }) => (
    <button>{`Add ${defaultTypeId}`}</button>
  ),
}));
jest.mock('@/pages/Medications/Glp1LogInjection', () => ({
  __esModule: true,
  default: ({ med }: { med: Medication }) => (
    <p>{`Log injection: ${med.id}`}</p>
  ),
}));
jest.mock('@/pages/Medications/Glp1RecentInjections', () => ({
  __esModule: true,
  default: () => <p>Injection history</p>,
}));
const peptide = {
  id: 'peptide',
  name: 'Example peptide',
  type_id: 'injection',
  is_glp1: false,
  dose_amount: 500,
  dose_unit: 'mcg',
  is_active: true,
} as Medication;
beforeEach(() => {
  mockSave.mockClear();
  mockPens.mockClear();
});
it('shows preparation tools without injection logging or history for a non-GLP-1 peptide', () => {
  render(
    <MemoryRouter
      initialEntries={['/medications?tab=stock&medication=peptide']}
    >
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.getByLabelText('Peptide / medication')).toHaveTextContent(
    'Example peptide'
  );
  expect(screen.queryByText('Log injection: peptide')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection history')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare a vial' }));
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  fireEvent.change(screen.getByLabelText('Prepared date'), {
    target: { value: '2026-11-15' },
  });
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
  expect(screen.getByText('4 mg/mL')).toBeInTheDocument();
  expect(screen.getByText('500 mcg · 0.125 mL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'vial',
      dose_mg: 0.5,
      preparation: expect.objectContaining({
        mass_value: '12',
        final_volume_ml: '3',
      }),
    }),
    expect.anything()
  );
});
it('shows a clear add-injectable entry point without existing peptides', () => {
  render(
    <MemoryRouter>
      <PeptideStock meds={[]} />
    </MemoryRouter>
  );
  expect(
    screen.getByRole('button', { name: 'Add injection' })
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Existing injectable medications appear here automatically/
    )
  ).toBeInTheDocument();
});
it('honours a direct link to a different injectable and keeps its stock queries scoped', () => {
  const other = { ...peptide, id: 'second', name: 'Second peptide' };
  render(
    <MemoryRouter initialEntries={['/medications?tab=stock&medication=second']}>
      <PeptideStock meds={[peptide, other]} />
    </MemoryRouter>
  );
  expect(screen.getByLabelText('Peptide / medication')).toHaveTextContent(
    'Second peptide'
  );
  expect(mockPens).toHaveBeenCalledWith('second');
});
