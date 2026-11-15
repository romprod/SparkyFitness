import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  simulateSerumCurve,
  resolveGlp1Profile,
  computeDraw,
  normalizeDeviceDose,
  calculatedDrawInputSchema,
  INJECTION_SITES,
} from '@workspace/shared';
import Medications from '@/pages/Medications/Medications';
const mockApiCall = jest.fn();
jest.mock('@/api/api', () => ({
  apiCall: (endpoint: string, options?: unknown) =>
    mockApiCall(endpoint, options),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: [], isLoading: false }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (date: string) => date,
    formatDateInUserTimezone: (date: Date) => date.toISOString(),
  }),
}));
jest.mock('@/components/DayNavigator', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Medications/AddMedicationDialog', () => ({
  __esModule: true,
  default: () => null,
  MedTypeIcon: () => null,
}));
jest.mock('@/pages/Medications/TodayMedications', () => ({
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
jest.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Container,
    AreaChart: ({ children }: { children?: React.ReactNode }) => (
      <svg>{children}</svg>
    ),
    Area: () => null,
    CartesianGrid: () => null,
    ReferenceLine: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});
const anchor = '2026-11-10T12:00:00.000Z';
const injections = [
  {
    id: 'dose',
    medication_id: 'med',
    injected_at: anchor,
    entry_date: '2026-11-10',
    dose_mg: 2,
    site: 'abdomen_left',
    notes: null,
    pen_id: null,
  },
];
const syringe = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Synthetic U100',
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
};
let mockGlp1 = true;
beforeEach(() => {
  localStorage.clear();
  mockGlp1 = true;
  mockApiCall.mockReset();
  mockApiCall.mockImplementation(
    async (
      endpoint: string,
      options?: { params?: Record<string, unknown>; body?: unknown }
    ) => {
      if (endpoint === '/v2/medications')
        return [
          {
            id: 'med',
            name: 'Retatrutide',
            display_name: 'Synthetic injectable',
            type_id: 'injection',
            is_glp1: mockGlp1,
            is_active: true,
            is_supplement: false,
            dose_amount: 0.5,
            dose_unit: 'mg',
            custom_fields: { glp1_drug: 'retatrutide' },
            schedules: [],
            nutrients: {},
          },
        ];
      if (endpoint.endsWith('/serum-curve')) {
        const profile = resolveGlp1Profile('retatrutide')!;
        return {
          drugId: profile.id,
          drugName: profile.displayName,
          anchorDate: anchor,
          doseDays: [0],
          curve: simulateSerumCurve(
            [{ day: 0, doseMg: 2 }],
            profile,
            0,
            12,
            Number(options?.params?.['stepDays'] ?? 0.25)
          ),
          currentLevelFraction: 0.5,
        };
      }
      if (endpoint.endsWith('/injections')) return injections;
      if (endpoint.endsWith('/pens'))
        return [
          {
            id: 'vial',
            kind: 'vial',
            label: 'Synthetic vial',
            status: 'in_use',
            dose_mg: 0.5,
            concentration_mg_ml: 2,
            volume_ml: 2,
            doses_total: 8,
            doses_used: 0,
            reorder_flag: false,
            stock: {
              totalMg: 4,
              remainingMg: 4,
              remainingMl: 2,
              usedMg: 0,
              overdrawnMg: 0,
            },
          },
        ];
      if (endpoint.endsWith('/syringes'))
        return { syringes: [syringe], default_syringe_id: null };
      if (endpoint.endsWith('/draw-preview')) {
        const input = calculatedDrawInputSchema.parse(options?.body);
        return {
          ...computeDraw({
            dose: normalizeDeviceDose(input.dose, syringe),
            concentrationMcgPerMl: '2000',
            syringe,
            remainingMl: '2',
          }),
          syringeCapacityMl: syringe.capacity_ml,
        };
      }
      if (endpoint.endsWith('/site-suggestion'))
        return {
          suggestedSiteId: 'abdomen_left',
          restingSiteIds: [],
          sites: INJECTION_SITES,
          restDays: 7,
        };
      return [];
    }
  );
});
function open(path = '/medications?tab=cabinet') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Medications />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
it('renders all three amounts and syringe controls through Cabinet selection using real hooks and sampled API contract', async () => {
  open();
  fireEvent.click(await screen.findByText('Synthetic injectable'));
  expect(
    await screen.findByText('Modelled total remaining')
  ).toBeInTheDocument();
  expect(screen.getByText('Modelled at injection sites')).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Manage devices' })
  ).toBeInTheDocument();
  expect(
    await screen.findByText('Measurable marking: 25 units')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to 25 units' })
  ).toBeInTheDocument();
  expect(
    screen
      .getByText('Measurable marking: 25 units')
      .compareDocumentPosition(
        screen.getByRole('group', { name: 'Injection site body map' })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(mockApiCall).toHaveBeenCalledWith(
    expect.stringContaining('/serum-curve'),
    expect.objectContaining({ params: { stepDays: 1 / 12 } })
  );
});
it('keeps syringe controls within a selected non-GLP1 injectable Cabinet detail', async () => {
  mockGlp1 = false;
  open();
  expect(
    screen.queryByRole('button', { name: 'Manage devices' })
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByText('Synthetic injectable'));
  expect(
    await screen.findByRole('button', { name: 'Manage devices' })
  ).toBeInTheDocument();
});
it('keeps Preparation & stock inventory-only through the full Medications route', async () => {
  open('/medications?tab=stock');
  await waitFor(() =>
    expect(screen.getByLabelText('Peptide / medication')).toHaveTextContent(
      'Synthetic injectable'
    )
  );
  expect(
    await screen.findByText('4.000 mg / 2.000 mL remaining')
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Manage devices' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Log injection')).not.toBeInTheDocument();
});
