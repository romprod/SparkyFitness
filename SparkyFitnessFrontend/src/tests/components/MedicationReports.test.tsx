import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationReports from '@/pages/Reports/MedicationReports';

jest.mock('react-i18next', () => ({
  Trans: ({
    defaults,
    components,
  }: {
    defaults: string;
    components?: Record<string, React.ReactElement>;
  }) => {
    const match = defaults.match(/^<strong>(.*?)<\/strong>(.*)$/s);
    if (!match || !components?.['strong']) return defaults;
    return (
      <>
        {React.cloneElement(components['strong'], {}, match[1])}
        {match[2]}
      </>
    );
  },
  useTranslation: () => ({
    t: (
      key: string,
      defaultValueOrOptions?: string | Record<string, unknown>
    ) => {
      if (typeof defaultValueOrOptions === 'string') {
        return defaultValueOrOptions;
      }

      const defaultValue = defaultValueOrOptions?.['defaultValue'];
      if (typeof defaultValue !== 'string') return key;

      return defaultValue.replace(/{{(\w+)}}/g, (_match, name: string) =>
        String(defaultValueOrOptions?.[name] ?? `{{${name}}}`)
      );
    },
  }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDateInUserTimezone: (date: string | Date) => String(date),
    weightUnit: 'lbs',
    convertWeight: (value: number) => value,
    timezone: 'UTC',
    dateFormat: 'yyyy-MM-dd',
  }),
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ activeUserId: 'user-1' }),
}));

jest.mock('@/hooks/Settings/useProfile', () => ({
  useProfileQuery: () => ({ data: null }),
}));

let mockPreferences: unknown[] = [];
const mockSavePreference = jest.fn();
jest.mock('@/hooks/useMedicationDisplayPreferences', () => ({
  useMedicationDisplayPreferences: () => ({ data: mockPreferences }),
  useUpsertMedicationDisplayPreferenceMutation: () => ({
    mutate: mockSavePreference,
  }),
}));

jest.mock('@/pages/Reports/MedicationLogTable', () => () => null);
jest.mock('@/pages/Reports/MedicationDoseHistory', () => () => null);
jest.mock('@/pages/Reports/MedicationInsightsCard', () => () => (
  <div>Insights card</div>
));
jest.mock('@/pages/Reports/AppointmentPdfExport', () => () => (
  <div>Owner appointment PDF controls</div>
));

jest.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    Line: Nothing,
    Bar: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
    Legend: Nothing,
  };
});

describe('MedicationReports localization', () => {
  it('interpolates the selected weight unit in the weight trend title', () => {
    render(
      <MedicationReports
        startDate="2026-08-01"
        endDate="2026-08-01"
        nutritionData={[]}
        tabularData={[]}
        exerciseEntries={[]}
        measurementData={[]}
        customCategories={[]}
        customMeasurementsData={[]}
        sleepAnalyticsData={[]}
        medications={[]}
        medicationEntries={[]}
        symptomEntries={[]}
        injections={[]}
        titrationSteps={[]}
      />
    );

    expect(
      screen.getByText('Weight Trend vs. Target Weight (lbs)')
    ).toBeInTheDocument();
    expect(screen.queryByText(/{{unit}}/)).not.toBeInTheDocument();
  });

  it('preserves emphasized recommendation labels after localization', () => {
    render(
      <MedicationReports
        startDate="2026-08-01"
        endDate="2026-08-01"
        nutritionData={[
          { date: '2026-08-01', water: 1000 },
          { date: '2026-08-02', water: 2000 },
          { date: '2026-08-03', water: 3000 },
          { date: '2026-08-04', water: 4000 },
          { date: '2026-08-05', water: 5000 },
        ]}
        tabularData={[]}
        exerciseEntries={[]}
        measurementData={[]}
        customCategories={[]}
        customMeasurementsData={[]}
        sleepAnalyticsData={[]}
        medications={[]}
        medicationEntries={[]}
        symptomEntries={[
          {
            id: 'symptom-1',
            entry_date: '2026-08-01',
            symptom_name_snapshot: 'constipation',
            severity: 3,
          },
          {
            id: 'symptom-2',
            entry_date: '2026-08-02',
            symptom_name_snapshot: 'constipation',
            severity: 2,
          },
          {
            id: 'symptom-3',
            entry_date: '2026-08-03',
            symptom_name_snapshot: 'constipation',
            severity: 3,
          },
          {
            id: 'symptom-4',
            entry_date: '2026-08-04',
            symptom_name_snapshot: 'constipation',
            severity: 2,
          },
          {
            id: 'symptom-5',
            entry_date: '2026-08-05',
            symptom_name_snapshot: 'constipation',
            severity: 1,
          },
        ]}
        injections={[]}
        titrationSteps={[]}
      />
    );

    expect(screen.getByText('Strong Hydration Benefit:').tagName).toBe(
      'STRONG'
    );
  });
});

