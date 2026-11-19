import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  dayOfWeek,
  lateDoseMove,
  todayInZone,
  type LateDoseMove,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useManagedMedicationIds } from '@/hooks/Medications/useManagedMedicationIds';
import {
  useMedicationEntries,
  useMoveSchedulesMutation,
} from '@/hooks/useMedications';
import type { MedicationDetail } from '@/types/medications';
import { asMovable } from './asMovable';

const DISMISSED_KEY = 'schedule-move-dismissed';

function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(DISMISSED_KEY) ?? '[]'
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

interface Offer {
  medication: MedicationDetail;
  move: LateDoseMove;
  key: string;
}

/**
 * After a dose taken off its schedule's pattern, offers to move the schedule to match. The change
 * is reviewed here and applied in one step on the server; the earlier rule stays as history.
 */
export default function MedicationScheduleMove({
  medications,
}: {
  medications: MedicationDetail[];
}) {
  const { t } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const today = todayInZone(timezone);
  const managed = useManagedMedicationIds();
  const entries = useMedicationEntries({
    fromDate: addDays(today, -10),
    toDate: today,
  });
  const move = useMoveSchedulesMutation();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const offers = useMemo<Offer[]>(() => {
    const taken = new Map<string, string[]>();
    for (const entry of entries.data ?? []) {
      if (entry.status !== 'taken') continue;
      taken.set(entry.medication_id, [
        ...(taken.get(entry.medication_id) ?? []),
        entry.entry_date,
      ]);
    }
    const found: Offer[] = [];
    for (const medication of medications) {
      if (!medication.is_active || managed.has(medication.id)) continue;
      const proposal = lateDoseMove({
        schedules: medication.schedules.map(asMovable),
        takenDays: taken.get(medication.id) ?? [],
        today,
      });
      if (!proposal) continue;
      const key = `${proposal.schedule_ids[0]}:${proposal.dose_day}`;
      if (!dismissed.includes(key))
        found.push({ medication, move: proposal, key });
    }
    return found;
  }, [entries.data, medications, managed, today, dismissed]);

  if (offers.length === 0) return null;

  const keep = (key: string) => {
    const next = [...dismissed, key].slice(-50);
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // The offer simply comes back after a reload.
    }
  };
  const weekday = (index: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 10, 15 + index)));
  const dayList = (days: number[]) => days.map(weekday).join(', ');

  return (
    <>
      {offers.map(({ medication, move: proposal, key }) => {
        const name = medication.display_name || medication.name;
        return (
          <Card key={key} data-testid="schedule-move-banner">
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">
                {proposal.kind === 'weekly'
                  ? t(
                      'medications.scheduleMove.weekly',
                      '{{name}} was taken on {{taken}}, not on its usual day. Move its schedule from {{from}} to {{to}}?',
                      {
                        name,
                        taken: `${weekday(dayOfWeek(proposal.dose_day))} ${formatDate(proposal.dose_day)}`,
                        from: dayList(proposal.from_days),
                        to: dayList(proposal.to_days),
                      }
                    )
                  : t(
                      'medications.scheduleMove.interval',
                      '{{name}} was taken on {{taken}}, off its every {{days}} days. Count {{days}} days on from that dose instead?',
                      {
                        name,
                        taken: formatDate(proposal.dose_day),
                        days: proposal.interval_days,
                      }
                    )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.scheduleMove.next',
                  'The next dose would be {{date}}. Earlier doses stay as they are, and you can move it back from the medication’s schedule.',
                  { date: formatDate(proposal.next_day) }
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={move.isPending}
                  onClick={() =>
                    move.mutate({
                      medicationId: medication.id,
                      body: {
                        schedule_ids: proposal.schedule_ids,
                        end_date: proposal.end_date,
                        new_start_date: proposal.new_start_date,
                        ...(proposal.rotate_days !== null
                          ? { rotate_days: proposal.rotate_days }
                          : {}),
                      },
                    })
                  }
                >
                  {t('medications.scheduleMove.move', 'Move schedule')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={move.isPending}
                  onClick={() => keep(key)}
                >
                  {t('medications.scheduleMove.keep', 'Keep schedule')}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
