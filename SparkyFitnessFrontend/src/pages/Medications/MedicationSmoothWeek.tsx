import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  comingWeekStart,
  dayOfWeek,
  isScheduleDueOnDate,
  smoothWeek,
  todayInZone,
  type SmoothItem,
} from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationCourses } from '@/hooks/Medications/useMedicationCourses';
import type { MedicationDetail, MedicationSchedule } from '@/types/medications';

type Skipped = 'managed_course' | 'not_weekly' | 'ends_soon';

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
  const courses = useMedicationCourses();
  const today = todayInZone(timezone);
  const weekStart = comingWeekStart(today);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const managed = useMemo(() => {
    const ids = new Set<string>();
    for (const course of courses.data?.courses ?? []) {
      if (course.deleted_at !== null || course.medication_id === null) continue;
      const tip = course.revisions.find(
        (revision) => revision.id === course.current_revision_id
      );
      if (tip && tip.status !== 'completed') ids.add(course.medication_id);
    }
    return ids;
  }, [courses.data]);

  const plan = useMemo(() => {
    const movable: SmoothItem[] = [];
    const skipped: { name: string; reason: Skipped }[] = [];
    const fixed = [0, 0, 0, 0, 0, 0, 0];
    for (const med of medications) {
      if (!med.is_active || med.type_id !== 'injection') continue;
      const rules = med.schedules.filter(
        (s) => s.active && s.schedule_type_id !== 'prn'
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
      if (managed.has(med.id)) reason = 'managed_course';
      else if (!weekly) reason = 'not_weekly';
      else if (endsSoon) reason = 'ends_soon';
      if (reason === null) {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        for (const s of rules)
          for (const d of s.days_of_week ?? []) counts[d] = counts[d]! + 1;
        movable.push({ id: med.id, name, counts });
        continue;
      }
      if (reason !== 'managed_course')
        for (const day of days)
          for (const s of rules)
            if (isScheduleDueOnDate(asRule(s), day))
              fixed[dayOfWeek(day)] = fixed[dayOfWeek(day)]! + 1;
      skipped.push({ name, reason });
    }
    if (movable.length === 0 && fixed.every((n) => n === 0)) return null;
    return { result: smoothWeek({ movable, fixed }), skipped };
  }, [medications, managed, days, weekStart]);
  if (!plan) return null;

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
                <li key={move.id}>
                  {t(
                    'medications.smoothWeek.move',
                    '{{name}}: {{from}} → {{to}}',
                    {
                      name: move.name,
                      from: dayList(move.from_days),
                      to: dayList(move.to_days),
                    }
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.smoothWeek.apply',
                'These are suggestions only. To use one, change the weekdays in that medication’s schedule.'
              )}
            </p>
          </>
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
    </Card>
  );
}
