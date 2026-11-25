import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useMedicationCostsAccess,
  useMedicationPurchase,
  useMedicationPurchaseEditorData,
  useMedicationPurchases,
} from '../hooks/useMedicationPurchases';
import MedicationPurchaseEditor from '../components/medications/MedicationPurchaseEditor';
import MedicationCostsStatus from '../components/medications/MedicationCostsStatus';
import { latestPurchaseCurrency } from '../utils/medicationPurchases';
import type { RootStackScreenProps } from '../types/navigation';
export default function MedicationPurchaseFormScreen({
  route,
  navigation,
}: RootStackScreenProps<'MedicationPurchaseForm'>) {
  const { t } = useTranslation();
  const access = useMedicationCostsAccess();
  const id = route.params?.purchaseId;
  const detail = useMedicationPurchase(access.ownerId, id);
  const editor = useMedicationPurchaseEditorData(access.ownerId, id);
  // The list is already cached by the costs screen; it only seeds a new invoice.
  const list = useMedicationPurchases(id ? null : access.ownerId);
  const [reload, setReload] = useState(0);
  const onClose = () => navigation.goBack();
  const title = id
    ? t('medications.costs.editInvoice', { defaultValue: 'Edit invoice' })
    : t('medications.costs.addInvoice', { defaultValue: 'Add invoice' });
  if (!access.ownerId || !editor.data || (id && !detail.data))
    return (
      <MedicationCostsStatus
        title={title}
        onClose={onClose}
        loading={
          access.isLoading ||
          (!!access.ownerId && (editor.isLoading || (!!id && detail.isLoading)))
        }
        onRetry={
          access.isError || editor.isError || detail.isError
            ? () => {
                void access.refetch();
                if (access.ownerId) {
                  void editor.refetch();
                  if (id) void detail.refetch();
                }
              }
            : undefined
        }
      />
    );
  return (
    <MedicationPurchaseEditor
      key={`${access.scopeKey}:${id ?? 'new'}:${reload}`}
      ownerId={access.ownerId}
      initial={detail.data}
      data={editor.data}
      defaultCurrency={latestPurchaseCurrency(list.data?.purchases ?? [])}
      isScopeCurrent={access.isCurrent}
      onClose={onClose}
      onReload={() => {
        void Promise.all([
          editor.refetch(),
          ...(id ? [detail.refetch()] : []),
        ]).then((results) => {
          if (access.isCurrent() && results.every((result) => !result.isError))
            setReload((value) => value + 1);
        });
      }}
    />
  );
}
