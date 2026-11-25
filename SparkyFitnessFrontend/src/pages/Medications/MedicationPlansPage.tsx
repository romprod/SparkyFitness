import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  courseBucket,
  coursePlanProgress,
  isCurrentCourseTip,
  readHalfLifeHours,
  type MedicationCourse,
  type MedicationCourseBucket,
  type MedicationCourseRevision,
} from '@workspace/shared';
import { useMedicationCourses } from '@/hooks/Medications/useMedicationCourses';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { MedicationDetail } from '@/types/medications';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MedicationCourseActionDialog, {
  type CourseAction,
} from './MedicationCourseActionDialog';
import { formatScheduleDescription } from './medicationUtils';

type Row = {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  med: MedicationDetail | undefined;
};

const BUCKETS: MedicationCourseBucket[] = [
  'active',
  'scheduled',
  'paused',
  'ended',
  'completed',
];

export default function MedicationPlansPage({
  medications,
  onTimeline,
  onManage,
}: {
  medications: MedicationDetail[];
  onTimeline: () => void;
  onManage: (medicationId: string, revisionId: string) => void;
}) {
  const result = useMedicationCourses();
  return result.scope.ready ? (
    <PlansContent
      key={result.scope.key}
      result={result}
      medications={medications}
      onTimeline={onTimeline}
      onManage={onManage}
    />
  ) : null;
}

