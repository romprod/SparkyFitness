import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCostWindow,
} from '@workspace/shared';
import { useMedicationCostAnalytics } from '../../hooks/useMedicationPurchases';
import SegmentedControl from '../SegmentedControl';
import Button from '../ui/Button';

export default function MedicationCostReport({ ownerId }: { ownerId: string }) {
  const { t, i18n } = useTranslation();
  const [window, setWindow] = useState<MedicationCostWindow>('12');
  const query = useMedicationCostAnalytics(ownerId, window);
  const current =
    !query.isFetching && !query.isError && query.data?.window.key === window
      ? query.data
      : undefined;
  const segments = [
    {
      key: '3' as const,
      label: t('medications.costs.window3', { defaultValue: '3 months' }),
    },
    {
      key: '6' as const,
      label: t('medications.costs.window6', { defaultValue: '6 months' }),
    },
    {
      key: '12' as const,
      label: t('medications.costs.window12', { defaultValue: '12 months' }),
    },
    {
      key: 'all' as const,
      label: t('medications.costs.windowAll', { defaultValue: 'All' }),
    },
  ];
  return (
    <View className="gap-3">
      <Text
        accessibilityRole="header"
        className="text-lg font-semibold text-text-primary"
      >
        {t('medications.costs.byMedication', { defaultValue: 'By medication' })}
      </Text>
      <SegmentedControl
        segments={segments}
        activeKey={window}
        onSelect={setWindow}
      />
      <Text className="text-xs text-text-secondary">
        {t('medications.costs.reportCaption', {
          defaultValue:
            'Rates use current invoice prices and vial label amounts, and only costed doses. The report window does not filter the invoice ledger.',
        })}
      </Text>
      {query.isFetching || (!query.isError && !current) ? (
        <Text className="text-sm text-text-secondary">
          {t('medications.costs.reportLoading', {
            defaultValue: 'Loading medication cost report…',
          })}
        </Text>
      ) : query.isError ? (
        <View className="gap-2 rounded-xl bg-surface p-3">
          <Text accessibilityRole="alert" className="text-sm text-text-primary">
            {t('medications.costs.reportFailed', {
              defaultValue: 'Unable to load the medication cost report.',
            })}
          </Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        </View>
      ) : current?.rows.length === 0 ? (
        <Text className="text-sm text-text-secondary">
          {t('medications.costs.reportEmpty', {
            defaultValue: 'Nothing bought or dosed in this window.',
          })}
        </Text>
      ) : (
        current?.rows.map((row) => {
          const spend =
            !row.spend_mixed_currency &&
            row.spend_present &&
            row.spend !== null &&
            row.spend_currency !== null
              ? formatPurchaseMoney(
                  row.spend,
                  row.spend_currency,
                  i18n.language
                )
              : '—';
          const rate = (value: string | null) =>
            row.usage_mixed_currency
              ? '—'
              : formatPurchaseRate(value, row.usage_currency);
          const metrics = [
            {
              label: t('medications.costs.spend', { defaultValue: 'Spend' }),
              value: spend,
            },
            {
              label: t('medications.costs.ratePerDose', {
                defaultValue: 'Per dose',
              }),
              value: rate(row.cost_per_dose),
            },
            {
              label: t('medications.costs.perMg', { defaultValue: 'Per mg' }),
              value: rate(row.cost_per_mg),
            },
          ];
          return (
            <View
              key={row.medication_id}
              className="gap-3 rounded-xl bg-surface p-4"
            >
              <Text
                accessibilityRole="header"
                className="text-base font-semibold text-text-primary"
              >
                {row.medication_name}
              </Text>
              <Text className="text-xs text-text-secondary">
                {t('medications.costs.costedCounts', {
                  defaultValue:
                    '{{costed}} costed doses · {{uncosted}} uncosted',
                  costed: row.costed_doses,
                  uncosted: row.uncosted_doses,
                })}
              </Text>
              <View className="flex-row gap-3">
                {metrics.map((metric) => (
                  <View key={metric.label} className="flex-1 gap-1">
                    <Text className="text-xs text-text-secondary">
                      {metric.label}
                    </Text>
                    <Text className="text-sm font-semibold text-text-primary">
                      {metric.value}
                    </Text>
                  </View>
                ))}
              </View>
              {row.spend_mixed_currency && (
                <Text className="text-xs text-text-primary">
                  {t('medications.costs.spendMixed', {
                    defaultValue:
                      'Spend is unavailable because contributing invoices use different currencies.',
                  })}
                </Text>
              )}
              {row.usage_mixed_currency && (
                <Text className="text-xs text-text-primary">
                  {t('medications.costs.usageMixed', {
                    defaultValue:
                      'Dose and mg rates are unavailable because costed doses use different currencies.',
                  })}
                </Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}
