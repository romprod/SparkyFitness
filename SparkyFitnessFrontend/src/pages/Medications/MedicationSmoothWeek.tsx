import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  comingWeekStart,
  dayOfWeek,
  isScheduleDueOnDate,
  smoothWeek,
  todayInZone,
  weekRotationMove,
  type SmoothItem,
  type SmoothMove,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useManagedMedicationIds } from '@/hooks/Medications/useManagedMedicationIds';
import { useMedicationLogWeek } from '@/hooks/Medications/useMedicationLogWeek';
import {
  usePinSmoothWeekMedication,
  useRefreshSmoothWeek,
  useSmoothWeekPins,
  useUnpinSmoothWeekMedication,
} from '@/hooks/Medications/useSmoothWeekPins';
import { useMoveSchedulesMutation } from '@/hooks/useMedications';
import type { MedicationDetail, MedicationSchedule } from '@/types/medications';
import { asMovable } from './asMovable';

type Skipped = 'managed_course' | 'not_weekly' | 'ends_soon';

interface ApplyAllResult {
  applied: number;
  total: number;
  failures: { name: string; message: string }[];
}

/** The same weekly pattern after every dose moves `shift` days later. */
const rotated = (counts: readonly number[], shift: number) =>
  counts.map((_, day) => counts[(day - shift + 7) % 7]!);

const asRule = (schedule: MedicationSchedule) => ({
  schedule_type_id: schedule.schedule_type_id,
  days_of_week: schedule.days_of_week,
  interval_days: schedule.interval_days,
  day_of_month: schedule.day_of_month,
  cycle_on_days: schedule.cycle_on_days,
  cycle_off_days: schedule.cycle_off_days,
  start_date: schedule.start_date,
  end_date: schedule.end_date,
  active: schedule.active,
});

