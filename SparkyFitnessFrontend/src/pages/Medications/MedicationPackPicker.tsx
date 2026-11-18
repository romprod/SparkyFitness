import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { useMedicationPacks } from '@/hooks/Medications/useMedicationPacks';

const AUTO = 'auto';
const trim = (value: string) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(
    Number(value)
  );

/**
 * Shows what is left in the pack a dose will come from and, when a medication
 * has more than one open or unopened pack, lets the user pick which one.
 * Renders nothing for medications without packs, so logging is unchanged there.
 */
export default function MedicationPackPicker({
  medicationId,
  value,
  onChange,
}: {
  medicationId: string;
  /** Chosen pack id, or undefined for automatic. */
  value: string | undefined;
  onChange: (packId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { data } = useMedicationPacks();
  const candidates = (data?.packs ?? []).filter(
    (pack) =>
      pack.medication_id === medicationId &&
      (pack.status === 'in_use' || pack.status === 'sealed')
  );
  if (candidates.length === 0) return null;
  const open = candidates.find((pack) => pack.status === 'in_use');
  const summary = (pack: (typeof candidates)[number]) =>
    t('medications.packs.remaining', '{{left}} of {{total}} {{unit}} left', {
      left: trim(pack.units_remaining),
      total: trim(pack.units_total),
      unit: pack.unit_label,
    });
  if (candidates.length === 1)
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        {summary(candidates[0]!)}
      </p>
    );
  const id = `pack-pick-${medicationId}`;
  return (
    <div className="mt-2 space-y-1">
      <Label htmlFor={id} className="text-[11px] font-normal">
        {t('medications.packs.takeFrom', 'Take from')}
      </Label>
      <select
        id={id}
        className="h-7 w-full max-w-[220px] rounded-md border bg-background px-2 text-xs"
        value={value ?? AUTO}
        onChange={(event) =>
          onChange(event.target.value === AUTO ? undefined : event.target.value)
        }
      >
        <option value={AUTO}>
          {t('medications.packs.takeAuto', 'Automatic')}
          {open ? ` · ${summary(open)}` : ''}
        </option>
        {candidates.map((pack) => (
          <option key={pack.id} value={pack.id}>
            {pack.label || pack.medication_name} · {summary(pack)}
          </option>
        ))}
      </select>
    </div>
  );
}
