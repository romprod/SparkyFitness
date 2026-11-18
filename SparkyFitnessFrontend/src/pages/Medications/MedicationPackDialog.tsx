import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MedicationPackView } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useCreatePackMutation,
  useUpdatePackMutation,
} from '@/hooks/Medications/useMedicationPacks';
import type { Medication } from '@/types/medications';
import { defaultPackUnit } from './packUnit';

const positive = (value: string) => {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && n > 0;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Medications a pack can be added for; ignored when editing. */
  medications: Medication[];
  pack?: MedicationPackView;
}

function PackForm({ onOpenChange, medications, pack }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const create = useCreatePackMutation();
  const update = useUpdatePackMutation();
  const editing = !!pack;
  const [medicationId, setMedicationId] = useState(
    pack?.medication_id ?? medications[0]?.id ?? ''
  );
  const chosen = medications.find((m) => m.id === medicationId);
  const [label, setLabel] = useState(pack?.label ?? '');
  const [unit, setUnit] = useState(
    pack?.unit_label ?? defaultPackUnit(medications[0])
  );
  const [total, setTotal] = useState(pack?.units_total ?? '');
  const [used, setUsed] = useState(pack?.units_used ?? '');
  const [status, setStatus] = useState<'sealed' | 'in_use'>(
    pack?.status === 'in_use' ? 'in_use' : 'sealed'
  );
  const [expiry, setExpiry] = useState(pack?.expiry_date ?? '');
  const [lot, setLot] = useState(pack?.lot_number ?? '');
  const [storage, setStorage] = useState(pack?.storage_location ?? '');
  const [threshold, setThreshold] = useState(
    pack?.reorder_threshold_units ?? ''
  );
  const [notes, setNotes] = useState(pack?.notes ?? '');
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;
  const valid =
    !!medicationId &&
    unit.trim() !== '' &&
    positive(total) &&
    (used.trim() === '' || Number(used) >= 0) &&
    (threshold.trim() === '' || Number(threshold) >= 0);
  const submit = () => {
    setError('');
    const common = {
      label: label.trim() || null,
      unit_label: unit.trim(),
      units_total: Number(total),
      expiry_date: expiry || null,
      lot_number: lot.trim() || null,
      storage_location: storage.trim() || null,
      reorder_threshold_units:
        threshold.trim() === '' ? null : Number(threshold),
      notes: notes.trim() || null,
    };
    const failed = (reason: unknown) =>
      setError(
        reason instanceof Error
          ? reason.message
          : t('medications.packs.saveFailed', 'Could not save this pack.')
      );
    if (pack)
      update.mutate(
        {
          id: pack.id,
          body: {
            ...common,
            units_used: used.trim() === '' ? 0 : Number(used),
          },
        },
        { onSuccess: () => onOpenChange(false), onError: failed }
      );
    else
      create.mutate(
        {
          medicationId,
          body: {
            ...common,
            status,
            ...(used.trim() !== '' ? { units_used: Number(used) } : {}),
          },
        },
        { onSuccess: () => onOpenChange(false), onError: failed }
      );
  };
  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {editing
            ? t('medications.packs.editTitle', 'Edit pack')
            : t('medications.packs.addTitle', 'Add a pack')}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="pack-medication">
            {t('medications.packs.medication', 'Medication or supplement')}
          </Label>
          <Select
            value={medicationId}
            disabled={editing}
            onValueChange={(id) => {
              setMedicationId(id);
              if (!editing)
                setUnit(defaultPackUnit(medications.find((m) => m.id === id)));
            }}
          >
            <SelectTrigger id="pack-medication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(editing && pack
                ? [{ id: pack.medication_id, name: pack.medication_name }]
                : medications.map((m) => ({
                    id: m.id,
                    name: m.display_name || m.name,
                  }))
              ).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen && !editing && chosen.dose_unit && (
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.packs.doseHint',
                'Your dose is {{amount}} {{unit}}. Use the same unit so each logged dose takes from this pack.',
                { amount: chosen.dose_amount, unit: chosen.dose_unit }
              )}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="pack-total">
              {t('medications.packs.total', 'Units in the pack')}
            </Label>
            <Input
              id="pack-total"
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-unit">
              {t('medications.packs.unit', 'Unit')}
            </Label>
            <Input
              id="pack-unit"
              value={unit}
              placeholder={t('medications.packs.unitPlaceholder', 'tablets')}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="pack-status">
                {t('medications.packs.state', 'State')}
              </Label>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as 'sealed' | 'in_use')
                }
              >
                <SelectTrigger id="pack-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sealed">
                    {t('medications.packs.status.sealed', 'Unopened')}
                  </SelectItem>
                  <SelectItem value="in_use">
                    {t('medications.packs.status.in_use', 'In use')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="pack-used">
              {t('medications.packs.used', 'Already used')}
            </Label>
            <Input
              id="pack-used"
              inputMode="decimal"
              value={used}
              onChange={(e) => setUsed(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="pack-expiry">
              {t('medications.packs.expiryLabel', 'Expiry date')}
            </Label>
            <Input
              id="pack-expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-threshold">
              {t('medications.packs.threshold', 'Warn when this few are left')}
            </Label>
            <Input
              id="pack-threshold"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="pack-label">
              {t('medications.packs.labelField', 'Name or label')}
            </Label>
            <Input
              id="pack-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-lot">
              {t('medications.packs.lot', 'Lot number')}
            </Label>
            <Input
              id="pack-lot"
              value={lot}
              onChange={(e) => setLot(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pack-storage">
            {t('medications.packs.storage', 'Storage location')}
          </Label>
          <Input
            id="pack-storage"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pack-notes">
            {t('medications.packs.notes', 'Notes')}
          </Label>
          <Textarea
            id="pack-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button disabled={!valid || pending} onClick={submit}>
          {t('common.save', 'Save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Adds or edits a pack; the form remounts on every open so no draft leaks between uses. */
export default function MedicationPackDialog({
  open,
  onOpenChange,
  medications,
  pack,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <PackForm
          key={pack?.id ?? 'new'}
          onOpenChange={onOpenChange}
          medications={medications}
          pack={pack}
        />
      )}
    </Dialog>
  );
}
