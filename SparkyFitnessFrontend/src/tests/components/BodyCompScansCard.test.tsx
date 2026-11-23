import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BodyCompRegionValues, BodyCompScan } from '@workspace/shared';
import BodyCompScansCard from '@/pages/Labs/BodyCompScansCard';

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
  mockEntriesHook.mockClear();
  mockRemove.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('with no scans', () => {
  it('says so and offers to add one', () => {
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
    expect(screen.getByText('Could not load the scans.')).toBeInTheDocument();
    expect(screen.queryByText(/No scans yet/)).not.toBeInTheDocument();
  });
});

describe('one scan', () => {
  beforeEach(() => {
    mockQuery = { data: [scan()] };
  });

  it('shows the headline figures and the repeat-scan window', () => {
    render(<BodyCompScansCard />);
    expect(screen.getByText('UK:2026-08-10')).toBeInTheDocument();
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
    render(<BodyCompScansCard />);
    const ffm = screen.getByText('Fat-free mass').parentElement!;
    expect(within(ffm).getByText('63.0 kg')).toBeInTheDocument();
    // 63 kg over 1.8 m squared.
    expect(
      within(screen.getByText('FFMI').parentElement!).getByText('19.4')
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('FMI').parentElement!).getByText('6.2')
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Appendicular lean').parentElement!).getByText(
        '29.0 kg'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Visceral fat').parentElement!).getByText('800 g')
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Bone density').parentElement!).getByText(
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
    render(<BodyCompScansCard />);
    expect(screen.getByText('Left arm')).toBeInTheDocument();
    expect(screen.getByText('Trunk')).toBeInTheDocument();
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
    const { unmount } = render(<BodyCompScansCard />);
    expect(screen.queryByText(/adds up to the total/)).not.toBeInTheDocument();
    unmount();
    mockQuery = { data: [scan({ total_fat_g: 21000, pct_fat: 31 })] };
    render(<BodyCompScansCard />);
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
    const { unmount } = render(<BodyCompScansCard />);
    expect(
      screen.getByText(
        'A repeat scan is worth taking now, until UK:2026-11-30.'
      )
    ).toBeInTheDocument();
    unmount();
    jest.setSystemTime(new Date('2026-12-15T10:00:00.000Z'));
    render(<BodyCompScansCard />);
    expect(
      screen.getByText(
        'The usual window for a repeat scan ended on UK:2026-11-30.'
      )
    ).toBeInTheDocument();
  });

  it('deletes after confirming, and says why it could not', async () => {
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
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
    render(<BodyCompScansCard />);
    expect(
      within(compare()).getByText('No doses were logged in this window.')
    ).toBeInTheDocument();
  });

  it('shows nothing about doses while they load or if they cannot be read', () => {
    mockEntries = { isLoading: true };
    const { unmount } = render(<BodyCompScansCard />);
    expect(
      screen.queryByText('Taken between these scans')
    ).not.toBeInTheDocument();
    unmount();
    mockEntries = { isError: true };
    render(<BodyCompScansCard />);
    expect(
      screen.queryByText('Taken between these scans')
    ).not.toBeInTheDocument();
  });

  it('refreshes the choice after a scan is deleted', async () => {
    mockRemove.mockImplementation(
      (_id: string, options: { onSuccess: () => void }) => options.onSuccess()
    );
    render(<BodyCompScansCard />);
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
