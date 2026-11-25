import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HttpApiError } from '@/api/api';
import type { BodyCompReportReadResponse } from '@workspace/shared';
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
const mockRead = jest.fn();
const mockUpload = jest.fn();
let mockPending = false;
let mockReading = false;
jest.mock('@/hooks/Labs/useBodyCompScans', () => ({
  useAddBodyCompScanMutation: () => ({
    mutateAsync: mockAdd,
    isPending: mockPending,
  }),
  useReadBodyCompReportMutation: () => ({
    mutateAsync: mockRead,
    isPending: mockReading,
  }),
}));
jest.mock('@/hooks/Labs/useHealthDocuments', () => ({
  useUploadHealthDocumentMutation: () => ({
    mutateAsync: mockUpload,
    isPending: false,
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
  mockRead.mockReset();
  mockUpload.mockReset().mockResolvedValue({ id: 'doc' });
  onSaved.mockReset();
  mockPending = false;
  mockReading = false;
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
    scan_mode: null,
    reference_population: null,
    bmd_t_score: null,
    bmd_z_score: null,
    bmd_cv_pct: null,
    pct_fat_yn: null,
    pct_fat_am: null,
    fmi_yn: null,
    fmi_am: null,
    lmi_yn: null,
    lmi_am: null,
    almi_yn: null,
    almi_am: null,
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

describe('report fields', () => {
  it('sends the scan mode, reference, scores and percentiles, and a region’s own percentiles and bone density', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('Scan mode', 'Whole Body');
    fill('Reference population', 'NHANES Male');
    fill('T-score', '-0.4');
    fill('Z-score', '0.1');
    fill('Site CV %', '1');
    fill('% fat YN percentile', '50');
    fill('% fat AM percentile', '40');
    fill('FMI YN percentile', '45');
    fill('ALMI AM percentile', '58');
    fill('Left arm Fat (g)', '1000');
    fill('Left arm Lean (g)', '4000');
    fill('Left arm % fat YN percentile', '55');
    fill('Left arm BMD (g/cm²)', '0.8');
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = mockAdd.mock.calls[0]![0];
    expect(sent).toMatchObject({
      scan_mode: 'Whole Body',
      reference_population: 'NHANES Male',
      bmd_t_score: -0.4,
      bmd_z_score: 0.1,
      bmd_cv_pct: 1,
      pct_fat_yn: 50,
      pct_fat_am: 40,
      fmi_yn: 45,
      fmi_am: null,
      almi_am: 58,
    });
    expect(sent.regions[0]).toMatchObject({
      region: 'l_arm',
      pct_fat_yn: 55,
      bmd_gcm2: 0.8,
    });
    expect(sent.regions[0]).not.toHaveProperty('pct_fat_am');
  });

  it('asks for a number in a percentile or score', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    fillRequired();
    fill('T-score', 'low');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'T-score must be a number.'
    );
    fill('T-score', '');
    fill('Left arm Fat (g)', '1000');
    fill('Left arm Lean (g)', '4000');
    fill('Left arm BMD (g/cm²)', 'x');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Left arm: enter fat and lean as numbers, or clear the row.'
    );
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('reading a Hologic report', () => {
  const reportFile = () =>
    new File(['%PDF-1.7 report'], 'dexa.pdf', { type: 'application/pdf' });
  const report = (
    patch: Partial<BodyCompReportReadResponse> = {}
  ): BodyCompReportReadResponse => ({
    ok: true,
    confidence: 1,
    checks: [
      { name: 'fat_sum', pass: true, detail: 'regions 1.0 vs total 1.0' },
    ],
    missing: [],
    prefill: {
      scanned_day: '2026-01-10',
      device_label: 'Hologic Horizon A',
      device_serial: 'TEST1',
      software_version: '13.6',
      scan_mode: 'Whole Body',
      reference_population: 'NHANES-Example Example Male',
      sex: 'male',
      age_years: 40,
      height_cm: 178,
      clinic_weight_kg: 82,
      total_fat_g: 16400,
      total_lean_g: 61800,
      total_bmc_g: 2800,
      total_mass_g: 81000,
      pct_fat: 20.2,
      pct_fat_yn: 50,
      pct_fat_am: 40,
      total_bmd_gcm2: 1.2,
      bmd_t_score: 0.1,
      bmd_z_score: 0.1,
      bmd_cv_pct: 1,
      fmi_yn: 45,
      almi_am: 58,
      regions: [
        {
          region: 'l_arm',
          fat_g: 1000,
          lean_g: 3500,
          bmc_g: 200,
          total_g: 4700,
          pct_fat: 21.3,
          pct_fat_yn: 55,
          pct_fat_am: 45,
          bmd_gcm2: 0.8,
        },
        {
          region: 'android',
          fat_g: 1200,
          lean_g: 4800,
          total_g: 6000,
          pct_fat: 20,
        },
      ],
    },
    ...patch,
  });
  const choose = (file: File) =>
    fireEvent.change(
      screen.getByLabelText(/Hologic report \(PDF, up to 10 MB\)/),
      { target: { files: [file] } }
    );

  it('says what the file is for and that nothing is saved until confirmed', () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    expect(screen.getByText('Read a Hologic report (PDF)')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Values are read from its text layer and shown here for review; nothing is saved until you confirm.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Hologic report/)).toHaveAttribute(
      'accept',
      'application/pdf,.pdf'
    );
    expect(
      screen.queryByLabelText('Keep the report PDF with this scan')
    ).not.toBeInTheDocument();
  });

  it('fills the form for review, shows the confidence, and keeps every field editable', async () => {
    mockRead.mockResolvedValue(report());
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    expect(
      await screen.findByText(/Read · 100 % confidence/)
    ).toBeInTheDocument();
    expect(mockRead).toHaveBeenCalledTimes(1);
    // base64 of the PDF bytes, not a data URL.
    expect(mockRead.mock.calls[0]![0]).toBe(btoa('%PDF-1.7 report'));
    expect(screen.getByLabelText(/Scan date/)).toHaveValue('2026-01-10');
    expect(screen.getByLabelText(/^Sex/)).toHaveValue('male');
    expect(screen.getByLabelText(/Age \(years\)/)).toHaveValue('40');
    expect(screen.getByLabelText(/Fat mass \(g\)/)).toHaveValue('16400');
    expect(screen.getByLabelText(/Scanner \(make and model\)/)).toHaveValue(
      'Hologic Horizon A'
    );
    expect(screen.getByLabelText('Scan mode')).toHaveValue('Whole Body');
    expect(screen.getByLabelText('T-score')).toHaveValue('0.1');
    expect(screen.getByLabelText('ALMI AM percentile')).toHaveValue('58');
    expect(screen.getByLabelText('Left arm % fat AM percentile')).toHaveValue(
      '45'
    );
    expect(screen.getByLabelText('Left arm BMD (g/cm²)')).toHaveValue('0.8');
    expect(screen.getByLabelText('Android zone Fat (g)')).toHaveValue('1200');
    expect(screen.getByLabelText('Trunk Fat (g)')).toHaveValue('');
    expect(
      screen.getByLabelText('Keep the report PDF with this scan')
    ).toBeChecked();
    expect(screen.queryByText('Checks that did not match')).toBeNull();

    // Edit one, and save: nothing was saved by the read.
    expect(mockAdd).not.toHaveBeenCalled();
    fill(/Age \(years\)/, '41');
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0]![0]).toMatchObject({
      scanned_day: '2026-01-10',
      device_label: 'Hologic Horizon A',
      age_years: 41,
      total_fat_g: 16400,
      total_mass_g: 81000,
      scan_mode: 'Whole Body',
      bmd_t_score: 0.1,
      pct_fat_yn: 50,
      almi_am: 58,
    });
    expect(mockAdd.mock.calls[0]![0].regions).toHaveLength(2);
    // The original is stored, tied to the saved scan, as a DEXA report.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const upload = mockUpload.mock.calls[0]![0];
    expect(upload.file.name).toBe('dexa.pdf');
    expect(upload.fields).toEqual({
      kind: 'dexa_report',
      document_day: '2026-01-10',
      body_comp_scan_id: 'new',
    });
  });

  it('lists the checks that failed with their detail, and what was not found', async () => {
    mockRead.mockResolvedValue(
      report({
        ok: false,
        confidence: 0.82,
        checks: [
          { name: 'fat_sum', pass: true, detail: 'fine' },
          {
            name: 'lean_sum',
            pass: false,
            detail: 'regions 61900.0 vs total 61800.0',
          },
        ],
        missing: ['bmd:Total BMD CV', 'percentile:Gynoid'],
      })
    );
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    expect(
      await screen.findByText(/Read · 82 % confidence/)
    ).toBeInTheDocument();
    expect(screen.getByText('Checks that did not match')).toBeInTheDocument();
    expect(
      screen.getByText('lean_sum: regions 61900.0 vs total 61800.0')
    ).toBeInTheDocument();
    expect(screen.queryByText(/^fat_sum/)).toBeNull();
    expect(
      screen.getByText(/bmd:Total BMD CV, percentile:Gynoid/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Fat mass \(g\)/)).toHaveValue('16400');
  });

  it('does not store the PDF when the box is unticked', async () => {
    mockRead.mockResolvedValue(report());
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    fireEvent.click(
      await screen.findByLabelText('Keep the report PDF with this scan')
    );
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['no_text_layer', /no text to read/],
    ['not_hologic', /does not look like a Hologic whole-body report/],
    ['unreadable', /could not be opened/],
    ['too_many_pages', /too many pages/],
  ])(
    'says in plain words why a %s report could not be read, and leaves the form as it was',
    async (code, words) => {
      mockRead.mockRejectedValue(new HttpApiError('server words', 422, code));
      render(<BodyCompScanForm onSaved={onSaved} />);
      fill(/Age \(years\)/, '55');
      fill('Scan mode', 'Typed');
      choose(reportFile());
      expect(await screen.findByRole('alert')).toHaveTextContent(words);
      expect(screen.getByLabelText(/Age \(years\)/)).toHaveValue('55');
      expect(screen.getByLabelText('Scan mode')).toHaveValue('Typed');
      expect(screen.getByLabelText(/Scan date/)).toHaveValue('2026-11-22');
      expect(screen.queryByText(/confidence/)).toBeNull();
      expect(
        screen.queryByLabelText('Keep the report PDF with this scan')
      ).toBeNull();
      expect(mockAdd).not.toHaveBeenCalled();
    }
  );

  it('shows the server’s reason for any other failure', async () => {
    mockRead.mockRejectedValue(new Error('Could not reach the server'));
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The report could not be read: Could not reach the server'
    );
  });

  it('refuses a file over 10 MB or that is not a PDF without sending it', async () => {
    render(<BodyCompScanForm onSaved={onSaved} />);
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    choose(big);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file is larger than 10 MB.'
    );
    choose(new File(['x'], 'photo.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a PDF file.'
    );
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('says the scan is saved when its PDF could not be stored, and does not save twice', async () => {
    mockRead.mockResolvedValue(report());
    mockUpload.mockRejectedValueOnce(new Error('Storage is full'));
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    await screen.findByText(/Read · 100 % confidence/);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scan saved. The report PDF was not stored: Storage is full'
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save scan' })).toBeDisabled();

    // Trying again stores it against the scan already saved, then finishes.
    fireEvent.click(
      screen.getByRole('button', { name: 'Try storing it again' })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls[1]![0].fields.body_comp_scan_id).toBe('new');
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('lets the person carry on without the PDF after a failed store', async () => {
    mockRead.mockResolvedValue(report());
    mockUpload.mockRejectedValue(new Error('Storage is full'));
    render(<BodyCompScanForm onSaved={onSaved} />);
    choose(reportFile());
    await screen.findByText(/Read · 100 % confidence/);
    submit();
    await screen.findByText(/Scan saved\. The report PDF was not stored/);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('shows that the report is being read', () => {
    mockReading = true;
    render(<BodyCompScanForm onSaved={onSaved} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading the report…');
    expect(screen.getByLabelText(/Hologic report/)).toBeDisabled();
  });
});
