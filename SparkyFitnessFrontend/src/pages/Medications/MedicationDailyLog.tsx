import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  buildSymptomChoices,
  todayInZone,
  type SymptomChoice,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useCheckInMeasurementsForDate,
  useSaveCheckInMeasurementsMutation,
} from '@/hooks/CheckIn/useCheckIn';
import {
  useCreateMoodCheckinMutation,
  useDeleteMoodCheckinMutation,
  useMoodCheckinsByDate,
  useUpdateMoodCheckinMutation,
} from '@/hooks/CheckIn/useMood';
import { useSleepEntriesQuery } from '@/hooks/CheckIn/useSleep';
import { useDailySummary } from '@/hooks/Diary/useDailyProgress';
import {
  useFoodEntries,
  useFoodEntryMeals,
} from '@/hooks/Diary/useFoodEntries';
import {
  useLogWaterAmountMutation,
  useWaterGoalQuery,
  useWaterIntakeQuery,
} from '@/hooks/Diary/useWaterIntake';
import {
  useCreateCustomSymptomMutation,
  useCreateSymptomEntryMutation,
  useCustomSymptoms,
  useSymptomEntries,
} from '@/hooks/useSymptoms';
import {
  addSupplementTotals,
  calculateDayTotals,
} from '@/utils/nutritionCalculations';
import { cn } from '@/lib/utils';
import {
  SEVERITY_LABELS,
  buildDailyLogSummary,
  buildSideEffectBody,
  checkWater,
  checkWeight,
  customSymptomChoice,
  formatSleepSource,
  isSymptomLogged,
  latestManualMood,
  planMoodSave,
  sideEffectChoices,
  symptomKey,
  weightInputUnit,
  weightToInputText,
  type DailyLogSummary,
  type SeverityLabel,
} from './medicationDailyLogHelpers';
import type { MoodEntry } from '@/types/mood';

