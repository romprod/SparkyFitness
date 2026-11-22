import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import {
  addDays,
  medicationWeekStart,
  nextDoseWhen,
  nextDosesByMedication,
  type NextDose,
  type NextDoseWhen,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationLogWeek } from '@/hooks/Medications/useMedicationLogWeek';
import { displayQuantity } from '@/utils/displayNumber';

/**
 * The next planned injection for each active injectable, as Pitstop's dashboard words it: a dose
 * later today counts down, any other names its day. It reads the same weekly plan the calendar
 * shows, and loads further weeks (up to five, the thirty days Pitstop looks ahead) only while some
 * injectable has nothing planned yet.
 */
export default function MedicationNextDoses({
  medications,
  today,
}: {
  medications: Medication[];
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const injectables = useMemo(
    () =>
      medications.filter(
        (med) =>
          med.is_active !== false &&
          !med.is_supplement &&
          med.type_id === 'injection'
      ),
    [medications]
  );
  const ids = useMemo(
    () => new Set(injectables.map((med) => med.id)),
    [injectables]
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const first = medicationWeekStart(today);
  const wanted = ids.size > 0;
  const missing = (
    slots: Parameters<typeof nextDosesByMedication>[0]['slots']
  ) =>
    nextDosesByMedication({ slots, now, timezone, medication_ids: ids })
      .length < ids.size;
  // Weeks load one after another: the next is read only when an injectable still has no dose found.
  const w0 = useMedicationLogWeek(first, wanted);
  const s0 = w0.data?.planned_slots ?? [];
  const w1 = useMedicationLogWeek(
    addDays(first, 7),
    wanted && w0.data !== undefined && missing(s0)
  );
  const s1 = [...s0, ...(w1.data?.planned_slots ?? [])];
  const w2 = useMedicationLogWeek(
    addDays(first, 14),
    wanted && w1.data !== undefined && missing(s1)
  );
  const s2 = [...s1, ...(w2.data?.planned_slots ?? [])];
  const w3 = useMedicationLogWeek(
    addDays(first, 21),
    wanted && w2.data !== undefined && missing(s2)
  );
  const s3 = [...s2, ...(w3.data?.planned_slots ?? [])];
  const w4 = useMedicationLogWeek(
    addDays(first, 28),
    wanted && w3.data !== undefined && missing(s3)
  );
  const slots = [...s3, ...(w4.data?.planned_slots ?? [])];
  const doses = wanted
    ? nextDosesByMedication({ slots, now, timezone, medication_ids: ids })
    : [];
  if (doses.length === 0) return null;

  const names = new Map(
    injectables.map((med) => [med.id, med.display_name || med.name])
  );
  const weekdayName = (day: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
  const describe = (dose: NextDose, when: NextDoseWhen) => {
    const time = dose.time ? ` ${dose.time}` : '';
    switch (when.kind) {
      case 'overdue':
        return t('medications.nextDose.overdue', 'Overdue');
      case 'now':
        return t('medications.nextDose.now', 'Now');
      case 'later_today':
        return `${t('medications.nextDose.today', 'Today')}${time} · ${
          when.hours >= 1
            ? t('medications.nextDose.inHours', 'in {{hours}}h {{minutes}}m', {
                hours: when.hours,
                minutes: when.minutes,
              })
            : t('medications.nextDose.inMinutes', 'in {{minutes}}m', {
                minutes: when.minutes,
              })
        }`;
      case 'tomorrow':
        return `${t('medications.nextDose.tomorrow', 'Tomorrow')}${time}`;
      case 'weekday':
        return `${weekdayName(when.day)}${time}`;
      case 'date':
        return `${formatDate(when.day)}${time}`;
    }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          {t('medications.nextDose.title', 'Next injection', {
            count: doses.length,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {doses.map((dose) => {
            const amount =
              dose.dose_amount !== null
                ? ` · ${displayQuantity(dose.dose_amount)}${
                    dose.dose_unit ? ` ${dose.dose_unit}` : ''
                  }`
                : '';
            return (
              <li
                key={dose.medication_id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
              >
                <span className="min-w-0 break-words font-medium">
                  {names.get(dose.medication_id)}
                  <span className="font-normal text-muted-foreground">
                    {amount}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {describe(dose, nextDoseWhen(dose.at, now, timezone))}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
