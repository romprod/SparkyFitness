import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import type {
  MedicationInventoryPlannedDashboardResponse,
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

import {
  projectedCoverageFixture,
  projectionFixture,
  cycleAssumptionFixture,
} from '@/tests/fixtures/medicationInventoryProjection';

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
let mockData: MedicationInventoryPlannedDashboardResponse | undefined;
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
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptionScope: () => ({
    ready: false,
    isCurrent: () => false,
  }),
}));
jest.mock('@/pages/Medications/MedicationSmoothWeek', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/MedicationScheduleMove', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/MedicationLevelsOverlay', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/MedicationNextDoses', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/MedicationLogCalendar', () => ({
  __esModule: true,
  default: () => null,
}));
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
): MedicationInventoryPlannedDashboardResponse => ({
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

it('uses for-next-cycle wording only for a server-proven provisional first failure', () => {
  mockData!.forecast.medications[0] = {
    ...mockData!.forecast.medications[0]!,
    ...projectedCoverageFixture(),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Reorder by UK:2027-01-10 for next cycle'
  );
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  expect(screen.getByText(/planned restarts are overdue/)).toBeInTheDocument();
});
it('does not call a committed shortage after provisional consumption next-cycle demand', () => {
  mockData!.forecast.medications[0] = {
    ...mockData!.forecast.medications[0]!,
    ...projectedCoverageFixture({
      projection: projectionFixture({
        claim_basis: 'projected_coverage',
        first_unserved_kind: 'committed',
      }),
    }),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Reorder by UK:2027-01-10'
  );
  expect(screen.getByRole('link')).not.toHaveTextContent('for next cycle');
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
});
it('qualifies covered projected demand without claiming committed-only or unlimited coverage', () => {
  mockData!.forecast.medications[0] = {
    ...mockData!.forecast.medications[0]!,
    coverage_through: '2027-01-24',
    projection: projectionFixture({
      claim_basis: 'projected_coverage',
      first_unserved_day: null,
      first_unserved_kind: null,
    }),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Covers planned doses through UK:2027-01-24'
  );
  expect(screen.getByRole('link')).not.toHaveTextContent('Covers committed');
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
});
it('labels urgent provisional need as next-cycle reorder without calculating urgency from browser dates', () => {
  mockData!.forecast.medications[0] = {
    ...mockData!.forecast.medications[0]!,
    ...projectedCoverageFixture({
      status: 'reorder_now',
      coverage_through: '2026-11-16',
      depletion_date: '2026-11-16',
      reorder_by: '2026-11-16',
      days_left: 0,
      served_slots: 0,
      expected_slots: 1,
      projection: projectionFixture({
        provisional_slots: 1,
        projection_starts_on: '2026-11-29',
        first_unserved_day: '2026-11-29',
      }),
    }),
    cycle_assumptions: [
      cycleAssumptionFixture({
        anchor_date: '2026-11-15',
        committed_end_date: '2026-11-21',
        next_restart_date: '2026-11-29',
        projection_starts_on: '2026-11-29',
        overdue: false,
      }),
    ],
  };
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent(
    'Reorder now for next cycle'
  );
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/planned restarts are overdue/)
  ).not.toBeInTheDocument();
});
it('keeps a server-unknown named forecast unknown even when a restart is overdue', () => {
  mockData!.supply = { state: 'unavailable', medication_id: courseIds.med };
  mockData!.forecast.medications[0] = {
    ...mockData!.forecast.medications[0]!,
    ...unknownCoverage(),
    limitations: ['unknown_projection_date'],
    projection: projectionFixture({
      claim_basis: 'unknown',
      projection_starts_on: null,
      first_unserved_day: null,
      first_unserved_kind: null,
    }),
    cycle_assumptions: [cycleAssumptionFixture({ projection_starts_on: null })],
  };
  renderTile();
  expect(screen.getByRole('link')).toHaveTextContent('Coverage unknown');
  expect(screen.getByRole('link')).not.toHaveTextContent('Reorder now');
  expect(screen.getByRole('link')).not.toHaveTextContent('for next cycle');
  expect(screen.getByText(/restarting remains manual/)).toBeInTheDocument();
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
});

describe('whole days the stock reaches', () => {
  // The fixture's forecast day is 2026-11-16.
  it('counts to the last covered dose when the stock covers the plan', () => {
    renderTile();
    expect(screen.getByRole('link')).toHaveTextContent('15 days');
  });
  it('counts to the day the stock runs short, for ok and reorder-now alike', () => {
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
    const { unmount } = renderTile();
    expect(screen.getByRole('link')).toHaveTextContent('24 days');
    unmount();
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
    expect(screen.getByRole('link')).toHaveTextContent(/(^|\D)1 days?/);
  });
  it('never shows a negative figure when the stock ran short before today', () => {
    Object.assign(
      mockData!.forecast.medications[0]!,
      forecastCoverage({
        status: 'reorder_now',
        basis: 'depleted',
        coverage_through: '2026-11-10',
        depletion_date: '2026-11-10',
        reorder_by: '2026-11-16',
      })
    );
    renderTile();
    expect(screen.getByRole('link')).toHaveTextContent(/(^|\D)0 days?/);
    expect(screen.getByRole('link')).not.toHaveTextContent('-');
  });
  it('shows no figure when coverage is unknown', () => {
    Object.assign(mockData!.forecast.medications[0]!, unknownCoverage());
    renderTile();
    expect(screen.getByRole('link')).toHaveTextContent('Coverage unknown');
    expect(screen.getByRole('link')).not.toHaveTextContent(/\d+ days?/);
  });
});
