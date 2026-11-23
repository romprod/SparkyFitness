import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MetabolicTest } from '@workspace/shared';
import MetabolicTestsCard from '@/pages/Labs/MetabolicTestsCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
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
jest.mock('@/pages/Labs/MetabolicTestForm', () => ({
  __esModule: true,
  default: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>mock form</button>
  ),
}));
let mockQuery: {
  data?: MetabolicTest[];
  isError?: boolean;
  isLoading?: boolean;
} = {};
const mockRemove = jest.fn();
jest.mock('@/hooks/Labs/useMetabolicTests', () => ({
  useMetabolicTests: () => mockQuery,
  useDeleteMetabolicTestMutation: () => ({ mutate: mockRemove }),
}));

const unknownPrep = {
  fasted: null,
  fasting_hours: null,
  no_caffeine: null,
  no_training_prior_day: null,
  active_travel: null,
  rested: null,
  rest_min_before_test: null,
  illness_free_14d: null,
  awake_quiet: null,
};
const test = (patch: Partial<MetabolicTest> = {}): MetabolicTest => ({
  id: '00000000-0000-4000-a000-0000000000a1',
  tested_day: '2026-10-05',
  method: 'ic_vo2_only',
  device_label: 'VO2-only analyser',
  facility: 'City clinic',
  measured_rmr_kcal: 2000,
  kcal_per_litre_o2: 4.81,
  vo2_ml_min: null,
  vco2_ml_min: null,
  rq: null,
  duration_min: 15,
  steady_state_cv_pct: 6.5,
  sex: 'male',
  age_years: 40,
  height_cm: 180,
  weight_kg: 90,
  fat_free_mass_kg: null,
  reported_predicted_kcal: 1900,
  reported_prediction_equation: 'Mifflin-St Jeor',
  reported_activity_factor: 1.4,
  reported_activity_label: 'Moderate',
  prep: unknownPrep,
  room_temp_c: null,
  notes: null,
  ...patch,
});

beforeEach(() => {
  mockQuery = { data: [] };
  mockRemove.mockReset();
});

it('says it is descriptive and shows an empty state with no tests', () => {
  render(<MetabolicTestsCard />);
  expect(
    screen.getByText(/no target or goal is set from it/)
  ).toBeInTheDocument();
  expect(
    screen.getByText('No RMR test recorded. Add one when a clinic measures it.')
  ).toBeInTheDocument();
});

it('opens the entry form and closes it once a test is saved', () => {
  render(<MetabolicTestsCard />);
  expect(screen.queryByText('mock form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Add RMR test/ }));
  expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  fireEvent.click(screen.getByText('mock form'));
  expect(screen.queryByText('mock form')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Add RMR test/ })
  ).toBeInTheDocument();
});

