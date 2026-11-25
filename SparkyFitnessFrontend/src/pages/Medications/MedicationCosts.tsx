import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationPurchaseView,
} from '@workspace/shared';
import {
  useMedicationPurchases,
  useMedicationPurchase,
  useMedicationPurchaseEditor,
  useMedicationPurchaseScope,
  useDeleteMedicationPurchase,
} from '@/hooks/useMedicationPurchases';
import { useLastUsedMedicationCurrency } from '@/hooks/Medications/useLastUsedMedicationCurrency';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import MedicationCostReport from './MedicationCostReport';
import MedicationCourseCosts from './MedicationCourseCosts';
import MedicationPurchaseForm from './MedicationPurchaseForm';
const notice =
  'whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10';
export default function MedicationCosts() {
  const scope = useMedicationPurchaseScope();
  if (!scope.ready) return null;
  return (
    <OwnedCosts
      key={scope.ownerId}
      ownerId={scope.ownerId}
      isCurrent={scope.isCurrent}
    />
  );
}
function OwnedCosts({
  ownerId,
  isCurrent,
}: {
  ownerId: string;
  isCurrent: () => boolean;
}) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [reloadError, setReloadError] = useState('');
  const editingId = params.get('purchase');
  const purchases = useMedicationPurchases(ownerId, true);
  const defaultCurrency = useLastUsedMedicationCurrency(!editingId);
  const detail = useMedicationPurchase(ownerId, editingId, true);
  const editor = useMedicationPurchaseEditor(
    ownerId,
    editingId ?? undefined,
    creating || !!editingId
  );
  const deletion = useDeleteMedicationPurchase();
  const [deleting, setDeleting] = useState<MedicationPurchaseView | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const setEditing = (id: string | null) => {
    setCreating(false);
    setReloadError('');
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', 'costs');
      if (id) next.set('purchase', id);
      else next.delete('purchase');
      return next;
    });
  };
  const done = () => {
    if (isCurrent()) {
      setCreating(false);
      setEditing(null);
    }
  };
  const money = (value: string, currency: string) =>
    formatPurchaseMoney(value, currency, i18n.language);
  if (creating || editingId) {
    if (
      (editor.isError && !editor.data) ||
      (editingId && detail.isError && !detail.data)
    )
      return (
        <div className="space-y-3">
          <Badge variant="destructive" className={notice}>
            {t('medications.costs.loadFailed', 'Could not load this invoice.')}
          </Badge>
          <Button variant="outline" onClick={done}>
            {t('common.back', 'Back')}
          </Button>
        </div>
      );
    if (!editor.data || (editingId && !detail.data))
      return <p>{t('common.loading', 'Loading…')}</p>;
    return (
      <div className="space-y-3">
        {reloadError && (
          <Badge variant="destructive" className={notice}>
            {reloadError}
          </Badge>
        )}
        <MedicationPurchaseForm
          key={`${ownerId}:${editingId ?? 'new'}:${formVersion}`}
          ownerId={ownerId}
          initial={editingId ? detail.data : undefined}
          data={editor.data}
          defaultCurrency={defaultCurrency}
          isCurrent={isCurrent}
          onDone={done}
          onCancel={done}
          onReload={async () => {
            setReloadError('');
            const [saved, candidates] = await Promise.all([
              detail.refetch(),
              editor.refetch(),
            ]);
            if (!isCurrent()) return;
            if (saved.isSuccess && candidates.isSuccess)
              setFormVersion((value) => value + 1);
            else
              setReloadError(
                t(
                  'medications.costs.reloadFailed',
                  'Could not reload the invoice and matching stock. Your draft is kept.'
                )
              );
          }}
        />
      </div>
    );
  }
  const invoiceBlock = (
    <>
      {purchases.isLoading && <p>{t('common.loading', 'Loading…')}</p>}
      {purchases.isError && (
        <Badge variant="destructive" className={notice}>
          {t('medications.costs.loadFailed', 'Could not load your invoices.')}
        </Badge>
      )}
      {purchases.data?.purchases.length === 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="font-medium">
              {t('medications.costs.empty', 'No invoices yet')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.costs.emptyHint',
                'Add an order to start tracking landed cost. Put shipping on the invoice, not on a line, so it is shared across every vial it delivered.'
              )}
            </p>
          </CardContent>
        </Card>
      )}
      {!!purchases.data?.purchases.length && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            {t('medications.costs.invoices', 'Invoices')}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {purchases.data.purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 break-words text-base font-semibold">
                    {purchase.vendor ||
                      t('medications.costs.invoice', 'Invoice')}
                    {purchase.reference && ` · ${purchase.reference}`}
                  </h3>
                  <span className="shrink-0 break-words text-lg font-semibold tabular-nums">
                    {money(purchase.totals.total, purchase.currency)}
                  </span>
                </div>
                <p className="-mt-2 text-sm text-muted-foreground">
                  {purchase.ordered_date}
                  {purchase.received_date &&
                    ` · ${t('medications.costs.received', 'Received')} ${purchase.received_date}`}
                </p>
                <ul className="space-y-3">
                  {purchase.items.map((item) => (
                    <li key={item.id} className="min-w-0 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 break-words font-medium">
                          {item.quantity} ×{' '}
                          {item.description ||
                            item.medication_name ||
                            t(
                              'medications.costs.removedMedication',
                              'Removed medication'
                            )}
                        </p>
                        <span className="shrink-0 tabular-nums">
                          {item.landed_unit === null
                            ? t('medications.costs.uncosted', 'Uncosted')
                            : formatPurchaseRate(
                                item.landed_unit,
                                purchase.currency
                              )}{' '}
                          {t('medications.costs.cardEach', 'ea')}
                        </span>
                      </div>
                      <p className="break-words text-xs text-muted-foreground">
                        {money(item.subtotal, purchase.currency)} +{' '}
                        {money(item.allocated, purchase.currency)}{' '}
                        {t('medications.costs.cardShip', 'ship')}
                        {item.kind === 'medication' &&
                          item.vial_ids.length > 0 &&
                          ` · ${item.vial_ids.length === 1 ? t('medications.costs.cardMatchedOne', '1 vial matched') : t('medications.costs.cardMatched', '{{matched}} vials matched', { matched: item.vial_ids.length })}`}
                        {item.kind === 'medication' &&
                          item.pack_ids.length > 0 &&
                          ` · ${item.pack_ids.length === 1 ? t('medications.costs.cardMatchedPackOne', '1 pack matched') : t('medications.costs.cardMatchedPacks', '{{matched}} packs matched', { matched: item.pack_ids.length })}`}
                      </p>
                      {item.kind === 'medication' && !item.medication_id && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {t(
                            'medications.costs.lineNoMedication',
                            'No medication is set on this line, so no vials can be matched. Edit the invoice and choose one.'
                          )}
                        </p>
                      )}
                      {item.kind === 'medication' &&
                        item.vial_ids.length + item.pack_ids.length >
                          item.quantity && (
                          <Badge variant="destructive" className={notice}>
                            {t(
                              'medications.costs.overmatched',
                              'More vials matched than this line bought. Raise the count or untick a vial.'
                            )}
                          </Badge>
                        )}
                    </li>
                  ))}
                </ul>
                {purchase.vials_expected >
                  purchase.vials_linked + purchase.packs_linked && (
                  <p className="text-xs text-muted-foreground">
                    {purchase.packs_linked > 0
                      ? t(
                          'medications.costs.cardUnmatchedAny',
                          '{{missing}} items on this invoice not yet matched to inventory.',
                          {
                            missing:
                              purchase.vials_expected -
                              purchase.vials_linked -
                              purchase.packs_linked,
                          }
                        )
                      : t(
                          'medications.costs.cardUnmatched',
                          '{{missing}} vials on this invoice not yet matched to inventory.',
                          {
                            missing:
                              purchase.vials_expected - purchase.vials_linked,
                          }
                        )}
                  </p>
                )}
                {purchase.totals.unallocated !== '0.00' && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'medications.costs.unallocatedAmount',
                      '{{amount}} stays unallocated.',
                      {
                        amount: money(
                          purchase.totals.unallocated,
                          purchase.currency
                        ),
                      }
                    )}
                  </p>
                )}
                {purchase.notes && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {purchase.notes}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-muted-foreground"
                    onClick={() => {
                      setDeleting(purchase);
                      setDeleteError('');
                    }}
                  >
                    <Trash2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                    {t('common.delete', 'Delete')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-primary"
                    onClick={() => setEditing(purchase.id)}
                  >
                    {t('common.edit', 'Edit')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            {t('medications.costs.title', 'Costs')}
          </h2>
          <p className="text-muted-foreground">
            {t(
              'medications.costs.ledgerHint',
              'Landed cost per vial, per mg and per dose — shipping and sundries included.'
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.costs.bookkeeping',
              'Bookkeeping only. Not medical advice.'
            )}
          </p>
        </div>
        <Button
          className="shrink-0"
          aria-label={t('medications.costs.addInvoiceLabel', 'Add invoice')}
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
          {t('medications.costs.addInvoice', 'Invoice')}
        </Button>
      </div>
      <MedicationCostReport
        ownerId={ownerId}
        invoices={invoiceBlock}
        trailing={<MedicationCourseCosts ownerId={ownerId} />}
      />
      <Dialog
        open={!!deleting}
        onOpenChange={(open) =>
          !open && !deletion.isPending && setDeleting(null)
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('medications.costs.deleteTitle', 'Delete this invoice?')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {t(
              'medications.costs.deleteHint',
              'The vials are kept. Costs are recalculated from eligible linked prescriptions; otherwise they become uncosted.'
            )}
          </p>
          {deleteError && (
            <Badge variant="destructive" className={notice}>
              {deleteError}
            </Badge>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deletion.isPending}
              onClick={() => setDeleting(null)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={deletion.isPending}
              onClick={async () => {
                if (!deleting || !isCurrent()) return;
                try {
                  await deletion.mutateAsync({
                    id: deleting.id,
                    body: {
                      expected_owner_id: ownerId,
                      expected_revision: deleting.revision,
                    },
                  });
                  if (isCurrent()) setDeleting(null);
                } catch (reason) {
                  if (isCurrent())
                    setDeleteError(
                      reason instanceof Error
                        ? reason.message
                        : t(
                            'medications.costs.deleteFailed',
                            'Could not delete this invoice.'
                          )
                    );
                }
              }}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
