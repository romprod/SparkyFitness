import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  MedicationForecastPlannedCoverage,
  MedicationInventoryPlannedForecast,
} from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  MedicationForecastProjectionNotice,
  MedicationForecastCycleAssumptions,
} from './MedicationForecastProjection';
import {
  isNextCycleShortage,
  isConditionalCoverage,
} from './medicationForecastClaims';
import { useMedicationInventoryForecast } from '@/hooks/Medications/useMedicationInventoryForecast';

const limitationCopy: Record<
  MedicationForecastPlannedCoverage['limitations'][number],
  string
> = {
  no_managed_plan: 'No committed versioned plan is available.',
  unknown_projection_date:
    'A projected administration has no specified time and uses a different calendar, so coverage dates cannot be determined.',
  date_out_of_range: 'Plan dates exceed the supported forecast calendar range.',
  no_forecast_slots: 'No future planned administrations could be evaluated.',
  unmodelled_legacy_demand: 'Legacy schedule demand is not fully modelled.',
  unknown_dose: 'A planned amount or phase is unknown.',
  unsupported_unit: 'A planned unit cannot be sized against this stock.',
  missing_device: 'A saved compatible device is needed.',
  incompatible_device:
    'The selected device is not compatible with this medication.',
  unknown_stock: 'Some stock quantities or preparation details are unknown.',
  unknown_bud:
    'Usable life is unknown because a beyond-use date is not recorded.',
  sealed_stock_excluded: 'Sealed stock is excluded from prepared coverage.',
  unsupported_route:
    'This administration route is not supported by the forecast.',
  blocked_draw:
    'A planned administration cannot be measured with the available stock and device.',
  preferred_device_basis:
    'The saved preferred device is used where a plan has no explicit selection.',
};
const basisCopy = {
  unknown: 'Unknown coverage',
  course_end: 'Committed course end',
  horizon: 'Forecast horizon reached',
  slot_cap: 'Planned-administration limit reached',
  depleted: 'Stock exhausted within evaluated demand',
};

