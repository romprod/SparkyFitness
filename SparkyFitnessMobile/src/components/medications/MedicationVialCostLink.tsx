import { Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatPurchaseMoney } from '@workspace/shared';
import {
  useMedicationCostsAccess,
  useMedicationVialCosts,
} from '../../hooks/useMedicationPurchases';
export default function MedicationVialCostLink({
  vialId,
  onOpen,
}: {
  vialId: string;
  onOpen: (purchaseId?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const access = useMedicationCostsAccess();
  const query = useMedicationVialCosts(access.ownerId);
  if (!access.ownerId) return null;
  if (query.isLoading)
    return (
      <Text className="text-xs text-text-muted">
        {t('medications.costs.loadingCost', {
          defaultValue: 'Loading invoice cost…',
        })}
      </Text>
    );
  if (query.isError)
    return (
      <Text className="text-xs text-text-muted">
        {t('medications.costs.costUnavailable', {
          defaultValue: 'Invoice cost unavailable',
        })}
      </Text>
    );
  const cost = query.data?.vials.find((vial) => vial.pen_id === vialId);
  if (!query.data) return null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => {
        if (access.isCurrent())
          onOpen(cost?.is_costed ? cost.purchase_id : undefined);
      }}
      className="py-2"
    >
      <Text className="text-sm text-text-link">
        {cost?.is_costed
          ? cost.landed_unit != null && cost.currency
            ? t('medications.costs.invoiceUnitCost', {
                defaultValue: 'Invoice · {{value}} per vial',
                value: formatPurchaseMoney(
                  cost.landed_unit,
                  cost.currency,
                  i18n.language
                ),
              })
            : t('medications.costs.invoice', { defaultValue: 'Invoice' })
          : t('medications.costs.uncosted', {
              defaultValue: 'Uncosted · view Costs',
            })}
      </Text>
    </TouchableOpacity>
  );
}
