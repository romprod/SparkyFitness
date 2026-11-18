import { useTranslation } from 'react-i18next';
import type { MedicationPackView } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';

export interface PackCardActions {
  onOpen: (pack: MedicationPackView) => void;
  onFinish: (pack: MedicationPackView) => void;
  onEdit: (pack: MedicationPackView) => void;
  onDelete: (pack: MedicationPackView) => void;
}

const trim = (value: string) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(
    Number(value)
  );

/** A tablet/capsule/softgel/scoop pack: how much is left and how long it should last. */
export default function MedicationPackCard({
  pack,
  canWrite,
  actions,
}: {
  pack: MedicationPackView;
  canWrite: boolean;
  actions: PackCardActions;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const closed = pack.status === 'finished' || pack.status === 'discarded';
  const total = Number(pack.units_total);
  const fill =
    total > 0
      ? Math.max(0, Math.min(1, Number(pack.units_remaining) / total))
      : 0;
  const name = pack.label
    ? `${pack.medication_name} · ${pack.label}`
    : pack.medication_name;
  return (
    <article
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
      aria-label={t('medications.packs.cardLabel', 'Pack of {{name}}', {
        name,
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="break-words font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {t('medications.packs.summary', '{{total}} {{unit}}', {
              total: trim(pack.units_total),
              unit: pack.unit_label,
            })}
            {pack.expiry_date &&
              ` · ${t('medications.packs.expiry', 'Expiry {{date}}', { date: formatDate(pack.expiry_date) })}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {pack.status === 'in_use' && (
            <Badge variant="secondary">
              {t('medications.packs.status.in_use', 'In use')}
            </Badge>
          )}
          {pack.status === 'sealed' && (
            <Badge variant="secondary">
              {t('medications.packs.status.sealed', 'Unopened')}
            </Badge>
          )}
          {closed && (
            <Badge variant="outline">
              {t(`medications.packs.status.${pack.status}`, pack.status)}
            </Badge>
          )}
          {pack.low && !closed && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-700 dark:text-amber-300"
            >
              {t('medications.packs.low', 'Low')}
            </Badge>
          )}
          {pack.expired && !closed && (
            <Badge variant="destructive">
              {t('medications.packs.expired', 'Expired')}
            </Badge>
          )}
        </div>
      </div>
      {!closed && (
        <div className="space-y-1.5">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t('medications.packs.level', 'Remaining in pack')}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.max(0, Number(pack.units_remaining))}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${fill * 100}%` }}
            />
          </div>
          <p className="text-sm tabular-nums">
            {pack.overdrawn
              ? t(
                  'medications.packs.overdrawn',
                  'Overdrawn by {{amount}} {{unit}}',
                  {
                    amount: trim(
                      String(Math.abs(Number(pack.units_remaining)))
                    ),
                    unit: pack.unit_label,
                  }
                )
              : t(
                  'medications.packs.remaining',
                  '{{left}} of {{total}} {{unit}} left',
                  {
                    left: trim(pack.units_remaining),
                    total: trim(pack.units_total),
                    unit: pack.unit_label,
                  }
                )}
          </p>
          {pack.doses_left !== null && !pack.overdrawn && (
            <p className="text-xs text-muted-foreground">
              {t('medications.packs.dosesLeft', '{{amount}} doses left', {
                amount: pack.doses_left,
              })}
              {pack.observed_days_left !== null &&
                ` · ${t('medications.packs.daysLeft', '~{{amount}} days at your recent pace', { amount: pack.observed_days_left })}`}
            </p>
          )}
        </div>
      )}
      {canWrite && (
        <div className="mt-auto flex flex-wrap items-center justify-end gap-1">
          {pack.status === 'sealed' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => actions.onOpen(pack)}
            >
              {t('medications.packs.open', 'Open')}
            </Button>
          )}
          {pack.status === 'in_use' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => actions.onFinish(pack)}
            >
              {t('medications.packs.finish', 'Mark finished')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => actions.onEdit(pack)}
          >
            {t('common.edit', 'Edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => actions.onDelete(pack)}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </div>
      )}
    </article>
  );
}
