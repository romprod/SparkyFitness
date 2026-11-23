import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MetabolicTestForm from '@/pages/Labs/MetabolicTestForm';

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
    timezone: 'Europe/London',
    formatDate: (day: string) => `UK:${day}`,
  }),
}));
let mockScans: {
  scanned_day: string;
  total_lean_g: number;
  total_bmc_g: number;
}[] = [];
jest.mock('@/hooks/Labs/useBodyCompScans', () => ({
  useBodyCompScans: () => ({ data: mockScans }),
}));
const mockAdd = jest.fn();
let mockPending = false;
jest.mock('@/hooks/Labs/useMetabolicTests', () => ({
  useAddMetabolicTestMutation: () => ({
    mutateAsync: mockAdd,
    isPending: mockPending,
  }),
}));

const onSaved = jest.fn();
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () =>
  fireEvent.submit(
    screen.getByRole('form', { name: 'Add a measured RMR test' })
  );
const fillRequired = () => {
  fill(/Measured RMR/, '1950');
  pick(/^Sex/, 'male');
  fill(/Age \(years\)/, '41');
  fill(/Height \(cm\)/, '180');
  fill(/Weight \(kg\)/, '92');
};

beforeEach(() => {
  mockScans = [];
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
  jest.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  mockAdd.mockReset().mockResolvedValue({ id: 'new' });
  onSaved.mockReset();
  mockPending = false;
});
afterEach(() => jest.useRealTimers());

it('starts on today, with the usual kcal per litre for a VO2-only device', () => {
  render(<MetabolicTestForm onSaved={onSaved} />);
  expect(screen.getByLabelText(/Test date/)).toHaveValue('2026-11-22');
  expect(screen.getByLabelText('kcal per litre O2')).toHaveValue('4.81');
  expect(screen.getByLabelText(/^Method/)).toHaveValue('ic_vo2_only');
});

it('refills the kcal per litre when the method returns to VO2 only and the field is empty', () => {
  render(<MetabolicTestForm onSaved={onSaved} />);
  pick(/^Method/, 'ic_vo2_vco2');
  fill('kcal per litre O2', '');
  pick(/^Method/, 'ic_vo2_only');
  expect(screen.getByLabelText('kcal per litre O2')).toHaveValue('4.81');
  // A figure the person typed is kept.
  fill('kcal per litre O2', '4.9');
  pick(/^Method/, 'other');
  pick(/^Method/, 'ic_vo2_only');
  expect(screen.getByLabelText('kcal per litre O2')).toHaveValue('4.9');
});

it('saves the test with what was entered, and leaves the rest not recorded', async () => {
  render(<MetabolicTestForm onSaved={onSaved} />);
  fillRequired();
  fill('Device', 'Analyser');
  submit();
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mockAdd).toHaveBeenCalledWith({
    tested_day: '2026-11-22',
    method: 'ic_vo2_only',
    device_label: 'Analyser',
    facility: null,
    measured_rmr_kcal: 1950,
    kcal_per_litre_o2: 4.81,
    vo2_ml_min: null,
    vco2_ml_min: null,
    rq: null,
    duration_min: null,
    steady_state_cv_pct: null,
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    weight_kg: 92,
    fat_free_mass_kg: null,
    reported_predicted_kcal: null,
    reported_prediction_equation: null,
    reported_activity_factor: null,
    reported_activity_label: null,
    prep: {
      fasted: null,
      fasting_hours: null,
      no_caffeine: null,
      no_training_prior_day: null,
      active_travel: null,
      rested: null,
      rest_min_before_test: null,
      illness_free_14d: null,
      awake_quiet: null,
    },
    room_temp_c: null,
    notes: null,
  });
});

it('sends the clinic’s printed figures and the fat-free mass', async () => {
  render(<MetabolicTestForm onSaved={onSaved} />);
  fillRequired();
  fill(/Fat-free mass/, '70.5');
  fill(/Predicted RMR/, '1900');
  fill('Equation label', 'Mifflin-St Jeor');
  fill('Activity factor', '1.4');
  fill('Activity label', 'Moderate');
  fill('VO2 (mL/min)', '280');
  fill('RQ', '0.82');
  fill('Duration (min)', '15');
  fill('Steady-state CV %', '6.5');
  fill(/Room temperature/, '21.5');
  fill('Notes', 'a note');
  submit();
  await waitFor(() => expect(mockAdd).toHaveBeenCalled());
  expect(mockAdd).toHaveBeenCalledWith(
    expect.objectContaining({
      fat_free_mass_kg: 70.5,
      reported_predicted_kcal: 1900,
      reported_prediction_equation: 'Mifflin-St Jeor',
      reported_activity_factor: 1.4,
      reported_activity_label: 'Moderate',
      vo2_ml_min: 280,
      rq: 0.82,
      duration_min: 15,
      steady_state_cv_pct: 6.5,
      room_temp_c: 21.5,
      notes: 'a note',
    })
  );
});

