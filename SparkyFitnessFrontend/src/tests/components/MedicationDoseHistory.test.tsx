import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationEntry } from '@/types/medications';
import MedicationDoseHistory from '@/pages/Reports/MedicationDoseHistory';

let mockEntries: {
  data?: Partial<MedicationEntry>[];
  isLoading: boolean;
  isError: boolean;
} = { isLoading: false, isError: false };
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: () => mockEntries,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'UTC',
    formatDate: (value: string) => value,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        fallback
      ),
  }),
}));
jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));

const entry = (over: Partial<MedicationEntry> = {}) => ({
  medication_id: 'm1',
  status: 'taken' as const,
  entry_date: '2026-11-16',
  dose_amount_snapshot: 1,
  dose_unit_snapshot: 'mg',
  med_name_snapshot: 'Retatrutide',
  ...over,
});

it('renders nothing while loading, on error, or with no doses', () => {
  for (const state of [
    { isLoading: true, isError: false },
    { isLoading: false, isError: true },
    { isLoading: false, isError: false, data: [] },
    { isLoading: false, isError: false, data: [entry({ status: 'skipped' })] },
  ]) {
    mockEntries = state;
    const { container, unmount } = render(<MedicationDoseHistory />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
});

it('draws one cell per day since the first dose and reports a clicked day', () => {
  mockEntries = {
    isLoading: false,
    isError: false,
    data: [
      entry(),
      entry({ status: 'prn_taken' }),
      entry({ entry_date: '2026-11-18' }),
    ],
  };
  render(<MedicationDoseHistory />);
  expect(screen.getByText('Since 2026-11-16')).toBeInTheDocument();
  const monday = screen.getByRole('button', { name: '2026-11-16: 2 doses' });
  expect(
    screen.getByRole('button', { name: '2026-11-17: 0 doses' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '2026-11-18: 1 doses' })
  ).toHaveClass('ring-primary');
  fireEvent.click(monday);
  expect(
    screen.getByText('2026-11-16: 2 doses', { selector: 'p' })
  ).toBeInTheDocument();
});

it('totals mass doses per compound and leaves other units out with a note', () => {
  mockEntries = {
    isLoading: false,
    isError: false,
    data: [
      entry({ dose_amount_snapshot: 1.5 }),
      entry({
        dose_amount_snapshot: 2500,
        dose_unit_snapshot: 'mcg',
        entry_date: '2026-11-17',
      }),
      entry({
        medication_id: 'm2',
        med_name_snapshot: 'Sertraline',
        dose_amount_snapshot: 2,
        dose_unit_snapshot: 'tablet',
      }),
    ],
  };
  render(<MedicationDoseHistory />);
  const table = screen.getByRole('table');
  const row = within(table).getByRole('row', { name: /Retatrutide/ });
  expect(row).toHaveTextContent('2');
  expect(row).toHaveTextContent('4.00 mg');
  expect(within(table).queryByText(/Sertraline/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/Counts only doses recorded in mass units/)
  ).toBeInTheDocument();
});
