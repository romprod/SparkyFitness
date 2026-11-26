import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BodyCompRegionValues, BodyCompScan } from '@workspace/shared';
import { MemoryRouter } from 'react-router-dom';
import BodyCompScansCard from '@/pages/Labs/BodyCompScansCard';

const renderCard = () =>
  render(
    <MemoryRouter>
      <BodyCompScansCard />
    </MemoryRouter>
  );

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDate: (day: string) => `UK:${day}`,
    timezone: 'Europe/London',
  }),
}));
jest.mock('@/pages/Labs/LinkedDocuments', () => ({
  __esModule: true,
  default: ({
    bodyCompScanId,
    metabolicTestId,
  }: {
    bodyCompScanId?: string;
    metabolicTestId?: string;
  }) => (
    <span data-testid="linked-documents">
      {bodyCompScanId ?? metabolicTestId}
    </span>
  ),
}));
jest.mock('@/pages/Labs/BodyCompScanForm', () => ({
  __esModule: true,
  default: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>mock form</button>
  ),
}));
let mockQuery: {
  data?: BodyCompScan[];
  isError?: boolean;
  isLoading?: boolean;
} = {};
const mockRemove = jest.fn();
jest.mock('@/hooks/Labs/useBodyCompScans', () => ({
  useBodyCompScans: () => mockQuery,
  useDeleteBodyCompScanMutation: () => ({ mutate: mockRemove }),
}));
let mockEntries: { data?: unknown[]; isLoading?: boolean; isError?: boolean } =
  { data: [] };
const mockEntriesHook = jest.fn();
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: (opts: unknown) => {
    mockEntriesHook(opts);
    return mockEntries;
  },
}));
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({ data: [] }),
}));
let mockMetabolicTests: unknown[] = [];
jest.mock('@/hooks/Labs/useMetabolicTests', () => ({
  useMetabolicTests: () => ({ data: mockMetabolicTests }),
}));
let mockScale: { data?: unknown; isError?: boolean; isLoading?: boolean } = {};
const mockScaleHook = jest.fn();
jest.mock('@/hooks/CheckIn/useCheckIn', () => ({
  useRecentStandardMeasurements: (from: string, to: string) => {
    mockScaleHook(from, to);
    return mockScale;
  },
}));
let mockLifeEvents: unknown[] = [];
jest.mock('@/hooks/Medications/useLifeEvents', () => ({
  useLifeEvents: () => ({ data: mockLifeEvents }),
}));
let mockLabPanels: { data?: unknown; isLoading?: boolean; isError?: boolean } =
  { data: { panels: [] } };
jest.mock('@/hooks/Labs/useLabResults', () => ({
  useLabPanels: () => mockLabPanels,
  useLabMarkers: () => ({ data: [] }),
}));

const region = (
  name: BodyCompRegionValues['region'],
  fat: number,
  lean: number,
  bmc: number
): BodyCompRegionValues => ({
  region: name,
  fat_g: fat,
  lean_g: lean,
  bmc_g: bmc,
  total_g: fat + lean + bmc,
  pct_fat: Math.round((fat / (fat + lean + bmc)) * 1000) / 10,
});
const regions = [
  region('l_arm', 1000, 4000, 200),
  region('r_arm', 1000, 4400, 220),
  region('trunk', 10000, 27000, 900),
  region('l_leg', 3000, 10000, 700),
  region('r_leg', 3000, 10600, 740),
  region('head', 2000, 4000, 240),
];
const scan = (patch: Partial<BodyCompScan> = {}): BodyCompScan => ({
  id: '00000000-0000-4000-a000-0000000000a1',
  scanned_day: '2026-08-10',
  device_label: 'Hologic Horizon A',
  device_serial: 'S1',
  software_version: '13.6',
  facility: 'City clinic',
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  clinic_weight_kg: 83,
  total_fat_g: 20000,
  total_lean_g: 60000,
  total_bmc_g: 3000,
  total_mass_g: 83000,
  pct_fat: 24.1,
  vat_mass_g: 800,
  vat_volume_cm3: null,
  vat_area_cm2: null,
  total_bmd_gcm2: 1.31,
  prep: {
    fasted: true,
    fasting_hours: 12,
    no_caffeine: true,
    no_training_prior_day: true,
    active_travel: false,
    euhydrated_voided: true,
    illness_free_14d: true,
  },
  creatine_status: 'none',
  carb_pattern_48h: null,
  regions,
  notes: 'second visit',
  ...patch,
});
const later = (patch: Partial<BodyCompScan> = {}) =>
  scan({
    id: '00000000-0000-4000-a000-0000000000a2',
    scanned_day: '2026-11-02',
    total_fat_g: 18000,
    total_lean_g: 61000,
    total_mass_g: 82000,
    pct_fat: 22,
    ...patch,
  });
