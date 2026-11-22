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
jest.mock('@/pages/Reports/LifeEventsCard', () => () => (
  <div>Life events card</div>
));
let mockLifeEvents: unknown[] = [];
jest.mock('@/hooks/Medications/useLifeEvents', () => ({
  useLifeEvents: () => ({ data: mockLifeEvents }),
}));
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
    ReferenceArea: (props: Record<string, unknown>) => (
      <div
        data-testid="shade"
        data-x1={String(props['x1'])}
        data-x2={String(props['x2'])}
        data-fill={String(props['fill'])}
        data-axis={String(props['yAxisId'])}
      />
    ),
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
    mockLifeEvents = [];
  });
  afterAll(() => {
    mockPreferences = [];
  });

  it('shows the card by default', () => {
    renderReports();
    expect(screen.getByText('Insights card')).toBeInTheDocument();
    expect(screen.getByText('Life events card')).toBeInTheDocument();
    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('hides the card for a person who has switched it off', () => {
    mockPreferences = saved(everyCard);
    localStorage.setItem('migrated_insights_card_pref-1', 'true');
    localStorage.setItem('migrated_life_events_card_pref-1', 'true');
    renderReports();
    expect(screen.queryByText('Insights card')).not.toBeInTheDocument();
    expect(screen.queryByText('Life events card')).not.toBeInTheDocument();
    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('adds the card once for a person with saved choices, in one write', () => {
    mockPreferences = saved(everyCard);
    renderReports();
    expect(mockSavePreference).toHaveBeenCalledTimes(1);
    expect(mockSavePreference).toHaveBeenCalledWith({
      viewGroup: 'reports',
      platform: 'web',
      visibleItems: [...everyCard, 'insights_card', 'life_events_card'],
    });
    expect(localStorage.getItem('migrated_insights_card_pref-1')).toBe('true');
    expect(localStorage.getItem('migrated_life_events_card_pref-1')).toBe(
      'true'
    );
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
        'life_events_card',
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

describe('Illness and travel windows shaded on the charts', () => {
  const renderRange = () =>
    render(
      <MedicationReports
        startDate="2026-08-01"
        endDate="2026-08-10"
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
  const windowOf = (
    id: string,
    kind: string,
    start_day: string,
    end_day: string
  ) => ({ id, kind, start_day, end_day, label: null, notes: null });

  beforeEach(() => {
    localStorage.clear();
    mockLifeEvents = [];
  });
  afterAll(() => {
    mockLifeEvents = [];
  });

  it('draws nothing and says nothing when there are no windows', () => {
    renderRange();
    expect(screen.queryAllByTestId('shade')).toHaveLength(0);
    expect(screen.queryByText(/Shaded windows/)).not.toBeInTheDocument();
  });

  it('shades each window, cut to the report’s range, on the four dated charts', () => {
    mockLifeEvents = [
      windowOf('flu', 'illness', '2026-07-30', '2026-08-03'),
      windowOf('trip', 'travel', '2026-08-08', '2026-08-20'),
      windowOf('old', 'other', '2026-05-01', '2026-05-05'),
    ];
    renderRange();
    const shades = screen.getAllByTestId('shade');
    // Two windows overlap the range; the older one does not. Four charts, two shades each.
    expect(shades).toHaveLength(8);
    const flu = shades.filter((el) => el.dataset['fill'] === '#f59e0b');
    const trip = shades.filter((el) => el.dataset['fill'] === '#14b8a6');
    expect(flu).toHaveLength(4);
    expect(trip).toHaveLength(4);
    for (const el of flu) {
      expect(el.dataset['x1']).toBe('2026-08-01');
      expect(el.dataset['x2']).toBe('2026-08-03');
    }
    for (const el of trip) {
      expect(el.dataset['x1']).toBe('2026-08-08');
      expect(el.dataset['x2']).toBe('2026-08-10');
    }
    expect(
      screen.getByText(
        'Shaded windows: illness (amber), travel (teal), other (grey).'
      )
    ).toBeInTheDocument();
  });

  it('ties the shade to the left axis on the charts that have two axes', () => {
    mockLifeEvents = [windowOf('flu', 'illness', '2026-08-02', '2026-08-04')];
    renderRange();
    const axes = screen.getAllByTestId('shade').map((el) => el.dataset['axis']);
    // The dose and check-in charts have a left and a right axis; the other two have one.
    expect(axes.filter((axis) => axis === 'left')).toHaveLength(2);
    expect(axes.filter((axis) => axis === 'undefined')).toHaveLength(2);
  });
});
