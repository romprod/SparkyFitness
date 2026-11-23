import MedicationPrescriptionLink from './MedicationPrescriptionLink';
import {
  useMedicationPrescriptionScope,
  useMedicationPrescriptions,
} from '@/hooks/Medications/useMedicationPrescriptions';
import { useEffect, useState, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Archive,
  FlaskConical,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import {
  todayInZone,
  addDays,
  medicationDoseInMg,
  medicationVialLabelMassSchema,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useMedicationPens,
  useCreatePenMutation,
  useUpdatePenMutation,
  useDeletePenMutation,
} from '@/hooks/useMedications';
import { usePreferences } from '@/contexts/PreferencesContext';
import SavedPreparation from './SavedPreparation';
import VialLabelMassField from './VialLabelMassField';
import MedicationVialCostLink from './MedicationVialCostLink';
import MedicationBudWarning from './MedicationBudWarning';
import MedicationPreparationWizard from './MedicationPreparationWizard';
import type {
  Medication,
  MedicationPen,
  MedicationPenWriteInput,
} from '@/types/medications';

import type {
  MedicationInventoryPlannedForecast,
  MedicationPreparationQueueItem,
} from '@workspace/shared';
import { MedicationPreparationQueueEntry } from './MedicationPreparationQueue';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { MedicationContainerForecast } from './MedicationInventoryForecast';

/**
 * A measured figure for display: at most two decimals and no trailing zeros, so a stored
 * 3.3333333333333335 mg/mL reads 3.33 and 10 reads 10. Display only; stored values keep full precision.
 */
const tidyNumber = (value: number | string) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(value);
};

interface Glp1InventoryManagerProps {
  med: Medication;
  forecast?: MedicationInventoryPlannedForecast;
  forecastTimezone?: string;
  stockView?: 'controls' | 'active' | 'closed' | 'queue';
  queueItems?: MedicationPreparationQueueItem[];
  stockCanWrite?: boolean;
  stockMoreRef?: RefObject<HTMLButtonElement | null>;
  /** Opens the add or preparation dialog once, when the stock header asks. */
  stockRequest?: 'add' | 'prepare';
  onStockRequestHandled?: () => void;
  onStockCounts?: (
    medicationId: string,
    counts: { active: number; closed: number }
  ) => void;
}