it('keeps existing Print and CSV formats distinct from owner-only appointment PDF controls', () => {
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  render(
    <MedicationReports
      startDate="2020-01-01"
      endDate="2020-01-01"
      nutritionData={[]}
      tabularData={[]}
      exerciseEntries={[]}
      measurementData={[]}
      customCategories={[]}
      customMeasurementsData={[]}
      sleepAnalyticsData={[]}
      medications={[]}
      medicationEntries={[]}
      symptomEntries={[]}
      injections={[]}
      titrationSteps={[]}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Print / Save PDF Report' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Download CSV Data' })
  ).toBeInTheDocument();
  expect(
    screen.getByText('Owner appointment PDF controls')
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Print and CSV use the current report view and its selected period.'
    )
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Print / Save PDF Report' })
  );
  expect(print).toHaveBeenCalledTimes(1);
  print.mockRestore();
});

describe('Insights card on the medication reports', () => {
  const renderReports = () =>
    render(
      <MedicationReports
        startDate="2026-08-01"
        endDate="2026-08-01"
        nutritionData={[]}
        tabularData={[]}
        exerciseEntries={[]}
        measurementData={[]}
        customCategories={[]}
        customMeasurementsData={[]}
        sleepAnalyticsData={[]}
        medications={[]}
        medicationEntries={[]}
        symptomEntries={[]}
        injections={[]}
        titrationSteps={[]}
      />
    );
  const saved = (items: string[]) => [
    {
      id: 'pref-1',
      view_group: 'reports',
      platform: 'web',
      visible_items: items,
    },
  ];
  const everyCard = [
    'nausea_vs_dose_chart',
    'weight_vs_goal_chart',
    'adherence_chart',
    'medication_log_table',
    'glp1_checkin_chart',
    'hydration_constipation_card',
    'protein_nausea_card',
    'sleep_fatigue_card',
    'dose_nausea_card',
  ];

  beforeEach(() => {
    localStorage.clear();
    mockSavePreference.mockClear();
    mockPreferences = [];
  });
  afterAll(() => {
    mockPreferences = [];
  });

  it('shows the card by default', () => {
    renderReports();
    expect(screen.getByText('Insights card')).toBeInTheDocument();
    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('hides the card for a person who has switched it off', () => {
    mockPreferences = saved(everyCard);
    localStorage.setItem('migrated_insights_card_pref-1', 'true');
    renderReports();
    expect(screen.queryByText('Insights card')).not.toBeInTheDocument();
    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('adds the card once for a person with saved choices, in one write', () => {
    mockPreferences = saved(everyCard);
    renderReports();
    expect(mockSavePreference).toHaveBeenCalledTimes(1);
    expect(mockSavePreference).toHaveBeenCalledWith({
      viewGroup: 'reports',
      platform: 'web',
      visibleItems: [...everyCard, 'insights_card'],
    });
    expect(localStorage.getItem('migrated_insights_card_pref-1')).toBe('true');
  });

  it('adds every card saved choices lack together, so none overwrites another', () => {
    const old = everyCard.filter(
      (id) => id !== 'glp1_checkin_chart' && id !== 'medication_log_table'
    );
    mockPreferences = saved(old);
    renderReports();
    expect(mockSavePreference).toHaveBeenCalledTimes(1);
    expect(mockSavePreference).toHaveBeenCalledWith({
      viewGroup: 'reports',
      platform: 'web',
      visibleItems: [
        ...old,
        'glp1_checkin_chart',
        'medication_log_table',
        'insights_card',
      ],
    });
  });

  it('does not add a card again after it was added once', () => {
    mockPreferences = saved(everyCard);
    renderReports();
    mockSavePreference.mockClear();
    cleanup();
    renderReports();
    expect(mockSavePreference).not.toHaveBeenCalled();
  });
});
