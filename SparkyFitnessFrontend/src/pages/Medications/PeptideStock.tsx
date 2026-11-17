import { resolvePreparedMedicationRoute } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Medication } from '@/types/medications';
import AddMedicationDialog from './AddMedicationDialog';
import Glp1InventoryManager from './Glp1InventoryManager';
import MedicationInventoryForecast from './MedicationInventoryForecast';
import { MedicationPreparationQueueEntry } from './MedicationPreparationQueue';
import { useMedicationInventoryForecast } from '@/hooks/Medications/useMedicationInventoryForecast';
import { useMedicationStockDashboard } from '@/hooks/Medications/useMedicationStockDashboard';

/** All-stock presentation; Cabinet keeps its existing medication-specific inventory. */
export default function PeptideStock({ meds }: { meds: Medication[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const forecast = useMedicationInventoryForecast();
  const dashboard = useMedicationStockDashboard();
  const injectables = meds.filter(
    (m) => resolvePreparedMedicationRoute(m) !== null
  );
  const selected =
    injectables.find((m) => m.id === params.get('medication')) ??
    injectables.find((m) => m.is_active) ??
    injectables[0];
  const scope = dashboard.scope;
  const queue = !dashboard.query.isError
    ? (dashboard.data?.preparation_queue ?? [])
    : [];
  const manager = (
    med: Medication,
    stockView: 'active' | 'closed' | 'queue'
  ) => (
    <Glp1InventoryManager
      key={`${scope.key}:${med.id}:${stockView}`}
      med={med}
      stockView={stockView}
      stockCanWrite={scope.canWrite}
      queueItems={queue.filter((row) => row.medication_id === med.id)}
      forecastTimezone={forecast.data?.timezone}
      forecast={
        !forecast.query.isError
          ? forecast.data?.medications.find(
              (item) => item.medication_id === med.id
            )
          : undefined
      }
    />
  );
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">
            {t('medications.stock.title', 'Preparation & stock')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.stockLayout.subtitle',
              'Vials, preparation and remaining stock across your medications.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {selected && (
            <div className="w-full space-y-1 sm:w-52">
              <Label htmlFor="stock-medication" className="text-xs">
                {t(
                  'medications.stockLayout.newStockMedication',
                  'Medication for new stock'
                )}
              </Label>
              <Select
                value={selected.id}
                onValueChange={(id) =>
                  setParams((previous) => {
                    const next = new URLSearchParams(previous);
                    next.set('tab', 'stock');
                    next.set('medication', id);
                    return next;
                  })
                }
              >
                <SelectTrigger id="stock-medication">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {injectables.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.display_name || m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selected && scope.ready && scope.isCurrent() && (
            <Glp1InventoryManager
              key={`${scope.key}:${selected.id}:controls`}
              med={selected}
              stockView="controls"
              stockCanWrite={scope.canWrite}
            />
          )}
          <AddMedicationDialog
            defaultTypeId="injection"
            trigger={
              <Button variant="ghost" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                {t('medications.stock.add', 'Add peptide / injectable')}
              </Button>
            }
          />
        </div>
      </header>
      {!selected && (
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.stock.empty',
            'Add your peptide as an injection to start. Existing injectable medications appear here automatically.'
          )}
        </p>
      )}
      {scope.ready && scope.isCurrent() && dashboard.query.isError && (
        <div role="alert" className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t(
              'medications.stockDashboard.queueError',
              'Could not load the preparation queue. No preparation eligibility is assumed.'
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void dashboard.query.refetch()}
          >
            {t('medications.stockDashboard.retry', 'Try again')}
          </Button>
        </div>
      )}
      {scope.ready &&
        scope.isCurrent() &&
        !dashboard.data &&
        !dashboard.query.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('medications.stockLayout.loading', 'Loading current stock…')}
          </p>
        )}
      {scope.ready &&
        scope.isCurrent() &&
        dashboard.data &&
        !dashboard.query.isError && (
          <div key={scope.key} className="space-y-6">
            <section
              aria-label={t('medications.stockLayout.tracked', 'Tracked stock')}
              className="grid min-w-0 gap-3 lg:grid-cols-2"
            >
              {injectables.map((med) => manager(med, 'active'))}
            </section>
            {(queue.length > 0 || dashboard.query.isError) && (
              <section
                className="space-y-3"
                aria-labelledby="needs-preparation-heading"
              >
                <h3
                  id="needs-preparation-heading"
                  className="text-sm font-semibold"
                >
                  {t(
                    'medications.stockDashboard.needsPreparation',
                    'Needs preparation'
                  )}
                </h3>
                {dashboard.query.isError ? (
                  <p role="alert" className="text-sm text-muted-foreground">
                    {t(
                      'medications.stockDashboard.queueError',
                      'Could not load the preparation queue. No preparation eligibility is assumed.'
                    )}
                  </p>
                ) : (
                  <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                    {injectables.map((med) => manager(med, 'queue'))}
                    {queue
                      .filter(
                        (row) =>
                          !injectables.some(
                            (med) => med.id === row.medication_id
                          )
                      )
                      .map((row) => (
                        <MedicationPreparationQueueEntry
                          key={row.stock_id}
                          row={row}
                          med={undefined}
                          canWrite={false}
                          compact
                        />
                      ))}
                  </div>
                )}
              </section>
            )}
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t(
                  'medications.stock.finishedDiscarded',
                  'Finished / discarded'
                )}
              </summary>
              <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
                {injectables.map((med) => manager(med, 'closed'))}
              </div>
            </details>
          </div>
        )}
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t('medications.forecasts.title', 'Stock forecasts')}
        </summary>
        <div className="mt-4">
          <MedicationInventoryForecast />
        </div>
      </details>
    </div>
  );
}