export default function Glp1InventoryManager(props: Glp1InventoryManagerProps) {
  const prescriptionScope = useMedicationPrescriptionScope();
  return (
    <InventorySession
      key={`${props.med.id}:${prescriptionScope.key}`}
      {...props}
      prescriptionScope={prescriptionScope}
    />
  );
}
function InventorySession({
  med,
  forecast,
  forecastTimezone,
  prescriptionScope,
  stockView,
  queueItems = [],
  stockCanWrite = false,
  stockMoreRef,
  stockRequest,
  onStockRequestHandled,
  onStockCounts,
}: Glp1InventoryManagerProps & {
  prescriptionScope: ReturnType<typeof useMedicationPrescriptionScope>;
}) {
  const { t } = useTranslation();
  const medId = med.id;
  const localMoreRef = useRef<HTMLButtonElement>(null);
  const moreRef = stockMoreRef ?? localMoreRef;

  const pensQ = useMedicationPens(medId);
  const addPenMutation = useCreatePenMutation(medId);
  const updatePenMutation = useUpdatePenMutation(medId);
  const deletePenMutation = useDeletePenMutation(medId);

  // Add/Edit Inventory Form States
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [preparationPen, setPreparationPen] = useState<
    MedicationPen | undefined
  >();
  const openPreparation = (pen?: MedicationPen) => {
    setPreparationPen(pen);
    setPreparationOpen(true);
  };
  const [editingPen, setEditingPen] = useState<MedicationPen | null>(null);
  // Retire and delete only run after an explicit confirmation.
  const [confirmPen, setConfirmPen] = useState<{
    action: 'retire' | 'delete';
    pen: MedicationPen;
  } | null>(null);
  useEffect(() => {
    if (stockView && !stockCanWrite) {
      setInventoryOpen(false);
      setPreparationOpen(false);
    }
  }, [stockView, stockCanWrite]);
  const [status, setStatus] = useState<MedicationPen['status']>('sealed');
  const [kind, setKind] = useState<'pen' | 'vial'>('pen');
  const [label, setLabel] = useState('');
  const [labelMass, setLabelMass] = useState('');
  const [labelMassTouched, setLabelMassTouched] = useState(false);
  const [prescriptionId, setPrescriptionId] = useState<
    string | null | undefined
  >(undefined);
  const [prescriptionTouched, setPrescriptionTouched] = useState(false);
  const labelMassRelevant =
    kind === 'vial' || editingPen?.label_mass_mg != null;
  const labelMassValid =
    !labelMassRelevant ||
    !labelMass.trim() ||
    (kind === 'vial' &&
      medicationVialLabelMassSchema.safeParse(labelMass).success);
  const [inventoryDoseMg, setInventoryDoseMg] = useState(
    medicationDoseInMg(med) != null ? String(medicationDoseInMg(med)) : ''
  );
  const [concentration, setConcentration] = useState('');
  const [volume, setVolume] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [budMode, setBudMode] = useState<'none' | 'date' | 'interval'>('none');
  const [budDate, setBudDate] = useState('');
  const [budInterval, setBudInterval] = useState('');
  const [budBaseDate, setBudBaseDate] = useState('');
  const [budSource, setBudSource] = useState('');
  const [dosesTotal, setDosesTotal] = useState('4');
  const [openedAt, setOpenedAt] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [reorderFlag, setReorderFlag] = useState(false);
  const [reorderThreshold, setReorderThreshold] = useState('1');
  const [notes, setNotes] = useState('');

  const preferencesContext = usePreferences();
  const { formatDate } = preferencesContext;
  const timezone =
    preferencesContext?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInZone(timezone);

  let calculatedBudDate = budDate;
  if (budMode === 'interval') {
    try {
      calculatedBudDate =
        budBaseDate &&
        budInterval !== '' &&
        Number.isInteger(Number(budInterval)) &&
        Number(budInterval) >= 0
          ? addDays(budBaseDate, Number(budInterval))
          : '';
    } catch {
      calculatedBudDate = '';
    }
  }
  const budValid =
    budMode === 'none' ||
    (budMode === 'date'
      ? /^\d{4}-\d{2}-\d{2}$/.test(budDate)
      : !!calculatedBudDate && !!budSource.trim());

  const getExpiryStatus = (
    targetDateStr: string | null,
    currentDateStr: string
  ) => {
    if (!targetDateStr) return null;
    try {
      const target = new Date(targetDateStr + 'T00:00:00');
      const current = new Date(currentDateStr + 'T00:00:00');
      const diffDays =
        (target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 0) return 'expired';
      if (diffDays <= 7) return 'near';
      return 'good';
    } catch {
      return null;
    }
  };

  const resetForm = () => {
    setEditingPen(null);
    setStatus('sealed');
    setKind('pen');
    setLabel('');
    setLabelMass('');
    setLabelMassTouched(false);
    setInventoryDoseMg(
      medicationDoseInMg(med) != null ? String(medicationDoseInMg(med)) : ''
    );
    setConcentration('');
    setVolume('');
    setLotNumber('');
    setStorageLocation('');
    setBudMode('none');
    setBudDate('');
    setBudInterval('');
    setBudBaseDate('');
    setBudSource('');
    setDosesTotal('4');
    setOpenedAt('');
    setExpiryDate('');
    setReorderFlag(false);
    setReorderThreshold('1');
    setNotes('');
  };

  const openAddDialog = () => {
    resetForm();
    // Most stock added here is a vial. Offer a pen first only when pens are
    // already tracked for this medication.
    if (!(pensQ.data ?? []).some((pen) => pen.kind === 'pen')) {
      setKind('vial');
      setDosesTotal('10');
    }
    setPrescriptionId(undefined);
    setPrescriptionTouched(false);
    setInventoryOpen(true);
  };

  const openEditDialog = (pen: MedicationPen) => {
    resetForm();
    setEditingPen(pen);
    setPrescriptionId(pen.prescription_id);
    setPrescriptionTouched(false);
    setStatus(pen.status);
    setLotNumber(pen.lot_number ?? '');
    setStorageLocation(pen.storage_location ?? '');
    setBudMode(pen.bud_mode ?? (pen.bud_date ? 'date' : 'none'));
    setBudDate(pen.bud_date ?? '');
    setBudInterval(
      pen.bud_interval_days != null ? String(pen.bud_interval_days) : ''
    );
    setBudBaseDate(pen.bud_base_date ?? '');
    setBudSource(pen.bud_source ?? '');
    setKind(pen.kind);
    setLabel(pen.label ?? '');
    setLabelMass(pen.label_mass_mg ?? '');
    setLabelMassTouched(false);
    setInventoryDoseMg(pen.dose_mg != null ? String(pen.dose_mg) : '');
    setConcentration(
      pen.concentration_mg_ml != null ? String(pen.concentration_mg_ml) : ''
    );
    setVolume(pen.volume_ml != null ? String(pen.volume_ml) : '');
    setDosesTotal(pen.doses_total != null ? String(pen.doses_total) : '');
    setOpenedAt(pen.opened_at ?? '');
    setExpiryDate(pen.expiry_date ?? '');
    setReorderFlag(pen.reorder_flag);
    setReorderThreshold(
      pen.reorder_threshold != null ? String(pen.reorder_threshold) : '1'
    );
    setNotes(pen.notes ?? '');
    setInventoryOpen(true);
  };

  useEffect(() => {
    if (stockView !== 'controls' || !stockRequest || !stockCanWrite) return;
    if (stockRequest === 'add') openAddDialog();
    else openPreparation();
    onStockRequestHandled?.();
    // Fires once per request; the openers only set local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockRequest]);

  const handleSaveInventory = () => {
    if (stockView && !stockCanWrite) return;
    if (
      !budValid ||
      !labelMassValid ||
      (prescriptionTouched &&
        (!prescriptionScope.isCurrent() || !prescriptionScope.canWrite))
    )
      return;
    const body: MedicationPenWriteInput = {
      kind,
      label: label.trim() || null,
      dose_mg: inventoryDoseMg ? Number(inventoryDoseMg) : null,
      concentration_mg_ml:
        kind === 'vial' ? (concentration ? Number(concentration) : null) : null,
      volume_ml: kind === 'vial' && volume ? Number(volume) : null,
      doses_total: dosesTotal ? Number(dosesTotal) : null,
      opened_at: openedAt || null,
      expiry_date: expiryDate || null,
      bud_date: budMode === 'none' ? null : calculatedBudDate || null,
      bud_mode: budMode === 'none' ? null : budMode,
      bud_interval_days: budMode === 'interval' ? Number(budInterval) : null,
      bud_base_date: budMode === 'interval' ? budBaseDate : null,
      bud_source: budSource.trim() || null,
      lot_number: lotNumber.trim() || null,
      storage_location: storageLocation.trim() || null,
      reorder_flag: reorderFlag,
      reorder_threshold:
        reorderFlag && reorderThreshold ? Number(reorderThreshold) : null,
      notes: notes.trim() || null,
    };
    if (prescriptionTouched) body.prescription_id = prescriptionId ?? null;
    if (kind === 'vial' || editingPen?.label_mass_mg != null) {
      if (editingPen ? labelMassTouched : !!labelMass.trim())
        body.label_mass_mg = labelMass.trim() || null;
    }
    if (
      editingPen &&
      budMode ===
        (editingPen.bud_mode ?? (editingPen.bud_date ? 'date' : 'none')) &&
      budDate === (editingPen.bud_date ?? '') &&
      budInterval ===
        (editingPen.bud_interval_days != null
          ? String(editingPen.bud_interval_days)
          : '') &&
      budBaseDate === (editingPen.bud_base_date ?? '') &&
      budSource === (editingPen.bud_source ?? '')
    ) {
      delete body.bud_date;
      delete body.bud_mode;
      delete body.bud_interval_days;
      delete body.bud_base_date;
      delete body.bud_source;
    }
    if (editingPen?.preparation) {
      delete body.concentration_mg_ml;
      delete body.volume_ml;
    }
    if (editingPen) {
      // Legacy numeric DTOs may already be rounded. Untouched text must never
      // rewrite the server's original physical values during a metadata edit.
      const convertingVialToPen = editingPen.kind === 'vial' && kind === 'pen';
      const physicalFields = {
        dose_mg: inventoryDoseMg,
        concentration_mg_ml: convertingVialToPen ? '' : concentration,
        volume_ml: convertingVialToPen ? '' : volume,
        doses_total: dosesTotal,
      };
      for (const field of Object.keys(
        physicalFields
      ) as (keyof typeof physicalFields)[]) {
        const original =
          editingPen[field] == null ? '' : String(editingPen[field]);
        const hiddenOnUnchangedPen =
          editingPen.kind === 'pen' &&
          kind === 'pen' &&
          (field === 'concentration_mg_ml' || field === 'volume_ml');
        if (hiddenOnUnchangedPen || physicalFields[field] === original)
          delete body[field];
      }
    }

    const onSuccess = () => {
      setInventoryOpen(false);
      resetForm();
    };

    if (editingPen) {
      if (status !== editingPen.status) {
        body.status = status;
        body.lifecycle_intent = true;
      }
      updatePenMutation.mutate({ id: editingPen.id, body }, { onSuccess });
    } else {
      body.status = openedAt ? 'in_use' : 'sealed';
      addPenMutation.mutate(body, { onSuccess });
    }
  };

  const savePending = addPenMutation.isPending || updatePenMutation.isPending;

  const activePens = (pensQ.data ?? []).filter(
    (pen) => pen.status !== 'finished' && pen.status !== 'discarded'
  );
  const closedPens = (pensQ.data ?? []).filter(
    (pen) => pen.status === 'finished' || pen.status === 'discarded'
  );
  useEffect(() => {
    if (stockView === 'active') {
      const loaded = !pensQ.isError ? (pensQ.data ?? []) : [];
      onStockCounts?.(medId, {
        active: loaded.filter(
          (p) =>
            p.status !== 'finished' &&
            p.status !== 'discarded' &&
            !queueItems.some((row) => row.stock_id === p.id)
        ).length,
        closed: loaded.filter(
          (p) => p.status === 'finished' || p.status === 'discarded'
        ).length,
      });
    }
  }, [stockView, pensQ.data, pensQ.isError, queueItems, onStockCounts, medId]);
  const retirePen = (p: MedicationPen) =>
    setConfirmPen({ action: 'retire', pen: p });
  const removePen = (p: MedicationPen) =>
    setConfirmPen({ action: 'delete', pen: p });
  const confirmPenAction = () => {
    if (!confirmPen) return;
    const { action, pen } = confirmPen;
    setConfirmPen(null);
    if (action === 'retire') {
      updatePenMutation.mutate({
        id: pen.id,
        body: { status: 'finished', lifecycle_intent: true },
      });
    } else {
      deletePenMutation.mutate(pen.id);
    }
  };
  const stockActions = (p: MedicationPen) => {
    if (!stockCanWrite) return null;
    const canPrepare =
      p.kind === 'vial' && (p.preparation || p.doses_used === 0);
    const preparationLabel = p.preparation
      ? t('medications.preparationFlow.edit', 'Edit preparation')
      : t('medications.stock.prepare', 'Prepare a vial');
    const canRetire = p.status === 'in_use' || p.status === 'sealed';
    return (
      <>
        <div className="hidden sm:flex flex-wrap items-center justify-start gap-x-3 gap-y-1 text-sm">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1 text-primary hover:text-primary"
            onClick={() => openEditDialog(p)}
          >
            <Pencil aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {t('common.edit', 'Edit')}
          </Button>
          {canPrepare && stockView !== 'queue' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1 text-primary hover:text-primary"
              onClick={() => openPreparation(p)}
            >
              <FlaskConical aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
              {preparationLabel}
            </Button>
          )}
          {canRetire && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1 text-muted-foreground"
              disabled={updatePenMutation.isPending}
              onClick={() => retirePen(p)}
            >
              <Archive aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
              {t('medications.stockLayout.retire', 'Retire')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1 text-destructive hover:text-destructive"
            disabled={deletePenMutation.isPending}
            onClick={() => removePen(p)}
          >
            <Trash2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {t('common.delete', 'Delete')}
          </Button>
        </div>
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t(
                  'medications.stockLayout.actions',
                  'Stock actions for {{name}}',
                  { name: p.label || med.display_name || med.name }
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openEditDialog(p)}>
                {t('common.edit', 'Edit')}
              </DropdownMenuItem>
              {canPrepare && stockView !== 'queue' && (
                <DropdownMenuItem onSelect={() => openPreparation(p)}>
                  {preparationLabel}
                </DropdownMenuItem>
              )}
              {canRetire && (
                <DropdownMenuItem
                  disabled={updatePenMutation.isPending}
                  onSelect={() => retirePen(p)}
                >
                  {t('medications.stockLayout.retire', 'Retire')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={deletePenMutation.isPending}
                onSelect={() => removePen(p)}
              >
                {t('common.delete', 'Delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    );
  };
  const stockFooter = (p: MedicationPen) => (
    <div className="space-y-2 border-t px-4 py-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
        <StockPrescriptionLine
          pen={p}
          canWrite={stockCanWrite}
          onChange={() => openEditDialog(p)}
        />
        {p.kind === 'vial' && <MedicationVialCostLink penId={p.id} />}
      </div>
      {stockActions(p)}
    </div>
  );
  const renderPen = (p: MedicationPen) => {
    const total = p.doses_total ?? 0;
    const left =
      p.stock && p.dose_mg && p.dose_mg > 0
        ? Math.floor(p.stock.remainingMg / p.dose_mg + 1e-10)
        : Math.max(0, total - p.doses_used);
    const pct = p.stock
      ? Math.round((p.stock.remainingMg / p.stock.totalMg) * 100)
      : total > 0
        ? Math.round((left / total) * 100)
        : 0;
    const low =
      ((p.stock !== null && p.stock !== undefined) || total > 0) && pct <= 25;
    const expStatus = getExpiryStatus(p.expiry_date, today);
    // The card header already prints the expiry date, so the Details list repeats it only to flag a problem.
    const showExpiryRow =
      !!p.expiry_date &&
      (!stockView || expStatus === 'expired' || expStatus === 'near');
    // A sealed vial nobody has prepared yet has no stock figure to show.
    const awaitingPreparation =
      p.kind === 'vial' &&
      !p.preparation &&
      !p.stock &&
      p.doses_used === 0 &&
      p.status !== 'finished' &&
      p.status !== 'discarded';

    const content = (
      <div
        key={p.id}
        className={
          stockView ? 'space-y-2 text-sm' : 'rounded-lg border p-3 text-sm'
        }
      >
        {!stockView && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium capitalize">{p.kind}</span>
              {p.label && (
                <span className="text-muted-foreground">({p.label})</span>
              )}
              {p.dose_mg ? (
                <span className="text-muted-foreground">{p.dose_mg} mg</span>
              ) : null}
              {p.concentration_mg_ml ? (
                <span className="text-muted-foreground">
                  {t(
                    'medications.glp1InventoryManager.mgML',
                    '· {{concentration_mg_ml}} mg/mL',
                    {
                      concentration_mg_ml: tidyNumber(p.concentration_mg_ml),
                    }
                  )}
                </span>
              ) : null}
              {p.status === 'in_use' && (
                <Badge variant="secondary" className="text-[10px]">
                  {t('medications.glp1InventoryManager.inUse', 'in use')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {p.reorder_flag &&
                p.reorder_threshold != null &&
                left <= p.reorder_threshold && (
                  <Badge
                    variant="destructive"
                    className="flex items-center gap-1 text-[10px]"
                  >
                    <AlertTriangle className="h-3 w-3" />{' '}
                    {t('medications.glp1InventoryManager.reorder', 'Reorder')}
                  </Badge>
                )}
              {awaitingPreparation ? (
                <Badge variant="outline" className="text-[10px]">
                  {t(
                    'medications.stockDashboard.needsPreparation',
                    'Needs preparation'
                  )}
                </Badge>
              ) : (
                <span className="font-medium tabular-nums">
                  {p.stock
                    ? p.stock.remainingMg.toFixed(3)
                    : `${left}/${total || '?'}`}{' '}
                  <span className="font-normal text-muted-foreground">
                    {p.stock
                      ? 'mg'
                      : t('medications.glp1InventoryManager.doses', 'doses')}
                  </span>
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => openEditDialog(p)}
                aria-label={t(
                  'medications.glp1InventoryManager.editPenVial',
                  'Edit pen/vial'
                )}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => removePen(p)}
                disabled={deletePenMutation.isPending}
                aria-label={t(
                  'medications.glp1InventoryManager.removePenVial',
                  'Remove pen/vial'
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        {p.kind === 'vial' &&
          (!stockView || !p.stock || p.stock.overdrawnMg > 0) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {p.stock
                ? stockView
                  ? null // the card's Details list already shows the balance and volume
                  : t(
                      'medications.preparation.remaining',
                      '{{mass}} mg / {{volume}} mL remaining',
                      {
                        mass: p.stock.remainingMg.toFixed(3),
                        volume: p.stock.remainingMl.toFixed(3),
                      }
                    )
                : awaitingPreparation
                  ? t(
                      'medications.preparation.notPrepared',
                      'Not prepared yet. Prepare this vial to track what is left.'
                    )
                  : t(
                      'medications.preparation.unknown',
                      'Mass stock unavailable: check preparation details and linked dose history.'
                    )}
              {p.stock && p.stock.overdrawnMg > 0 && (
                <span className="text-destructive">
                  {' '}
                  {t(
                    'medications.preparation.overdrawn',
                    'Logged use exceeds the recorded vial content.'
                  )}
                </span>
              )}
            </p>
          )}
        {!awaitingPreparation && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${low ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {(showExpiryRow || p.bud_date) && (
          <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground flex-wrap items-center">
            {showExpiryRow && p.expiry_date && (
              <span className="flex items-center gap-1">
                {t(
                  'medications.glp1InventoryManager.exp',
                  'Exp {{expiry_date}}',
                  { expiry_date: formatDate(p.expiry_date) }
                )}
                {expStatus === 'expired' && (
                  <Badge
                    variant="destructive"
                    className="text-[9px] px-1 py-0 h-4"
                  >
                    {t('medications.glp1InventoryManager.expired', 'Expired')}
                  </Badge>
                )}
                {expStatus === 'near' && (
                  <Badge className="text-[9px] px-1 py-0 h-4 bg-amber-500 text-white hover:bg-amber-600">
                    {t('medications.glp1InventoryManager.nearExp', 'Near Exp')}
                  </Badge>
                )}
              </span>
            )}
            {p.bud_date && (
              <span className="flex items-center gap-1">
                {t('medications.glp1InventoryManager.bud', 'BUD {{bud_date}}', {
                  bud_date: formatDate(p.bud_date),
                })}
                <MedicationBudWarning date={p.bud_date} />
              </span>
            )}
          </div>
        )}
        {p.preparation && <SavedPreparation preparation={p.preparation} />}
        {forecast?.containers
          .filter((container) => container.container_id === p.id)
          .map((container) => (
            <MedicationContainerForecast
              key={container.container_id}
              container={container}
              timezone={forecastTimezone}
            />
          ))}
        {!stockView && p.kind === 'vial' && (
          <MedicationVialCostLink penId={p.id} />
        )}
        {!stockView &&
          p.kind === 'vial' &&
          (p.preparation || p.doses_used === 0) && (
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              onClick={() => openPreparation(p)}
            >
              {p.preparation
                ? t('medications.preparationFlow.edit', 'Edit preparation')
                : t('medications.stock.prepare', 'Prepare a vial')}
            </Button>
          )}
        {(p.lot_number || p.storage_location || p.bud_source) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {[
              p.lot_number &&
                `${t('medications.preparation.lot', 'Lot number')}: ${p.lot_number}`,
              p.storage_location &&
                `${t('medications.preparation.storage', 'Storage location')}: ${p.storage_location}`,
              p.bud_source &&
                `${t('medications.preparation.budSource', 'BUD source')}: ${p.bud_source}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {(p.status === 'finished' || p.status === 'discarded') && (
          <Badge variant="secondary" className="mt-2">
            {t(`medications.stock.status.${p.status}`, p.status)}
          </Badge>
        )}
        {p.notes && (
          <p className="mt-1.5 text-xs text-muted-foreground italic border-t pt-1">
            {t('medications.glp1InventoryManager.notes', 'Notes: {{notes}}', {
              notes: p.notes,
            })}
          </p>
        )}
      </div>
    );
    if (!stockView) return content;
    return (
      <article
        key={p.id}
        className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground"
        aria-label={`${med.display_name || med.name}${p.label ? ` · ${p.label}` : ''}`}
      >
        <header className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <h3 className="break-words font-medium">
              {med.display_name || med.name}
            </h3>
            <p className="break-words text-sm text-muted-foreground">
              {[
                p.label && p.label !== med.name && p.label !== med.display_name
                  ? p.label
                  : null,
                `${p.label_mass_mg ? `${p.label_mass_mg} mg ` : ''}${t(`medications.stockLayout.kind.${p.kind}`, p.kind).toLowerCase()}`,
                p.expiry_date
                  ? `${t('medications.stockLayout.expShort', 'exp')} ${formatDate(p.expiry_date)}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={
              p.status === 'in_use'
                ? 'shrink-0 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300'
                : 'shrink-0'
            }
          >
            {t(
              `medications.stock.status.${p.status}`,
              {
                sealed: 'Sealed',
                in_use: 'In use',
                finished: 'Finished',
                discarded: 'Discarded',
              }[p.status]
            )}
          </Badge>
        </header>
        <details className="border-t px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('medications.stockLayout.details', 'Details')}
          </summary>
          <div className="mt-3 space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {p.dose_mg ? (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('medications.stockLayout.recordedDose', 'Recorded dose')}
                  </dt>
                  <dd className="font-medium tabular-nums">{p.dose_mg} mg</dd>
                </div>
              ) : null}
              {p.concentration_mg_ml ? (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t(
                      'medications.glp1InventoryManager.concentrationMgML',
                      'Concentration (mg/mL)'
                    )}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {tidyNumber(p.concentration_mg_ml)} mg/mL
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t('medications.stockLayout.balance', 'Stock balance')}
                </dt>
                <dd className="font-medium tabular-nums">
                  {p.stock
                    ? `${p.stock.remainingMg.toFixed(3)} mg`
                    : `${left}/${total || '?'} ${t('medications.glp1InventoryManager.doses', 'doses')}`}
                </dd>
              </div>
              {p.stock && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t(
                      'medications.stockLayout.remainingVolume',
                      'Remaining volume'
                    )}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {p.stock.remainingMl.toFixed(3)} mL
                  </dd>
                </div>
              )}
            </dl>
            {p.reorder_flag &&
              p.reorder_threshold != null &&
              left <= p.reorder_threshold && (
                <Badge
                  variant="outline"
                  className="border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {t('medications.glp1InventoryManager.reorder', 'Reorder')}
                </Badge>
              )}
            {content}
          </div>
        </details>
        {stockFooter(p)}
      </article>
    );
  };

  const quickAdd = !editingPen && kind === 'vial';
  const fieldKind = (
    <div className="space-y-1">
      <Label htmlFor="inv-kind">
        {t('medications.glp1InventoryManager.kind', 'Kind')}
      </Label>
      <Select
        value={kind}
        disabled={!!editingPen?.preparation}
        onValueChange={(v) => {
          setKind(v as 'pen' | 'vial');
          if (v === 'pen') {
            setDosesTotal('4');
          } else {
            setDosesTotal('10');
          }
        }}
      >
        <SelectTrigger id="inv-kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pen">
            {t('medications.glp1InventoryManager.pen', 'Pen')}
          </SelectItem>
          <SelectItem value="vial">
            {t('medications.glp1InventoryManager.vial', 'Vial')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
  const fieldLabel = (
    <div className="space-y-1">
      <Label htmlFor="inv-label">
        {t('medications.glp1InventoryManager.labelName', 'Label / Name')}
      </Label>
      <Input
        id="inv-label"
        placeholder={t(
          'medications.glp1InventoryManager.eGPen2Vial',
          'e.g. Pen #2, Vial Batch A'
        )}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
    </div>
  );
  const fieldOpened = (
    <div className="space-y-1">
      <Label htmlFor="inv-opened">
        {t('medications.glp1InventoryManager.dateOpened', 'Date Opened')}
      </Label>
      <Input
        id="inv-opened"
        type="date"
        value={openedAt}
        onChange={(e) => setOpenedAt(e.target.value)}
      />
    </div>
  );
  const fieldExpiry = (
    <div className="space-y-1">
      <Label htmlFor="inv-expiry">
        {t('medications.glp1InventoryManager.expiryDate', 'Expiry Date')}
      </Label>
      <Input
        id="inv-expiry"
        type="date"
        value={expiryDate}
        onChange={(e) => setExpiryDate(e.target.value)}
      />
    </div>
  );
  const fieldPrescription = (
    <>
      <MedicationPrescriptionLink
        medication={med}
        value={prescriptionId}
        onChange={(id) => {
          setPrescriptionId(id);
          setPrescriptionTouched(true);
        }}
        disabled={savePending}
      />
    </>
  );
  const fieldLabelMass = (
    <>
      {labelMassRelevant && (
        <VialLabelMassField
          id="inv-label-mass"
          value={labelMass}
          onChange={(value) => {
            setLabelMass(value);
            setLabelMassTouched(true);
          }}
          conflictsWithPen={kind === 'pen'}
          required={quickAdd}
        />
      )}
    </>
  );
  const fieldDose = (
    <>
      {kind === 'pen' ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="inv-dose">
              {t(
                'medications.glp1InventoryManager.doseStrengthMg',
                'Dose Strength (mg)'
              )}
            </Label>
            <Input
              id="inv-dose"
              type="number"
              step="0.05"
              value={inventoryDoseMg}
              onChange={(e) => setInventoryDoseMg(e.target.value)}
              placeholder={
                medicationDoseInMg(med) != null
                  ? String(medicationDoseInMg(med))
                  : '0'
              }
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="inv-doses-total">
              {t('medications.glp1InventoryManager.totalDoses', 'Total Doses')}
            </Label>
            <Input
              id="inv-doses-total"
              type="number"
              value={dosesTotal}
              onChange={(e) => setDosesTotal(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t(
              'medications.glp1InventoryManager.doseCountDetails',
              'Dose size and count (optional)'
            )}
          </summary>
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-dose">
                  {t(
                    'medications.glp1InventoryManager.doseStrengthMg',
                    'Dose Strength (mg)'
                  )}
                </Label>
                <Input
                  id="inv-dose"
                  type="number"
                  step="0.05"
                  value={inventoryDoseMg}
                  onChange={(e) => setInventoryDoseMg(e.target.value)}
                  placeholder={
                    medicationDoseInMg(med) != null
                      ? String(medicationDoseInMg(med))
                      : '0'
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inv-doses-total">
                  {t(
                    'medications.glp1InventoryManager.totalDoses',
                    'Total Doses'
                  )}
                </Label>
                <Input
                  id="inv-doses-total"
                  type="number"
                  value={dosesTotal}
                  onChange={(e) => setDosesTotal(e.target.value)}
                />
              </div>
            </div>
          </div>
        </details>
      )}
    </>
  );
  const fieldConcVolume = (
    <>
      {kind === 'vial' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="inv-concentration">
              {t(
                'medications.glp1InventoryManager.concentrationMgML',
                'Concentration (mg/mL)'
              )}
            </Label>
            <Input
              id="inv-concentration"
              type="number"
              step="0.1"
              placeholder="e.g. 5"
              value={concentration}
              readOnly={
                !!editingPen?.preparation || (editingPen?.doses_used ?? 0) > 0
              }
              onChange={(e) => setConcentration(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="inv-volume">
              {t('medications.glp1InventoryManager.volumeML', 'Volume (mL)')}
            </Label>
            <Input
              id="inv-volume"
              type="number"
              step="0.1"
              placeholder="e.g. 2"
              value={volume}
              readOnly={
                !!editingPen?.preparation || (editingPen?.doses_used ?? 0) > 0
              }
              onChange={(e) => setVolume(e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  );
  const fieldLotStorage = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="inv-lot">
            {t('medications.preparation.lot', 'Lot number')}
          </Label>
          <Input
            id="inv-lot"
            value={lotNumber}
            onChange={(event) => setLotNumber(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-storage">
            {t('medications.preparation.storage', 'Storage location')}
          </Label>
          <Input
            id="inv-storage"
            value={storageLocation}
            onChange={(event) => setStorageLocation(event.target.value)}
          />
        </div>
      </div>
    </>
  );
  const fieldBud = (
    <>
      <div className="space-y-2 rounded-md border p-3">
        <Label htmlFor="inv-bud-mode">
          {t('medications.preparation.budMethod', 'Beyond-use date (BUD)')}
        </Label>
        <Select
          value={budMode}
          onValueChange={(value) => setBudMode(value as typeof budMode)}
        >
          <SelectTrigger id="inv-bud-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              {t('medications.preparation.notRecorded', 'Not recorded')}
            </SelectItem>
            <SelectItem value="date">
              {t('medications.preparation.explicitDate', 'Explicit date')}
            </SelectItem>
            <SelectItem value="interval">
              {t('medications.preparation.interval', 'Interval and source')}
            </SelectItem>
          </SelectContent>
        </Select>
        {budMode === 'date' && (
          <>
            <Label htmlFor="inv-bud-date">
              {t('medications.preparation.budDate', 'BUD date')}
            </Label>
            <Input
              id="inv-bud-date"
              type="date"
              value={budDate}
              onChange={(event) => setBudDate(event.target.value)}
            />
          </>
        )}
        {budMode === 'interval' && (
          <>
            <Label htmlFor="inv-bud-base">
              {t('medications.preparation.budBase', 'BUD basis date')}
            </Label>
            <Input
              id="inv-bud-base"
              type="date"
              value={budBaseDate}
              onChange={(event) => setBudBaseDate(event.target.value)}
            />
            <Label htmlFor="inv-bud-days">
              {t('medications.preparation.budDays', 'BUD interval (days)')}
            </Label>
            <Input
              id="inv-bud-days"
              type="number"
              min="0"
              step="1"
              value={budInterval}
              onChange={(event) => setBudInterval(event.target.value)}
            />
            {calculatedBudDate && (
              <p className="text-sm">
                {t('medications.glp1InventoryManager.bud', 'BUD {{bud_date}}', {
                  bud_date: calculatedBudDate,
                })}
              </p>
            )}
          </>
        )}
        {budMode !== 'none' && (
          <>
            <Label htmlFor="inv-bud-source">
              {t('medications.preparation.budSource', 'BUD source')}
            </Label>
            <Input
              id="inv-bud-source"
              value={budSource}
              onChange={(event) => setBudSource(event.target.value)}
            />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.preparation.budHelp',
            'Enter the date or interval from your product or clinician guidance. No stability interval is assumed.'
          )}
        </p>
      </div>
    </>
  );
  const fieldReorder = (
    <>
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="inv-reorder" className="flex flex-col gap-0.5">
            <span>
              {t(
                'medications.glp1InventoryManager.enableReorderWarning',
                'Enable Reorder Warning'
              )}
            </span>
            <span className="font-normal text-[10px] text-muted-foreground">
              {t(
                'medications.glp1InventoryManager.alertWhenRemainingDosesAre',
                'Alert when remaining doses are low'
              )}
            </span>
          </Label>
          <Switch
            id="inv-reorder"
            checked={reorderFlag}
            onCheckedChange={setReorderFlag}
          />
        </div>

        {reorderFlag && (
          <div className="space-y-1 pt-1">
            <Label htmlFor="inv-threshold">
              {t(
                'medications.glp1InventoryManager.reorderThresholdDosesLeft',
                'Reorder Threshold (doses left)'
              )}
            </Label>
            <Input
              id="inv-threshold"
              type="number"
              value={reorderThreshold}
              onChange={(e) => setReorderThreshold(e.target.value)}
            />
          </div>
        )}
      </div>
    </>
  );
  const fieldNotes = (
    <>
      <div className="space-y-1">
        <Label htmlFor="inv-notes">
          {t('medications.glp1InventoryManager.notes2', 'Notes')}
        </Label>
        <Textarea
          id="inv-notes"
          placeholder={t(
            'medications.glp1InventoryManager.batchNumberBrandPharmacyInfo',
            'Batch number, brand, pharmacy info...'
          )}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </>
  );

  return (
    <>
      {stockView ? (
        <>
          {(stockView === 'active' || stockView === 'closed') &&
            pensQ.isError && (
              <p
                role="alert"
                className="col-span-full text-sm text-muted-foreground"
              >
                {t(
                  'medications.stockLayout.loadError',
                  'Could not load stock for {{name}}.',
                  { name: med.display_name || med.name }
                )}
              </p>
            )}
          {stockView === 'active' && pensQ.isLoading && (
            <p
              role="status"
              className="col-span-full text-sm text-muted-foreground"
            >
              {t('medications.stockLayout.loading', 'Loading current stock…')}
            </p>
          )}
          {stockView === 'active' &&
            !pensQ.isError &&
            activePens
              .filter((p) => !queueItems.some((row) => row.stock_id === p.id))
              .map(renderPen)}
          {stockView === 'closed' &&
            !pensQ.isError &&
            closedPens.map(renderPen)}
          {stockView === 'queue' &&
            queueItems.map((row) => {
              const p =
                !pensQ.isError && !pensQ.isLoading && !pensQ.isFetching
                  ? pensQ.data?.find(
                      (p) =>
                        p.id === row.stock_id &&
                        p.medication_id === row.medication_id
                    )
                  : undefined;
              return (
                <MedicationPreparationQueueEntry
                  key={row.stock_id}
                  row={row}
                  med={med}
                  canWrite={stockCanWrite}
                  compact
                  footer={p ? stockFooter(p) : undefined}
                />
              );
            })}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col items-start gap-3 text-base sm:flex-row sm:items-center sm:justify-between">
              <span>{t('medications.stock.title', 'Inventory')}</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openPreparation()}>
                  {t('medications.stock.prepare', 'Prepare a vial')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAddDialog()}
                >
                  {t('medications.glp1.addInventory', 'Add Inventory')}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(pensQ.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('medications.glp1.noPens', 'No pens/vials tracked.')}
              </p>
            )}
            {activePens.map(renderPen)}
            {closedPens.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t(
                    'medications.stock.finishedDiscarded',
                    'Finished / discarded'
                  )}{' '}
                  ({closedPens.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {closedPens.map(renderPen)}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {preparationOpen && (
        <MedicationPreparationWizard
          key={preparationPen?.id ?? 'new'}
          med={med}
          pen={preparationPen}
          onClose={() => setPreparationOpen(false)}
          onCloseAutoFocus={
            stockView === 'controls'
              ? (event) => {
                  event.preventDefault();
                  moreRef.current?.focus();
                }
              : undefined
          }
        />
      )}
      {/* Add/Edit Inventory Dialog */}
      <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPen
                ? t(
                    'medications.glp1InventoryManager.editPenVialInventory',
                    'Edit Pen / Vial Inventory'
                  )
                : t(
                    'medications.glp1InventoryManager.addPenVialInventory',
                    'Add Pen / Vial Inventory'
                  )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editingPen && (
              <div className="space-y-1">
                <Label htmlFor="inv-status">
                  {t('medications.stock.statusLabel', 'Status')}
                </Label>
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as MedicationPen['status'])
                  }
                >
                  <SelectTrigger id="inv-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      ['sealed', 'in_use', 'finished', 'discarded'] as const
                    ).map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(
                          `medications.stock.status.${value}`,
                          value.replace('_', ' ')
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {quickAdd ? (
              <>
                <div className="grid grid-cols-2 gap-3">{fieldKind}</div>
                {fieldLabelMass}
                {fieldPrescription}
                <div className="grid grid-cols-2 gap-3">{fieldExpiry}</div>
                {fieldLotStorage}
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t(
                      'medications.glp1InventoryManager.moreOptions',
                      'More options (label, already opened or prepared stock, beyond-use date, notes)'
                    )}
                  </summary>
                  <div className="mt-3 space-y-4">
                    <div className="grid grid-cols-2 gap-3">{fieldLabel}</div>
                    {fieldDose}
                    {fieldConcVolume}
                    <div className="grid grid-cols-2 gap-3">{fieldOpened}</div>
                    {fieldBud}
                    {fieldReorder}
                    {fieldNotes}
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {fieldKind}
                  {fieldLabel}
                </div>
                {fieldPrescription}
                {fieldLabelMass}
                {fieldDose}
                {editingPen?.preparation && (
                  <SavedPreparation
                    preparation={editingPen.preparation}
                    expanded
                  />
                )}
                {fieldConcVolume}
                <div className="grid grid-cols-2 gap-3">
                  {fieldOpened}
                  {fieldExpiry}
                </div>
                {fieldLotStorage}
                {fieldBud}
                {fieldReorder}
                {fieldNotes}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInventoryOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleSaveInventory}
              disabled={
                savePending ||
                !budValid ||
                !labelMassValid ||
                (quickAdd && !labelMass.trim()) ||
                (prescriptionTouched &&
                  (!prescriptionScope.ready || !prescriptionScope.canWrite))
              }
            >
              {savePending
                ? t('common.saving', 'Saving...')
                : editingPen
                  ? t('common.saveChanges', 'Save Changes')
                  : t(
                      'medications.glp1InventoryManager.addInventory',
                      'Add Inventory'
                    )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={confirmPen !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPen(null);
        }}
        onConfirm={confirmPenAction}
        variant="destructive"
        title={
          confirmPen?.action === 'delete'
            ? t(
                'medications.stockLayout.deleteConfirmTitle',
                'Delete {{name}}?',
                {
                  name: confirmPen.pen.label || med.display_name || med.name,
                }
              )
            : t(
                'medications.stockLayout.retireConfirmTitle',
                'Retire {{name}}?',
                {
                  name: confirmPen?.pen.label || med.display_name || med.name,
                }
              )
        }
        description={
          confirmPen?.action === 'delete'
            ? t(
                'medications.stockLayout.deleteConfirmBody',
                'This permanently removes it from your stock and cannot be undone. Stock with recorded doses cannot be deleted; retire it instead.'
              )
            : t(
                'medications.stockLayout.retireConfirmBody',
                'It is marked finished and leaves your active stock. Doses already logged are kept.'
              )
        }
        confirmLabel={
          confirmPen?.action === 'delete'
            ? t('common.delete', 'Delete')
            : t('medications.stockLayout.retire', 'Retire')
        }
      />
    </>
  );
}

/** "Rx: source · Change" line from Pitstop; shown only when a prescription is linked. */
function StockPrescriptionLine({
  pen,
  canWrite,
  onChange,
}: {
  pen: MedicationPen;
  canWrite: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useMedicationPrescriptions(!!pen.prescription_id);
  if (!pen.prescription_id) {
    // Stock still in play can be linked to a prescription from its card, as in Pitstop.
    if (
      !canWrite ||
      pen.kind !== 'vial' ||
      pen.status === 'finished' ||
      pen.status === 'discarded'
    )
      return null;
    return (
      <button
        type="button"
        className="text-primary hover:underline"
        onClick={onChange}
      >
        {t('medications.stockLayout.addRx', '+ Add prescription')}
      </button>
    );
  }
  const row = data?.prescriptions.find(
    (item) => item.id === pen.prescription_id
  );
  if (!row) return null;
  const name =
    row.source ??
    row.prescriber ??
    row.pharmacy ??
    t('medications.prescriptions.singular', 'Prescription');
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span>
        {t('medications.stockLayout.rx', 'Rx')}:{' '}
        <span className="text-foreground">{name}</span>
      </span>
      {canWrite && (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={onChange}
        >
          {t('medications.stockLayout.change', 'Change')}
        </button>
      )}
    </span>
  );
}
