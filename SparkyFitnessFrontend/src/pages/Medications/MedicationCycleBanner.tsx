import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCw } from 'lucide-react';
import {
  courseCycleAlert,
  isCourseCycleBannerAlert,
  type MedicationCourse,
} from '@workspace/shared';
import { useMedicationCourseCycle } from '@/hooks/Medications/useMedicationCourses';
import { usePreferences } from '@/contexts/PreferencesContext';

/**
 * Prompts for a course on a weekly on/off plan: the last week of a run, the final day, a finished
 * run still active, a break that is about to end, or the restart day. Advisory only; ending or
 * restarting a cycle stays in the course's own reviewed actions.
 */
export default function MedicationCycleBanner({
  courses,
}: {
  courses: MedicationCourse[];
}) {
  const planned = courses.filter((course) => {
    const revision = course.revisions.find(
      (r) => r.id === course.current_revision_id
    );
    return (
      !course.deleted_at &&
      revision?.status === 'active' &&
      revision.course_cycle_on_weeks != null
    );
  });
  if (planned.length === 0) return null;
  return (
    <section aria-label="Cycle status" className="space-y-2 empty:hidden">
      {planned.map((course) => (
        <CycleBannerRow key={course.id} course={course} />
      ))}
    </section>
  );
}

function CycleBannerRow({ course }: { course: MedicationCourse }) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { data } = useMedicationCourseCycle(course.id, true);
  if (!data) return null;
  const alert = courseCycleAlert({
    phase: data.phase,
    today: data.today,
    planned_stop_date: data.planned_stop_date,
    next_restart_date: data.next_restart_date,
  });
  if (!isCourseCycleBannerAlert(alert) || !alert) return null;
  const name = course.medication_name_snapshot;
  const date = alert.date ? formatDate(alert.date) : '';
  const days = alert.days;
  const copy = {
    ending_soon: {
      title: t(
        'medications.cycleBanner.endingSoon',
        '{{name}}: cycle ends in {{count}} days',
        { name, count: days }
      ),
      body: t(
        'medications.cycleBanner.endingSoonBody',
        'Planned last dose {{date}}.',
        { date }
      ),
    },
    last_dose: {
      title: t(
        'medications.cycleBanner.lastDose',
        '{{name}}: last dose of the cycle',
        { name }
      ),
      body: t(
        'medications.cycleBanner.lastDoseBody',
        'Today ({{date}}) is the final day of this run.',
        { date }
      ),
    },
    stop_now: {
      title: t(
        'medications.cycleBanner.stopNow',
        '{{name}}: planned run is over',
        { name }
      ),
      body: t(
        'medications.cycleBanner.stopNowBody',
        'The run finished on {{date}} but the course is still active. Open the course to end the cycle.',
        { date }
      ),
    },
    restart_soon: {
      title: t(
        'medications.cycleBanner.restartSoon',
        '{{name}}: restart in {{count}} days',
        { name, count: days }
      ),
      body: t(
        'medications.cycleBanner.restartSoonBody',
        'The break ends {{date}}; the next cycle starts then.',
        { date }
      ),
    },
    restart_now: {
      title: t(
        'medications.cycleBanner.restartNow',
        '{{name}}: back on today',
        {
          name,
        }
      ),
      body: t(
        'medications.cycleBanner.restartNowBody',
        'The break is over. Open the course to start the next cycle.'
      ),
    },
    off_cycle: { title: '', body: '' },
  }[alert.kind];
  const Icon = alert.kind.startsWith('restart') ? RotateCw : AlertTriangle;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-medium">{copy.title}</p>
        <p className="text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  );
}
