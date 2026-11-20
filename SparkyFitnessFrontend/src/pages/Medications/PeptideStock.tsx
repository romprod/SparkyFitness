import {
  resolvePreparedMedicationRoute,
  type MedicationPackView,
} from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import MedicationPackCard from './MedicationPackCard';
import MedicationPackDialog from './MedicationPackDialog';
import {
  useDeletePackMutation,
  useMedicationPacks,
  useUpdatePackMutation,
} from '@/hooks/Medications/useMedicationPacks';
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
  const packsQuery = useMedicationPacks();
  const updatePack = useUpdatePackMutation();
  const deletePack = useDeletePackMutation();
  const [packDialog, setPackDialog] = useState<{
    pack?: MedicationPackView;
  } | null>(null);
  const [packToDelete, setPackToDelete] = useState<MedicationPackView | null>(
    null
  );
  const allPacks =
    scope.ready && scope.isCurrent() && !packsQuery.query.isError
      ? (packsQuery.data?.packs ?? [])
      : [];
  const openPacks = allPacks.filter((pack) => pack.status === 'in_use');
  const sealedPacks = allPacks.filter((pack) => pack.status === 'sealed');
  const closedPacks = allPacks.filter(
    (pack) => pack.status === 'finished' || pack.status === 'discarded'
  );
  const packMedications = meds
    .filter((m) => resolvePreparedMedicationRoute(m) === null)
    .sort((a, b) => Number(b.is_active) - Number(a.is_active));
  const packActions = {
    onOpen: (pack: MedicationPackView) =>
      updatePack.mutate({
        id: pack.id,
        body: { status: 'in_use', lifecycle_intent: true },
      }),
    onFinish: (pack: MedicationPackView) =>
      updatePack.mutate({
        id: pack.id,
        body: { status: 'finished', lifecycle_intent: true },
      }),
    onEdit: (pack: MedicationPackView) => setPackDialog({ pack }),
    onDelete: (pack: MedicationPackView) => setPackToDelete(pack),
  };
  const packCards = (list: MedicationPackView[]) =>
    list.map((pack) => (
      <MedicationPackCard
        key={pack.id}
        pack={pack}
        canWrite={scope.canWrite}
        actions={packActions}
      />
    ));
  const moreRef = useRef<HTMLButtonElement>(null);
  const [request, setRequest] = useState<{
    medicationId: string;
    kind: 'add' | 'prepare';
  } | null>(null);
  const [choosing, setChoosing] = useState<'add' | 'prepare' | null>(null);
  const [chosenMedication, setChosenMedication] = useState('');
  const chooseVialMedication = (kind: 'add' | 'prepare') => {
    const [only] = injectables;
    if (injectables.length === 1 && only) {
      setRequest({ medicationId: only.id, kind });
      return;
    }
    setChosenMedication(selected?.id ?? '');
    setChoosing(kind);
  };
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
  // Compounds that exist but have no vial or pen at all, which the stock lists above would not show.
  const noStock = injectables.filter((med) => {
    const seen = counts[`${scope.key}:${med.id}`];
    return (
      med.is_active &&
      seen !== undefined &&
      seen.active === 0 &&
      seen.closed === 0 &&
      !queue.some((row) => row.medication_id === med.id)
    );
  });
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
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">
            {t('medications.stock.title', 'Inventory')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.stockLayout.subtitle',
              'Vials, concentration, and how long each lasts.'
            )}
          </p>
        </div>
        {scope.ready && scope.isCurrent() && scope.canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={moreRef} className="shrink-0 self-start">
                <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
                {t('medications.stockLayout.addStock', 'Add stock')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {injectables.length > 0 && (
                <DropdownMenuItem onSelect={() => chooseVialMedication('add')}>
                  {t('medications.stockLayout.addVial', 'Add a vial or pen')}
                </DropdownMenuItem>
              )}
              {injectables.length > 0 && (
                <DropdownMenuItem
                  onSelect={() => chooseVialMedication('prepare')}
                >
                  {t('medications.stock.prepare', 'Prepare a vial')}
                </DropdownMenuItem>
              )}
              {packMedications.length > 0 && (
                <DropdownMenuItem onSelect={() => setPackDialog({})}>
                  {t('medications.packs.add', 'Add pack')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setAddMedication(scope.key)}>
                {t('medications.stock.add', 'Add peptide / injectable')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {selected && scope.ready && scope.isCurrent() && (
          <Glp1InventoryManager
            key={`${scope.key}:${selected.id}:controls`}
            med={selected}
            stockView="controls"
            stockCanWrite={scope.canWrite}
            stockMoreRef={moreRef}
            stockRequest={
              request?.medicationId === selected.id ? request.kind : undefined
            }
            onStockRequestHandled={() => setRequest(null)}
          />
        )}
      </header>
      <Dialog
        open={choosing !== null}
        onOpenChange={(open) => !open && setChoosing(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t(
                'medications.stockLayout.chooseMedication',
                'Which medication is this for?'
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="stock-medication">
              {t('medications.stockLayout.medication', 'Medication')}
            </Label>
            <Select
              value={chosenMedication}
              onValueChange={setChosenMedication}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoosing(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={!chosenMedication}
              onClick={() => {
                if (!choosing || !chosenMedication) return;
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('tab', 'stock');
                  next.set('medication', chosenMedication);
                  return next;
                });
                setRequest({ medicationId: chosenMedication, kind: choosing });
                setChoosing(null);
              }}
            >
              {t('medications.stockLayout.continue', 'Continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddMedicationDialog
        key={`${scope.key}:add-medication`}
        defaultTypeId="injection"
        trigger={false}
        onCreated={(med) => {
          // A new compound has no vial yet, so go straight on to adding one.
          setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set('tab', 'stock');
            next.set('medication', med.id);
            return next;
          });
          setRequest({ medicationId: med.id, kind: 'add' });
        }}
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
              queue.length === 0 &&
              allPacks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.stockLayout.emptyAll',
                    'No vials yet. Add your first vial to start tracking stock.'
                  )}
                </p>
              )}
            {(activeCount > 0 || openPacks.length > 0) && (
              <h3 className="text-sm font-semibold">
                {t('medications.stockLayout.inUse', 'In use')}
              </h3>
            )}
            <section
              aria-label={t('medications.stockLayout.tracked', 'Tracked stock')}
              className="grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3"
            >
              {injectables.map((med) => manager(med, 'active'))}
              {packCards(openPacks)}
            </section>
            {noStock.length > 0 && (
              <section
                className="space-y-3"
                aria-label={t(
                  'medications.stockLayout.noStock',
                  'No stock yet'
                )}
              >
                <h3 className="text-sm font-semibold">
                  {t('medications.stockLayout.noStock', 'No stock yet')}
                </h3>
                <div className="grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3">
                  {noStock.map((med) => (
                    <div
                      key={med.id}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {med.display_name || med.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t(
                            'medications.stockLayout.noVials',
                            'No vials or pens yet'
                          )}
                        </p>
                      </div>
                      {scope.canWrite && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setParams((previous) => {
                              const next = new URLSearchParams(previous);
                              next.set('tab', 'stock');
                              next.set('medication', med.id);
                              return next;
                            });
                            setRequest({ medicationId: med.id, kind: 'add' });
                          }}
                        >
                          {t(
                            'medications.stockLayout.addVial',
                            'Add a vial or pen'
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {(queue.length > 0 || dashboard.query.isError) && (
              <section
                className="space-y-3"
                aria-labelledby="needs-preparation-heading"
              >
                <div className="flex items-baseline gap-2">
                  <h3
                    id="needs-preparation-heading"
                    className="text-sm font-semibold"
                  >
                    {t(
                      'medications.stockDashboard.needsPreparation',
                      'Needs preparation'
                    )}
                  </h3>
                  {!dashboard.query.isError && (
                    <span className="text-sm text-muted-foreground">
                      {t('medications.stockDashboard.needsPreparationCount', {
                        count: queue.length,
                        defaultValue_one: '{{count}} vial',
                        defaultValue_other: '{{count}} vials',
                      })}
                    </span>
                  )}
                </div>
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
            {sealedPacks.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  {t('medications.packs.unopened', 'Unopened')}
                </h3>
                <div className="grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3">
                  {packCards(sealedPacks)}
                </div>
              </section>
            )}
            {(closedCount > 0 || closedPacks.length > 0) && (
              <details className="rounded-lg border bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {t(
                    'medications.stock.finishedDiscarded',
                    'Finished / discarded'
                  )}
                </summary>
                <div className="mt-3 grid min-w-0 gap-3 lg:max-[1899px]:grid-cols-2 min-[1900px]:grid-cols-3">
                  {injectables.map((med) => manager(med, 'closed'))}
                  {packCards(closedPacks)}
                </div>
              </details>
            )}
          </div>
        )}
      {packsQuery.query.isError && scope.ready && scope.isCurrent() && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t(
            'medications.packs.loadError',
            'Could not load pack stock. Vial stock above is unaffected.'
          )}
        </p>
      )}
      <MedicationPackDialog
        open={packDialog !== null}
        onOpenChange={(open) => !open && setPackDialog(null)}
        medications={packMedications}
        pack={packDialog?.pack}
      />
      <ConfirmationDialog
        open={packToDelete !== null}
        onOpenChange={(open) => !open && setPackToDelete(null)}
        title={t('medications.packs.deleteTitle', 'Delete this pack?')}
        description={t(
          'medications.packs.deleteHint',
          'Logged doses are kept. They stay recorded, but no longer link to this pack.'
        )}
        variant="destructive"
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={() => {
          if (packToDelete) deletePack.mutate(packToDelete.id);
          setPackToDelete(null);
        }}
      />
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
