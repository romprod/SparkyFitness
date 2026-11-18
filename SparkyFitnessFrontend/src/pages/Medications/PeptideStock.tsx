import { resolvePreparedMedicationRoute } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
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
  const moreRef = useRef<HTMLButtonElement>(null);
  const [addMedication, setAddMedication] = useState<string | null>(null);
  const [counts, setCounts] = useState<
    Record<string, { active: number; closed: number }>
  >({});
  const reportCounts = useCallback(
    (medicationId: string, value: { active: number; closed: number }) => {
      const key = `${scope.key}:${medicationId}`;
      setCounts((previous) =>
        previous[key]?.active === value.active &&
        previous[key]?.closed === value.closed
          ? previous
          : { ...previous, [key]: value }
      );
    },
    [scope.key]
  );
  const activeCount = injectables.reduce(
    (sum, med) => sum + (counts[`${scope.key}:${med.id}`]?.active ?? 0),
    0
  );
  const closedCount = injectables.reduce(
    (sum, med) => sum + (counts[`${scope.key}:${med.id}`]?.closed ?? 0),
    0
  );
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
      onStockCounts={stockView === 'active' ? reportCounts : undefined}
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
        <div className="flex min-w-0 w-full items-end gap-2 xl:w-auto">
          {selected && (
            <div className="min-w-0 flex-1 space-y-1 xl:w-52">
              <Label
                htmlFor="stock-medication"
                className="block truncate text-xs"
              >
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
                <SelectTrigger
                  id="stock-medication"
                  className="min-w-0 w-full [&>span]:truncate"
                >
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
              stockMoreRef={moreRef}
              stockOnAddMedication={() => setAddMedication(scope.key)}
            />
          )}
          {!selected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={moreRef}
                  variant="outline"
                  size="icon"
                  aria-label={t(
                    'medications.stockLayout.more',
                    'More stock tools'
                  )}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAddMedication(scope.key)}>
                  {t('medications.stock.add', 'Add peptide / injectable')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <AddMedicationDialog
        key={`${scope.key}:add-medication`}
        defaultTypeId="injection"
        trigger={false}
        open={addMedication === scope.key && scope.ready && scope.isCurrent()}
        onOpenChange={(open) => setAddMedication(open ? scope.key : null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          moreRef.current?.focus();
        }}
      />
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
            {injectables.length > 0 &&
              injectables.every(
                (med) => counts[`${scope.key}:${med.id}`] !== undefined
              ) &&
              activeCount === 0 &&
              closedCount === 0 &&
              queue.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.stockLayout.emptyAll',
                    'No vials yet. Add your first vial to start tracking stock.'
                  )}
                </p>
              )}
            {activeCount > 0 && (
              <h3 className="text-sm font-semibold">
                {t('medications.stockLayout.inUse', 'In use')}
              </h3>
            )}
            <section
              aria-label={t('medications.stockLayout.tracked', 'Tracked stock')}
              className="grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3"
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
                  <div className="grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3">
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
            {closedCount > 0 && (
              <details className="rounded-lg border bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {t(
                    'medications.stock.finishedDiscarded',
                    'Finished / discarded'
                  )}
                </summary>
                <div className="mt-3 grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3">
                  {injectables.map((med) => manager(med, 'closed'))}
                </div>
              </details>
            )}
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