describe('the latest test', () => {
  it('shows the measurement, method, date, device and facility', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    expect(screen.getByText('2000')).toBeInTheDocument();
    expect(
      screen.getByText('Indirect calorimetry · VO2 only')
    ).toBeInTheDocument();
    expect(
      screen.getByText('UK:2026-10-05 · VO2-only analyser · City clinic')
    ).toBeInTheDocument();
  });

  it('shows the noise band, the oxygen use the device assumed and the steady state', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    // 2.77 x 8 per cent of 2000 kcal.
    expect(screen.getByText('± 443 kcal (LSC)')).toBeInTheDocument();
    expect(screen.getByText('289 mL/min · 0.92 MET')).toBeInTheDocument();
    expect(screen.getByText('15 min · CV 6.5 %')).toBeInTheDocument();
  });

  it('flags test conditions that are not recorded', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    expect(
      screen.getByText('test conditions not recorded')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/fasted unknown, no caffeine unknown/)
    ).toBeInTheDocument();
  });

  it('does not flag it when every condition is answered, and words the answers', () => {
    mockQuery = {
      data: [
        test({
          prep: {
            fasted: true,
            fasting_hours: 12,
            no_caffeine: true,
            no_training_prior_day: false,
            active_travel: false,
            rested: true,
            rest_min_before_test: 20,
            illness_free_14d: true,
            awake_quiet: true,
          },
        }),
      ],
    };
    render(<MetabolicTestsCard />);
    expect(
      screen.queryByText('test conditions not recorded')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /fasted yes \(12 h\), no caffeine yes, no training the prior day no, active travel no, rested 20 min, awake and still yes, illness-free for 14 days yes\./
      )
    ).toBeInTheDocument();
  });

  it('lists the eight equations with Mifflin-St Jeor as the reference when no fat-free mass is known', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent('Mifflin-St Jeor (1990)');
    expect(rows[0]).toHaveTextContent('reference');
    // 10 x 90 + 6.25 x 180 - 5 x 40 + 5 = 1830; 2000 / 1830 = 1.09.
    expect(rows[0]).toHaveTextContent('1830');
    expect(rows[0]).toHaveTextContent('1.09');
    const cunningham = rows.find((r) =>
      r.textContent?.includes('Cunningham 1980')
    )!;
    expect(within(cunningham).getAllByText('—')).toHaveLength(2);
    expect(
      screen.getByText(
        /No fat-free mass entered: the equations that need it are not shown\./
      )
    ).toBeInTheDocument();
  });

  it('puts the scan-matched equation first, and fills the fat-free-mass rows, when a mass was entered', () => {
    mockQuery = { data: [test({ fat_free_mass_kg: 70 })] };
    render(<MetabolicTestsCard />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Tinsley 2019 (FFM)');
    expect(rows[0]).toHaveTextContent('reference');
    expect(rows[0]).toHaveTextContent('2097');
    expect(rows[0]).toHaveTextContent('0.95');
    expect(screen.getByText('28.6 kcal/kg')).toBeInTheDocument();
    expect(
      screen.getByText(/Fat-free mass 70 kg, as entered\./)
    ).toBeInTheDocument();
  });

  it('shows the per-kilogram figure for the body mass that was fed to the clinic', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    expect(
      screen.getByText('per kg body mass (test-day weight 90.0 kg)')
    ).toBeInTheDocument();
    expect(screen.getByText('22.2 kcal/kg')).toBeInTheDocument();
  });

  it('shows the clinic’s own figures as printed, and the activity arithmetic as no target', () => {
    mockQuery = { data: [test()] };
    render(<MetabolicTestsCard />);
    expect(
      screen.getByText(
        'Clinic-printed prediction: 1900 kcal (Mifflin-St Jeor).'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /2000 × 1.4 Moderate = 2800 kcal: arithmetic on the clinic’s activity-factor assumption, not a target\./
      )
    ).toBeInTheDocument();
  });

  it('leaves out what the clinic did not print', () => {
    mockQuery = {
      data: [
        test({
          reported_predicted_kcal: null,
          reported_activity_factor: null,
          kcal_per_litre_o2: null,
          steady_state_cv_pct: null,
          duration_min: null,
        }),
      ],
    };
    render(<MetabolicTestsCard />);
    expect(
      screen.queryByText(/Clinic-printed prediction/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/arithmetic on the clinic/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/MET/)).not.toBeInTheDocument();
  });
});

describe('several tests', () => {
  const older = test({
    id: '00000000-0000-4000-a000-0000000000a0',
    tested_day: '2026-06-01',
    measured_rmr_kcal: 2150,
  });
  const newer = test({ measured_rmr_kcal: 1980 });

  it('shows the newest above and lists every test, newest first', () => {
    mockQuery = { data: [newer, older] };
    render(<MetabolicTestsCard />);
    expect(screen.getByText('All RMR tests')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1980 kcal/d');
    expect(items[0]).toHaveTextContent('shown above');
    expect(items[1]).toHaveTextContent('UK:2026-06-01');
    expect(items[1]).toHaveTextContent('2150 kcal/d');
    expect(items[1]).not.toHaveTextContent('shown above');
  });

  it('asks before deleting a test, and deletes it only when confirmed', async () => {
    mockQuery = { data: [newer, older] };
    render(<MetabolicTestsCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete RMR test UK:2026-06-01' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Delete this RMR test?')
    ).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(mockRemove).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete RMR test UK:2026-06-01' })
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete',
      })
    );
    expect(mockRemove).toHaveBeenCalledWith(
      '00000000-0000-4000-a000-0000000000a0',
      expect.objectContaining({ onError: expect.any(Function) })
    );
  });

  it('offers to delete a single test too', async () => {
    mockQuery = { data: [newer] };
    render(<MetabolicTestsCard />);
    expect(screen.queryByText('All RMR tests')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete RMR test UK:2026-10-05' })
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

it('says so while loading and when the tests cannot be loaded', () => {
  mockQuery = { isLoading: true };
  const { rerender } = render(<MetabolicTestsCard />);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  mockQuery = { isError: true };
  rerender(<MetabolicTestsCard />);
  expect(screen.getByText('Could not load the RMR tests.')).toBeInTheDocument();
});
