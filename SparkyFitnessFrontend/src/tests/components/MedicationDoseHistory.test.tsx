import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationEntry } from '@/types/medications';
import MedicationDoseHistory from '@/pages/Reports/MedicationDoseHistory';

let mockEntries: {
  data?: Partial<MedicationEntry>[];
  isLoading: boolean;
  isError: boolean;
} = { isLoading: false, isError: false };
let mockBlends: unknown[] | undefined;
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({ data: mockBlends }),
}));
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
beforeEach(() => {
  mockBlends = undefined;
});
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

const klow = {
  blend_medication_id: 'blend',
  name: 'KLOW',
  components: [
    ['ghk', 'GHK-Cu', '50'],
    ['bpc', 'BPC-157', '10'],
    ['tb', 'TB-500', '10'],
    ['kpv', 'KPV', '10'],
  ].map(([id, name, mass_mg], sort_index) => ({
    component_medication_id: id,
    name,
    mass_mg,
    source: 'label',
    sort_index,
  })),
};

it('counts a blend under its components and adds a derived via-blends column', () => {
  mockBlends = [klow];
  mockEntries = {
    isLoading: false,
    isError: false,
    data: [
      entry({
        medication_id: 'blend',
        med_name_snapshot: 'KLOW',
        dose_amount_snapshot: 800,
        dose_unit_snapshot: 'mcg',
      }),
      entry({
        medication_id: 'bpc',
        med_name_snapshot: 'BPC-157',
        dose_amount_snapshot: 250,
        dose_unit_snapshot: 'mcg',
      }),
    ],
  };
  render(<MedicationDoseHistory />);
  const table = screen.getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual(['Compound', 'Doses', 'Via blends', 'Total']);
  expect(within(table).queryByText(/KLOW/)).not.toBeInTheDocument();
  const bpc = within(table).getByRole('row', { name: /BPC-157/ });
  expect(bpc).toHaveTextContent('0.10 mg');
  expect(bpc).toHaveTextContent('(derived, label)');
  expect(bpc).toHaveTextContent('0.35 mg');
  const ghk = within(table).getByRole('row', { name: /GHK-Cu/ });
  expect(ghk).toHaveTextContent('0.50 mg');
  expect(
    screen.getByText(/“Via blends” is worked out from/)
  ).toBeInTheDocument();
});

it('shows no via-blends column when no blend delivered anything', () => {
  mockBlends = [klow];
  mockEntries = {
    isLoading: false,
    isError: false,
    data: [entry()],
  };
  render(<MedicationDoseHistory />);
  expect(screen.queryByText('Via blends')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/“Via blends” is worked out from/)
  ).not.toBeInTheDocument();
});
