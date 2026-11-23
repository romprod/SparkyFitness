import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
import { calendarWeek } from '@/tests/fixtures/medicationLogWeek';
import { inventoryForecastFixture } from '@/tests/fixtures/medicationInventoryForecast';
const mockInvoiceUser = { id: 'owner', activeUserId: 'owner' };
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptionScope: () => ({
    ready: mockInvoiceUser.activeUserId === mockInvoiceUser.id,
    canWrite: true,
    key: 'owner',
    isCurrent: () => mockInvoiceUser.activeUserId === mockInvoiceUser.id,
  }),
  useMedicationPrescriptions: () => ({
    scope: {
      ready: mockInvoiceUser.activeUserId === mockInvoiceUser.id,
      canWrite: true,
      key: 'owner',
      isCurrent: () => mockInvoiceUser.activeUserId === mockInvoiceUser.id,
    },
    query: { isLoading: false, isError: false },
    data: { prescriptions: [] },
  }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockInvoiceUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockInvoiceUser.activeUserId,
    hasPermission: () => true,
    hasWritePermission: () => true,
    isActingOnBehalf: false,
  }),
}));
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
    formatDateInUserTimezone: (date: Date | string) =>
      new Date(date).toISOString(),
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
  default: () => <p>Existing selected-date checklist</p>,
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: () => ({
    scope: { ready: true, key: 'owner', isCurrent: () => true },
    query: { isLoading: false, isError: false },
    data: calendarWeek({ lanes: [] }),
  }),
}));
jest.mock('@/pages/Medications/ScheduleManager', () => ({
  __esModule: true,
  default: ({
    onTimeline,
    focusRevisionId,
  }: {
    onTimeline?: () => void;
    focusRevisionId?: string;
  }) => (
    <>
      <button onClick={onTimeline}>Timeline test entry</button>
      <p>Focused plan: {focusRevisionId}</p>
    </>
  ),
}));
jest.mock('@/pages/Medications/MedicationCourseTimeline', () => ({
  __esModule: true,
  default: ({
    onManage,
  }: {
    onManage: (row: {
      medication_id: string;
      is_current_tip: boolean;
      revision_id: string;
    }) => void;
  }) => (
    <button
      onClick={() =>
        onManage({
          medication_id: 'med',
          is_current_tip: true,
          revision_id: 'timeline-revision',
        })
      }
    >
      Manage exact timeline row
    </button>
  ),
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
let mockEmptyMedications = false;
beforeEach(() => {
  localStorage.clear();
  mockGlp1 = true;
  mockEmptyMedications = false;
  mockInvoiceUser.activeUserId = 'owner';
  mockApiCall.mockReset();
  mockApiCall.mockImplementation(
    async (
      endpoint: string,
      options?: { params?: Record<string, unknown>; body?: unknown }
    ) => {
      if (endpoint === '/identity/user')
        return {
          authenticatedUserId: mockInvoiceUser.id,
          activeUserId: mockInvoiceUser.activeUserId,
        };
      if (endpoint === '/v2/medication-inventory/dashboard')
        return {
          forecast: { ...inventoryForecastFixture(), medications: [] },
          supply: { state: 'no_demand', medication_id: null },
          preparation_queue: [],
        };
      if (endpoint === '/v2/medication-inventory/forecast')
        return { ...inventoryForecastFixture(), medications: [] };
      if (endpoint === '/v2/medication-courses')
        return { courses: [], today: '2026-11-16', timezone: 'Europe/London' };
      if (endpoint === '/v2/medication-purchases/vial-costs')
        return { vials: [] };
      if (endpoint === '/v2/medication-blends') return { blends: [] };
      if (endpoint === '/v2/medication-purchases/analytics')
        return {
          window: {
            key: options?.params?.['window'] ?? '12',
            from_date: '2025-11-15',
            to_date: '2026-11-15',
          },
          rows: [],
        };
      if (endpoint === '/v2/medication-purchases') return { purchases: [] };
      if (endpoint === '/v2/medication-purchases/editor-data')
        return { medications: [], vials: [], packs: [] };
      if (endpoint === '/v2/medications')
        return mockEmptyMedications
          ? []
          : [
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
it('offers blend components on a selected injectable, as a plain medication until some are added', async () => {
  mockGlp1 = false;
  open();
  fireEvent.click(await screen.findByText('Synthetic injectable'));
  expect(await screen.findByText('Blend components')).toBeInTheDocument();
  expect(screen.getByText('Not a blend.')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Add components' })
  ).toBeInTheDocument();
});
it('keeps Inventory inventory-only through the full Medications route', async () => {
  open('/medications?tab=stock');
  expect(
    await screen.findByRole('button', { name: 'Add stock' })
  ).toBeInTheDocument();
  expect(
    await screen.findByText('4.000 mg / 2.000 mL remaining')
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Manage devices' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Log injection')).not.toBeInTheDocument();
});

it('opens Costs without medication records and offers a consumable-only invoice', async () => {
  mockEmptyMedications = true;
  open('/medications?tab=costs');
  fireEvent.click(await screen.findByRole('button', { name: 'Add invoice' }));
  await screen.findByRole('heading', { name: 'New invoice' });
  fireEvent.click(screen.getByRole('button', { name: 'Add consumable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }));
  expect(screen.getByLabelText('Packs')).toHaveValue('1');
  expect(screen.queryByLabelText('Medication')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
});

it('keeps an owner Costs entry beside the empty medication disclaimer', async () => {
  mockEmptyMedications = true;
  open('/medications?tab=cabinet');
  fireEvent.click(await screen.findByRole('button', { name: 'Costs' }));
  expect(
    await screen.findByRole('button', { name: 'Add invoice' })
  ).toBeInTheDocument();
});

it('hides Costs and makes no financial requests in a delegated profile', async () => {
  mockInvoiceUser.activeUserId = 'another-profile';
  open('/medications?tab=costs');
  await screen.findByRole('button', { name: 'Inventory' });
  expect(
    screen.queryByRole('button', { name: 'Costs' })
  ).not.toBeInTheDocument();
  expect(
    mockApiCall.mock.calls.some(([endpoint]) =>
      endpoint.startsWith('/v2/medication-purchases')
    )
  ).toBe(false);
});

it('returns timeline Manage to the exact Cabinet plan and clears the subtype filter', async () => {
  localStorage.setItem('medications.subtypeFilter', 'meds');
  open();
  fireEvent.click(await screen.findByText('Synthetic injectable'));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Timeline test entry' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage exact timeline row' })
  );
  expect(localStorage.getItem('medications.subtypeFilter')).toBe('all');
  expect(
    await screen.findByText('Focused plan: timeline-revision')
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Manage exact timeline row' })
  ).not.toBeInTheDocument();
});

it('places the default weekly calendar in Log before the existing separate checklist', async () => {
  open('/medications?tab=today');
  const heading = await screen.findByRole('heading', { name: 'Dose calendar' });
  expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(
    heading.compareDocumentPosition(
      screen.getByText('Existing selected-date checklist')
    ) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Manage devices' })
  ).not.toBeInTheDocument();
});

it('offers the owner prescription register without medication records or medical onboarding', async () => {
  mockEmptyMedications = true;
  open('/medications?tab=prescriptions');
  expect(
    await screen.findByRole('heading', { name: 'Prescriptions' })
  ).toBeInTheDocument();
  expect(screen.getByText('No prescriptions yet.')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Basic prescription' })
  ).toBeDisabled();
});
it('hides the owner-only Prescriptions destination in a delegated profile', async () => {
  mockInvoiceUser.activeUserId = 'another-profile';
  open('/medications?tab=prescriptions');
  await screen.findByRole('button', { name: 'Inventory' });
  expect(
    screen.queryByRole('button', { name: 'Prescriptions' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Prescriptions' })
  ).not.toBeInTheDocument();
  expect(
    mockApiCall.mock.calls.some(([endpoint]) =>
      endpoint.startsWith('/v2/medication-prescriptions')
    )
  ).toBe(false);
});