/** The first scan's own detail, apart from the figure, series and bloodwork panels. */
const inDetail = () => within(document.querySelector('details') as HTMLElement);
const dose = (day: string, name: string, mg: number) => ({
  medication_id: name,
  status: 'taken',
  entry_date: day,
  dose_amount_snapshot: mg,
  dose_unit_snapshot: 'mg',
  med_name_snapshot: name,
});

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'queueMicrotask'],
  });
  jest.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
  mockQuery = { data: [] };
  mockEntries = { data: [] };
  mockMetabolicTests = [];
  mockLifeEvents = [];
  mockScale = {};
  mockScaleHook.mockClear();
  mockLabPanels = { data: { panels: [] } };
  mockEntriesHook.mockClear();
  mockRemove.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('with no scans', () => {
  it('links to the pre-visit checklist', () => {
    renderCard();
    expect(
      screen.getByRole('link', { name: 'Pre-visit checklist' })
    ).toHaveAttribute('href', '/labs/dexa-checklist');
  });

  it('says so and offers to add one', () => {
    renderCard();
    expect(screen.getByText(/No scans yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a scan' }));
    expect(screen.getByText('mock form')).toBeInTheDocument();
    expect(screen.queryByText(/No scans yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('mock form'));
    expect(screen.queryByText('mock form')).not.toBeInTheDocument();
    expect(mockEntriesHook).not.toHaveBeenCalled();
  });

  it('says when the scans could not be loaded', () => {
    mockQuery = { isError: true };
    renderCard();
    expect(screen.getByText('Could not load the scans.')).toBeInTheDocument();
    expect(screen.queryByText(/No scans yet/)).not.toBeInTheDocument();
  });
});

describe('one scan', () => {
  beforeEach(() => {
    mockQuery = { data: [scan()] };
  });

  it('still links to the pre-visit checklist', () => {
    renderCard();
    expect(
      screen.getByRole('link', { name: 'Pre-visit checklist' })
    ).toHaveAttribute('href', '/labs/dexa-checklist');
  });

  it('shows the headline figures and the repeat-scan window', () => {
    renderCard();
    expect(
      screen.getByText('UK:2026-08-10', { selector: 'summary span' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/24\.1% fat · 20\.0 kg fat · 60\.0 kg lean/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A repeat scan is worth taking from UK:2026-11-02 to UK:2026-11-30, twelve to sixteen weeks after the latest.'
      )
    ).toBeInTheDocument();
    // No second scan to compare with.
    expect(
      screen.queryByRole('region', { name: 'Compare two scans' })
    ).not.toBeInTheDocument();
  });

  it('works the indices out in its details', () => {
    renderCard();
    const ffm = inDetail().getByText('Fat-free mass').parentElement!;
    expect(within(ffm).getByText('63.0 kg')).toBeInTheDocument();
    // 63 kg over 1.8 m squared.
    expect(
      within(inDetail().getByText('FFMI').parentElement!).getByText('19.4')
    ).toBeInTheDocument();
    expect(
      within(inDetail().getByText('FMI').parentElement!).getByText('6.2')
    ).toBeInTheDocument();
    expect(
      within(
        inDetail().getByText('Appendicular lean').parentElement!
      ).getByText('29.0 kg')
    ).toBeInTheDocument();
    expect(
      within(inDetail().getByText('Visceral fat').parentElement!).getByText(
        '800 g'
      )
    ).toBeInTheDocument();
    expect(
      within(inDetail().getByText('Bone density').parentElement!).getByText(
        '1.310 g/cm²'
      )
    ).toBeInTheDocument();
  });

  it('lists regions, shape ratios and the conditions with unknown ones marked', () => {
    mockQuery = {
      data: [
        scan({
          prep: {
            ...scan().prep,
            no_training_prior_day: null,
            euhydrated_voided: null,
            illness_free_14d: null,
          },
        }),
      ],
    };
    renderCard();
    expect(inDetail().getByText('Left arm')).toBeInTheDocument();
    expect(inDetail().getByText('Trunk')).toBeInTheDocument();
    expect(
      screen.getByText('Arm lean mass, right against left: +9.5%')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Trunk fat over limb fat: 1.25')
    ).toBeInTheDocument();
    const prep = screen.getByText('Conditions')
      .nextElementSibling as HTMLElement;
    expect(within(prep).getByText(/Fasted:/)).toHaveTextContent(
      'Fasted: yes (12 h)'
    );
    expect(
      within(prep).getByText(/Cycled or ran to the clinic:/)
    ).toHaveTextContent(': no');
    expect(within(prep).getByText(/No hard training/)).toHaveTextContent(
      ': unknown'
    );
    expect(within(prep).getByText(/Creatine:/)).toHaveTextContent(
      'Creatine: none'
    );
    expect(screen.getByText('second visit')).toBeInTheDocument();
  });

  it('is quiet when the report agrees with itself and flags it when it does not', () => {
    const { unmount } = renderCard();
    expect(screen.queryByText(/adds up to the total/)).not.toBeInTheDocument();
    unmount();
    mockQuery = { data: [scan({ total_fat_g: 21000, pct_fat: 31 })] };
    renderCard();
    expect(
      screen.getByText(
        /Region fat adds up to the total: worked out 20000\.0, printed 21000\.0/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Printed body fat matches fat over total mass/)
    ).toBeInTheDocument();
  });

  it('says where the window stands once it has come, and once it has passed', () => {
    jest.setSystemTime(new Date('2026-11-10T10:00:00.000Z'));
    const { unmount } = renderCard();
    expect(
      screen.getByText(
        'A repeat scan is worth taking now, until UK:2026-11-30.'
      )
    ).toBeInTheDocument();
    unmount();
    jest.setSystemTime(new Date('2026-12-15T10:00:00.000Z'));
    renderCard();
    expect(
      screen.getByText(
        'The usual window for a repeat scan ended on UK:2026-11-30.'
      )
    ).toBeInTheDocument();
  });

  it('deletes after confirming, and says why it could not', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this scan?')).toBeInTheDocument();
    mockRemove.mockImplementation(
      (_id: string, options: { onError: (e: Error) => void }) =>
        options.onError(new Error('Not allowed'))
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      })
    );
    expect(mockRemove).toHaveBeenCalledWith(
      '00000000-0000-4000-a000-0000000000a1',
      expect.anything()
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
  });
});

describe('two scans', () => {
  beforeEach(() => {
    mockQuery = { data: [later(), scan()] };
  });
  const compare = () =>
    screen.getByRole('region', { name: 'Compare two scans' });

  it('compares the latest two against the scanner’s own noise, with the days apart', () => {
    renderCard();
    expect(within(compare()).getByText('84 days apart')).toBeInTheDocument();
    const fat = within(compare()).getByText('Fat mass').closest('tr')!;
    expect(fat).toHaveTextContent('20.0 kg');
    expect(fat).toHaveTextContent('18.0 kg');
    expect(fat).toHaveTextContent('−2.0 kg');
    expect(fat).toHaveTextContent('Beyond measurement noise');
    expect(fat).toHaveTextContent('noise 0.43, clear above 0.82');
    expect(fat).toHaveTextContent('−0.7 kg per 30 days');
    const lean = within(compare())
      .getByText('Lean mass (without bone)')
      .closest('tr')!;
    expect(lean).toHaveTextContent('+1.0 kg');
    expect(lean).toHaveTextContent('Possible change');
    const pct = within(compare()).getByText('Body fat').closest('tr')!;
    expect(pct).toHaveTextContent('−2.1 points');
    expect(
      within(compare()).getByText('Appendicular lean mass')
    ).toBeInTheDocument();
    expect(within(compare()).getByText('Visceral fat')).toBeInTheDocument();
    expect(
      within(compare()).queryByText(/Lowered a step/)
    ).not.toBeInTheDocument();
    expect(
      within(compare()).getByText(/Hologic Horizon A default/)
    ).toBeInTheDocument();
  });

  it('lowers the verdict a step, saying what the numbers alone say, when the conditions differed', () => {
    mockQuery = {
      data: [
        later({
          prep: { ...scan().prep, fasted: false },
        }),
        scan(),
      ],
    };
    renderCard();
    const fat = within(compare()).getByText('Fat mass').closest('tr')!;
    expect(fat).toHaveTextContent('Possible change');
    expect(fat).toHaveTextContent(
      'Lowered a step: the scans were not taken alike (the numbers alone say: Beyond measurement noise).'
    );
    expect(
      within(compare()).getByText('Not alike: fasted: differs.')
    ).toBeInTheDocument();
  });

  it('shows no numbers across a different scanner, only why', () => {
    mockQuery = { data: [later({ device_serial: 'S2' }), scan()] };
    renderCard();
    expect(within(compare()).getByRole('status')).toHaveTextContent(
      'These scans cannot be compared: different scanner serial.'
    );
    expect(within(compare()).queryByRole('table')).not.toBeInTheDocument();
  });

  it('compares any two chosen, whichever order they are picked in', () => {
    const middle = scan({
      id: '00000000-0000-4000-a000-0000000000a3',
      scanned_day: '2026-09-20',
      total_fat_g: 19000,
      total_mass_g: 82000,
      pct_fat: 23.2,
    });
    mockQuery = { data: [later(), middle, scan()] };
    renderCard();
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '00000000-0000-4000-a000-0000000000a1' },
    });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '00000000-0000-4000-a000-0000000000a3' },
    });
    expect(within(compare()).getByText('41 days apart')).toBeInTheDocument();
  });

  it('compares earlier to later even when the later one is chosen as From', () => {
    const middle = scan({
      id: '00000000-0000-4000-a000-0000000000a3',
      scanned_day: '2026-09-20',
      total_fat_g: 19000,
      total_mass_g: 82000,
      pct_fat: 23.2,
    });
    mockQuery = { data: [later(), middle, scan()] };
    renderCard();
    // From is the middle scan by default; choosing the oldest as To puts it before From.
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '00000000-0000-4000-a000-0000000000a1' },
    });
    expect(within(compare()).getByText('41 days apart')).toBeInTheDocument();
    expect(
      within(compare()).getByText('Fat mass').closest('tr')
    ).toHaveTextContent('−1.0 kg');
  });

  it('is not shown when the same scan is chosen twice', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '00000000-0000-4000-a000-0000000000a2' },
    });
    expect(
      screen.queryByRole('region', { name: 'Compare two scans' })
    ).not.toBeInTheDocument();
  });

  it('lists what was taken between the scans, from the dose log for that window', async () => {
    mockEntries = {
      data: [
        dose('2026-08-17', 'Retatrutide', 2),
        dose('2026-10-26', 'Retatrutide', 4),
        dose('2026-09-01', 'Cagrilintide', 0.25),
      ],
    };
    renderCard();
    expect(mockEntriesHook).toHaveBeenCalledWith({
      fromDate: '2026-08-10',
      toDate: '2026-11-02',
    });
    const table = await within(compare()).findByText(
      'Taken between these scans'
    );
    expect(table).toBeInTheDocument();
    const reta = within(compare()).getByText('Retatrutide').closest('tr')!;
    expect(reta).toHaveTextContent('6.00');
    expect(reta).toHaveTextContent('2');
    expect(within(compare()).getByText('Cagrilintide')).toBeInTheDocument();
    expect(
      within(compare()).getByText(/not a reason for any change/)
    ).toBeInTheDocument();
  });

  it('says so when no dose was logged in the window, and leaves the section out while loading', () => {
    renderCard();
    expect(
      within(compare()).getByText('No doses were logged in this window.')
    ).toBeInTheDocument();
  });

  it('shows nothing about doses while they load or if they cannot be read', () => {
    mockEntries = { isLoading: true };
    const { unmount } = renderCard();
    expect(
      screen.queryByText('Taken between these scans')
    ).not.toBeInTheDocument();
    unmount();
    mockEntries = { isError: true };
    renderCard();
    expect(
      screen.queryByText('Taken between these scans')
    ).not.toBeInTheDocument();
  });

  it('refreshes the choice after a scan is deleted', async () => {
    mockRemove.mockImplementation(
      (_id: string, options: { onSuccess: () => void }) => options.onSuccess()
    );
    renderCard();
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '00000000-0000-4000-a000-0000000000a1' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      })
    );
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });
});