export function MedicationForecastCoverageDetails({
  coverage,
  preparedOnly = false,
  timezone,
}: {
  coverage: MedicationForecastPlannedCoverage;
  preparedOnly?: boolean;
  timezone?: string;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">
        {t(
          `medications.forecasts.basis.${coverage.basis}`,
          basisCopy[coverage.basis]
        )}
      </p>
      {isNextCycleShortage(coverage) && (
        <p className="text-sm font-medium">
          {t('medications.forecasts.projection.forNextCycle', 'For next cycle')}
        </p>
      )}
      <MedicationForecastProjectionNotice projection={coverage.projection} />
      {coverage.status !== 'unknown' && (
        <dl className="grid gap-1 sm:grid-cols-2">
          {coverage.coverage_through && (
            <div>
              <dt className="inline text-muted-foreground">
                {t('medications.forecasts.through', 'Coverage through')}:{' '}
              </dt>
              <dd className="inline">
                {formatDate(coverage.coverage_through)}
              </dd>
            </div>
          )}
          {coverage.depletion_date && (
            <div>
              <dt className="inline text-muted-foreground">
                {t(
                  'medications.forecasts.projection.coverageEnd',
                  'Stock coverage ends'
                )}
                :{' '}
              </dt>
              <dd className="inline">{formatDate(coverage.depletion_date)}</dd>
            </div>
          )}
          {!preparedOnly && coverage.reorder_by && (
            <div>
              <dt className="inline text-muted-foreground">
                {t('medications.forecasts.reorderBy', 'Order by')}:{' '}
              </dt>
              <dd className="inline">{formatDate(coverage.reorder_by)}</dd>
            </div>
          )}
          {coverage.projection.first_unserved_day && (
            <div>
              <dt className="inline text-muted-foreground">
                {t(
                  'medications.forecasts.projection.firstUnserved',
                  'First unserved planned administration'
                )}
                :{' '}
              </dt>
              <dd className="inline">
                {formatDate(coverage.projection.first_unserved_day)}
              </dd>
            </div>
          )}
          {coverage.days_left != null && (
            <div>
              <dt className="inline text-muted-foreground">
                {t('medications.forecasts.daysLeft', 'Days covered')}:{' '}
              </dt>
              <dd className="inline">{coverage.days_left}</dd>
            </div>
          )}
          <div>
            <dt className="inline text-muted-foreground">
              {t(
                'medications.forecasts.slots',
                'Planned administrations covered'
              )}
              :{' '}
            </dt>
            <dd className="inline">
              {coverage.served_slots} / {coverage.expected_slots}
            </dd>
          </div>
        </dl>
      )}
      {timezone && (
        <p className="text-xs text-muted-foreground">
          {t('medications.forecasts.projection.calendar', 'Forecast calendar')}:{' '}
          {timezone}
        </p>
      )}
      {coverage.limitations.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          {coverage.limitations.map((reason) => (
            <li key={reason}>
              {t(
                `medications.forecasts.limitations.${reason}`,
                limitationCopy[reason]
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MedicationContainerForecast({
  container,
  timezone,
}: {
  container: MedicationInventoryPlannedForecast['containers'][number];
  timezone?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2 rounded-md border bg-muted/10 p-3 text-sm">
      <p className="font-medium">
        {t(
          'medications.forecasts.containerTitle',
          'Prepared-container forecast'
        )}
      </p>
      <p>
        {t(
          'medications.forecasts.remainingAdministrations',
          'Remaining measurable administrations'
        )}
        : {container.remaining_doses ?? '—'}
      </p>
      {container.current_dose && (
        <p className="text-muted-foreground">
          {t('medications.forecasts.currentAmount', 'Current planned amount')}:{' '}
          {container.current_dose.value} {container.current_dose.unit}
        </p>
      )}
      <MedicationForecastCoverageDetails
        coverage={container.coverage}
        timezone={timezone}
        preparedOnly
      />
    </div>
  );
}

export default function MedicationInventoryForecast() {
  const { t } = useTranslation();
  const { formatDateInUserTimezone } = usePreferences();
  const { scope, data, query } = useMedicationInventoryForecast();
  if (!scope.ready || !scope.isCurrent()) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('medications.forecasts.title', 'Stock forecasts')}
        </CardTitle>
        <CardDescription>
          {t(
            'medications.forecasts.description',
            'Current stock against committed doses and planned-cycle assumptions. Estimates do not place orders or start cycles; unknown details can prevent a reliable run-out date.'
          )}
        </CardDescription>
        {scope.actorId === scope.ownerId && (
          <Button variant="link" className="h-auto justify-start px-0" asChild>
            <Link to="/settings?section=medication-reorder-defaults">
              {t('medications.forecasts.defaultsLink', 'Reorder defaults')}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading && (
          <p role="status">
            {t(
              'medications.forecasts.loading',
              'Loading current stock forecast…'
            )}
          </p>
        )}
        {query.isError ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground"
          >
            <p>
              {t(
                'medications.forecasts.loadError',
                'Could not load the stock forecast. No run-out estimate is available.'
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
        ) : (
          data && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('medications.forecasts.asOf', 'Current as of')}{' '}
                {formatDateInUserTimezone(data.as_of, 'dd MMM yyyy, HH:mm')} ·{' '}
                {t(
                  'medications.forecasts.horizon',
                  'Up to {{days}} days or {{slots}} planned administrations.',
                  { days: data.horizon_days, slots: data.max_slots }
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.forecasts.defaultsBasis',
                  'Lead time {{lead}} days; safety buffer {{buffer}} days.',
                  {
                    lead: data.defaults.lead_days,
                    buffer: data.defaults.buffer_days,
                  }
                )}
              </p>
              {data.medications.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.forecasts.empty',
                    'No compatible medications are available for a stock forecast.'
                  )}
                </p>
              )}
              {data.medications.map((medication) => (
                <section
                  key={medication.medication_id}
                  aria-label={medication.name}
                  className="min-w-0 space-y-3 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="min-w-0 break-words font-semibold">
                      {medication.name}
                    </h3>
                    <Badge
                      variant="outline"
                      className={
                        medication.status === 'reorder_now'
                          ? 'border-destructive/50 bg-destructive/10 text-foreground hover:bg-destructive/10'
                          : ''
                      }
                    >
                      {medication.status === 'covered' &&
                      isConditionalCoverage(medication.projection)
                        ? t(
                            'medications.forecasts.projection.covered',
                            'Planned demand covered'
                          )
                        : t(
                            `medications.forecasts.status.${medication.status}`,
                            {
                              unknown: 'Unknown',
                              covered: 'Committed demand covered',
                              ok: 'Stock available',
                              reorder_now: 'Reorder window reached',
                            }[medication.status]
                          )}
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">
                        {t(
                          'medications.forecasts.overall',
                          'Overall stock coverage'
                        )}
                      </h4>
                      <MedicationForecastCoverageDetails
                        coverage={medication}
                        timezone={data.timezone}
                      />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">
                        {t(
                          'medications.forecasts.preparedOnly',
                          'Prepared stock only'
                        )}
                      </h4>
                      <MedicationForecastCoverageDetails
                        coverage={medication.prepared_only}
                        timezone={data.timezone}
                        preparedOnly
                      />
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'medications.forecasts.preparedScope',
                          'Prepared coverage alone does not establish when to buy more stock.'
                        )}
                      </p>
                    </div>
                  </div>
                  <MedicationForecastCycleAssumptions
                    assumptions={medication.cycle_assumptions}
                    forecastTimezone={data.timezone}
                  />
                  {medication.device_basis.length > 0 && (
                    <div className="space-y-1 text-sm">
                      <h4 className="font-semibold">
                        {t('medications.forecasts.deviceBasis', 'Device basis')}
                      </h4>
                      {medication.device_basis.map((device) => (
                        <p
                          key={`${device.plan_kind}:${device.plan_id}`}
                          className="break-words text-muted-foreground"
                        >
                          {device.device_name ??
                            t(
                              'medications.forecasts.missingDevice',
                              'No usable saved device'
                            )}{' '}
                          ·{' '}
                          {t(
                            `medications.forecasts.deviceSource.${device.source}`,
                            {
                              plan: 'Selected for the plan',
                              preferred: 'Saved preferred device',
                              missing: 'Missing device selection',
                              incompatible: 'Incompatible device selection',
                            }[device.source]
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
