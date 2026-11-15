import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DrawResult } from '@workspace/shared';

export default function SyringeDrawPreview({
  data,
  pending,
  failed,
}: {
  data?: DrawResult;
  pending: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {pending && (
        <Text className="text-sm text-text-muted">
          {t('medications.syringes.calculating', {
            defaultValue: 'Calculating draw…',
          })}
        </Text>
      )}
      {failed && (
        <Text className="text-sm text-text-warning">
          {t('medications.syringes.previewFailed', {
            defaultValue:
              'Unable to calculate this draw. Check the vial concentration and syringe settings.',
          })}
        </Text>
      )}
      {!pending && !failed && data && (
        <View className="gap-1">
          <Text className="text-base font-semibold text-text-primary">
            {t('medications.syringes.marking', {
              defaultValue: 'Measured marking: {{value}} {{unit}}',
              value: data.markingValue,
              unit:
                data.markingScale === 'ml'
                  ? t('medications.syringes.ml', { defaultValue: 'mL' })
                  : t('medications.syringes.units', {
                      defaultValue: 'Units',
                    }),
            })}
          </Text>
          <Text className="text-sm text-text-secondary">
            {t('medications.syringes.delivered', {
              defaultValue: 'Delivered: {{mass}} mcg · {{volume}} mL',
              mass: data.deliveredMassMcg,
              volume: data.deliveredVolumeMl,
            })}
          </Text>
          <Text className="text-sm text-text-secondary">
            {t('medications.syringes.error', {
              defaultValue: 'Rounding error: {{error}} mcg',
              error: data.roundingErrorMcg,
            })}
          </Text>
          {data.warnings.map((warning) => (
            <Text key={warning.code} className="text-sm text-text-warning">
              {warning.message}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}