describe('Pitstop’s Body page extras', () => {
  const position = (a: Element, b: Element) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;

  it('shows none of them with no scans', () => {
    renderCard();
    expect(screen.queryByText('Regional distribution')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Scan series with noise bands')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Nearest bloodwork panel')
    ).not.toBeInTheDocument();
  });

  it('stacks the figure and series, then the comparison, then bloodwork, then the scans', () => {
    mockQuery = { data: [later(), scan()] };
    renderCard();
    const header = screen.getByText(/A repeat scan is worth taking/);
    const figure = screen.getByRole('heading', {
      name: 'Regional distribution',
    });
    const series = screen.getByRole('heading', {
      name: 'Scan series with noise bands',
    });
    const compare = screen.getByRole('region', { name: 'Compare two scans' });
    const exposure = screen.getByText('Taken between these scans');
    const labs = screen.getByRole('heading', {
      name: 'Nearest bloodwork panel',
    });
    const list = document.querySelector('details') as HTMLElement;
    for (const [a, b] of [
      [header, figure],
      [figure, series],
      [series, compare],
      [compare, exposure],
      [exposure, labs],
      [labs, list],
    ] as const)
      expect(position(a, b)).toBeTruthy();
  });

  it('looks for bloodwork near the latest scan', () => {
    mockQuery = { data: [later(), scan()] };
    mockLabPanels = {
      data: {
        panels: [
          {
            id: 'p',
            collected_on: '2026-10-30',
            lab_name: 'City lab',
            notes: null,
            origin: 'manual',
            created_at: '2026-10-30T00:00:00.000Z',
            results: [],
          },
        ],
      },
    };
    renderCard();
    expect(
      screen.getByText('Within ± 30 days of the scan on UK:2026-11-02.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('3 days before the scan · City lab')
    ).toBeInTheDocument();
  });

  it('feeds the series the metabolic tests and life events', () => {
    mockQuery = { data: [later(), scan()] };
    mockMetabolicTests = [
      { tested_day: '2026-08-12', measured_rmr_kcal: 1800 },
    ];
    mockLifeEvents = [
      {
        id: 'e',
        kind: 'travel',
        start_day: '2026-09-01',
        end_day: '2026-09-04',
        label: null,
        notes: null,
      },
    ];
    renderCard();
    expect(
      screen.getByRole('img', {
        name: 'Resting metabolic rate, 1 point(s) with noise bands',
      })
    ).toBeInTheDocument();
    expect(document.querySelector('[data-shade="travel"]')).not.toBeNull();
  });

  it('adds each scan’s printed report figures to its detail', () => {
    mockQuery = {
      data: [
        scan({
          age_years: 52,
          pct_fat_yn: 60,
          bmd_z_score: 0.5,
          bmd_t_score: -0.2,
          scan_mode: 'Fast array',
          reference_population: 'NHANES',
        }),
      ],
    };
    renderCard();
    const detail = inDetail();
    expect(
      within(
        detail.getByText('% fat percentile (young-normal)').parentElement!
      ).getByText('60')
    ).toBeInTheDocument();
    expect(
      within(
        detail.getByText('% fat percentile (age-matched)').parentElement!
      ).getByText('not printed')
    ).toBeInTheDocument();
    expect(detail.getByText('BMD T-score')).toBeInTheDocument();
    expect(detail.getByText('Fast array')).toBeInTheDocument();
    expect(detail.getByText('NHANES')).toBeInTheDocument();
    expect(
      detail.getByText(/Population position, not a target\./)
    ).toBeInTheDocument();
    // Everything the card already showed is still there.
    expect(detail.getByText('Fat-free mass')).toBeInTheDocument();
  });

  it('adds percentile and BMD columns to the region table only when a region has them', () => {
    mockQuery = { data: [scan()] };
    const { unmount } = renderCard();
    expect(inDetail().queryByText('YN %ile')).not.toBeInTheDocument();
    expect(inDetail().queryByText('BMD g/cm²')).not.toBeInTheDocument();
    unmount();
    mockQuery = {
      data: [
        scan({
          regions: regions.map((r) =>
            r.region === 'trunk'
              ? { ...r, pct_fat_yn: 71.2, bmd_gcm2: 1.05 }
              : r
          ),
        }),
      ],
    };
    renderCard();
    const detail = inDetail();
    expect(detail.getByText('YN %ile')).toBeInTheDocument();
    expect(detail.getByText('BMD g/cm²')).toBeInTheDocument();
    expect(detail.queryByText('AM %ile')).not.toBeInTheDocument();
    const trunk = detail.getByText('Trunk').closest('tr') as HTMLElement;
    expect(within(trunk).getByText('71')).toBeInTheDocument();
    expect(within(trunk).getByText('1.050')).toBeInTheDocument();
  });
});

