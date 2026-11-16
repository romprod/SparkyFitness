import { useTranslation } from 'react-i18next';
import type { MedicationCourseCycleState } from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';

type Dates = Pick<
  MedicationCourseCycleState,
  'anchor_date' | 'planned_stop_date' | 'next_restart_date' | 'timezone'
>;
export default function MedicationCourseCycleDates({
  dates,
}: {
  dates: Dates;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid gap-1 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">
            {t('medications.courseCycles.anchorDate', 'Weekly cycle anchor')}
          </dt>
          <dd>{dates.anchor_date ? formatDate(dates.anchor_date) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t('medications.courseCycles.plannedStop', 'Planned cycle stop')}
          </dt>
          <dd>
            {dates.planned_stop_date
              ? formatDate(dates.planned_stop_date)
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t(
              'medications.courseCycles.plannedRestart',
              'Next planned restart'
            )}
          </dt>
          <dd>
            {dates.next_restart_date
              ? formatDate(dates.next_restart_date)
              : '—'}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {t('medications.courses.zone', 'Plan timezone')}: {dates.timezone}
      </p>
    </div>
  );
}
