import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import {
  daysBetween,
  type MedicationForecastPlannedCoverage,
} from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { MedicationForecastProjectionNotice } from './MedicationForecastProjection';
import {
  isNextCycleShortage,
  isConditionalCoverage,
} from './medicationForecastClaims';
import { useMedicationStockDashboard } from '@/hooks/Medications/useMedicationStockDashboard';

/** The server chooses the supply row from the current overall forecast snapshot. */
export default function MedicationSupplyTile() {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { scope, query, data } = useMedicationStockDashboard();
  if (!scope.ready || !scope.isCurrent()) return null;

  const supplyLine = (coverage: MedicationForecastPlannedCoverage) => {
    if (coverage.status === 'reorder_now' && isNextCycleShortage(coverage))
      return t(
        'medications.forecasts.projection.reorderNow',
        'Reorder now for next cycle'
      );
    if (
      coverage.status === 'ok' &&
      coverage.reorder_by &&
      isNextCycleShortage(coverage)
    )
      return t(
        'medications.forecasts.projection.reorderBy',
        'Reorder by {{date}} for next cycle',
        { date: formatDate(coverage.reorder_by) }
      );
    if (
      coverage.status === 'covered' &&
      coverage.coverage_through &&
      isConditionalCoverage(coverage.projection)
    )
      return t(
        'medications.forecasts.projection.supplyCovered',
        'Covers planned doses through {{date}}',
        { date: formatDate(coverage.coverage_through) }
      );
    if (coverage.status === 'reorder_now')
      return t('medications.stockDashboard.supplyReorderNow', 'Reorder now');
    if (coverage.status === 'ok' && coverage.reorder_by)
      return t(
        'medications.stockDashboard.supplyReorderBy',
        'Reorder by {{date}}',
        { date: formatDate(coverage.reorder_by) }
      );
    if (coverage.status === 'covered' && coverage.coverage_through) {
      const date = formatDate(coverage.coverage_through);
      if (coverage.basis === 'course_end')
        return t(
          'medications.stockDashboard.supplyCoveredCourse',
          'Covers committed doses through {{date}}',
          { date }
        );
      if (coverage.basis === 'horizon')
        return t(
          'medications.stockDashboard.supplyCoveredHorizon',
          'Covers planned doses through {{date}} (forecast window)',
          { date }
        );
      if (coverage.basis === 'slot_cap')
        return t(
          'medications.stockDashboard.supplyCoveredLimit',
          'Covers planned doses through {{date}} (forecast limit)',
          { date }
        );
    }
    return t('medications.stockDashboard.supplyUnknown', 'Coverage unknown');
  };
  const header = (
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-base">
        <Package className="h-4 w-4" />
        {t('medications.stockDashboard.supplyTitle', 'Supply')}
      </CardTitle>
    </CardHeader>
  );

  if (query.isError || (!data && !query.isLoading && !query.isFetching))
    return (
      <Card>
        {header}
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              'medications.stockDashboard.supplyUnavailable',
              'Supply unavailable'
            )}
          </p>
        </CardContent>
      </Card>
    );
  if (!data)
    return (
      <Card>
        {header}
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {t('medications.stockDashboard.supplyLoading', 'Loading supply…')}
          </p>
        </CardContent>
      </Card>
    );
  if (data.supply.state === 'no_demand')
    return (
      <Card>
        {header}
        <CardContent className="space-y-1">
          <p className="text-sm">
            {t(
              'medications.stockDashboard.supplyNoDemand',
              'No injectable or nasal doses in the forecast window'
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.stockDashboard.supplyWindow',
              '{{days}}-day forecast window',
              { days: data.forecast.horizon_days }
            )}
          </p>
        </CardContent>
      </Card>
    );

  const selected =
    data.supply.medication_id === null
      ? undefined
      : data.forecast.medications.find(
          (item) => item.medication_id === data.supply.medication_id
        );
  if (
    !selected ||
    (data.supply.state === 'unavailable' && selected.status !== 'unknown')
  )
    return (
      <Card>
        {header}
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              'medications.stockDashboard.supplyUnavailable',
              'Supply unavailable'
            )}
          </p>
        </CardContent>
      </Card>
    );

  // Whole days the stock reaches, as Pitstop's tile leads with: to the last dose it covers, or to
  // the day it runs short. Unknown coverage has no figure.
  const reachedDay =
    selected.status === 'covered'
      ? selected.coverage_through
      : selected.status === 'ok' || selected.status === 'reorder_now'
        ? selected.depletion_date
        : null;
  const coverageDays =
    reachedDay === null
      ? null
      : Math.max(0, daysBetween(data.forecast.today, reachedDay));
  return (
    <Link
      to="/medications?tab=stock"
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="transition-colors hover:bg-muted/20">
        {header}
        <CardContent className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-medium">{selected.name}</p>
              <p className="text-sm text-muted-foreground">
                {supplyLine(selected)}
              </p>
            </div>
            {coverageDays !== null && (
              <p className="shrink-0 text-right tabular-nums">
                <span className="text-2xl font-semibold">{coverageDays}</span>{' '}
                <span className="text-sm text-muted-foreground">
                  {t('medications.stockDashboard.supplyDaysUnit', 'days', {
                    count: coverageDays,
                  })}
                </span>
              </p>
            )}
          </div>
          <MedicationForecastProjectionNotice
            projection={selected.projection}
          />
          {selected.cycle_assumptions.some(
            (assumption) => assumption.overdue
          ) && (
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.forecasts.projection.supplyOverdue',
                'One or more planned restarts are overdue; restarting remains manual.'
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