describe('the scale background', () => {
  const row = (
    entry_date: string,
    weight: number | null,
    body_fat_percentage: number | null
  ) => ({ entry_date, weight, body_fat_percentage });
  const dashed = () =>
    document.querySelectorAll('[data-series-bg]') as NodeListOf<Element>;

  it('reads the last 180 days, ending today', () => {
    renderCard();
    expect(mockScaleHook).toHaveBeenCalledWith('2026-03-05', '2026-09-01');
  });

  it('with no scan, shows the scale weight, the raw body fat and the uncalibrated note', () => {
    mockScale = {
      data: [row('2026-08-30', 82, null), row('2026-08-31', 82.4, 18.2)],
    };
    renderCard();
    expect(
      screen.getByRole('heading', { name: 'Scan series with noise bands' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /^Weight, 0 point/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /^Body fat \(scale\), 0 point/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Garmin scale body-fat readings are uncalibrated/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/No scans yet/)).toBeInTheDocument();
    // One body fat reading is a dot; two weights are a dashed line.
    expect(dashed()).toHaveLength(2);
    expect(screen.queryByText(/Scale offset to the latest DEXA/)).toBeNull();
  });

  it('with no scan and weight only, shows the weight panel without the body fat note', () => {
    mockScale = { data: [row('2026-08-30', 82, null)] };
    renderCard();
    expect(
      screen.getByRole('img', { name: /^Weight, 0 point/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Body fat/ })).toBeNull();
    expect(screen.queryByText(/uncalibrated/)).toBeNull();
  });

  it('draws nothing while it loads or if it fails', () => {
    mockScale = { isLoading: true };
    const { unmount } = renderCard();
    expect(screen.queryByText('Scan series with noise bands')).toBeNull();
    unmount();
    mockScale = { isError: true };
    renderCard();
    expect(screen.queryByText('Scan series with noise bands')).toBeNull();
    expect(screen.getByText(/No scans yet/)).toBeInTheDocument();
  });

  it('keeps the scan series when the scale cannot be read', () => {
    mockQuery = { data: [later(), scan()] };
    mockScale = { isError: true };
    renderCard();
    expect(
      screen.getByRole('heading', { name: 'Scan series with noise bands' })
    ).toBeInTheDocument();
    expect(dashed()).toHaveLength(0);
    expect(screen.queryByText(/Scale offset to the latest DEXA/)).toBeNull();
  });

  it('with two scans, offsets to the latest and says by how much and when', () => {
    mockQuery = { data: [later(), scan()] };
    mockScale = {
      data: [
        row('2026-11-01', 82, 14.5),
        row('2026-11-02', 82.2, 15),
        row('2026-11-03', 82.1, 15.4),
      ],
    };
    renderCard();
    expect(
      screen.getByText(
        'Scale offset to the latest DEXA: +7.0 points on UK:2026-11-02.'
      )
    ).toBeInTheDocument();
    const compare = screen.getByRole('region', { name: 'Compare two scans' });
    const offset = screen.getByText(/Scale offset to the latest DEXA/);
    expect(
      compare.compareDocumentPosition(offset) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByText(/Dashed: Garmin scale, offset to latest DEXA/)
    ).toBeInTheDocument();
  });

  it('with one scan, draws the weight but no calibrated body fat or offset line', () => {
    mockQuery = { data: [later()] };
    mockScale = {
      data: [row('2026-11-01', 82, 14.5), row('2026-11-02', 82.2, 15)],
    };
    renderCard();
    expect(screen.queryByText(/offset to latest DEXA/)).toBeNull();
    expect(screen.queryByText(/Scale offset/)).toBeNull();
    expect(
      screen.getByText(/Dashed: Garmin scale, cleaned/)
    ).toBeInTheDocument();
  });

  it('says no offset when no scale reading is within a day of the latest scan', () => {
    mockQuery = { data: [later(), scan()] };
    mockScale = {
      data: [row('2026-10-20', 82, 14.5), row('2026-10-21', 82.2, 15)],
    };
    renderCard();
    expect(screen.queryByText(/Scale offset/)).toBeNull();
  });
});
