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
