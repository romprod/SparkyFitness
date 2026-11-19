import { useTranslation } from 'react-i18next';
import { Archive, Pencil, Trash2 } from 'lucide-react';
import type { MedicationPackView } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import MedicationPackCostLink from './MedicationPackCostLink';

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
  const name = pack.medication_name;
  const cardName = pack.label ? `${name} · ${pack.label}` : name;
  return (
    <article
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground"
      aria-label={t('medications.packs.cardLabel', 'Pack of {{name}}', {
        name: cardName,
      })}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="break-words font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {pack.label && `${pack.label} · `}
            {t('medications.packs.summary', '{{total}} {{unit}}', {
              total: trim(pack.units_total),
              unit: pack.unit_label,
            })}
            {pack.expiry_date &&
              ` · ${t('medications.packs.expiry', 'exp {{date}}', { date: formatDate(pack.expiry_date) })}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {pack.status === 'in_use' && (
            <Badge
              variant="secondary"
              className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            >
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
        <div className="space-y-1.5 px-4 pb-4">
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
          {pack.planned_empty_date !== null &&
            pack.planned_days_left !== null &&
            !pack.overdrawn && (
              <p className="text-xs text-muted-foreground">
                {pack.planned_days_left === 0
                  ? t(
                      'medications.packs.planRunsOutToday',
                      'On your plan: runs out today'
                    )
                  : t(
                      'medications.packs.planRunsOut',
                      'On your plan: runs out {{date}} (~{{amount}} days)',
                      {
                        date: formatDate(pack.planned_empty_date),
                        amount: pack.planned_days_left,
                      }
                    )}
              </p>
            )}
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
      <div className={closed ? 'px-4 pb-3' : 'px-4 pb-3 -mt-2'}>
        <MedicationPackCostLink
          packId={pack.id}
          unitsTotal={pack.units_total}
          unitsUsed={pack.units_used}
        />
      </div>
      {canWrite && (
        <div className="mt-auto flex flex-wrap items-center justify-start gap-x-3 gap-y-1 border-t px-4 py-3 text-sm">
          {pack.status === 'sealed' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-1 text-primary hover:text-primary"
              onClick={() => actions.onOpen(pack)}
            >
              {t('medications.packs.open', 'Open')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1 text-primary hover:text-primary"
            onClick={() => actions.onEdit(pack)}
          >
            <Pencil aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {t('common.edit', 'Edit')}
          </Button>
          {pack.status === 'in_use' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-1 text-muted-foreground"
              onClick={() => actions.onFinish(pack)}
            >
              <Archive aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
              {t('medications.packs.finish', 'Retire')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1 text-destructive hover:text-destructive"
            onClick={() => actions.onDelete(pack)}
          >
            <Trash2 aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {t('common.delete', 'Delete')}
          </Button>
        </div>
      )}
    </article>
  );
}
