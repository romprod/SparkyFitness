import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import type {
  MedicationInventoryDashboardResponse,
  MedicationInventorySupply,
} from '@workspace/shared';
import MedicationSupplyTile from '@/pages/Medications/MedicationSupplyTile';
import Medications from '@/pages/Medications/Medications';
import {
  forecastCoverage,
  inventoryForecastFixture,
} from '@/tests/fixtures/medicationInventoryForecast';
import {
  courseIds,
  courseMedication,
} from '@/tests/fixtures/medicationCourses';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
const mockFormatDate = jest.fn((day: string) => `UK:${day}`);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: mockFormatDate,
  }),
}));
let mockReady = true;
let mockCurrent = true;
let mockScopeKey = 'actor:owner:1';
let mockData: MedicationInventoryDashboardResponse | undefined;
const mockQuery = {
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
};
const mockDashboardRead = jest.fn();
jest.mock('@/hooks/Medications/useMedicationStockDashboard', () => ({
  useMedicationStockDashboard: () => {
    mockDashboardRead();
    return {
      scope: {
        ready: mockReady,
        key: mockScopeKey,
        isCurrent: () => mockCurrent,
      },
      query: mockQuery,
      data: mockData,
    };
  },
}));
// Isolate the page's existing date/subtype/tab behaviour from unrelated domain queries.
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationPurchaseScope: () => ({ ready: false, ownerId: '' }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedications: () => ({ data: [courseMedication], isLoading: false }),
  useMedicationEntries: () => ({ data: [], isLoading: false }),
  useDeleteMedicationMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: [], isLoading: false }),
}));
jest.mock('@/components/DayNavigator', () => () => null);
jest.mock('@/pages/Medications/TodayMedications', () => ({
  __esModule: true,
  default: ({
    selectedDate,
    subtype,
  }: {
    selectedDate: string;
    subtype: string;
  }) => (
    <p>
      Daily log {selectedDate} {subtype}
    </p>
  ),
}));
jest.mock('@/pages/Medications/PeptideStock', () => () => <p>Stock tools</p>);
jest.mock('@/pages/Medications/MedicationCosts', () => () => null);
jest.mock('@/pages/Medications/AddMedicationDialog', () => ({
  __esModule: true,
  default: () => null,
  MedTypeIcon: () => null,
}));
jest.mock('@/pages/Medications/Glp1Coach', () => () => null);
jest.mock('@/pages/Medications/Glp1InventoryManager', () => () => null);
jest.mock('@/pages/Medications/Glp1LogInjection', () => () => null);
jest.mock('@/pages/Medications/Glp1RecentInjections', () => () => null);
jest.mock('@/pages/Medications/ScheduleManager', () => () => null);
jest.mock('@/pages/Symptoms/SymptomsHub', () => () => null);

const dashboard = (
  supply: MedicationInventorySupply = {
    state: 'forecast',
    medication_id: courseIds.med,
  }
): MedicationInventoryDashboardResponse => ({
  forecast: inventoryForecastFixture(),
  supply,
  preparation_queue: [],
});
const renderTile = () =>
  render(
    <MemoryRouter>
      <MedicationSupplyTile />
    </MemoryRouter>
  );
const unknownCoverage = () =>
  forecastCoverage({
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
  });
beforeEach(() => {
  localStorage.clear();
  mockReady = true;
  mockCurrent = true;
  mockScopeKey = 'actor:owner:1';
  mockData = dashboard();
  Object.assign(mockQuery, {
    isLoading: false,
    isFetching: false,
    isError: false,
  });
  mockQuery.refetch.mockReset();
  mockFormatDate.mockClear();
  mockDashboardRead.mockClear();
});

