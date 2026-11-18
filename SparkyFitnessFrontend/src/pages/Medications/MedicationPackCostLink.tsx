import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  packUnitCost,
} from '@workspace/shared';
import {
  useMedicationPackCosts,
  useMedicationPurchaseScope,
} from '@/hooks/useMedicationPurchases';

interface Props {
  packId: string;
  unitsTotal: string;
  unitsUsed: string;
}

/** Invoice cost of one pack: per unit and for what has been used. Owner only, like vial costs. */
export default function MedicationPackCostLink(props: Props) {
  const scope = useMedicationPurchaseScope();
  if (!scope.ready) return null;
  return (
    <OwnedPackCost
      key={`${scope.ownerId}:${scope.generation}`}
      ownerId={scope.ownerId}
      {...props}
    />
  );
}

function OwnedPackCost({
  ownerId,
  packId,
  unitsTotal,
  unitsUsed,
}: Props & { ownerId: string }) {
  const { t } = useTranslation();
  const costs = useMedicationPackCosts(ownerId, true);
  if (!costs.data || costs.isError) return null;
  const cost = costs.data.packs.find((pack) => pack.pack_id === packId);
  // Recomputed from the live pack so a logged dose updates the used cost without a refetch.
  const live =
    cost?.is_costed && cost.landed_pack != null && cost.currency
      ? packUnitCost({
          landedPack: cost.landed_pack,
          unitsTotal,
          unitsUsed,
        })
      : null;
  return (
    <Link
      className="inline-block break-words text-xs font-medium underline underline-offset-2"
      to={
        cost?.is_costed && cost.purchase_id
          ? `/medications?tab=costs&purchase=${encodeURIComponent(cost.purchase_id)}`
          : '/medications?tab=costs'
      }
    >
      {live && cost?.currency
        ? t(
            'medications.packs.costLine',
            '{{each}} each · {{used}} used · Invoice',
            {
              each: formatPurchaseRate(live.perUnit, cost.currency),
              used: formatPurchaseMoney(live.consumed, cost.currency),
            }
          )
        : t('medications.costs.uncosted', 'Uncosted')}
    </Link>
  );
}
