import '@testing-library/jest-dom';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MedicationInventoryForecast, {
  MedicationContainerForecast,
} from '@/pages/Medications/MedicationInventoryForecast';
import {
  inventoryForecastFixture,
  forecastCoverage,
} from '@/tests/fixtures/medicationInventoryForecast';
import {
  projectionFixture,
  cycleAssumptionFixture,
  projectedCoverageFixture,
} from '@/tests/fixtures/medicationInventoryProjection';
let mockReady = true;
let mockSelf = true;
let mockError = false;
let mockData = inventoryForecastFixture();
const mockRefetch = jest.fn();
jest.mock('@/hooks/Medications/useMedicationInventoryForecast', () => ({
  useMedicationInventoryForecast: () => ({
    scope: {
      ready: mockReady,
      isCurrent: () => mockReady,
      actorId: 'self',
      ownerId: mockSelf ? 'self' : 'other',
    },
    data: mockData,
    query: { isLoading: false, isError: mockError, refetch: mockRefetch },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDate: (day: string) => `Date ${day}`,
    formatDateInUserTimezone: () => '16 Nov 2026, 12:00',
  }),
}));
beforeEach(() => {
  mockReady = true;
  mockSelf = true;
  mockError = false;
  mockData = inventoryForecastFixture();
  mockRefetch.mockClear();
});
const setup = () =>
  render(
    <MemoryRouter>
      <MedicationInventoryForecast />
    </MemoryRouter>
  );
