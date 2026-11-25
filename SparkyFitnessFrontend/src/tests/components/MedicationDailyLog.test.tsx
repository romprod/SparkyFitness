import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  SYMPTOM_SCALE_TYPES,
  buildSymptomChoices,
  severityBand,
  todayInZone,
  type SymptomDefinitionResponse,
} from '@workspace/shared';
import MedicationDailyLog from '@/pages/Medications/MedicationDailyLog';
import {
  SEVERITY_LABELS,
  buildDailyLogSummary,
  buildSideEffectBody,
  checkWater,
  checkWeight,
  customSymptomChoice,
  moodRatingToValue,
  moodValueToRating,
  planMoodSave,
  severityLabelForValue,
  severityValueForLabel,
  sideEffectChoices,
  summarizeSleep,
  weightToInputText,
} from '@/pages/Medications/medicationDailyLogHelpers';
import type { MoodEntry } from '@/types/mood';
import type { SleepEntry } from '@/types';

const TZ = 'Europe/London';
const TODAY = todayInZone(TZ);
const PAST = '2020-01-10';
const FUTURE = '2999-01-01';

// --- Mutable fixtures the module mocks read --------------------------------
let mockWeightKg: number | null = null;
let mockMoodEntries: MoodEntry[] = [];
let mockSleep: Partial<SleepEntry>[] = [];
let mockTotals = { calories: 0, protein: 0 };
let mockWaterMl = 0;
let mockGoalMl = 2500;
let mockSymptomEntries: Record<string, unknown>[] = [];
let mockDefinitions: SymptomDefinitionResponse[] = [];
let mockWeightUnit = 'kg';

const mockSaveCheckIn = jest.fn();
const mockCreateMood = jest.fn();
const mockUpdateMood = jest.fn();
const mockDeleteMood = jest.fn();
const mockLogWater = jest.fn();
const mockCreateDefinition = jest.fn();
const mockCreateSymptom = jest.fn();

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: 'user-1',
    hasWritePermission: () => true,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    weightUnit: mockWeightUnit,
  }),
}));
jest.mock('@/hooks/CheckIn/useCheckIn', () => ({
  useCheckInMeasurementsForDate: () => ({
    data: mockWeightKg === null ? null : { weight: mockWeightKg },
    isLoading: false,
  }),
  useSaveCheckInMeasurementsMutation: () => ({ mutateAsync: mockSaveCheckIn }),
}));
jest.mock('@/hooks/CheckIn/useMood', () => ({
  useMoodCheckinsByDate: () => ({ data: mockMoodEntries, isLoading: false }),
  useCreateMoodCheckinMutation: () => ({ mutateAsync: mockCreateMood }),
  useUpdateMoodCheckinMutation: () => ({ mutateAsync: mockUpdateMood }),
  useDeleteMoodCheckinMutation: () => ({ mutateAsync: mockDeleteMood }),
}));
jest.mock('@/hooks/CheckIn/useSleep', () => ({
  useSleepEntriesQuery: () => ({ data: mockSleep }),
}));
jest.mock('@/hooks/Diary/useDailyProgress', () => ({
  useDailySummary: () => ({ data: { supplementTotals: {} } }),
}));
jest.mock('@/hooks/Diary/useFoodEntries', () => ({
  useFoodEntries: () => ({ data: [] }),
  useFoodEntryMeals: () => ({ data: [] }),
}));
jest.mock('@/utils/nutritionCalculations', () => ({
  calculateDayTotals: () => mockTotals,
  addSupplementTotals: (totals: unknown) => totals,
}));
jest.mock('@/hooks/Diary/useWaterIntake', () => ({
  useWaterIntakeQuery: () => ({ data: mockWaterMl }),
  useWaterGoalQuery: () => ({ data: mockGoalMl }),
  useLogWaterAmountMutation: () => ({ mutateAsync: mockLogWater }),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: mockSymptomEntries, isLoading: false }),
  useCustomSymptoms: () => ({ data: mockDefinitions }),
  useCreateCustomSymptomMutation: () => ({
    mutateAsync: mockCreateDefinition,
  }),
  useCreateSymptomEntryMutation: () => ({ mutateAsync: mockCreateSymptom }),
}));

