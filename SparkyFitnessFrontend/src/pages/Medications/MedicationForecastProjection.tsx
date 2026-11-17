import { useTranslation } from 'react-i18next';
import type {
  MedicationForecastProjection,
  MedicationForecastCycleAssumption,
} from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';

import { isConditionalCoverage } from './medicationForecastClaims';

export function MedicationForecastProjectionNotice({
  projection,
}: {
  projection: MedicationForecastProjection;
}) {
  const { t } = useTranslation();
  const conditional =
    isConditionalCoverage(projection) ||
    (projection.claim_basis === 'unknown' && projection.provisional_slots > 0);
  return conditional ? (
    <p className="text-sm text-muted-foreground">
      {t(
        'medications.forecasts.projection.assumes',
        'Assumes planned manual restart(s).'
      )}
    </p>
  ) : null;
}
export function MedicationForecastCycleAssumptions({
  assumptions,
  forecastTimezone,
}: {
  assumptions: MedicationForecastCycleAssumption[];
  forecastTimezone: string;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  if (assumptions.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-3 text-sm">
      <h4 className="font-semibold">
        {t(
          'medications.forecasts.projection.assumptions',
          'Planned manual restart assumptions'
        )}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.forecasts.projection.manualOnly',
          'Restarting each course requires manual confirmation. This forecast does not start or reopen a course.'
        )}
      </p>
      <ol className="space-y-3">
        {assumptions.map((assumption) => (
          <li key={assumption.revision_id} className="space-y-1">
            <p className="break-words font-medium">{assumption.plan_name}</p>
            <p>
              {t(
                'medications.forecasts.projection.weeks',
                'Run for {{on}} weeks; break {{off}} weeks',
                { on: assumption.on_weeks, off: assumption.off_weeks }
              )}
            </p>
            <p>
              {t(
                'medications.forecasts.projection.committedEnd',
                'Committed through'
              )}
              : {formatDate(assumption.committed_end_date)} (
              {assumption.timezone})
            </p>
            <p>
              {t(
                'medications.forecasts.projection.plannedRestart',
                'Planned restart date'
              )}
              : {formatDate(assumption.next_restart_date)} (
              {assumption.timezone})
            </p>
            <p>
              {assumption.projection_starts_on
                ? t(
                    'medications.forecasts.projection.firstProjected',
                    'First projected administration: {{date}} ({{timezone}})',
                    {
                      date: formatDate(assumption.projection_starts_on),
                      timezone: forecastTimezone,
                    }
                  )
                : t(
                    'medications.forecasts.projection.dateUnavailable',
                    'First projected administration date is unavailable.'
                  )}
            </p>
            {assumption.overdue && (
              <p className="rounded-md border p-2 text-foreground">
                {t(
                  'medications.forecasts.projection.overdue',
                  'This planned restart date has passed. Restarting still requires manual confirmation.'
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
