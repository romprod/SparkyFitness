import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Dumbbell } from 'lucide-react';
import {
  buildWellnessTile,
  wellnessDayAge,
  type WellnessActivity,
} from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationWellnessStreams } from '@/hooks/Medications/useMedicationWellness';

const SPARK_W = 120;
const SPARK_H = 32;
const SPARK_PAD = 3;

/** A small line of the week's weights, drawn inline like the other chart-less tiles. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const step = (SPARK_W - 2 * SPARK_PAD) / (values.length - 1);
  const path = values
    .map((value, index) => {
      const x = SPARK_PAD + index * step;
      const y =
        SPARK_PAD + (1 - (value - min) / range) * (SPARK_H - 2 * SPARK_PAD);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="h-8 w-full max-w-[160px] text-primary"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const hoursMinutes = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
const workoutLength = (minutes: number) => {
  const whole = Math.max(0, Math.round(minutes));
  const h = Math.floor(whole / 60);
  return h > 0 ? `${h}h ${whole % 60}m` : `${whole}m`;
};

/**
 * Recovery and weight at a glance, as Pitstop's dashboard Wellness tile has it: the latest Garmin
 * figures (sleep score, resting heart rate, HRV and Body Battery when the watch gives them) with
 * the day they are from, the latest workout, and the week's weight with its change. Figures are
 * labelled with their day so a sync gap does not pass yesterday's recovery off as today's.
 */
export default function MedicationWellnessTile() {
  const { t } = useTranslation();
  const { weightUnit, convertWeight, formatDate } = usePreferences();
  const streams = useMedicationWellnessStreams();
  const unit = weightUnit === 'st_lbs' ? 'lbs' : weightUnit;
  const tile = useMemo(
    () =>
      streams.data
        ? buildWellnessTile(streams.data, (kg) => convertWeight(kg, 'kg', unit))
        : null,
    [streams.data, unit, convertWeight]
  );
  const today = streams.data?.today;
  if (!tile || !today) return null;
  const { snapshot, activities, weight } = tile;
  if (!snapshot && !activities && !weight) return null;

  const when = (day: string) => {
    const age = wellnessDayAge(day, today);
    return {
      text:
        age === 'today'
          ? t('medications.wellness.today', 'Today')
          : age === 'yesterday'
            ? t('medications.wellness.yesterday', 'Yesterday')
            : formatDate(day),
      stale: age !== 'today',
    };
  };

  const stats: { key: string; label: string; value: string; unit?: string }[] =
    [];
  if (snapshot) {
    if (snapshot.sleep_score !== null || snapshot.sleep_seconds !== null)
      stats.push({
        key: 'sleep',
        label: t('medications.wellness.sleep', 'Sleep'),
        value:
          snapshot.sleep_score !== null
            ? String(snapshot.sleep_score)
            : hoursMinutes(snapshot.sleep_seconds!),
        unit:
          snapshot.sleep_score !== null && snapshot.sleep_seconds !== null
            ? hoursMinutes(snapshot.sleep_seconds)
            : undefined,
      });
    if (snapshot.resting_hr !== null)
      stats.push({
        key: 'rhr',
        label: t('medications.wellness.restingHr', 'Resting HR'),
        value: String(snapshot.resting_hr),
        unit: t('medications.wellness.bpm', 'bpm'),
      });
    if (snapshot.hrv_ms !== null)
      stats.push({
        key: 'hrv',
        label: t('medications.wellness.hrv', 'HRV'),
        value: String(Math.round(snapshot.hrv_ms)),
        unit: t('medications.wellness.ms', 'ms'),
      });
    if (snapshot.body_battery !== null)
      stats.push({
        key: 'bb',
        label: t('medications.wellness.bodyBattery', 'Body Battery'),
        value: String(snapshot.body_battery),
      });
  }
  const asOf = snapshot ? when(snapshot.as_of) : null;
  const workoutDay = activities ? when(activities.day) : null;
  const first: WellnessActivity | undefined = activities?.items[0];
  const more = (activities?.items.length ?? 0) - 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {t('medications.wellness.title', 'Recovery')}
          </span>
          {asOf && (
            <span className="text-[11px] font-medium text-muted-foreground">
              {t('medications.wellness.garmin', 'Garmin')} ·{' '}
              <span className={asOf.stale ? 'text-amber-600' : undefined}>
                {asOf.text}
              </span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {stats.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.key} className="rounded-lg border bg-muted/40 p-2">
                <dt className="text-[10px] font-semibold text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">
                  {stat.value}
                  {stat.unit && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {stat.unit}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {first && workoutDay && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Dumbbell className="h-3.5 w-3.5" aria-hidden />
            {t('medications.wellness.exercise', 'Exercise')}
            <span className="font-medium text-foreground">
              {first.name || t('medications.wellness.workout', 'Workout')}{' '}
              {workoutLength(first.duration_minutes)}
              {more > 0 ? ` +${more}` : ''}
            </span>
            {workoutDay.stale && (
              <span className="text-amber-600">· {workoutDay.text}</span>
            )}
          </p>
        )}

        {weight && (
          <div className="space-y-1 border-t pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {t('medications.wellness.weight', 'Weight')}
              </span>
              {weight.delta !== null && (
                <span className="text-xs font-medium tabular-nums">
                  {weight.delta > 0 ? '+' : ''}
                  {weight.delta} {unit}{' '}
                  <span className="text-muted-foreground">
                    {t('medications.wellness.sevenDays', '7d')}
                  </span>
                </span>
              )}
            </div>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {weight.latest}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {unit}
              </span>
            </p>
            <Sparkline values={weight.points} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
