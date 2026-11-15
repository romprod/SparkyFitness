import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { drawTargetDisplay, type DrawResult } from '@workspace/shared';
import SyringeVisual from './SyringeVisual';

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
  const target = data && !pending && !failed ? drawTargetDisplay(data) : null;
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
          <SyringeVisual draw={data} />
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
          {target && (
            <View className="gap-1 my-2">
              <Text className="text-xs text-text-muted">
                {t('medications.syringes.targetBreakdown', {
                  defaultValue: 'Target dose in all units',
                })}
              </Text>
              <View className="flex-row gap-2">
                {[
                  {
                    value: target.mcg,
                    unit: t('medications.preparation.unitMcg', {
                      defaultValue: 'mcg',
                    }),
                  },
                  {
                    value: target.mg,
                    unit: t('medications.preparation.unitMg', {
                      defaultValue: 'mg',
                    }),
                  },
                  {
                    value: target.ml,
                    unit: t('medications.syringes.ml', { defaultValue: 'mL' }),
                  },
                  {
                    value: target.units,
                    unit: t('medications.syringes.units', {
                      defaultValue: 'Units',
                    }),
                  },
                ].map((item) => (
                  <Text
                    key={item.unit}
                    className="flex-1 text-xs text-text-secondary"
                  >
                    {t('medications.syringes.targetValue', {
                      defaultValue: '{{value}} {{unit}}',
                      value: item.value,
                      unit: item.unit,
                    })}
                  </Text>
                ))}
              </View>
            </View>
          )}
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