it.each(['unresolved', 'stale'] as const)(
  'hides cached medication facts while identity is %s',
  (state) => {
    if (state === 'unresolved') mockReady = false;
    else mockCurrent = false;
    renderTile();
    expect(screen.queryByText('Supply')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Example prepared medication')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  }
);
it('shows neutral loading without claiming empty demand or coverage', () => {
  mockData = undefined;
  mockQuery.isLoading = true;
  renderTile();
  expect(screen.getByRole('status')).toHaveTextContent('Loading supply…');
  expect(
    screen.queryByText('No injectable or nasal doses in the forecast window')
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('keeps a network failure unavailable and nonlinked even if old snapshot data is cached', () => {
  mockQuery.isError = true;
  renderTile();
  expect(screen.getByRole('status')).toHaveTextContent('Supply unavailable');
  expect(
    screen.queryByText('Example prepared medication')
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('renders explicit server no-demand as a plain card bounded by the server forecast window', () => {
  mockData = dashboard({ state: 'no_demand', medication_id: null });
  mockData.forecast.medications = [];
  renderTile();
  expect(
    screen.getByText('No injectable or nasal doses in the forecast window')
  ).toBeInTheDocument();
  expect(screen.getByText('365-day forecast window')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('keeps explicit unavailability with no chosen item distinct from no demand', () => {
  mockData = dashboard({ state: 'unavailable', medication_id: null });
  renderTile();
  expect(screen.getByRole('status')).toHaveTextContent('Supply unavailable');
  expect(
    screen.queryByText('No injectable or nasal doses in the forecast window')
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('keeps an authoritative chosen unknown item named and linked to stock', () => {
  mockData = dashboard({ state: 'unavailable', medication_id: courseIds.med });
  Object.assign(mockData.forecast.medications[0]!, unknownCoverage());
  renderTile();
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', '/medications?tab=stock');
  expect(link).toHaveTextContent('Example prepared medication');
  expect(link).toHaveTextContent('Coverage unknown');
  expect(mockFormatDate).not.toHaveBeenCalled();
});
it('uses exactly the server-selected row rather than the first row or a client urgency sort', () => {
  mockData = dashboard({
    state: 'unavailable',
    medication_id: courseIds.revision2,
  });
  const first = mockData.forecast.medications[0]!;
  Object.assign(
    first,
    forecastCoverage({
      status: 'reorder_now',
      basis: 'depleted',
      coverage_through: '2026-11-17',
      depletion_date: '2026-11-17',
      reorder_by: '2026-11-16',
    })
  );
  mockData.forecast.medications.push({
    ...first,
    ...unknownCoverage(),
    medication_id: courseIds.revision2,
    name: 'Authoritatively selected item',
  });
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Authoritatively selected item'
  );
  expect(screen.getByRole('link')).toHaveTextContent('Coverage unknown');
  expect(screen.queryByText('Reorder now')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Example prepared medication')
  ).not.toBeInTheDocument();
});
it('defensively refuses an unmatched chosen ID instead of falling back to another row', () => {
  mockData = dashboard({
    state: 'forecast',
    medication_id: courseIds.revision2,
  });
  renderTile();
  expect(screen.getByRole('status')).toHaveTextContent('Supply unavailable');
  expect(
    screen.queryByText('Example prepared medication')
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('shows authoritative overall reorder urgency', () => {
  Object.assign(
    mockData!.forecast.medications[0]!,
    forecastCoverage({
      status: 'reorder_now',
      basis: 'depleted',
      coverage_through: '2026-11-17',
      depletion_date: '2026-11-17',
      reorder_by: '2026-11-16',
    })
  );
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent('Reorder now');
});
it('formats the authoritative reorder date with preferences without recalculating status from browser time', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2099-01-01T00:00:00Z'));
  try {
    Object.assign(
      mockData!.forecast.medications[0]!,
      forecastCoverage({
        status: 'ok',
        basis: 'depleted',
        coverage_through: '2026-12-10',
        depletion_date: '2026-12-10',
        reorder_by: '2026-11-26',
      })
    );
    renderTile();
    expect(screen.getByRole('link')).toHaveTextContent(
      'Reorder by UK:2026-11-26'
    );
    expect(screen.queryByText('Reorder now')).not.toBeInTheDocument();
    expect(mockFormatDate).toHaveBeenCalledWith('2026-11-26');
  } finally {
    jest.useRealTimers();
  }
});
it.each([
  ['course_end', 'Covers committed doses through UK:2026-12-01'],
  ['horizon', 'Covers planned doses through UK:2026-12-01 (forecast window)'],
  ['slot_cap', 'Covers planned doses through UK:2026-12-01 (forecast limit)'],
] as const)(
  'keeps the authoritative covered bound qualified for %s',
  (basis, text) => {
    mockData!.forecast.medications[0]!.basis = basis;
    renderTile();
    expect(screen.getByRole('link')).toHaveTextContent(text);
  }
);
it('does not promote prepared-only urgency into overall purchasing urgency', () => {
  mockData!.forecast.medications[0]!.prepared_only = forecastCoverage({
    status: 'reorder_now',
    basis: 'depleted',
    coverage_through: '2026-11-17',
    depletion_date: '2026-11-17',
    reorder_by: '2026-11-16',
  });
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Covers committed doses through UK:2026-12-01'
  );
  expect(screen.queryByText('Reorder now')).not.toBeInTheDocument();
});
it('hides a late older-scope snapshot until the new authoritative scope supplies its own view', () => {
  const view = renderTile();
  mockScopeKey = 'actor:other-owner:1';
  mockCurrent = false;
  // A defensive scope guard still hides stale hook payloads.
  view.rerender(
    <MemoryRouter>
      <MedicationSupplyTile />
    </MemoryRouter>
  );
  expect(
    screen.queryByText('Example prepared medication')
  ).not.toBeInTheDocument();
  mockCurrent = true;
  mockData = dashboard();
  mockData.forecast.medications[0]!.name = 'New owner selected item';
  view.rerender(
    <MemoryRouter>
      <MedicationSupplyTile />
    </MemoryRouter>
  );
  expect(screen.getByRole('link')).toHaveTextContent('New owner selected item');
  expect(
    screen.queryByText('Example prepared medication')
  ).not.toBeInTheDocument();
});

it('places Supply above the existing Log while retaining the date and subtype filter behaviour', () => {
  render(
    <MemoryRouter initialEntries={['/medications?tab=today&date=2020-01-01']}>
      <Medications />
    </MemoryRouter>
  );
  const supply = screen.getByText('Supply');
  const log = screen.getByText('Daily log 2020-01-01 all');
  expect(
    supply.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Supplements' }));
  expect(
    screen.getByText('Daily log 2020-01-01 supplements')
  ).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Example prepared medication'
  );
  fireEvent.click(screen.getByRole('link'));
  expect(screen.getByText('Stock tools')).toBeInTheDocument();
  expect(screen.queryByText('Supply')).not.toBeInTheDocument();
});
it.each(['stock', 'cabinet', 'symptoms', 'costs'])(
  'does not mount or fetch Supply on the %s tab',
  (tab) => {
    render(
      <MemoryRouter initialEntries={[`/medications?tab=${tab}`]}>
        <Medications />
      </MemoryRouter>
    );
    expect(screen.queryByText('Supply')).not.toBeInTheDocument();
    expect(mockDashboardRead).not.toHaveBeenCalled();
  }
);
