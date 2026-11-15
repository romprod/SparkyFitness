import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../../services/nativeTabBarPreference';
import Button from '../ui/Button';
export default function MedicationCostsStatus({
  title,
  onClose,
  loading,
  onRetry,
}: {
  title: string;
  onClose: () => void;
  loading: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const native = useNativeIOSHeadersActive();
  const header = useScreenHeader({
    title,
    left: { kind: 'dismiss', onPress: onClose },
  });
  return (
    <View
      className="flex-1 bg-background"
      style={native ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <View className="gap-3 p-4">
        <Text className="text-sm text-text-primary">
          {loading
            ? t('medications.costs.loading', {
                defaultValue: 'Loading invoice data…',
              })
            : onRetry
              ? t('medications.costs.loadFailed', {
                  defaultValue: 'Unable to load invoice data.',
                })
              : t('medications.costs.ownerOnly', {
                  defaultValue:
                    'Costs are available only for your own account.',
                })}
        </Text>
        {onRetry && (
          <Button variant="secondary" onPress={onRetry}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        )}
      </View>
    </View>
  );
}