const RATINGS = [1, 2, 3, 4, 5];

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : String(err);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function WaterBar({
  waterMl,
  goalMl,
  label,
}: {
  waterMl: number;
  goalMl: number | null;
  label: string;
}) {
  const pct =
    goalMl && goalMl > 0
      ? Math.max(0, Math.min(100, Math.round((waterMl / goalMl) * 100)))
      : 0;
  return (
    <div className="col-span-2 sm:col-span-4">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-xs font-medium tabular-nums">
          {goalMl ? `${waterMl} / ${goalMl} mL` : `${waterMl} mL`}
        </dd>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {RATINGS.map((n) => {
          const selected = value === n;
          return (
            <Button
              key={n}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              className="flex-1 tabular-nums"
              onClick={() => onChange(selected ? null : n)}
            >
              {n}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface FormProps {
  date: string;
  today: string;
  userId: string | undefined;
  weightUnit: 'kg' | 'lbs';
  storedKg: number | null;
  moodEntry: MoodEntry | null;
  summary: DailyLogSummary;
  choices: SymptomChoice[];
  canLogSymptoms: boolean;
  onClose: () => void;
}

interface Operation {
  label: string;
  run: () => Promise<void>;
}

function DailyLogForm(props: FormProps) {
  const {
    date,
    today,
    userId,
    weightUnit,
    summary,
    choices,
    canLogSymptoms,
    onClose,
  } = props;
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const saveCheckIn = useSaveCheckInMeasurementsMutation();
  const createMood = useCreateMoodCheckinMutation();
  const updateMood = useUpdateMoodCheckinMutation();
  const deleteMood = useDeleteMoodCheckinMutation();
  const updateWater = useLogWaterAmountMutation();
  const createDefinition = useCreateCustomSymptomMutation();
  const createSymptom = useCreateSymptomEntryMutation();
  const dayEntries = useSymptomEntries({ fromDate: date, toDate: date });

  // What this form has already written, so a retry after a partial failure
  // continues from there instead of repeating saved parts.
  const [storedKg, setStoredKg] = useState(props.storedKg);
  const [moodEntry, setMoodEntry] = useState(props.moodEntry);
  const createdDefinitions = useRef<Record<string, string>>({});
  const [loggedNow, setLoggedNow] = useState<string[]>([]);

  const [weight, setWeight] = useState(() =>
    weightToInputText(props.storedKg, weightUnit)
  );
  const [mood, setMood] = useState<number | null>(summary.mood);
  const [energy, setEnergy] = useState<number | null>(summary.energy);
  const [notes, setNotes] = useState(props.moodEntry?.notes ?? '');
  const [water, setWater] = useState('');
  const [selected, setSelected] = useState<
    { choice: SymptomChoice; label: SeverityLabel | null }[]
  >([]);
  const [extraChoices, setExtraChoices] = useState<SymptomChoice[]>([]);
  const [custom, setCustom] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);
  const [waterError, setWaterError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existingEntries = dayEntries.data ?? [];
  const chips = useMemo(() => {
    const base = sideEffectChoices([...choices]);
    const names = new Set(base.map((c) => c.name));
    return [...base, ...extraChoices.filter((c) => !names.has(c.name))];
  }, [choices, extraChoices]);
  const logged = (choice: SymptomChoice) =>
    loggedNow.includes(choice.name) || isSymptomLogged(choice, existingEntries);

  const toggle = (choice: SymptomChoice) =>
    setSelected((current) =>
      current.some((s) => s.choice.name === choice.name)
        ? current.filter((s) => s.choice.name !== choice.name)
        : [...current, { choice, label: null }]
    );
  const setSeverity = (choice: SymptomChoice, label: SeverityLabel | null) =>
    setSelected((current) =>
      current.map((s) => (s.choice.name === choice.name ? { ...s, label } : s))
    );
  const addCustom = () => {
    const text = custom.trim();
    if (!text) return;
    const key = symptomKey(text);
    const known =
      choices.find((c) => c.name === key) ??
      extraChoices.find((c) => c.name === key) ??
      customSymptomChoice(text);
    setExtraChoices((current) =>
      current.some((c) => c.name === known.name) ? current : [...current, known]
    );
    if (!logged(known))
      setSelected((current) =>
        current.some((s) => s.choice.name === known.name)
          ? current
          : [...current, { choice: known, label: null }]
      );
    setCustom('');
  };

  const joinNames = (names: string[]) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} ${t('medications.dailyLog.and', 'and')} ${names[names.length - 1]}`;
  const capitalize = (text: string) =>
    text.charAt(0).toUpperCase() + text.slice(1);

  const save = async () => {
    setFormError(null);
    setWeightError(null);
    setWaterError(null);

    const weightCheck = checkWeight(weight, storedKg, weightUnit);
    const waterCheck = checkWater(water);
    let invalid = false;
    if (weightCheck.status === 'invalid') {
      setWeightError(
        t('medications.dailyLog.weightInvalid', 'Enter a valid weight.')
      );
      invalid = true;
    }
    if (waterCheck.status === 'invalid') {
      setWaterError(
        t(
          'medications.dailyLog.waterInvalid',
          'Enter water as a whole number of mL.'
        )
      );
      invalid = true;
    }
    if (invalid) return;

    const operations: Operation[] = [];

    if (weightCheck.status === 'save') {
      const kg = weightCheck.kg;
      operations.push({
        label: t('medications.dailyLog.part.weight', 'weight'),
        run: async () => {
          await saveCheckIn.mutateAsync({ entry_date: date, weight: kg });
          setStoredKg(kg);
        },
      });
    }

    const moodPlan = planMoodSave({
      entry: moodEntry,
      rating: mood,
      energy,
      notes,
      day: date,
      timezone,
    });
    if (moodPlan.action !== 'none') {
      operations.push({
        label: t('medications.dailyLog.part.mood', 'mood'),
        run: async () => {
          if (moodPlan.action === 'create')
            setMoodEntry(await createMood.mutateAsync(moodPlan.body));
          else if (moodPlan.action === 'update')
            setMoodEntry(
              await updateMood.mutateAsync({
                id: moodPlan.id,
                body: moodPlan.body,
              })
            );
          else if (moodPlan.action === 'delete') {
            await deleteMood.mutateAsync(moodPlan.id);
            setMoodEntry(null);
          }
        },
      });
    }

    if (waterCheck.status === 'add' && userId) {
      const waterMl = waterCheck.ml;
      operations.push({
        label: t('medications.dailyLog.part.water', 'water'),
        run: async () => {
          await updateWater.mutateAsync({
            user_id: userId,
            entry_date: date,
            water_ml: waterMl,
          });
          setWater('');
        },
      });
    }

    if (canLogSymptoms) {
      for (const { choice, label } of selected) {
        if (logged(choice)) continue;
        operations.push({
          label: choice.displayName,
          run: async () => {
            let symptomId =
              choice.definitionId ??
              createdDefinitions.current[choice.name] ??
              null;
            if (!symptomId) {
              // A symptom becomes a saved definition the first time it is
              // logged, as the Symptoms page does, so the entry can point at it.
              const definition = await createDefinition.mutateAsync({
                name: choice.name,
                display_name: choice.displayName,
                template: choice.template,
                category: choice.category,
                scale_type: choice.scaleType,
                is_episodic: choice.isEpisodic,
                is_glp1_flagged: choice.isGlp1,
                custom_field_defs: choice.customFieldDefs,
              });
              symptomId = definition.id;
              // Kept so a retry after the entry fails reuses it.
              createdDefinitions.current[choice.name] = definition.id;
            }
            await createSymptom.mutateAsync(
              buildSideEffectBody({
                choice,
                symptomId,
                label,
                day: date,
                today,
              })
            );
            setLoggedNow((current) => [...current, choice.name]);
            setSelected((current) =>
              current.filter((s) => s.choice.name !== choice.name)
            );
          },
        });
      }
    }

    if (operations.length === 0) {
      setFormError(
        t(
          'medications.dailyLog.nothingToSave',
          'Log at least one value before saving.'
        )
      );
      return;
    }

    setBusy(true);
    const saved: string[] = [];
    for (const operation of operations) {
      try {
        await operation.run();
        saved.push(operation.label);
      } catch (err) {
        const failed = capitalize(operation.label);
        const message = errorMessage(err);
        setFormError(
          saved.length > 0
            ? t(
                'medications.dailyLog.partialFailure',
                'Saved {{saved}}. {{failed}} was not saved: {{message}}',
                { saved: joinNames(saved), failed, message }
              )
            : t(
                'medications.dailyLog.failure',
                '{{failed}} was not saved: {{message}}',
                { failed, message }
              )
        );
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onClose();
  };

  const unitLabel = weightUnit === 'kg' ? 'kg' : 'lbs';
  const editing = summary.hasValues;

  return (
    <form
      className="mt-3 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="daily-log-weight">
          {t('medications.dailyLog.weightLabel', 'Weight ({{unit}})', {
            unit: unitLabel,
          })}
        </Label>
        <Input
          id="daily-log-weight"
          inputMode="decimal"
          className="w-32 tabular-nums"
          value={weight}
          aria-invalid={weightError ? true : undefined}
          aria-describedby={weightError ? 'daily-log-weight-error' : undefined}
          onChange={(event) => setWeight(event.target.value)}
        />
        {weightError && (
          <p
            id="daily-log-weight-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {weightError}
          </p>
        )}
      </div>

      <Segmented
        label={t('medications.dailyLog.moodLabel', 'Mood (1–5)')}
        value={mood}
        onChange={setMood}
      />
      <Segmented
        label={t('medications.dailyLog.energyLabel', 'Energy (1–5)')}
        value={energy}
        onChange={setEnergy}
      />

      <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-3">
        <Stat
          label={t('medications.dailyLog.sleep', 'Sleep')}
          value={
            summary.sleep
              ? `${summary.sleep.hours} h · ${formatSleepSource(summary.sleep.source)}`
              : t('medications.dailyLog.noSleep', 'No sleep recorded')
          }
        />
        <Stat
          label={t('medications.dailyLog.calories', 'Calories')}
          value={
            summary.calories !== null
              ? `${Math.round(summary.calories)} kcal`
              : '—'
          }
        />
        <Stat
          label={t('medications.dailyLog.protein', 'Protein')}
          value={
            summary.proteinG !== null
              ? `${Math.round(summary.proteinG)} g`
              : '—'
          }
        />
      </dl>
      <Button asChild variant="link" size="sm" className="h-auto p-0">
        <Link to={`/?date=${date}`}>
          {t('medications.dailyLog.openDiary', 'Open the food diary')}
        </Link>
      </Button>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <WaterBar
          waterMl={summary.waterMl}
          goalMl={summary.waterGoalMl}
          label={t('medications.dailyLog.water', 'Water')}
        />
      </dl>
      <div className="space-y-1">
        <Label htmlFor="daily-log-water">
          {t('medications.dailyLog.addWater', 'Add water (mL)')}
        </Label>
        <Input
          id="daily-log-water"
          inputMode="numeric"
          className="w-32 tabular-nums"
          placeholder="250"
          value={water}
          aria-invalid={waterError ? true : undefined}
          onChange={(event) => setWater(event.target.value)}
        />
        {waterError && (
          <p role="alert" className="text-sm text-destructive">
            {waterError}
          </p>
        )}
      </div>

      {canLogSymptoms && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t('medications.dailyLog.sideEffects', 'Side effects')}
          </p>
          {summary.symptoms.length > 0 && (
            <ul className="space-y-0.5 text-sm">
              {summary.symptoms.map((entry) => (
                <li key={entry.id}>
                  {entry.label ? `${entry.name} · ${entry.label}` : entry.name}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5">
            {chips.map((choice) => {
              const isLogged = logged(choice);
              const isSelected = selected.some(
                (s) => s.choice.name === choice.name
              );
              return (
                <Button
                  key={choice.name}
                  type="button"
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  aria-pressed={isSelected}
                  disabled={isLogged}
                  title={
                    isLogged
                      ? t(
                          'medications.dailyLog.alreadyLogged',
                          'Already logged for this day'
                        )
                      : undefined
                  }
                  className={cn('h-8 rounded-full px-3 text-xs')}
                  onClick={() => toggle(choice)}
                >
                  {choice.displayName}
                </Button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <ul className="space-y-1.5">
              {selected.map(({ choice, label }) => (
                <li
                  key={choice.name}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{choice.displayName}</span>
                  <div
                    className="flex gap-1"
                    role="group"
                    aria-label={t(
                      'medications.dailyLog.severityFor',
                      '{{name}} severity',
                      { name: choice.displayName }
                    )}
                  >
                    {SEVERITY_LABELS.map((severity) => {
                      const on = label === severity;
                      return (
                        <Button
                          key={severity}
                          type="button"
                          size="sm"
                          variant={on ? 'secondary' : 'outline'}
                          aria-pressed={on}
                          className="h-8 px-2 text-xs"
                          onClick={() =>
                            setSeverity(choice, on ? null : severity)
                          }
                        >
                          {t(
                            `medications.dailyLog.severity.${severity.toLowerCase()}`,
                            severity
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={custom}
              placeholder={t(
                'medications.dailyLog.addCustomSymptom',
                'Add custom symptom'
              )}
              aria-label={t(
                'medications.dailyLog.addCustomSymptom',
                'Add custom symptom'
              )}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addCustom}>
              {t('medications.dailyLog.add', 'Add')}
            </Button>
          </div>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to={`/symptoms?date=${date}`}>
              {t(
                'medications.dailyLog.manageSymptoms',
                'Edit or delete symptom entries on the Symptoms page'
              )}
            </Link>
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="daily-log-notes">
          {t('medications.dailyLog.notes', 'Notes')}
        </Label>
        <Input
          id="daily-log-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={onClose}
        >
          {t('medications.dailyLog.cancel', 'Cancel')}
        </Button>
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy
            ? t('medications.dailyLog.saving', 'Saving…')
            : editing
              ? t('medications.dailyLog.saveChanges', 'Save changes')
              : t('medications.dailyLog.saveLog', 'Save log')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Sparky's version of a per-day wellness journal. The figures come from
 * Sparky's own records for the day (check-in weight, mood check-in, sleep,
 * food diary, water, symptoms) and every save goes to that record's own
 * endpoint; nothing is stored separately.
 */
export default function MedicationDailyLog({
  date,
  title,
}: {
  date: string;
  /** Heading text; pass null when the surrounding card already has one. */
  title?: string | null;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeUserId, hasWritePermission } = useActiveUser();
  const { timezone, weightUnit } = usePreferences();
  const [editing, setEditing] = useState(false);
  const userId = activeUserId || user?.id;
  const unit = weightInputUnit(weightUnit);
  const today = todayInZone(timezone);

  const weightQuery = useCheckInMeasurementsForDate(date);
  const moodQuery = useMoodCheckinsByDate(date);
  const sleepQuery = useSleepEntriesQuery(date, date);
  const summaryQuery = useDailySummary(date);
  const foodQuery = useFoodEntries(date);
  const mealsQuery = useFoodEntryMeals(date);
  const waterQuery = useWaterIntakeQuery(date, userId);
  const goalQuery = useWaterGoalQuery(date, userId);
  const entriesQuery = useSymptomEntries({ fromDate: date, toDate: date });
  const definitionsQuery = useCustomSymptoms();

  const moodEntry = useMemo(
    () => latestManualMood(moodQuery.data ?? []),
    [moodQuery.data]
  );
  const choices = useMemo(
    () => buildSymptomChoices(definitionsQuery.data ?? []),
    [definitionsQuery.data]
  );
  const totals = useMemo(
    () =>
      addSupplementTotals(
        calculateDayTotals(
          (foodQuery.data ?? []).filter((entry) => !entry.food_entry_meal_id),
          mealsQuery.data ?? []
        ),
        summaryQuery.data?.supplementTotals
      ),
    [foodQuery.data, mealsQuery.data, summaryQuery.data]
  );
  const summary = useMemo(
    () =>
      buildDailyLogSummary({
        day: date,
        weightKg: weightQuery.data?.weight ?? null,
        mood: moodEntry,
        sleepEntries: sleepQuery.data ?? [],
        calories: totals.calories,
        proteinG: totals.protein,
        waterMl: waterQuery.data ?? 0,
        waterGoalMl: goalQuery.data ?? null,
        symptoms: entriesQuery.data ?? [],
      }),
    [
      date,
      weightQuery.data,
      moodEntry,
      sleepQuery.data,
      totals,
      waterQuery.data,
      goalQuery.data,
      entriesQuery.data,
    ]
  );

  const canLog = date <= today && hasWritePermission('checkin');
  const canLogSymptoms = hasWritePermission('symptoms');
  const heading =
    title === undefined ? t('medications.dailyLog.title', 'Log') : title;
  const loading =
    weightQuery.isLoading || moodQuery.isLoading || entriesQuery.isLoading;

  if (editing && canLog) {
    return (
      <section aria-label={t('medications.dailyLog.title', 'Log')}>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {summary.hasValues
            ? t('medications.dailyLog.editLog', 'Edit log')
            : t('medications.dailyLog.addLog', 'Add log')}
        </p>
        <DailyLogForm
          date={date}
          today={today}
          userId={userId}
          weightUnit={unit}
          storedKg={weightQuery.data?.weight ?? null}
          moodEntry={moodEntry}
          summary={summary}
          choices={choices}
          canLogSymptoms={canLogSymptoms}
          onClose={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <section aria-label={t('medications.dailyLog.title', 'Log')}>
      <div className="flex items-center justify-between gap-2">
        {heading ? <h3 className="font-semibold">{heading}</h3> : <span />}
        {canLog && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            {summary.hasValues
              ? t('medications.dailyLog.editLog', 'Edit log')
              : t('medications.dailyLog.addLog', 'Add log')}
          </Button>
        )}
      </div>
      {loading ? (
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          {t('common.loading', 'Loading…')}
        </p>
      ) : summary.hasValues ? (
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.weightKg !== null && (
            <Stat
              label={t('medications.dailyLog.weight', 'Weight')}
              value={`${weightToInputText(summary.weightKg, unit)} ${unit}`}
            />
          )}
          {summary.mood !== null && (
            <Stat
              label={t('medications.dailyLog.mood', 'Mood')}
              value={`${summary.mood}/5`}
            />
          )}
          {summary.energy !== null && (
            <Stat
              label={t('medications.dailyLog.energy', 'Energy')}
              value={`${summary.energy}/5`}
            />
          )}
          {summary.sleep && (
            <Stat
              label={t('medications.dailyLog.sleep', 'Sleep')}
              value={`${summary.sleep.hours} h · ${formatSleepSource(summary.sleep.source)}`}
            />
          )}
          {summary.calories !== null && (
            <Stat
              label={t('medications.dailyLog.calories', 'Calories')}
              value={`${Math.round(summary.calories)} kcal`}
            />
          )}
          {summary.proteinG !== null && (
            <Stat
              label={t('medications.dailyLog.protein', 'Protein')}
              value={`${Math.round(summary.proteinG)} g`}
            />
          )}
          {summary.waterMl > 0 && (
            <WaterBar
              waterMl={summary.waterMl}
              goalMl={summary.waterGoalMl}
              label={t('medications.dailyLog.water', 'Water')}
            />
          )}
          {summary.symptoms.length > 0 && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted-foreground">
                {t('medications.dailyLog.sideEffects', 'Side effects')}
              </dt>
              <dd className="text-sm">
                {summary.symptoms
                  .map((entry) =>
                    entry.label ? `${entry.name} · ${entry.label}` : entry.name
                  )
                  .join(', ')}
              </dd>
            </div>
          )}
          {summary.notes && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted-foreground">
                {t('medications.dailyLog.notes', 'Notes')}
              </dt>
              <dd className="break-words text-sm">{summary.notes}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('medications.dailyLog.empty', 'Nothing logged for this day.')}
        </p>
      )}
    </section>
  );
}
