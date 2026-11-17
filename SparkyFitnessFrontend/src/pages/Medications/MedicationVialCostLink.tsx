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
  return (
    <OwnedVialCost
      key={`${scope.ownerId}:${scope.generation}`}
      ownerId={scope.ownerId}
      penId={penId}
    />
  );
}
function OwnedVialCost({ ownerId, penId }: { ownerId: string; penId: string }) {
  const { t, i18n } = useTranslation();
  const costs = useMedicationVialCosts(ownerId, true);
  if (!costs.data || costs.isError) return null;
  const cost = costs.data.vials.find((vial) => vial.pen_id === penId);
  const known =
    cost?.is_costed && cost.unit_cost !== null && cost.cost_source !== null;
  const invoice = known && cost.cost_source === 'invoice';
  const provenance = invoice
    ? t('medications.costs.invoice', 'Invoice')
    : t(
        'medications.costEstimates.prescriptionEstimate',
        'Prescription estimate'
      );
  const amount =
    known && cost.currency
      ? formatPurchaseMoney(cost.unit_cost!, cost.currency, i18n.language)
      : null;
  return (
    <Link
      className="inline-block break-words text-xs font-medium underline underline-offset-2"
      to={
        invoice && cost.purchase_id
          ? `/medications?tab=costs&purchase=${encodeURIComponent(cost.purchase_id)}`
          : '/medications?tab=costs'
      }
    >
      {known
        ? `${amount ?? t('medications.costEstimates.currencyUnavailable', 'Currency unavailable')} · ${provenance}${!invoice ? ` · ${t('medications.costEstimates.noShipping', 'no shipping')}` : ''}`
        : t('medications.costs.uncosted', 'Uncosted')}
    </Link>
  );
}
