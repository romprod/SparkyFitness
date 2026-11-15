import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  labResultStatus,
  type LabComparisonPanel,
  type LabMarker,
} from '@workspace/shared';
import Button from '../ui/Button';
import LabStatusBadge from './LabStatusBadge';
import { useDeleteLabPanel } from '../../hooks/useLabResults';
import { formatDateLabel } from '../../utils/dateUtils';
import { formatLabRange, labResultText } from '../../utils/labResults';

interface Props {
  panels: LabComparisonPanel[];
  markers: LabMarker[];
  isLoading: boolean;
  isError: boolean;
}
const LabPanelHistory = ({ panels, markers, isLoading, isError }: Props) => {
  const { t, i18n } = useTranslation();
  const remove = useDeleteLabPanel();
  const locale = i18n.language.startsWith('pl') ? 'pl-PL' : 'en-US';
  const dateLabel = (day: string | null) =>
    day
      ? formatDateLabel(day, t, locale)
      : t('labs.comparison.dateUnknown', {
          defaultValue: 'Collection date not recorded',
        });
  const confirm = (id: string) =>
    Alert.alert(
      t('labs.panels.deleteTitle', { defaultValue: 'Delete lab panel' }),
      t('labs.panels.deleteMessage', {
        defaultValue:
          'Delete this panel and all of its results? This cannot be undone.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () =>
            remove.mutate(id, {
              onError: () =>
                Toast.show({
                  type: 'error',
                  text1: t('labs.panels.deleteFailed', {
                    defaultValue: 'Could not delete the lab panel.',
                  }),
                }),
            }),
        },
      ]
    );
  return (
    <View className="mt-5 gap-3">
      <Text className="text-lg font-semibold text-text-primary">
        {t('labs.panels.title', { defaultValue: 'Lab panels' })}
      </Text>
      {isLoading ? (
        <ActivityIndicator />
      ) : isError ? (
        <Text accessibilityRole="alert" className="text-text-secondary">
          {t('labs.panels.loadFailed', {
            defaultValue: 'Could not load the lab panels.',
          })}
        </Text>
      ) : panels.length === 0 ? (
        <Text className="text-sm text-text-secondary">
          {t('labs.panels.empty', {
            defaultValue:
              'No lab panels yet. Add one above to start tracking your markers.',
          })}
        </Text>
      ) : (
        panels.map((panel) => (
          <View key={panel.id} className="bg-surface rounded-xl p-4 gap-3">
            <View className="flex-row flex-wrap items-start justify-between gap-2">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold text-text-primary">
                  {dateLabel(panel.collected_on)}
                </Text>
                {panel.lab_name && (
                  <Text className="text-sm text-text-secondary">
                    {panel.lab_name}
                  </Text>
                )}
                <Text className="text-xs text-text-muted">
                  {panel.origin === 'manual'
                    ? t('labs.panels.manual', { defaultValue: 'Manual panel' })
                    : t('labs.panels.imported', {
                        defaultValue: 'Imported report',
                      })}
                </Text>
              </View>
              <Button
                variant="ghost"
                disabled={remove.isPending}
                accessibilityLabel={t('labs.panels.deleteDate', {
                  defaultValue: 'Delete lab panel {{date}}',
                  date: dateLabel(panel.collected_on),
                })}
                onPress={() => confirm(panel.id)}
              >
                {t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            </View>
            {panel.results.map((result) => {
              const id = result.marker_key
                ? `builtin:${result.marker_key}`
                : `custom:${result.custom_marker_id}`;
              const name =
                markers.find((m) => m.id === id)?.name ??
                t('labs.panels.marker', { defaultValue: 'Marker' });
              const range = formatLabRange(
                result.ref_range_low,
                result.ref_range_high,
                result.unit
              );
              const status = labResultStatus(result, {
                ref_range_low: null,
                ref_range_high: null,
              });
              return (
                <View
                  key={result.id}
                  className="border-t border-border-subtle pt-2 gap-1"
                >
                  <View className="flex-row flex-wrap justify-between gap-2">
                    <Text className="text-sm font-medium text-text-primary">
                      {name}
                    </Text>
                    <Text className="text-sm text-text-primary">
                      {labResultText(result)}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    {range && (
                      <Text className="text-xs text-text-muted">
                        {t('labs.referenceRange', {
                          defaultValue: 'Reference range: {{range}}',
                          range,
                        })}
                      </Text>
                    )}
                    <LabStatusBadge status={status} />
                    {result.entry_date !== panel.collected_on && (
                      <Text className="text-xs text-text-muted">
                        {t('labs.comparison.resultDate', {
                          defaultValue: 'Result date: {{date}}',
                          date: dateLabel(result.entry_date),
                        })}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
            {panel.notes && (
              <Text className="text-sm text-text-secondary bg-background rounded-lg p-3">
                {panel.notes}
              </Text>
            )}
          </View>
        ))
      )}
    </View>
  );
};
export default LabPanelHistory;
