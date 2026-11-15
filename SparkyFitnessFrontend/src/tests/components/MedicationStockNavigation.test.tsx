import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import Medications from '@/pages/Medications/Medications';
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationPurchaseScope: () => ({ ready: false, ownerId: '' }),
}));
jest.mock('@/components/DayNavigator', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedications: () => ({
    data: [
      {
        id: 'peptide',
        name: 'Example peptide',
        type_id: 'injection',
        is_glp1: false,
        is_active: true,
        schedules: [],
      },
    ],
    isLoading: false,
  }),
  useMedicationEntries: () => ({ data: [], isLoading: false }),
  useDeleteMedicationMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: [], isLoading: false }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
jest.mock('@/pages/Medications/PeptideStock', () => ({
  __esModule: true,
  default: () => <p>Peptide stock tools</p>,
}));
jest.mock('@/pages/Medications/AddMedicationDialog', () => ({
  __esModule: true,
  default: () => null,
  MedTypeIcon: () => null,
}));
jest.mock('@/pages/Medications/TodayMedications', () => ({
  __esModule: true,
  default: () => <p>Daily log</p>,
}));
jest.mock('@/pages/Medications/Glp1Coach', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/Glp1InventoryManager', () => ({
  __esModule: true,
  default: () => <p>Generic inventory</p>,
}));
jest.mock('@/pages/Medications/Glp1LogInjection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/Glp1RecentInjections', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/ScheduleManager', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Symptoms/SymptomsHub', () => ({
  __esModule: true,
  default: () => null,
}));
it('offers stock directly from the main medication tabs', () => {
  render(
    <MemoryRouter>
      <Medications />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preparation & stock' }));
  expect(screen.getByText('Peptide stock tools')).toBeInTheDocument();
});
it('opens the stock tab from a bookmarked URL', () => {
  render(
    <MemoryRouter initialEntries={['/medications?tab=stock']}>
      <Medications />
    </MemoryRouter>
  );
  expect(screen.getByText('Peptide stock tools')).toBeInTheDocument();
  expect(screen.queryByText('Daily log')).not.toBeInTheDocument();
});
