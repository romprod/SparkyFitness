import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import {
  todayInZone,
  addDays,
  medicationDoseInMg,
  medicationVialLabelMassSchema,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
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

interface Glp1InventoryManagerProps {
  med: Medication;
}

export default function Glp1InventoryManager({
  med,
}: Glp1InventoryManagerProps) {
  const { t } = useTranslation();
  const medId = med.id;

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
  const [status, setStatus] = useState<MedicationPen['status']>('sealed');
  const [kind, setKind] = useState<'pen' | 'vial'>('pen');
  const [label, setLabel] = useState('');
  const [labelMass, setLabelMass] = useState('');
  const [labelMassTouched, setLabelMassTouched] = useState(false);
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
    setInventoryOpen(true);
  };

  const openEditDialog = (pen: MedicationPen) => {
    resetForm();
    setEditingPen(pen);
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

  const handleSaveInventory = () => {
    if (!budValid || !labelMassValid) return;
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

    return (
      <div key={p.id} className="rounded-lg border p-3 text-sm">
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
                  { concentration_mg_ml: p.concentration_mg_ml }
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
              onClick={() => deletePenMutation.mutate(p.id)}
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
        {p.kind === 'vial' && (
          <p className="mt-2 text-xs text-muted-foreground">
            {p.stock
              ? t(
                  'medications.preparation.remaining',
                  '{{mass}} mg / {{volume}} mL remaining',
                  {
                    mass: p.stock.remainingMg.toFixed(3),
                    volume: p.stock.remainingMl.toFixed(3),
                  }
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
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${low ? 'bg-amber-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {(p.expiry_date || p.bud_date) && (
          <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground flex-wrap items-center">
            {p.expiry_date && (
              <span className="flex items-center gap-1">
                {t(
                  'medications.glp1InventoryManager.exp',
                  'Exp {{expiry_date}}',
                  { expiry_date: p.expiry_date }
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
                  bud_date: p.bud_date,
                })}
                <MedicationBudWarning date={p.bud_date} />
              </span>
            )}
          </div>
        )}
        {p.preparation && <SavedPreparation preparation={p.preparation} />}
        {p.kind === 'vial' && <MedicationVialCostLink penId={p.id} />}
        {p.kind === 'vial' && (p.preparation || p.doses_used === 0) && (
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
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col items-start gap-3 text-base sm:flex-row sm:items-center sm:justify-between">
            <span>{t('medications.stock.title', 'Preparation & stock')}</span>
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
              <div className="mt-3 space-y-2">{closedPens.map(renderPen)}</div>
            </details>
          )}
        </CardContent>
      </Card>

      {preparationOpen && (
        <MedicationPreparationWizard
          key={preparationPen?.id ?? 'new'}
          med={med}
          pen={preparationPen}
          onClose={() => setPreparationOpen(false)}
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
            <div className="grid grid-cols-2 gap-3">
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

              <div className="space-y-1">
                <Label htmlFor="inv-label">
                  {t(
                    'medications.glp1InventoryManager.labelName',
                    'Label / Name'
                  )}
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
            </div>

            {labelMassRelevant && (
              <VialLabelMassField
                id="inv-label-mass"
                value={labelMass}
                onChange={(value) => {
                  setLabelMass(value);
                  setLabelMassTouched(true);
                }}
                conflictsWithPen={kind === 'pen'}
              />
            )}
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

            {editingPen?.preparation && (
              <SavedPreparation preparation={editingPen.preparation} expanded />
            )}
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
                      !!editingPen?.preparation ||
                      (editingPen?.doses_used ?? 0) > 0
                    }
                    onChange={(e) => setConcentration(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inv-volume">
                    {t(
                      'medications.glp1InventoryManager.volumeML',
                      'Volume (mL)'
                    )}
                  </Label>
                  <Input
                    id="inv-volume"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 2"
                    value={volume}
                    readOnly={
                      !!editingPen?.preparation ||
                      (editingPen?.doses_used ?? 0) > 0
                    }
                    onChange={(e) => setVolume(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-opened">
                  {t(
                    'medications.glp1InventoryManager.dateOpened',
                    'Date Opened'
                  )}
                </Label>
                <Input
                  id="inv-opened"
                  type="date"
                  value={openedAt}
                  onChange={(e) => setOpenedAt(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inv-expiry">
                  {t(
                    'medications.glp1InventoryManager.expiryDate',
                    'Expiry Date'
                  )}
                </Label>
                <Input
                  id="inv-expiry"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>

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
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="inv-bud-mode">
                {t(
                  'medications.preparation.budMethod',
                  'Beyond-use date (BUD)'
                )}
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
                    {t(
                      'medications.preparation.interval',
                      'Interval and source'
                    )}
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
                    {t(
                      'medications.preparation.budDays',
                      'BUD interval (days)'
                    )}
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
                      {t(
                        'medications.glp1InventoryManager.bud',
                        'BUD {{bud_date}}',
                        { bud_date: calculatedBudDate }
                      )}
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInventoryOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleSaveInventory}
              disabled={savePending || !budValid || !labelMassValid}
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
    </>
  );
}