/** Doses per weekday for the coming week, and how rotating weekly injections would even it out. */
export default function MedicationSmoothWeek({
  medications,
}: {
  medications: MedicationDetail[];
}) {
  const { t } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const managed = useManagedMedicationIds();
  const move = useMoveSchedulesMutation();
  const quietMove = useMoveSchedulesMutation({ quiet: true });
  const { pinnedIds } = useSmoothWeekPins();
  const pin = usePinSmoothWeekMedication();
  const unpin = useUnpinSmoothWeekMedication();
  const refresh = useRefreshSmoothWeek();
  const [confirming, setConfirming] = useState<SmoothMove | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<ApplyAllResult | null>(null);
  const today = todayInZone(timezone);
  const weekStart = comingWeekStart(today);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const hasManaged = medications.some(
    (m) => m.is_active && m.type_id === 'injection' && managed.has(m.id)
  );
  const week = useMedicationLogWeek(weekStart, hasManaged);
  const weekData = week.data;
  const weekLoading = hasManaged && !weekData && !week.query.isError;
  const plan = useMemo(() => {
    if (weekLoading) return null;
    const movable: SmoothItem[] = [];
    const skipped: { name: string; reason: Skipped }[] = [];
    const kept: { id: string; name: string }[] = [];
    const fixed = [0, 0, 0, 0, 0, 0, 0];
    for (const med of medications) {
      if (!med.is_active || med.type_id !== 'injection') continue;
      if (managed.has(med.id)) {
        // A course plan owns these doses: count its slots in the week (all but skipped) as fixed.
        let slots = 0;
        for (const slot of weekData?.planned_slots ?? []) {
          if (
            slot.medication_id === med.id &&
            slot.status !== 'skipped' &&
            days.includes(slot.scheduled_day)
          ) {
            const d = dayOfWeek(slot.scheduled_day);
            fixed[d] = fixed[d]! + 1;
            slots++;
          }
        }
        const live = med.schedules.some(
          (s) =>
            s.active &&
            s.schedule_type_id !== 'prn' &&
            (s.end_date === null || s.end_date >= weekStart)
        );
        if (slots > 0 || live)
          skipped.push({
            name: med.display_name || med.name,
            reason: 'managed_course',
          });
        continue;
      }
      // A rule that ends before the coming week is history (a schedule moved earlier leaves one).
      const rules = med.schedules.filter(
        (s) =>
          s.active &&
          s.schedule_type_id !== 'prn' &&
          (s.end_date === null || s.end_date >= weekStart)
      );
      if (rules.length === 0) continue;
      const name = med.display_name || med.name;
      const weekly = rules.every(
        (s) =>
          (s.schedule_type_id === 'weekly' ||
            s.schedule_type_id === 'specific_days') &&
          (s.days_of_week?.length ?? 0) > 0
      );
      const endsSoon = rules.some(
        (s) => s.end_date !== null && s.end_date < addDays(weekStart, 7)
      );
      let reason: Skipped | null = null;
      if (!weekly) reason = 'not_weekly';
      else if (endsSoon) reason = 'ends_soon';
      const isPinned = pinnedIds.has(med.id);
      if (reason === null && !isPinned) {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        for (const s of rules)
          for (const d of s.days_of_week ?? []) counts[d] = counts[d]! + 1;
        movable.push({ id: med.id, name, counts });
        continue;
      }
      for (const day of days)
        for (const s of rules)
          if (isScheduleDueOnDate(asRule(s), day))
            fixed[dayOfWeek(day)] = fixed[dayOfWeek(day)]! + 1;
      if (isPinned) kept.push({ id: med.id, name });
      else if (reason) skipped.push({ name, reason });
    }
    if (movable.length === 0 && fixed.every((n) => n === 0)) return null;
    return {
      result: smoothWeek({ movable, fixed }),
      skipped,
      kept,
      counts: new Map(movable.map((item) => [item.id, item.counts])),
    };
  }, [medications, managed, pinnedIds, weekData, weekLoading, days, weekStart]);
  if (weekLoading)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md">
            {t('medications.smoothWeek.title', 'Smooth your week')}
          </CardTitle>
          <CardDescription>
            {t(
              'medications.smoothWeek.loadingWeek',
              'Loading the coming week…'
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  if (!plan) return null;

  const plans = new Map(
    plan.result.moves.flatMap((move) => {
      const med = medications.find((m) => m.id === move.id);
      const rotation = med
        ? weekRotationMove({
            schedules: med.schedules.map(asMovable),
            shift: move.shift,
            from: weekStart,
          })
        : null;
      return rotation ? [[move.id, rotation] as const] : [];
    })
  );
  const applying = confirming ? plans.get(confirming.id) : undefined;
  const applicable = plan.result.moves.filter((m) => plans.has(m.id));
  const busy = running || move.isPending || pin.isPending || unpin.isPending;

  const applyAll = async () => {
    const batch = applicable;
    setRunning(true);
    const failures: ApplyAllResult['failures'] = [];
    let applied = 0;
    for (const item of batch) {
      const rotation = plans.get(item.id)!;
      try {
        await quietMove.mutateAsync({
          medicationId: item.id,
          body: {
            schedule_ids: rotation.schedule_ids,
            end_date: rotation.end_date,
            new_start_date: rotation.new_start_date,
            rotate_days: rotation.rotate_days!,
          },
        });
        applied++;
      } catch (err) {
        failures.push({
          name: item.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      await refresh();
    } finally {
      setOutcome({ applied, total: batch.length, failures });
      setConfirmingAll(false);
      setRunning(false);
    }
  };

  const weekday = (index: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 10, 15 + index)));
  const strip = (counts: number[], label: string) => (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const n = counts[dayOfWeek(day)]!;
        return (
          <div
            key={day}
            className="rounded-md border px-1 py-1.5 text-center text-xs"
          >
            <div className="text-muted-foreground">
              {weekday(dayOfWeek(day))}
            </div>
            <div
              className={`text-base font-semibold tabular-nums ${n === 0 ? 'text-muted-foreground' : ''}`}
            >
              {n}
            </div>
          </div>
        );
      })}
    </div>
  );
  const dayList = (list: number[]) => list.map(weekday).join(', ');
  const beforeAfter = (item: SmoothMove) => {
    const before = plan.counts.get(item.id);
    if (!before) return null;
    const rows = [
      {
        label: t('medications.smoothWeek.before', 'Before'),
        counts: before,
      },
      {
        label: t('medications.smoothWeek.after', 'After'),
        counts: rotated(before, item.shift),
      },
    ];
    return (
      <div
        key={item.id}
        role="group"
        aria-label={t(
          'medications.smoothWeek.gridLabel',
          '{{name}}: before and after',
          { name: item.name }
        )}
        className="space-y-1 rounded-md border p-2 text-xs"
      >
        <p className="font-medium">{item.name}</p>
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] items-center gap-1 text-center">
          <span />
          {days.map((day) => (
            <span key={day} className="text-muted-foreground">
              {weekday(dayOfWeek(day))}
            </span>
          ))}
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <span className="text-left text-muted-foreground">
                {row.label}
              </span>
              {days.map((day) => {
                const n = row.counts[dayOfWeek(day)]!;
                return (
                  <span
                    key={day}
                    className={`rounded-sm py-0.5 tabular-nums ${n > 0 ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {n > 0 ? n : '·'}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };
  const reasonText: Record<Skipped, string> = {
    managed_course: t(
      'medications.smoothWeek.managed',
      'follows a course plan, not moved here'
    ),
    not_weekly: t('medications.smoothWeek.notWeekly', 'not a weekly pattern'),
    ends_soon: t(
      'medications.smoothWeek.endsSoon',
      'schedule ends within a week'
    ),
  };
  const { result } = plan;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">
          {t('medications.smoothWeek.title', 'Smooth your week')}
        </CardTitle>
        <CardDescription>
          {t(
            'medications.smoothWeek.subtitle',
            'Doses per day in the coming week, and how moving weekly injections to other days would spread them. Amounts, times and doses per week do not change.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t('medications.smoothWeek.weekOf', 'Week of {{date}}', {
            date: formatDate(weekStart),
          })}
        </p>
        {strip(
          result.current,
          t('medications.smoothWeek.current', 'Doses per day this plan')
        )}
        {result.already_flat ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.smoothWeek.flat',
              'Your week is already as flat as moving weekly injections can make it.'
            )}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">
              {t('medications.smoothWeek.suggested', 'With these moves')}
            </p>
            {strip(
              result.proposed,
              t('medications.smoothWeek.proposed', 'Doses per day after moves')
            )}
            <ul className="space-y-1 text-sm">
              {result.moves.map((move) => (
                <li
                  key={move.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {t(
                      'medications.smoothWeek.move',
                      '{{name}}: {{from}} → {{to}}',
                      {
                        name: move.name,
                        from: dayList(move.from_days),
                        to: dayList(move.to_days),
                      }
                    )}
                  </span>
                  <span className="flex gap-2">
                    {plans.has(move.id) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirming(move)}
                      >
                        {t('medications.smoothWeek.applyMove', 'Apply')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => pin.mutate(move.id)}
                    >
                      {t('medications.smoothWeek.keepAsIs', 'Keep as is')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            {applicable.length >= 2 && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setConfirmingAll(true)}
              >
                {t(
                  'medications.smoothWeek.applyAll',
                  'Apply all {{count}} changes',
                  { count: applicable.length }
                )}
              </Button>
            )}
            <div className="space-y-2">
              {result.moves.map((m) => beforeAfter(m))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.smoothWeek.apply',
                'Nothing changes until you apply a move. A move starts on the week shown; earlier days keep their schedule.'
              )}
            </p>
          </>
        )}
        {outcome && (
          <p role="status" className="text-sm">
            {outcome.failures.length === 0
              ? t(
                  'medications.smoothWeek.allApplied',
                  'All {{count}} changes applied.',
                  { count: outcome.total }
                )
              : t(
                  'medications.smoothWeek.someApplied',
                  'Moved {{done}} of {{total}}.',
                  { done: outcome.applied, total: outcome.total }
                ) +
                ' ' +
                outcome.failures
                  .map((f) => `${f.name}: ${f.message}`)
                  .join(' ')}
          </p>
        )}
        {plan.kept.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {t('medications.smoothWeek.keptTitle', 'Kept as is ({{count}})', {
                count: plan.kept.length,
              })}
            </p>
            <ul className="space-y-1">
              {plan.kept.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>{row.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => unpin.mutate(row.id)}
                  >
                    {t('medications.smoothWeek.includeAgain', 'Include again')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.skipped.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {plan.skipped.map((row) => (
              <li key={row.name}>
                {row.name} — {reasonText[row.reason]}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmationDialog
        open={confirming !== null && applying !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t('medications.smoothWeek.confirmTitle', 'Move {{name}}?', {
          name: confirming?.name ?? '',
        })}
        description={t(
          'medications.smoothWeek.confirmBody',
          'From {{date}} its schedule moves from {{from}} to {{to}}. Doses up to then, and your history, stay as they are.',
          {
            date: formatDate(weekStart),
            from: dayList(confirming?.from_days ?? []),
            to: dayList(confirming?.to_days ?? []),
          }
        )}
        confirmLabel={t('medications.smoothWeek.confirmMove', 'Move schedule')}
        confirmDisabled={busy}
        onConfirm={() => {
          if (!confirming || !applying) return;
          move.mutate(
            {
              medicationId: confirming.id,
              body: {
                schedule_ids: applying.schedule_ids,
                end_date: applying.end_date,
                new_start_date: applying.new_start_date,
                rotate_days: applying.rotate_days!,
              },
            },
            { onSettled: () => setConfirming(null) }
          );
        }}
      />
      <ConfirmationDialog
        open={confirmingAll}
        onOpenChange={(open) => {
          if (!open && !running) setConfirmingAll(false);
        }}
        title={t(
          'medications.smoothWeek.confirmAllTitle',
          'Apply all {{count}} changes?',
          { count: applicable.length }
        )}
        description={
          <div className="space-y-2">
            <ul className="list-disc space-y-0.5 pl-4">
              {applicable.map((m) => (
                <li key={m.id}>
                  {t(
                    'medications.smoothWeek.move',
                    '{{name}}: {{from}} → {{to}}',
                    {
                      name: m.name,
                      from: dayList(m.from_days),
                      to: dayList(m.to_days),
                    }
                  )}
                </li>
              ))}
            </ul>
            <p>
              {t(
                'medications.smoothWeek.confirmAllBody',
                'From {{date}} each schedule moves to its new days. Doses up to then, and your history, stay as they are. The moves are applied one after another; if one fails, the rest still go ahead.',
                { date: formatDate(weekStart) }
              )}
            </p>
          </div>
        }
        confirmLabel={t(
          'medications.smoothWeek.confirmAll',
          'Move all schedules'
        )}
        confirmDisabled={busy}
        onConfirm={() => void applyAll()}
      />
    </Card>
  );
}
