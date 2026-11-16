import { useTranslation } from 'react-i18next';
import type {
  MedicationCourse,
  MedicationCourseRevision,
} from '@workspace/shared';
import { useMedicationCourseCycle } from '@/hooks/Medications/useMedicationCourses';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Button } from '@/components/ui/button';
import MedicationCourseCycleDates from './MedicationCourseCycleDates';

export default function MedicationCourseCycles(props: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  tip: boolean;
  canWrite: boolean;
  onAction: (action: 'end' | 'start') => void;
  onRefresh: () => Promise<unknown>;
}) {
  return props.revision.course_cycle_on_weeks == null ? null : (
    <CycleDetails {...props} />
  );
}
function CycleDetails({
  course,
  revision,
  tip,
  canWrite,
  onAction,
  onRefresh,
}: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  tip: boolean;
  canWrite: boolean;
  onAction: (action: 'end' | 'start') => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { scope, query, data } = useMedicationCourseCycle(course.id, tip);
  const current =
    data && data.revision_id === revision.id && data.version === course.version;
  return (
    <section
      aria-label={t(
        'medications.courseCycles.planTitle',
        'Weekly cycle plan (optional)'
      )}
      className="space-y-2 rounded-md border bg-muted/10 p-3"
    >
      <h5 className="font-medium">
        {t('medications.courseCycles.onSummary', 'Run for {{weeks}} weeks', {
          weeks: revision.course_cycle_on_weeks,
        })}
        {revision.course_cycle_off_weeks != null
          ? ` · ${t('medications.courseCycles.offSummary', 'Then break {{weeks}} weeks', { weeks: revision.course_cycle_off_weeks })}`
          : ''}
      </h5>
      {!tip && revision.course_cycle_anchor_date && (
        <p>
          {t('medications.courseCycles.anchor', 'Recorded weekly cycle anchor')}
          : {formatDate(revision.course_cycle_anchor_date)}
        </p>
      )}
      {tip &&
        (query.isError ? (
          <div className="space-y-1">
            <p role="status">
              {t(
                'medications.courseCycles.stateError',
                'Cycle dates are unavailable. The recorded plan values are retained.'
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t('medications.forecasts.retry', 'Try again')}
            </Button>
          </div>
        ) : !data ? (
          <p role="status">
            {t('medications.courseCycles.loading', 'Loading cycle dates…')}
          </p>
        ) : !current ? (
          <div>
            <p>
              {t(
                'medications.courseCycles.changed',
                'This course changed. Refresh current data and review the change again.'
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onRefresh()}
            >
              {t('medications.courses.refresh', 'Refresh current data')}
            </Button>
          </div>
        ) : (
          <>
            <MedicationCourseCycleDates dates={data} />
            <p>
              {t(
                `medications.courseCycles.phase.${data.phase}`,
                {
                  none: 'No weekly cycle is configured.',
                  scheduled: 'The planned cycle has not started.',
                  on: 'Within the planned run period.',
                  off: 'Within the planned break period.',
                  ended: 'The planned run period has ended.',
                  restart_due: 'The planned restart date has been reached.',
                }[data.phase]
              )}
            </p>
            {canWrite && scope.canWrite && scope.isCurrent() && (
              <div className="flex flex-wrap gap-2">
                {data.end_cycle.allowed && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={query.isFetching}
                    onClick={() => {
                      if (scope.isCurrent()) onAction('end');
                    }}
                  >
                    {t('medications.courseCycles.end', 'End cycle')}
                  </Button>
                )}
                {data.start_next_cycle.allowed && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={query.isFetching}
                    onClick={() => {
                      if (scope.isCurrent()) onAction('start');
                    }}
                  >
                    {t('medications.courseCycles.start', 'Start next cycle')}
                  </Button>
                )}
              </div>
            )}
            {[
              ...new Set([
                ...data.end_cycle.reasons,
                ...data.start_next_cycle.reasons,
              ]),
            ].length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {[
                  ...new Set([
                    ...data.end_cycle.reasons,
                    ...data.start_next_cycle.reasons,
                  ]),
                ].map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        ))}
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.courseCycles.advisory',
          'Cycle dates are planned only. Saving them does not stop scheduled doses or start another cycle. Use the reviewed End cycle or Start next cycle actions explicitly.'
        )}
      </p>
    </section>
  );
}
