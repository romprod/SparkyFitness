import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useMedicationCourseCycle,
  useMedicationCourses,
} from '@/hooks/Medications/useMedicationCourses';
import type { MedicationDetail } from '@/types/medications';
import {
  hasAnyPlan,
  isCyclicRevision,
  pickRunningPlan,
  planDayReadout,
  type RunningPlan,
} from './medicationPlanDay';

/** Which day of the current plan today is, following the most recently started running plan. */
export default function MedicationPlanDayTile({
  medications,
}: {
  medications: MedicationDetail[];
}) {
  const { scope, query, data } = useMedicationCourses();
  const ids = useMemo(
    () => new Set(medications.map((med) => med.id)),
    [medications]
  );
  if (!scope.ready || !scope.isCurrent() || query.isLoading || query.isError)
    return null;
  if (!data || !hasAnyPlan(data.courses, ids)) return null;
  const plan = pickRunningPlan(data.courses, data.today, ids);
  return plan ? (
    <RunningTile plan={plan} today={data.today} />
  ) : (
    <TileFrame>
      <EmptyText />
    </TileFrame>
  );
}

function EmptyText() {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t('medications.planDay.none', 'No active plan')}
    </p>
  );
}

function TileFrame({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const title = t('medications.planDay.title', 'Cycle');
  return (
    <section aria-label={label ?? title}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">{children}</CardContent>
      </Card>
    </section>
  );
}

function RunningTile({ plan, today }: { plan: RunningPlan; today: string }) {
  const { t } = useTranslation();
  const cyclic = isCyclicRevision(plan.revision);
  const cycle = useMedicationCourseCycle(plan.course.id, cyclic).data;
  const readout = planDayReadout(plan.revision, today, cyclic ? cycle : null);
  if (!readout)
    return (
      <TileFrame>
        <EmptyText />
      </TileFrame>
    );
  const name = plan.course.medication_name_snapshot;
  const value = t('medications.planDay.day', 'Day {{day}}', {
    day: readout.day,
  });
  const sub =
    readout.kind === 'plan'
      ? t('medications.planDay.planDay', 'Plan day')
      : readout.kind === 'on'
        ? readout.phaseDays == null
          ? t('medications.planDay.on', 'On')
          : t('medications.planDay.onPhase', 'On · {{days}}-day phase', {
              days: readout.phaseDays,
            })
        : readout.phaseDays == null
          ? t('medications.planDay.off', 'Off')
          : t('medications.planDay.offPhase', 'Off · {{days}}-day phase', {
              days: readout.phaseDays,
            });
  const title = t('medications.planDay.title', 'Cycle');
  return (
    <TileFrame label={`${title}: ${value}, ${sub}, ${name}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">{sub}</p>
          <p className="break-words text-xs text-muted-foreground">{name}</p>
        </div>
        {readout.kind === 'on' && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            ▲ {t('medications.planDay.onPlan', 'On plan')}
          </span>
        )}
      </div>
    </TileFrame>
  );
}
