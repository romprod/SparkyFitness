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
  expect(screen.getByText('Preparation calculator')).toBeInTheDocument();
  expect(screen.getByLabelText('Kind')).toHaveTextContent('Vial');
  expect(screen.getByLabelText('Dose Strength (mg)')).toHaveValue(0.5);
  fireEvent.change(screen.getByLabelText('Prepared date'), {
    target: { value: '2026-11-15' },
  });
  fireEvent.change(screen.getByLabelText('Vial content'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Volume (mL)'), {
    target: { value: '3' },
  });
  expect(
    screen.getByText('4 mg/mL · 0.125 mL per entered dose')
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'vial',
      dose_mg: 0.5,
      preparation: expect.objectContaining({
        mass_value: 12,
        final_volume_ml: 3,
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
