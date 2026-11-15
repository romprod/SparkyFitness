import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  MedicationPreparation,
  MedicationPreparationCreationInput,
  MedicationPreparationCorrectionValues,
} from '@workspace/shared';
import BottomSheetPicker from '../BottomSheetPicker';
import FormInput from '../FormInput';
import OptionalDateField from './OptionalDateField';

export interface PreparationDraft {
  mode: 'reconstituted' | 'premixed';
  mass: string;
  massUnit: 'mg' | 'mcg';
  concentration: string;
  volume: string;
  preparedDate: string;
  diluent: string;
}
export const preparationDraft = (
  prep?: MedicationPreparation | null
): PreparationDraft => ({
  mode: prep?.mode ?? 'reconstituted',
  mass: prep?.exact?.mass_value ?? (prep ? String(prep.mass_value) : ''),
  massUnit: prep?.mass_unit ?? 'mg',
  concentration:
    prep?.label_concentration_value ??
    (prep?.mode === 'premixed'
      ? (prep.exact?.concentration_mg_ml ?? String(prep.concentration_mg_ml))
      : ''),
  volume:
    prep?.exact?.final_volume_ml ?? (prep ? String(prep.final_volume_ml) : ''),
  preparedDate: prep?.prepared_date ?? '',
  diluent: prep?.diluent ?? '',
});
export const preparationCreationInput = (
  draft: PreparationDraft
): MedicationPreparationCreationInput =>
  draft.mode === 'premixed'
    ? {
        mode: draft.mode,
        label_concentration_value: draft.concentration,
        label_concentration_unit: 'mg/ml',
        final_volume_ml: draft.volume,
        prepared_date: draft.preparedDate,
        diluent: draft.diluent.trim() || null,
      }
    : {
        mode: draft.mode,
        mass_value: draft.mass,
        mass_unit: draft.massUnit,
        final_volume_ml: draft.volume,
        prepared_date: draft.preparedDate,
        diluent: draft.diluent.trim() || null,
      };
export const preparationCorrectionValues = (
  draft: PreparationDraft
): MedicationPreparationCorrectionValues =>
  draft.mode === 'premixed'
    ? {
        mode: draft.mode,
        label_concentration_value: draft.concentration,
        label_concentration_unit: 'mg/ml',
        final_volume_ml: draft.volume,
        prepared_date: draft.preparedDate,
        diluent: draft.diluent.trim() || null,
      }
    : {
        mode: draft.mode,
        mass_value: draft.mass,
        mass_unit: draft.massUnit,
        final_volume_ml: draft.volume,
        prepared_date: draft.preparedDate,
        diluent: draft.diluent.trim() || null,
      };
export default function PreparationFields({
  draft,
  onChange,
  stage,
}: {
  draft: PreparationDraft;
  onChange: (draft: PreparationDraft) => void;
  stage: 'mode' | 'amounts';
}) {
  const { t } = useTranslation();
  const input = (
    key: 'mass' | 'concentration' | 'volume' | 'diluent',
    label: string
  ) => (
    <View className="gap-1.5">
      <Text className="text-sm text-text-secondary">{label}</Text>
      <FormInput
        accessibilityLabel={label}
        value={draft[key]}
        onChangeText={(value) => onChange({ ...draft, [key]: value })}
        keyboardType={key === 'diluent' ? 'default' : 'decimal-pad'}
      />
    </View>
  );
  return stage === 'mode' ? (
    <BottomSheetPicker
      value={draft.mode}
      onSelect={(mode) => onChange({ ...draft, mode })}
      title={t('medications.preparation.mode', {
        defaultValue: 'Preparation type',
      })}
      options={[
        {
          value: 'reconstituted' as const,
          label: t('medications.preparation.reconstituted', {
            defaultValue: 'Reconstituted',
          }),
        },
        {
          value: 'premixed' as const,
          label: t('medications.preparation.premixed', {
            defaultValue: 'Premixed',
          }),
        },
      ]}
    />
  ) : (
    <View className="gap-3">
      {draft.mode === 'reconstituted' ? (
        <>
          {input(
            'mass',
            t('medications.preparation.massValue', {
              defaultValue: 'Labelled vial content',
            })
          )}
          <BottomSheetPicker
            value={draft.massUnit}
            onSelect={(massUnit) => onChange({ ...draft, massUnit })}
            title={t('medications.preparation.massUnit', {
              defaultValue: 'Mass unit',
            })}
            options={[
              {
                value: 'mg' as const,
                label: t('medications.preparation.unitMg', {
                  defaultValue: 'mg',
                }),
              },
              {
                value: 'mcg' as const,
                label: t('medications.preparation.unitMcg', {
                  defaultValue: 'mcg',
                }),
              },
            ]}
          />
        </>
      ) : (
        input(
          'concentration',
          t('medications.preparation.labelConcentration', {
            defaultValue: 'Label concentration (mg/mL)',
          })
        )
      )}
      {input(
        'volume',
        t('medications.preparation.finalVolume', {
          defaultValue: 'Final volume (mL)',
        })
      )}
      <OptionalDateField
        label={t('medications.preparation.preparedDate', {
          defaultValue: 'Prepared date',
        })}
        value={draft.preparedDate}
        onChange={(preparedDate) => onChange({ ...draft, preparedDate })}
      />
      {input(
        'diluent',
        t('medications.preparation.diluent', {
          defaultValue: 'Diluent (optional)',
        })
      )}
    </View>
  );
}
