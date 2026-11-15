import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { drawTargetDisplay, type DrawResult } from '@workspace/shared';
import SyringeVisual from './SyringeVisual';

export default function SyringeDrawPreview({
  data,
  pending,
  failed,
  showNeutral = false,
}: {
  data?: DrawResult;
  pending: boolean;
  failed: boolean;
  showNeutral?: boolean;
}) {
  const { t } = useTranslation();
  const current = !pending && !failed ? data : undefined;
  const target = current ? drawTargetDisplay(current) : null;
  return (
    <>
      {(current || showNeutral) && (
        <>
          <SyringeVisual draw={current} neutral={showNeutral} />
          <Text className="text-base font-semibold text-text-primary">
            {current
              ? t('medications.syringes.marking', {
                  defaultValue: 'Measured marking: {{value}} {{unit}}',
                  value: current.markingValue,
                  unit:
                    current.markingScale === 'ml'
                      ? t('medications.syringes.ml', { defaultValue: 'mL' })
                      : t('medications.syringes.units', {
                          defaultValue: 'Units',
                        }),
                })
              : t('medications.syringes.emptyMarking', {
                  defaultValue: 'Draw to —',
                })}
          </Text>
        </>
      )}
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
      {current && (
        <View className="gap-1">
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
              mass: current.deliveredMassMcg,
              volume: current.deliveredVolumeMl,
            })}
          </Text>
          <Text className="text-sm text-text-secondary">
            {t('medications.syringes.error', {
              defaultValue: 'Rounding error: {{error}} mcg',
              error: current.roundingErrorMcg,
            })}
          </Text>
          {current.warnings.map((warning) => (
            <Text key={warning.code} className="text-sm text-text-warning">
              {warning.message}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}