const moodEntry = (patch: Partial<MoodEntry> = {}): MoodEntry => ({
  id: 'mood-1',
  user_id: 'user-1',
  mood_value: 70,
  mood_tags: [],
  notes: null,
  energy_value: 4,
  focus_value: null,
  entry_date: PAST,
  entry_timestamp: `${PAST}T12:00:00.000Z`,
  source: 'manual',
  created_at: '',
  updated_at: '',
  ...patch,
});

const definition = (
  patch: Partial<SymptomDefinitionResponse>
): SymptomDefinitionResponse => ({
  id: 'def-1',
  user_id: 'user-1',
  name: 'nausea',
  display_name: 'Nausea',
  scale_type: '1-10',
  unit: null,
  is_glp1_flagged: true,
  category: 'gi',
  template: 'gi',
  sections: {},
  custom_field_defs: [],
  is_episodic: false,
  color: null,
  icon: null,
  is_pinned: false,
  sort_order: 0,
  is_archived: false,
  created_at: '',
  updated_at: '',
  ...patch,
});

const renderLog = (date = PAST, title?: string | null) =>
  render(
    <MemoryRouter>
      <MedicationDailyLog date={date} title={title} />
    </MemoryRouter>
  );

const group = (name: string) => screen.getByRole('group', { name });
const openForm = (label = 'Add log') =>
  fireEvent.click(screen.getByRole('button', { name: label }));
const save = async (label = 'Save log') => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
};

beforeEach(() => {
  mockWeightKg = null;
  mockMoodEntries = [];
  mockSleep = [];
  mockTotals = { calories: 0, protein: 0 };
  mockWaterMl = 0;
  mockGoalMl = 2500;
  mockSymptomEntries = [];
  mockDefinitions = [];
  mockWeightUnit = 'kg';
  jest.clearAllMocks();
  mockSaveCheckIn.mockResolvedValue(undefined);
  mockCreateMood.mockResolvedValue(moodEntry());
  mockUpdateMood.mockResolvedValue(moodEntry());
  mockDeleteMood.mockResolvedValue(undefined);
  mockLogWater.mockResolvedValue(undefined);
  mockCreateDefinition.mockResolvedValue({ id: 'def-new' });
  mockCreateSymptom.mockResolvedValue({ id: 'entry-new' });
});