function PlansContent({
  result,
  medications,
  onTimeline,
  onManage,
}: {
  result: ReturnType<typeof useMedicationCourses>;
  medications: MedicationDetail[];
  onTimeline: () => void;
  onManage: (medicationId: string, revisionId: string) => void;
}) {
  const { t } = useTranslation();
  const { formatDate, timeFormat } = usePreferences();
  const { scope, query, data } = result;
  const [action, setAction] = useState<CourseAction | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const labels: Record<MedicationCourseBucket, string> = {
    active: t('medications.courses.buckets.active', 'Active'),
    scheduled: t('medications.courses.buckets.scheduled', 'Scheduled'),
    paused: t('medications.courses.buckets.paused', 'Paused'),
    ended: t('medications.courses.buckets.ended', 'Past end date'),
    completed: t('medications.courses.buckets.completed', 'Completed'),
  };
  const descriptions: Record<MedicationCourseBucket, string> = {
    active: t('medications.plans.desc.active', 'Running now.'),
    scheduled: t(
      'medications.plans.desc.scheduled',
      'Queued — starts on a future date.'
    ),
    paused: t(
      'medications.plans.desc.paused',
      'Temporarily stopped; resume when ready.'
    ),
    ended: t(
      'medications.plans.desc.ended',
      'Its end date has passed; complete it or reopen with a new end.'
    ),
    completed: t(
      'medications.plans.desc.completed',
      'Finished. Kept for history and adherence.'
    ),
  };

  // One row per course: its current tip, skipping deleted courses and tips.
  const rows: Row[] =
    data?.courses.flatMap((course) => {
      const revision = course.revisions.find(
        (row) => !row.deleted_at && isCurrentCourseTip(course, row.id)
      );
      return revision
        ? [
            {
              course,
              revision,
              med: medications.find((m) => m.id === course.medication_id),
            },
          ]
        : [];
    }) ?? [];

  const plainScheduleCount = medications.filter(
    (med) =>
      med.is_active &&
      med.schedules.length > 0 &&
      !data?.courses.some(
        (course) => course.medication_id === med.id && !course.deleted_at
      )
  ).length;

  const refresh = async (id: string) => {
    const fresh = await query.refetch();
    if (!scope.isCurrent()) return;
    return fresh.data?.courses.find((course) => course.id === id);
  };

  const card = (
    { course, revision, med }: Row,
    bucket: MedicationCourseBucket
  ) => {
    const progress = coursePlanProgress({
      start_date: revision.start_date,
      end_date: revision.end_date,
      local_today: data!.today,
    });
    const progressText =
      progress.kind === 'running'
        ? progress.of !== null && progress.end_date
          ? t(
              'medications.courses.timeline.dayOf',
              'Day {{day}} of {{total}} · ends {{date}}',
              {
                day: progress.day,
                total: progress.of,
                date: formatDate(progress.end_date),
              }
            )
          : t(
              'medications.courses.timeline.dayOpen',
              'Day {{day}} · no end date',
              {
                day: progress.day,
              }
            )
        : progress.kind === 'not_started'
          ? t('medications.courses.timeline.starts', {
              defaultValue_one: 'Starts in {{count}} day · {{date}}',
              defaultValue_other: 'Starts in {{count}} days · {{date}}',
              count: progress.starts_in_days,
              date: formatDate(progress.start_date),
            })
          : progress.kind === 'finished'
            ? t('medications.courses.timeline.finished', 'Ended {{date}}', {
                date: formatDate(progress.end_date),
              })
            : null;
    const halfLife = readHalfLifeHours(med?.custom_fields);
    const revised =
      course.revisions.filter((row) => !row.deleted_at).length > 1;
    const medName =
      med?.display_name || med?.name || course.medication_name_snapshot;
    const schedule = revision.rules
      .map((rule) => formatScheduleDescription(rule, timeFormat))
      .join('; ');
    const act = (kind: Exclude<CourseAction['kind'], 'delete'>) => (
      <Button
        key={kind}
        variant="outline"
        size="sm"
        onClick={() => setAction({ kind, course, revision })}
      >
        {
          {
            pause: t('medications.courses.pause', 'Pause course'),
            resume: t('medications.courses.resume', 'Resume course'),
            complete: t('medications.courses.complete', 'Complete course'),
            reopen: t('medications.courses.reopen', 'Reopen course'),
          }[kind]
        }
      </Button>
    );
    return (
      <Card key={course.id} data-testid="plan-card">
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium break-words">
              {medName} · {revision.name}
            </p>
            <Badge variant="outline">{labels[bucket]}</Badge>
          </div>
          {schedule && <p>{schedule}</p>}
          {revision.target_dose != null && (
            <p>
              {t('medications.plans.target', 'Target {{dose}} {{unit}}', {
                dose: revision.target_dose,
                unit: revision.dose_unit,
              })}{' '}
              ·{' '}
              {revision.dose_basis === 'per_week'
                ? t('medications.courses.perWeek', 'Per week')
                : t('medications.courses.perDose', 'Per administration')}
              {halfLife !== null &&
                ` · ${t('medications.plans.halfLife', 't½ {{hours}} h', { hours: halfLife })}`}
            </p>
          )}
          {revision.target_dose == null && halfLife !== null && (
            <p>
              {t('medications.plans.halfLife', 't½ {{hours}} h', {
                hours: halfLife,
              })}
            </p>
          )}
          <p>
            {formatDate(revision.start_date)} →{' '}
            {revision.end_date ? formatDate(revision.end_date) : '—'}
          </p>
          {progressText && <p className="font-medium">{progressText}</p>}
          {revised && (
            <p className="text-xs text-muted-foreground">
              {t('medications.plans.revised', 'revised from earlier')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {scope.canWrite && bucket === 'active' && act('pause')}
            {scope.canWrite && bucket === 'paused' && act('resume')}
            {scope.canWrite &&
              (bucket === 'active' ||
                bucket === 'paused' ||
                bucket === 'ended') &&
              act('complete')}
            {scope.canWrite && bucket === 'completed' && act('reopen')}
            {scope.canWrite && med && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (scope.isCurrent()) onManage(med.id, revision.id);
                }}
              >
                {t('medications.plans.manage', 'Manage plan →')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {query.isLoading && <p>{t('common.loading', 'Loading…')}</p>}
      {query.isError && (
        <div>
          <p role="status" className="text-sm">
            {t(
              'medications.courses.loadError',
              'Could not load versioned plans.'
            )}
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      )}
      {data && !rows.length && (
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.plans.empty',
            'No versioned plans yet. Create one from a medicine in Cabinet.'
          )}
        </p>
      )}
      {data && rows.length > 0 && (
        <>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">
                {t('medications.plans.title', 'Plans')}
              </h2>
              <Button size="sm" variant="outline" onClick={onTimeline}>
                {t('medications.courses.timeline.entry', 'Timeline')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.plans.subtitle',
                'Start dates, schedules, and pause or resume for every versioned plan.'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.plans.editNote',
                'Schedule and date changes are made in Manage plan, where they are reviewed before saving.'
              )}
            </p>
          </div>
          {BUCKETS.map((bucket) => {
            const group = rows.filter(
              ({ revision }) => courseBucket(revision, data.today) === bucket
            );
            if (!group.length) return null;
            const collapsed = bucket === 'completed' && !showCompleted;
            return (
              <section
                key={bucket}
                aria-label={labels[bucket]}
                className="space-y-2"
              >
                <div>
                  <h3 className="text-sm font-semibold">
                    {labels[bucket]} · {group.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {descriptions[bucket]}
                  </p>
                </div>
                {bucket === 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={showCompleted}
                    onClick={() => setShowCompleted((open) => !open)}
                  >
                    {showCompleted
                      ? t('medications.plans.hideCompleted', 'Hide completed')
                      : t(
                          'medications.plans.showCompleted',
                          'Show {{count}} completed',
                          { count: group.length }
                        )}
                  </Button>
                )}
                {!collapsed && (
                  <div className="space-y-2">
                    {group.map((row) => card(row, bucket))}
                  </div>
                )}
              </section>
            );
          })}
          {plainScheduleCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('medications.plans.plainSchedules', {
                defaultValue_one:
                  '{{count}} medicine follows plain schedules, not versioned plans — see Cabinet.',
                defaultValue_other:
                  '{{count}} medicines follow plain schedules, not versioned plans — see Cabinet.',
                count: plainScheduleCount,
              })}
            </p>
          )}
        </>
      )}
      {action && (
        <MedicationCourseActionDialog
          key={`${scope.key}:${action.revision.id}:${action.kind}`}
          action={action}
          scope={scope}
          onClose={() => setAction(null)}
          onRefresh={() => refresh(action.course.id)}
        />
      )}
    </div>
  );
}