describe('conditions', () => {
  it('records yes, no and unknown, each as its own answer', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    pick('Fasted', 'yes');
    pick('No caffeine', 'yes');
    pick('No training in the prior 24 hours', 'no');
    submit();
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]?.[0].prep).toMatchObject({
      fasted: true,
      no_caffeine: true,
      no_training_prior_day: false,
      active_travel: null,
      illness_free_14d: null,
    });
  });

  it('asks for the hours fasted and the minutes rested only after a yes, and sends them then', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    expect(screen.queryByLabelText('Hours fasted')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minutes rested')).not.toBeInTheDocument();
    fillRequired();
    pick('Fasted', 'yes');
    fill('Hours fasted', '12');
    pick(/^Rested/, 'yes');
    fill('Minutes rested', '20');
    submit();
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]?.[0].prep).toMatchObject({
      fasted: true,
      fasting_hours: 12,
      rested: true,
      rest_min_before_test: 20,
    });
  });

  it('drops the hours fasted if the answer is changed away from yes', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    pick('Fasted', 'yes');
    fill('Hours fasted', '12');
    pick('Fasted', 'no');
    submit();
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]?.[0].prep).toMatchObject({
      fasted: false,
      fasting_hours: null,
    });
  });
});

describe('what is refused', () => {
  const refused = async (message: RegExp | string) => {
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  };

  it('needs a sex to be chosen, not assumed', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    pick(/^Sex/, '');
    submit();
    await refused('Choose male or female.');
  });

  it('names a field that is not a number', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    fill(/Height \(cm\)/, 'tall');
    submit();
    await refused('Height (cm) must be a number.');
  });

  it('refuses a missing measurement', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    fill(/Measured RMR/, '');
    submit();
    await refused('Measured RMR (kcal/day) is required.');
  });

  it('refuses a fat-free mass above the body weight', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    fill(/Fat-free mass/, '100');
    submit();
    await refused(/Fat-free mass cannot be more than the body weight/);
  });

  it('refuses a height that cannot be right', async () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    fillRequired();
    fill(/Height \(cm\)/, '18');
    submit();
    await refused(/height cm/);
  });
});

it('shows why a save failed and keeps what was entered', async () => {
  mockAdd.mockRejectedValue(new Error('The server said no'));
  render(<MetabolicTestForm onSaved={onSaved} />);
  fillRequired();
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server said no'
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Measured RMR/)).toHaveValue('1950');
});

it('disables saving while a save is under way', () => {
  mockPending = true;
  render(<MetabolicTestForm onSaved={onSaved} />);
  expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
});

describe('fat-free mass from a scan', () => {
  it('offers the fat-free mass of the scan closest to the test day, and fills it in', () => {
    mockScans = [
      { scanned_day: '2026-01-05', total_lean_g: 50000, total_bmc_g: 2500 },
      { scanned_day: '2026-11-02', total_lean_g: 60000, total_bmc_g: 3000 },
    ];
    render(<MetabolicTestForm onSaved={onSaved} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use the fat-free mass from the UK:2026-11-02 scan (63.0 kg)',
      })
    );
    expect(screen.getByLabelText(/Fat-free mass/)).toHaveValue('63');
  });

  it('follows the test date when it is changed', () => {
    mockScans = [
      { scanned_day: '2026-01-05', total_lean_g: 50000, total_bmc_g: 2500 },
      { scanned_day: '2026-11-02', total_lean_g: 60000, total_bmc_g: 3000 },
    ];
    render(<MetabolicTestForm onSaved={onSaved} />);
    fill(/Test date/, '2026-01-20');
    expect(
      screen.getByRole('button', {
        name: 'Use the fat-free mass from the UK:2026-01-05 scan (52.5 kg)',
      })
    ).toBeInTheDocument();
  });

  it('offers nothing without a scan', () => {
    render(<MetabolicTestForm onSaved={onSaved} />);
    expect(
      screen.queryByRole('button', { name: /Use the fat-free mass/ })
    ).not.toBeInTheDocument();
  });
});