describe('daily log helpers', () => {
  it('maps mood 1-5 to the stored grid and back', () => {
    expect([1, 2, 3, 4, 5].map(moodRatingToValue)).toEqual([
      10, 30, 50, 70, 90,
    ]);
    for (const rating of [1, 2, 3, 4, 5])
      expect(moodValueToRating(moodRatingToValue(rating))).toBe(rating);
  });

  it('rounds other stored values to the nearest rating, clamped to 1-5', () => {
    expect(moodValueToRating(100)).toBe(5);
    expect(moodValueToRating(10)).toBe(1);
    expect(moodValueToRating(0)).toBe(1);
    expect(moodValueToRating(55)).toBe(3);
    expect(moodValueToRating(65)).toBe(4);
    expect(moodValueToRating(null)).toBeNull();
    expect(moodValueToRating('50')).toBe(3);
  });

  it('stores a severity on every scale that reads back as the same label', () => {
    for (const scale of SYMPTOM_SCALE_TYPES) {
      for (const label of SEVERITY_LABELS) {
        const value = severityValueForLabel(label, scale);
        if (scale === 'count' || scale === 'text') {
          expect(value).toBeNull();
          continue;
        }
        const band = { Mild: 'low', Moderate: 'mid', Severe: 'high' }[label];
        expect(severityBand(value as number, scale)).toBe(band);
        expect(severityLabelForValue(value, scale)).toBe(label);
      }
    }
  });

  it('builds a symptom body with the chosen label and severity, or none', () => {
    const choice = customSymptomChoice('Hiccups');
    const body = buildSideEffectBody({
      choice,
      symptomId: 'def-9',
      label: 'Severe',
      day: PAST,
      today: TODAY,
    });
    expect(body).toMatchObject({
      symptom_id: 'def-9',
      symptom_name_snapshot: 'Hiccups',
      severity: 8,
      severity_label: 'Severe',
      entry_date: PAST,
    });
    const bare = buildSideEffectBody({
      choice,
      symptomId: 'def-9',
      label: null,
      day: PAST,
      today: TODAY,
    });
    expect(bare.severity).toBeNull();
    expect(bare.severity_label).toBeNull();
    const counted = buildSideEffectBody({
      choice: { ...choice, scaleType: 'count' },
      symptomId: 'def-9',
      label: 'Mild',
      day: PAST,
      today: TODAY,
    });
    expect(counted.severity).toBeNull();
    expect(counted.severity_label).toBe('Mild');
  });

  it('offers pinned and GLP-1 symptoms, pinned first then by name', () => {
    const all = buildSymptomChoices([
      definition({
        id: 'd-1',
        name: 'zzz_custom',
        display_name: 'Zzz custom',
        is_pinned: true,
        is_glp1_flagged: false,
      }),
    ]);
    const chips = sideEffectChoices(all);
    expect(chips[0]?.name).toBe('zzz_custom');
    expect(chips.every((c) => c.isGlp1 || c.isPinned)).toBe(true);
    const rest = chips.slice(1).map((c) => c.displayName);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('validates weight: blank and unchanged are left alone, bad input is invalid', () => {
    expect(checkWeight('', 80, 'kg')).toEqual({ status: 'unchanged' });
    expect(checkWeight('  ', null, 'kg')).toEqual({ status: 'unchanged' });
    expect(checkWeight('80', 80, 'kg')).toEqual({ status: 'unchanged' });
    expect(checkWeight('80.0', 80, 'kg')).toEqual({ status: 'unchanged' });
    for (const bad of ['abc', '0', '-5', '1e3', '12,5', '8 0'])
      expect(checkWeight(bad, 80, 'kg')).toEqual({ status: 'invalid' });
    expect(checkWeight('81.25', 80, 'kg')).toEqual({
      status: 'save',
      kg: 81.25,
    });
  });

  it('converts pounds to and from stored kilograms', () => {
    expect(weightToInputText(80.5, 'kg')).toBe('80.5');
    expect(weightToInputText(80, 'lbs')).toBe('176.4');
    expect(checkWeight('176.4', 80, 'lbs')).toEqual({ status: 'unchanged' });
    const change = checkWeight('180', 80, 'lbs');
    expect(change.status).toBe('save');
    expect((change as { kg: number }).kg).toBeCloseTo(81.65, 2);
  });

  it('validates water as a positive whole number of mL', () => {
    expect(checkWater('')).toEqual({ status: 'none' });
    expect(checkWater('500')).toEqual({ status: 'add', ml: 500 });
    expect(checkWater(' 300 ')).toEqual({ status: 'add', ml: 300 });
    expect(checkWater('10000')).toEqual({ status: 'add', ml: 10000 });
    for (const bad of ['0', '-250', '12.5', 'abc', '1e3', '10001'])
      expect(checkWater(bad)).toEqual({ status: 'invalid' });
  });

  it('plans the mood entry: create, update only what changed, delete when empty', () => {
    const base = { day: PAST, timezone: TZ };
    expect(
      planMoodSave({
        ...base,
        entry: null,
        rating: null,
        energy: null,
        notes: ' ',
      })
    ).toEqual({ action: 'none' });
    const create = planMoodSave({
      ...base,
      entry: null,
      rating: 4,
      energy: 2,
      notes: ' hi ',
    });
    expect(create).toMatchObject({
      action: 'create',
      body: {
        mood_value: 70,
        energy_value: 2,
        notes: 'hi',
        entry_date: PAST,
      },
    });
    const entry = moodEntry({ mood_value: 65, notes: 'old' });
    expect(
      planMoodSave({ ...base, entry, rating: 4, energy: 4, notes: 'old' })
    ).toEqual({ action: 'none' });
    expect(
      planMoodSave({ ...base, entry, rating: 4, energy: 5, notes: 'old' })
    ).toEqual({ action: 'update', id: 'mood-1', body: { energy_value: 5 } });
    expect(
      planMoodSave({ ...base, entry, rating: null, energy: null, notes: '' })
    ).toEqual({ action: 'delete', id: 'mood-1' });
    const tagged = moodEntry({ mood_tags: ['calm'] });
    expect(
      planMoodSave({
        ...base,
        entry: tagged,
        rating: null,
        energy: null,
        notes: '',
      })
    ).toMatchObject({
      action: 'update',
      body: { mood_value: null, energy_value: null },
    });
  });

  it('summarises the night from the main sleep record', () => {
    const night = {
      entry_date: PAST,
      bedtime: `${PAST}T00:00:00Z`,
      wake_time: `${PAST}T07:30:00Z`,
      duration_in_seconds: 27000,
      time_asleep_in_seconds: 26640,
      source: 'garmin',
    } as SleepEntry;
    expect(summarizeSleep([night], PAST)).toEqual({
      hours: 7.4,
      source: 'garmin',
    });
    expect(summarizeSleep([night], '2020-01-11')).toBeNull();
    expect(summarizeSleep([], PAST)).toBeNull();
  });

  it('only counts a day as logged when it has a value', () => {
    const empty = buildDailyLogSummary({
      day: PAST,
      weightKg: null,
      mood: null,
      sleepEntries: [],
      calories: 0,
      proteinG: 0,
      waterMl: 0,
      waterGoalMl: 2500,
      symptoms: [],
    });
    expect(empty.hasValues).toBe(false);
    expect(empty.calories).toBeNull();
  });
});

describe('MedicationDailyLog read view', () => {
  it('shows each recorded value', () => {
    mockWeightKg = 80.5;
    mockMoodEntries = [moodEntry({ notes: 'Felt fine', energy_value: 3 })];
    mockSleep = [
      {
        entry_date: PAST,
        bedtime: `${PAST}T00:00:00Z`,
        wake_time: `${PAST}T07:30:00Z`,
        duration_in_seconds: 27000,
        time_asleep_in_seconds: 26640,
        source: 'garmin',
      },
    ];
    mockTotals = { calories: 2100.4, protein: 149.6 };
    mockWaterMl = 1500;
    mockSymptomEntries = [
      {
        id: 'e1',
        symptom_id: 'def-1',
        symptom_name_snapshot: 'Nausea',
        severity_label: 'Moderate',
      },
    ];
    renderLog();
    expect(screen.getByText('Log')).toBeInTheDocument();
    expect(screen.getByText('80.5 kg')).toBeInTheDocument();
    expect(screen.getByText('4/5')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('Mood')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('7.4 h · Garmin')).toBeInTheDocument();
    expect(screen.getByText('2100 kcal')).toBeInTheDocument();
    expect(screen.getByText('150 g')).toBeInTheDocument();
    expect(screen.getByText('1500 / 2500 mL')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Water' })).toHaveAttribute(
      'aria-valuenow',
      '60'
    );
    expect(screen.getByText('Nausea · Moderate')).toBeInTheDocument();
    expect(screen.getByText('Felt fine')).toBeInTheDocument();
  });

  it('offers Add log on an empty day and Edit log once there is a value', () => {
    const { unmount } = renderLog();
    expect(screen.getByRole('button', { name: 'Add log' })).toBeInTheDocument();
    expect(
      screen.getByText('Nothing logged for this day.')
    ).toBeInTheDocument();
    unmount();
    mockWaterMl = 250;
    renderLog();
    expect(
      screen.getByRole('button', { name: 'Edit log' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add log' })
    ).not.toBeInTheDocument();
  });

  it('has no button for a future day', () => {
    renderLog(FUTURE);
    expect(
      screen.queryByRole('button', { name: /add log|edit log/i })
    ).not.toBeInTheDocument();
  });

  it('allows today', () => {
    renderLog(TODAY);
    expect(screen.getByRole('button', { name: 'Add log' })).toBeInTheDocument();
  });

  it('hides its own heading when the card supplies one', () => {
    renderLog(PAST, null);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('MedicationDailyLog form', () => {
  it('shows read-only sleep, calories and protein with placeholders', () => {
    renderLog();
    openForm();
    expect(screen.getByText('No sleep recorded')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'Open the food diary' })
    ).toHaveAttribute('href', `/?date=${PAST}`);
  });

  it('asks for a value when nothing would be saved', async () => {
    mockWeightKg = 80;
    renderLog();
    openForm('Edit log');
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue('80');
    await save('Save changes');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Log at least one value before saving.'
    );
    expect(mockSaveCheckIn).not.toHaveBeenCalled();
  });

  it('saves weight only when it changed and never clears it', async () => {
    mockWeightKg = 80;
    renderLog();
    openForm('Edit log');
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: '' },
    });
    await save('Save changes');
    expect(mockSaveCheckIn).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: '79.4' },
    });
    await save('Save changes');
    expect(mockSaveCheckIn).toHaveBeenCalledTimes(1);
    expect(mockSaveCheckIn).toHaveBeenCalledWith({
      entry_date: PAST,
      weight: 79.4,
    });
    expect(mockCreateMood).not.toHaveBeenCalled();
    expect(mockLogWater).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Edit log' })
    ).toBeInTheDocument();
  });

  it('rejects a bad weight and a bad water amount', async () => {
    renderLog();
    openForm();
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: '-3' },
    });
    fireEvent.change(screen.getByLabelText('Add water (mL)'), {
      target: { value: '12.5' },
    });
    await save();
    expect(screen.getByText('Enter a valid weight.')).toBeInTheDocument();
    expect(
      screen.getByText('Enter water as a whole number of mL.')
    ).toBeInTheDocument();
    expect(mockSaveCheckIn).not.toHaveBeenCalled();
    expect(mockLogWater).not.toHaveBeenCalled();
  });

  it('types pounds for a pounds user and saves kilograms', async () => {
    mockWeightUnit = 'lbs';
    mockWeightKg = 80;
    renderLog();
    openForm('Edit log');
    expect(screen.getByLabelText('Weight (lbs)')).toHaveValue('176.4');
    fireEvent.change(screen.getByLabelText('Weight (lbs)'), {
      target: { value: '180' },
    });
    await save('Save changes');
    expect(mockSaveCheckIn).toHaveBeenCalledWith({
      entry_date: PAST,
      weight: 81.65,
    });
  });

  it('creates a manual mood entry for the day with mood, energy and notes', async () => {
    renderLog();
    openForm();
    fireEvent.click(
      within(group('Mood (1–5)')).getByRole('button', { name: '4' })
    );
    fireEvent.click(
      within(group('Energy (1–5)')).getByRole('button', { name: '2' })
    );
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'ok day' },
    });
    await save();
    expect(mockCreateMood).toHaveBeenCalledTimes(1);
    expect(mockCreateMood.mock.calls[0]?.[0]).toMatchObject({
      mood_value: 70,
      energy_value: 2,
      notes: 'ok day',
      entry_date: PAST,
    });
    expect(mockUpdateMood).not.toHaveBeenCalled();
  });

  it('marks the pressed rating and clears it when tapped again', () => {
    renderLog();
    openForm();
    const four = within(group('Mood (1–5)')).getByRole('button', { name: '4' });
    expect(four).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(four);
    expect(four).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(four);
    expect(four).toHaveAttribute('aria-pressed', 'false');
  });

  it('updates the existing mood entry with only what changed', async () => {
    mockMoodEntries = [
      moodEntry({ id: 'old', entry_timestamp: `${PAST}T08:00:00.000Z` }),
      moodEntry({ id: 'latest', entry_timestamp: `${PAST}T18:00:00.000Z` }),
      moodEntry({ id: 'garmin', source: 'garmin' }),
    ];
    renderLog();
    openForm('Edit log');
    expect(
      within(group('Mood (1–5)')).getByRole('button', { name: '4' })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      within(group('Energy (1–5)')).getByRole('button', { name: '5' })
    );
    await save('Save changes');
    expect(mockCreateMood).not.toHaveBeenCalled();
    expect(mockUpdateMood).toHaveBeenCalledWith({
      id: 'latest',
      body: { energy_value: 5 },
    });
  });

  it('deletes the entry when mood, energy and notes are all cleared', async () => {
    mockMoodEntries = [moodEntry({ notes: 'x' })];
    renderLog();
    openForm('Edit log');
    fireEvent.click(
      within(group('Mood (1–5)')).getByRole('button', { name: '4' })
    );
    fireEvent.click(
      within(group('Energy (1–5)')).getByRole('button', { name: '4' })
    );
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } });
    await save('Save changes');
    expect(mockDeleteMood).toHaveBeenCalledWith('mood-1');
    expect(mockUpdateMood).not.toHaveBeenCalled();
  });

  it('adds one exact water entry for the day', async () => {
    renderLog();
    openForm();
    fireEvent.change(screen.getByLabelText('Add water (mL)'), {
      target: { value: '500' },
    });
    await save();
    expect(mockLogWater).toHaveBeenCalledTimes(1);
    expect(mockLogWater).toHaveBeenCalledWith({
      user_id: 'user-1',
      entry_date: PAST,
      water_ml: 500,
    });
  });

  it('logs each selected chip as a symptom entry with its severity', async () => {
    renderLog();
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Nausea' }));
    fireEvent.click(
      within(group('Nausea severity')).getByRole('button', { name: 'Moderate' })
    );
    await save();
    const nausea = buildSymptomChoices([]).find((c) => c.name === 'nausea')!;
    expect(mockCreateDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nausea', display_name: 'Nausea' })
    );
    expect(mockCreateSymptom).toHaveBeenCalledTimes(1);
    const body = mockCreateSymptom.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      symptom_id: 'def-new',
      symptom_name_snapshot: 'Nausea',
      severity_label: 'Moderate',
      entry_date: PAST,
    });
    expect(severityBand(body.severity, nausea.scaleType)).toBe('mid');
  });

  it('uses the saved definition and sends no severity when none is chosen', async () => {
    mockDefinitions = [definition({ id: 'def-7', is_pinned: true })];
    renderLog();
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Nausea' }));
    await save();
    expect(mockCreateDefinition).not.toHaveBeenCalled();
    expect(mockCreateSymptom.mock.calls[0]?.[0]).toMatchObject({
      symptom_id: 'def-7',
      severity: null,
      severity_label: null,
    });
  });

  it('logs a custom symptom as a new definition and entry', async () => {
    renderLog();
    openForm();
    fireEvent.change(screen.getByLabelText('Add custom symptom'), {
      target: { value: 'Hiccups' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Hiccups' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(
      within(group('Hiccups severity')).getByRole('button', { name: 'Severe' })
    );
    await save();
    expect(mockCreateDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'hiccups',
        display_name: 'Hiccups',
        template: 'generic',
        scale_type: '1-10',
      })
    );
    expect(mockCreateSymptom.mock.calls[0]?.[0]).toMatchObject({
      symptom_id: 'def-new',
      symptom_name_snapshot: 'Hiccups',
      severity: 8,
      severity_label: 'Severe',
    });
  });

  it('shows symptoms already logged for the day and disables their chips', async () => {
    mockSymptomEntries = [
      {
        id: 'e1',
        symptom_id: null,
        symptom_name_snapshot: 'Nausea',
        severity_label: 'Moderate',
      },
    ];
    renderLog();
    openForm('Edit log');
    expect(screen.getByRole('button', { name: 'Nausea' })).toBeDisabled();
    expect(screen.getAllByText('Nausea · Moderate').length).toBeGreaterThan(0);
    await save('Save changes');
    expect(mockCreateSymptom).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Log at least one value before saving.'
    );
  });

  it('stops at the first failure and says what was and was not saved', async () => {
    mockLogWater.mockRejectedValue(new Error('boom'));
    mockCreateMood.mockResolvedValue(
      moodEntry({ mood_value: 50, energy_value: null })
    );
    renderLog();
    openForm();
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: '80' },
    });
    fireEvent.click(
      within(group('Mood (1–5)')).getByRole('button', { name: '3' })
    );
    fireEvent.change(screen.getByLabelText('Add water (mL)'), {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Nausea' }));
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved weight and mood. Water was not saved: boom'
    );
    expect(mockCreateSymptom).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Save log' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // A retry continues from the failure instead of repeating saved parts.
    mockLogWater.mockResolvedValue(undefined);
    await save();
    expect(mockSaveCheckIn).toHaveBeenCalledTimes(1);
    expect(mockCreateMood).toHaveBeenCalledTimes(1);
    expect(mockUpdateMood).not.toHaveBeenCalled();
    expect(mockLogWater).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add log|edit log/i })
      ).toBeInTheDocument()
    );
  });

  it('reuses a definition it created when the entry failed and is retried', async () => {
    mockCreateSymptom.mockRejectedValueOnce(new Error('nope'));
    renderLog();
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Nausea' }));
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nausea was not saved: nope'
    );
    expect(mockCreateDefinition).toHaveBeenCalledTimes(1);
    await save();
    expect(mockCreateDefinition).toHaveBeenCalledTimes(1);
    expect(mockCreateSymptom).toHaveBeenCalledTimes(2);
    expect(mockCreateSymptom.mock.calls[1]?.[0]).toMatchObject({
      symptom_id: 'def-new',
      symptom_name_snapshot: 'Nausea',
    });
  });

  it('closes without saving on Cancel', () => {
    renderLog();
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Add log' })).toBeInTheDocument();
    expect(mockSaveCheckIn).not.toHaveBeenCalled();
  });
});
