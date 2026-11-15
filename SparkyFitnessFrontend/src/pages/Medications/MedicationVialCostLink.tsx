import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPurchaseMoney } from '@workspace/shared';
import {
  useMedicationPurchaseScope,
  useMedicationVialCosts,
} from '@/hooks/useMedicationPurchases';
export default function MedicationVialCostLink({ penId }: { penId: string }) {
  const scope = useMedicationPurchaseScope();
  if (!scope.ready) return null;
  return <OwnedVialCost ownerId={scope.ownerId} penId={penId} />;
}
function OwnedVialCost({ ownerId, penId }: { ownerId: string; penId: string }) {
  const { t, i18n } = useTranslation();
  const costs = useMedicationVialCosts(ownerId, true);
  if (!costs.data) return null;
  const cost = costs.data.vials.find((vial) => vial.pen_id === penId);
  const known =
    cost?.is_costed &&
    cost.landed_unit != null &&
    cost.currency &&
    cost.purchase_id;
  return (
    <Link
      className="inline-block break-words text-xs font-medium underline underline-offset-2"
      to={
        known
          ? `/medications?tab=costs&purchase=${encodeURIComponent(cost.purchase_id!)}`
          : '/medications?tab=costs'
      }
    >
      {known
        ? `${formatPurchaseMoney(cost.landed_unit!, cost.currency!, i18n.language)} · ${t('medications.costs.invoice', 'Invoice')}`
        : t('medications.costs.uncosted', 'Uncosted')}
    </Link>
  );
}