it('separates named medications and prepared coverage from overall urgency, using current as-of rather than a diary date', () => {
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...forecastCoverage({
      status: 'unknown',
      basis: 'unknown',
      coverage_through: null,
      days_left: null,
      limitations: ['sealed_stock_excluded'],
    }),
    prepared_only: forecastCoverage({
      status: 'reorder_now',
      basis: 'depleted',
      depletion_date: '2026-11-20',
      reorder_by: '2026-11-16',
    }),
  };
  mockData.medications.push({
    ...mockData.medications[0]!,
    medication_id: '00000000-0000-4000-8000-000000000099',
    name: 'Second medication',
    ...forecastCoverage({
      status: 'reorder_now',
      basis: 'depleted',
      reorder_by: '2026-11-18',
    }),
  });
  setup();
  const first = within(
    screen.getByRole('region', { name: 'Example prepared medication' })
  );
  expect(first.getByText('Unknown')).toBeInTheDocument();
  expect(first.queryByText('Reorder window reached')).not.toBeInTheDocument();
  expect(first.queryByText(/Order by/)).not.toBeInTheDocument();
  expect(first.getByText(/Prepared coverage alone/)).toBeInTheDocument();
  expect(screen.getByText(/Current as of/)).toHaveTextContent(
    '16 Nov 2026, 12:00'
  );
  expect(
    within(screen.getByRole('region', { name: 'Second medication' })).getByText(
      'Reorder window reached'
    )
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Saved example device/)).toHaveLength(2);
  expect(
    screen.getByRole('link', { name: 'Reorder defaults' })
  ).toHaveAttribute('href', '/settings?section=medication-reorder-defaults');
});
it('shows honest unknown reasons and no fabricated dates', () => {
  const unknown = forecastCoverage({
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    days_left: null,
    limitations: [
      'missing_device',
      'unknown_dose',
      'unknown_bud',
      'unmodelled_legacy_demand',
    ],
  });
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...unknown,
    prepared_only: unknown,
  };
  setup();
  expect(
    screen.getAllByText('A saved compatible device is needed.')
  ).toHaveLength(2);
  expect(screen.queryByText(/Date 2026/)).not.toBeInTheDocument();
});
it('does not present cached results as a successful forecast when a refresh fails', () => {
  mockError = true;
  setup();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not load the stock forecast'
  );
  expect(
    screen.queryByRole('region', { name: 'Example prepared medication' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('hides the card without current proof, and hides owner settings for delegated reads', () => {
  mockReady = false;
  const view = setup();
  expect(screen.queryByText('Stock forecasts')).not.toBeInTheDocument();
  mockReady = true;
  mockSelf = false;
  view.rerender(
    <MemoryRouter>
      <MedicationInventoryForecast />
    </MemoryRouter>
  );
  expect(screen.getByText('Stock forecasts')).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Reorder defaults' })
  ).not.toBeInTheDocument();
});

it('preserves known zero container administrations and exact authored basis without implying reorder urgency', () => {
  render(
    <MedicationContainerForecast
      container={{
        container_id: '00000000-0000-4000-8000-000000000001',
        remaining_doses: 0,
        current_dose: {
          value: '0.1234567890123456789',
          unit: 'mg',
          device_id: '00000000-0000-4000-8000-000000000002',
        },
        coverage: forecastCoverage({
          status: 'reorder_now',
          basis: 'depleted',
          reorder_by: '2026-11-16',
          depletion_date: '2026-11-16',
        }),
      }}
    />
  );
  expect(
    screen.getByText(/Remaining measurable administrations/)
  ).toHaveTextContent(': 0');
  expect(screen.getByText(/Current planned amount/)).toHaveTextContent(
    '0.1234567890123456789 mg'
  );
  expect(screen.queryByText(/Order by/)).not.toBeInTheDocument();
});

it('distinguishes served-stock coverage from the first unmet next-cycle need and qualifies the claim', () => {
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...projectedCoverageFixture(),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  render(
    <MemoryRouter>
      <MedicationInventoryForecast />
    </MemoryRouter>
  );
  expect(screen.getByText('For next cycle')).toBeInTheDocument();
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  const overall = screen.getByText('Overall stock coverage').parentElement!;
  expect(
    within(overall).getByText(/Stock coverage ends/).parentElement
  ).toHaveTextContent('Date 2027-01-10');
  expect(
    within(overall).getByText(/First unserved planned administration/)
      .parentElement
  ).toHaveTextContent('Date 2027-01-24');
  expect(
    screen.getByText(/This planned restart date has passed/)
  ).toBeInTheDocument();
});
it('qualifies a committed shortage affected by earlier provisional consumption without saying for next cycle', () => {
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...projectedCoverageFixture({
      projection: projectionFixture({
        claim_basis: 'projected_coverage',
        first_unserved_kind: 'committed',
      }),
    }),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  setup();
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
});
it('labels bounded coverage containing provisional doses as planned, not committed-only coverage', () => {
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...forecastCoverage({
      coverage_through: '2027-01-24',
      projection: projectionFixture({
        claim_basis: 'projected_coverage',
        first_unserved_day: null,
        first_unserved_kind: null,
      }),
    }),
    cycle_assumptions: [cycleAssumptionFixture()],
  };
  setup();
  expect(screen.getByText('Planned demand covered')).toBeInTheDocument();
  expect(
    screen.queryByText('Committed demand covered')
  ).not.toBeInTheDocument();
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
});
it('keeps each named course restart date and saved zone separate from forecast-calendar demand dates', () => {
  mockData.timezone = 'UTC';
  mockData.medications[0]!.cycle_assumptions = [
    cycleAssumptionFixture(),
    cycleAssumptionFixture({
      course_id: '00000000-0000-4000-8000-000000000090',
      revision_id: '00000000-0000-4000-8000-000000000091',
      plan_name: 'Example cycle Beta',
      timezone: 'Pacific/Auckland',
      next_restart_date: '2026-12-05',
      projection_starts_on: '2026-12-06',
      overdue: false,
    }),
  ];
  setup();
  const alpha = within(screen.getByText('Example cycle Alpha').closest('li')!);
  const beta = within(screen.getByText('Example cycle Beta').closest('li')!);
  expect(alpha.getByText(/Planned restart date/)).toHaveTextContent(
    'Date 2026-11-15 (America/New_York)'
  );
  expect(beta.getByText(/Planned restart date/)).toHaveTextContent(
    'Date 2026-12-05 (Pacific/Auckland)'
  );
  expect(alpha.getByText(/First projected administration/)).toHaveTextContent(
    '(UTC)'
  );
  expect(beta.getByText(/First projected administration/)).toHaveTextContent(
    'Date 2026-12-06 (UTC)'
  );
  expect(beta.queryByText(/date has passed/)).not.toBeInTheDocument();
});
it('qualifies prepared and per-container projections without promoting either into purchase urgency', () => {
  mockData.medications[0]!.prepared_only = projectedCoverageFixture({
    status: 'reorder_now',
  });
  mockData.medications[0]!.cycle_assumptions = [cycleAssumptionFixture()];
  setup();
  expect(screen.queryByText('Reorder window reached')).not.toBeInTheDocument();
  expect(screen.queryByText(/Order by/)).not.toBeInTheDocument();
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
});
it('qualifies a container claim affected by hypothetical consumption but does not call its committed failure next-cycle demand', () => {
  render(
    <MedicationContainerForecast
      timezone="UTC"
      container={{
        container_id: '00000000-0000-4000-8000-000000000001',
        remaining_doses: 0,
        current_dose: null,
        coverage: projectedCoverageFixture({
          projection: projectionFixture({
            claim_basis: 'projected_coverage',
            first_unserved_kind: 'committed',
          }),
        }),
      }}
    />
  );
  expect(
    screen.getByText('Assumes planned manual restart(s).')
  ).toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
  expect(screen.queryByText(/Order by/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/Remaining measurable administrations/)
  ).toHaveTextContent(': 0');
});
it('keeps an attempted restart assumption visible without reassuring coverage when no projected slot is included', () => {
  const unknown = forecastCoverage({
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    days_left: null,
    limitations: ['no_forecast_slots'],
  });
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...unknown,
    prepared_only: unknown,
    cycle_assumptions: [cycleAssumptionFixture({ projection_starts_on: null })],
  };
  setup();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  expect(
    screen.getByText('First projected administration date is unavailable.')
  ).toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
  expect(screen.queryByText(/Order by/)).not.toBeInTheDocument();
});

it('explains an unknown cross-calendar untimed projection without showing precise stock coverage or need dates', () => {
  const unknown = forecastCoverage({
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
    limitations: ['unknown_projection_date'],
    projection: projectionFixture({
      claim_basis: 'unknown',
      projection_starts_on: null,
      first_unserved_day: null,
      first_unserved_kind: null,
    }),
  });
  mockData.medications[0] = {
    ...mockData.medications[0]!,
    ...unknown,
    prepared_only: unknown,
    cycle_assumptions: [cycleAssumptionFixture({ projection_starts_on: null })],
  };
  setup();
  expect(
    screen.getAllByText(/has no specified time and uses a different calendar/)
  ).toHaveLength(2);
  expect(
    screen.queryByText(/First unserved planned administration/)
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Stock coverage ends/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Order by/)).not.toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
  expect(
    screen.getAllByText('Assumes planned manual restart(s).')
  ).toHaveLength(2);
  expect(
    screen.getByText('First projected administration date is unavailable.')
  ).toBeInTheDocument();
  expect(screen.getByText('Example cycle Alpha')).toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});

it('does not qualify a committed first failure that occurs before any hypothetical consumption', () => {
  render(
    <MedicationContainerForecast
      container={{
        container_id: '00000000-0000-4000-8000-000000000001',
        remaining_doses: 0,
        current_dose: null,
        coverage: projectedCoverageFixture({
          status: 'reorder_now',
          coverage_through: '2026-11-16',
          depletion_date: '2026-11-16',
          reorder_by: '2026-11-16',
          days_left: 0,
          projection: projectionFixture({
            claim_basis: 'committed',
            first_unserved_kind: 'committed',
            first_unserved_day: '2026-11-20',
          }),
        }),
      }}
    />
  );
  expect(
    screen.queryByText('Assumes planned manual restart(s).')
  ).not.toBeInTheDocument();
  expect(screen.queryByText('For next cycle')).not.toBeInTheDocument();
});
