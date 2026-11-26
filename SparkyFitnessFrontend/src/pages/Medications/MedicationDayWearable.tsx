import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useCheckInMeasurementsForDate } from '@/hooks/CheckIn/useCheckIn';
import { useSleepEntriesQuery } from '@/hooks/CheckIn/useSleep';
import { useExerciseEntries } from '@/hooks/Exercises/useExerciseEntries';
import { useDailyHealthMetrics } from '@/hooks/useGenericHealth';
import {
  buildWearableDay,
  fmtSleepDuration,
  fmtWorkoutDistance,
  fmtWorkoutDuration,
  wearableDayHasAny,
} from './medicationWearableFigures';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The day's watch figures (steps, sleep, heart, Body Battery) and workouts.
 * A figure that is missing is left out, and a query that is loading or has
 * failed adds nothing, so with no figures and no workouts nothing renders.
 */
export default function MedicationDayWearable({ day }: { day: string }) {
  const { t } = useTranslation();
  const { weightUnit, convertWeight, distanceUnit, convertDistance } =
    usePreferences();
  const metrics = useDailyHealthMetrics(day, day);
  const sleep = useSleepEntriesQuery(day, day);
  const weight = useCheckInMeasurementsForDate(day);
  const exercise = useExerciseEntries(day);

  const figures = useMemo(
    () =>
      buildWearableDay({
        day,
        metrics: metrics.data,
        sleepEntries: sleep.data,
        weightKg: weight.data?.weight,
        sessions: exercise.data,
      }),
    [day, metrics.data, sleep.data, weight.data, exercise.data]
  );

  if (!wearableDayHasAny(figures)) return null;

  const weightDisplayUnit = weightUnit === 'st_lbs' ? 'lbs' : weightUnit;
  const sleepText = figures.sleep
    ? [
        figures.sleep.seconds !== null
          ? fmtSleepDuration(figures.sleep.seconds)
          : null,
        figures.sleep.score !== null
          ? t('medications.wearable.sleepScore', 'score {{score}}', {
              score: figures.sleep.score,
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section
      aria-label={t('medications.wearable.title', 'Wellness')}
      className="border-t pt-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
        {t('medications.wearable.title', 'Wellness')}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.steps !== null && (
          <Stat
            label={t('medications.wearable.steps', 'Steps')}
            value={figures.steps.toLocaleString()}
          />
        )}
        {sleepText && (
          <Stat
            label={t('medications.wearable.sleep', 'Sleep')}
            value={sleepText}
          />
        )}
        {figures.activeCalories !== null && (
          <Stat
            label={t('medications.wearable.activeCal', 'Active cal')}
            value={String(Math.round(figures.activeCalories))}
          />
        )}
        {figures.intensityMinutes !== null && (
          <Stat
            label={t('medications.wearable.intensity', 'Intensity')}
            value={t('medications.wearable.minutes', '{{count}} min', {
              count: figures.intensityMinutes,
            })}
          />
        )}
        {figures.weightKg !== null && (
          <Stat
            label={t('medications.wearable.weight', 'Weight')}
            value={`${Number(convertWeight(figures.weightKg, 'kg', weightDisplayUnit).toFixed(1))} ${weightDisplayUnit}`}
          />
        )}
        {figures.restingHr !== null && (
          <Stat
            label={t('medications.wearable.restingHr', 'Resting HR')}
            value={`${Math.round(figures.restingHr)} bpm`}
          />
        )}
        {figures.hrvMs !== null && (
          <Stat
            label={t('medications.wearable.hrv', 'HRV')}
            value={`${Math.round(figures.hrvMs)} ms`}
          />
        )}
        {figures.bodyBattery !== null && (
          <Stat
            label={t('medications.wearable.bodyBattery', 'Body Battery')}
            value={String(Math.round(figures.bodyBattery))}
          />
        )}
      </dl>
      {figures.workouts.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-xs text-muted-foreground">
            {t('medications.wearable.workouts', 'Workouts')}
          </p>
          <ul className="space-y-1.5">
            {figures.workouts.map((workout) => {
              const detail = [
                workout.minutes !== null
                  ? fmtWorkoutDuration(workout.minutes)
                  : null,
                workout.km !== null
                  ? fmtWorkoutDistance(workout.km, distanceUnit, (km) =>
                      convertDistance(km, 'km', distanceUnit)
                    )
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  key={workout.key}
                  className="flex items-center gap-2 text-sm"
                >
                  <Activity
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="font-medium">
                    {workout.name ||
                      t('medications.wearable.workout', 'Workout')}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {detail}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
