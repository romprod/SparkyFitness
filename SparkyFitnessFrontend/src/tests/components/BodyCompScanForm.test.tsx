import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import BodyCompScanForm from '@/pages/Labs/BodyCompScanForm';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const mockAdd = jest.fn();
let mockPending = false;
jest.mock('@/hooks/Labs/useBodyCompScans', () => ({
  useAddBodyCompScanMutation: () => ({
    mutateAsync: mockAdd,
    isPending: mockPending,
  }),
}));

const onSaved = jest.fn();
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () =>
  fireEvent.submit(screen.getByRole('form', { name: 'Add a DEXA scan' }));
const fillRequired = () => {
  fill(/^Sex/, 'male');
  fill(/Age \(years\)/, '41');
  fill(/Height \(cm\)/, '180');
  fill(/Fat mass \(g\)/, '20000');
  fill(/Lean mass \(g\)/, '60000');
  fill(/^Bone mineral \(g\)/, '3000');
};

beforeEach(() => {
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

it('starts on today and asks for what the report always prints', async () => {
  render(<BodyCompScanForm onSaved={onSaved} />);
  expect(screen.getByLabelText(/Scan date/)).toHaveValue('2026-11-22');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Age (years) is required.'
  );
  fill(/Age \(years\)/, '41');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Height (cm) is required.'
  );
  expect(mockAdd).not.toHaveBeenCalled();
});

it('wants a sex and numbers that are numbers', async () => {
  render(<BodyCompScanForm onSaved={onSaved} />);
  fill(/Age \(years\)/, '41');
  fill(/Height \(cm\)/, '180');
  fill(/Fat mass \(g\)/, '20000');
  fill(/Lean mass \(g\)/, '60000');
  fill(/^Bone mineral \(g\)/, '3000');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose male or female.'
  );
  fill(/^Sex/, 'male');
  fill(/Fat mass \(g\)/, 'lots');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Fat mass (g) must be a number.'
  );
  expect(mockAdd).not.toHaveBeenCalled();
});

it('saves the figures as printed, leaving what was blank unrecorded', async () => {
  render(<BodyCompScanForm onSaved={onSaved} />);
  fillRequired();
  submit();
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(mockAdd).toHaveBeenCalledWith({
    scanned_day: '2026-11-22',
    device_label: null,
    device_serial: null,
    software_version: null,
    facility: null,
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    clinic_weight_kg: null,
    total_fat_g: 20000,
    total_lean_g: 60000,
    total_bmc_g: 3000,
    total_mass_g: null,
    pct_fat: null,
    vat_mass_g: null,
    vat_volume_cm3: null,
    vat_area_cm2: null,
    total_bmd_gcm2: null,
    prep: {
      fasted: null,
      fasting_hours: null,
      no_caffeine: null,
      no_training_prior_day: null,
      active_travel: null,
      euhydrated_voided: null,
      illness_free_14d: null,
    },
    creatine_status: null,
    carb_pattern_48h: null,
    regions: [],
    notes: null,
  });
});

it('sends the scanner, the printed totals and the whole-body extras it was given', async () => {
  render(<BodyCompScanForm onSaved={onSaved} />);
  fillRequired();
  fill(/Scanner \(make and model\)/, ' Hologic Horizon A ');
  fill(/Scanner serial number/, 'S-1');
  fill(/Analysis software version/, '13.6');
  fill(/^Clinic$/, 'City clinic');
  fill(/Total mass \(g\)/, '83250');
  fill(/Body fat \(%\)/, '24');
  fill(/Visceral fat mass \(g\)/, '812');
  fill(/Bone density/, '1.31');
  submit();
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mockAdd.mock.calls[0]![0]).toMatchObject({
    device_label: 'Hologic Horizon A',
    device_serial: 'S-1',
    software_version: '13.6',
    facility: 'City clinic',
    total_mass_g: 83250,
    pct_fat: 24,
    vat_mass_g: 812,
    total_bmd_gcm2: 1.31,
  });
});

describe('regions', () => {
  it('works each region’s total and percentage out, and skips blank rows', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('Left arm Fat (g)', '1000');
    fill('Left arm Lean (g)', '4000');
    fill('Left arm Bone mineral (g)', '200');
    // Zones print no bone mineral: it is left out of the total.
    fill('Android zone Fat (g)', '2500');
    fill('Android zone Lean (g)', '5000');
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]![0].regions).toEqual([
      {
        region: 'l_arm',
        fat_g: 1000,
        lean_g: 4000,
        bmc_g: 200,
        total_g: 5200,
        pct_fat: 19.2,
      },
      {
        region: 'android',
        fat_g: 2500,
        lean_g: 5000,
        bmc_g: null,
        total_g: 7500,
        pct_fat: 33.3,
      },
    ]);
  });

  it('asks for fat and lean on a region that was started, or for it to be cleared', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('Trunk Fat (g)', '10000');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trunk: enter fat and lean as numbers, or clear the row.'
    );
    fill('Trunk Lean (g)', 'x');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trunk: enter fat and lean'
    );
    fill('Trunk Lean (g)', '0');
    fill('Trunk Fat (g)', '0');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trunk: the region has no mass.'
    );
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('conditions', () => {
  it('keeps what was answered and the hours only when fasted', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('Fasted', 'yes');
    fill('Hours fasted', '12');
    fill('No caffeine', 'no');
    fill('Creatine', 'stable');
    fill('Carbohydrate, last 48 hours', 'loaded');
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]![0]).toMatchObject({
      prep: { fasted: true, fasting_hours: 12, no_caffeine: false },
      creatine_status: 'stable',
      carb_pattern_48h: 'loaded',
    });
  });

  it('drops the hours when fasted is changed to no', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('Fasted', 'yes');
    fill('Hours fasted', '12');
    fill('Fasted', 'no');
    expect(screen.queryByLabelText('Hours fasted')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0]![0].prep).toMatchObject({
      fasted: false,
      fasting_hours: null,
    });
  });
});

describe('what the server would refuse', () => {
  it('shows a reason from the rules before sending: more fat than mass', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill(/Total mass \(g\)/, '15000');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'total fat g: Fat cannot be more than the total mass'
    );
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when the save fails, and stays open', async () => {
    mockAdd.mockRejectedValueOnce(new Error('Could not reach the server'));
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server'
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('disables saving while it is being sent', () => {
    mockPending = true;
    render(<BodyCompScanForm onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Save scan' })).toBeDisabled();
  });
});
