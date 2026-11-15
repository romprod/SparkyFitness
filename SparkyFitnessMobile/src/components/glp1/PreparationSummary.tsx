import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MedicationPreparation } from '@workspace/shared';
import { formatDateLabel } from '../../utils/dateUtils';

/** Stored inputs remain visible separately from mutable vial metadata. */
export default function PreparationSummary({
  preparation,
}: {
  preparation: MedicationPreparation | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  if (!preparation) {
    return (
      <Text className="text-sm text-text-muted">
        {t('medications.preparation.notRecorded', {
          defaultValue: 'Preparation details not recorded.',
        })}
      </Text>
    );
  }
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-text-primary">
        {t('medications.preparation.saved', {
          defaultValue: 'Saved preparation',
        })}
      </Text>
      <Text className="text-sm text-text-secondary">
        {preparation.mode === 'premixed'
          ? t('medications.preparation.premixed', { defaultValue: 'Premixed' })
          : t('medications.preparation.reconstituted', {
              defaultValue: 'Reconstituted',
            })}
        {' · '}
        {t('medications.preparation.summary', {
          defaultValue:
            '{{mass}} {{unit}} in {{volume}} mL · {{concentration}} mg/mL',
          mass: preparation.mass_value.toLocaleString(i18n.language),
          unit: preparation.mass_unit,
          volume: preparation.final_volume_ml.toLocaleString(i18n.language),
          concentration: preparation.concentration_mg_ml.toLocaleString(
            i18n.language,
            { maximumSignificantDigits: 6 }
          ),
        })}
      </Text>
      <Text className="text-sm text-text-secondary">
        {t('medications.preparation.preparedSummary', {
          defaultValue: 'Prepared {{date}}',
          date: formatDateLabel(preparation.prepared_date, t, i18n.language),
        })}
        {preparation.diluent ? ` · ${preparation.diluent}` : ''}
      </Text>
    </View>
  );
}
