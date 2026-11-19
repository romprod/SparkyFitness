import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  resolvePreparedMedicationRoute,
  type MedicationPreparationQueueItem,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useMedicationStockDashboard,
  usePreparationQueueStock,
} from '@/hooks/Medications/useMedicationStockDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import MedicationPreparationWizard from './MedicationPreparationWizard';

function QueuePreparation({
  row,
  med,
  onClose,
}: {
  row: MedicationPreparationQueueItem;
  med: Medication;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { scope, query, data } = usePreparationQueueStock(
    row.medication_id,
    row.stock_id,
    true
  );
  if (!scope.ready || !scope.canWrite || !scope.isCurrent()) return null;
  if (query.isError)
    return (
      <div
        role="alert"
        className="mt-3 space-y-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-foreground"
      >
        <p>
          {t(
            'medications.stockDashboard.queueChanged',
            'This vial could not be revalidated for preparation. Refresh the queue before trying again.'
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {t('medications.stockDashboard.retry', 'Try again')}
        </Button>
      </div>
    );
  if (!data || !query.isFetchedAfterMount)
    return (
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {t(
          'medications.stockDashboard.checkingVial',
          'Checking this existing vial…'
        )}
      </p>
    );
  if (data.row.route !== resolvePreparedMedicationRoute(med))
    return (
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {t(
          'medications.stockDashboard.medicationUnavailable',
          'Medication details are unavailable. Refresh this page before preparing the vial.'
        )}
      </p>
    );
  return (
    <MedicationPreparationWizard
      inline
      med={med}
      pen={data.pen}
      onClose={onClose}
      queueContext={{
        state: data.row.preparation_queue_state,
        isCurrent: () =>
          scope.isCurrent() &&
          scope.canWrite &&
          !query.isFetching &&
          !query.isError &&
          data.pen.id === row.stock_id &&
          data.pen.medication_id === med.id,
      }}
    />
  );
}

export function MedicationPreparationQueueEntry({
  row,
  med,
  canWrite,
  compact = false,
  footer,
}: {
  row: MedicationPreparationQueueItem;
  med: Medication | undefined;
  canWrite: boolean;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const [open, setOpen] = useState(false);
  const metadata = row.expiry_date ? (
    <span className="block text-sm text-muted-foreground">
      {t('medications.stockDashboard.expiry', 'Expiry')}:{' '}
      {formatDate(row.expiry_date)}{' '}
      {row.expired && (
        <Badge
          variant="outline"
          className="border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
        >
          {t('medications.stockDashboard.expired', 'Expired')}
        </Badge>
      )}
    </span>
  ) : null;
  const customLabel =
    row.label &&
    row.label !== row.medication_name &&
    row.label.replace(/\s/g, '').toLowerCase() !== `${row.label_mass_mg}mg`;
  const identity = (
    <span className="block min-w-0 flex-1 space-y-1">
      <span className="block break-words font-medium">
        {row.medication_name}
        {customLabel && !compact ? ` · ${row.label}` : ''}
      </span>
      {compact ? (
        <span className="block text-sm text-muted-foreground">
          {customLabel ? `${row.label} · ` : ''}
          {row.label_mass_mg ? `${row.label_mass_mg} mg vial · ` : ''}
          {t(
            'medications.stockDashboard.needsPreparation',
            'Needs preparation'
          ).toLowerCase()}
        </span>
      ) : (
        <>
          {row.label_mass_mg !== null && (
            <span className="block text-sm text-muted-foreground">
              {t('medications.labelMass.label', 'Vial label amount (mg)')}:{' '}
              {row.label_mass_mg}
            </span>
          )}
          {metadata}
        </>
      )}
    </span>
  );
  if (!canWrite)
    return (
      <div className="space-y-2 rounded-md border p-3">
        {identity}
        {compact && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              {t('medications.stockLayout.details', 'Details')}
            </summary>
            {metadata}
          </details>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.stockDashboard.readOnly',
            'Preparing stock requires medication edit access.'
          )}
        </p>
      </div>
    );
  return (
    <div
      className={
        compact
          ? 'min-w-0 rounded-xl border bg-card text-card-foreground'
          : undefined
      }
    >
      <details
        className={compact ? 'min-w-0 p-4' : 'min-w-0 rounded-md border p-3'}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className={
            compact
              ? 'list-none cursor-pointer [&::-webkit-details-marker]:hidden'
              : 'cursor-pointer'
          }
        >
          <span
            className={
              compact
                ? 'flex w-full items-center justify-between gap-3'
                : 'inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-2 align-top'
            }
          >
            {identity}
            <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {t('medications.stockDashboard.prepare', 'Prepare')} ›
            </span>
          </span>
        </summary>
        {open &&
          (med ? (
            <QueuePreparation
              row={row}
              med={med}
              onClose={() => setOpen(false)}
            />
          ) : (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {t(
                'medications.stockDashboard.medicationUnavailable',
                'Medication details are unavailable. Refresh this page before preparing the vial.'
              )}
            </p>
          ))}
        {compact && open && (
          <div className="mt-3 space-y-3">
            {metadata}
            {footer}
          </div>
        )}
      </details>
      {!compact && footer}
    </div>
  );
}

export default function MedicationPreparationQueue({
  meds,
}: {
  meds: Medication[];
}) {
  const { t } = useTranslation();
  const { scope, query, data } = useMedicationStockDashboard();
  if (!scope.ready || !scope.isCurrent()) return null;
  if (!query.isError && (!data || data.preparation_queue.length === 0))
    return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(
            'medications.stockDashboard.needsPreparation',
            'Needs preparation'
          )}
          {!query.isError && data && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t('medications.stockDashboard.needsPreparationCount', {
                count: data.preparation_queue.length,
                defaultValue_one: '{{count}} vial',
                defaultValue_other: '{{count}} vials',
              })}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-foreground"
          >
            <p>
              {t(
                'medications.stockDashboard.queueError',
                'Could not load the preparation queue. No preparation eligibility is assumed.'
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t('medications.stockDashboard.retry', 'Try again')}
            </Button>
          </div>
        ) : (
          data?.preparation_queue.map((row) => (
            <MedicationPreparationQueueEntry
              key={`${scope.key}:${row.stock_id}`}
              row={row}
              med={meds.find((med) => med.id === row.medication_id)}
              canWrite={scope.canWrite}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
