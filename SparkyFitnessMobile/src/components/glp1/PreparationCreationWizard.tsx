import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  previewPreparationCreation,
  isDeviceEligibleForRoute,
  positiveDrawDoseSchema,
  normalizeDeviceDose,
  type DeviceDose,
  type PreparedMedicationRoute,
  medicationPreparationInputSchema,
  type MedicationPreparationCreationInput,
} from '@workspace/shared';
import Button from '../ui/Button';
import SyringeDrawPreview from './SyringeDrawPreview';
import { useSyringes } from '../../hooks/useSyringes';
import PreparationFields, {
  preparationDraft,
  preparationCreationInput,
} from './PreparationFields';

export default function PreparationCreationWizard({
  initialDate,
  initialVolume,
  onChange,
  target = null,
  administrationRoute = 'injection',
}: {
  target?: DeviceDose | null;
  administrationRoute?: PreparedMedicationRoute;
  initialDate: string;
  initialVolume: string;
  onChange: (
    input: MedicationPreparationCreationInput | null,
    ready: boolean
  ) => void;
}) {
  const { t } = useTranslation();
  const devices = useSyringes();
  const eligible =
    devices.data?.syringes.filter((device) =>
      isDeviceEligibleForRoute(
        device.device_type ?? 'syringe',
        administrationRoute
      )
    ) ?? [];
  const device =
    eligible.find((device) => device.id === devices.data?.default_syringe_id) ??
    eligible[0] ??
    null;
  const [draft, setDraft] = useState(() => ({
    ...preparationDraft(),
    preparedDate: initialDate,
    volume: initialVolume,
  }));
  const [step, setStep] = useState(1);
  const raw = useMemo(() => preparationCreationInput(draft), [draft]);
  const normalized = useMemo(
    () => medicationPreparationInputSchema.safeParse(raw),
    [raw]
  );
  let usableTarget: DeviceDose | null = null;
  if (target && device) {
    try {
      if (
        positiveDrawDoseSchema.safeParse(normalizeDeviceDose(target, device))
          .success
      )
        usableTarget = target;
    } catch {
      /* An incompatible stored dose has no creation-review draw. */
    }
  }
  const preview = normalized.success
    ? previewPreparationCreation(raw, usableTarget, device)
    : null;
  useEffect(() => {
    onChange(normalized.success ? raw : null, step === 3 && normalized.success);
  }, [normalized, raw, step, onChange]);
  return (
    <View className="gap-3 rounded-xl border border-chrome-border p-3">
      <Text className="text-base font-semibold text-text-primary">
        {t('medications.preparation.step', {
          defaultValue: 'Preparation · step {{step}} of 3',
          step,
        })}
      </Text>
      {step < 3 ? (
        <PreparationFields
          draft={draft}
          onChange={setDraft}
          stage={step === 1 ? 'mode' : 'amounts'}
        />
      ) : (
        preview && (
          <>
            <Text className="text-sm text-text-primary">
              {t('medications.preparation.reviewConcentration', {
                defaultValue: 'Concentration: {{value}} mg/mL',
                value: preview.values.concentration_mg_ml,
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.reviewVolume', {
                defaultValue: 'Final volume: {{value}} mL',
                value: draft.volume,
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.reviewDate', {
                defaultValue: 'Prepared date: {{date}}',
                date: draft.preparedDate,
              })}
            </Text>
            <SyringeDrawPreview
              data={preview.draw ?? undefined}
              pending={devices.isFetching}
              failed={devices.isError}
              showNeutral
              neutralDeviceType={
                administrationRoute === 'nasal'
                  ? 'pump'
                  : (device?.device_type ?? 'syringe')
              }
            />
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.estimatedYield', {
                defaultValue: 'Estimated doses in vial: {{value}}',
                value:
                  !devices.isFetching && !devices.isError
                    ? (preview.doses_in_vial ?? '—')
                    : '—',
              })}
            </Text>
          </>
        )
      )}
      {step < 3 && (
        <Button
          variant="secondary"
          disabled={step === 2 && !normalized.success}
          onPress={() => setStep(step + 1)}
        >
          {step === 1
            ? t('common.next', { defaultValue: 'Next' })
            : t('medications.preparation.review', {
                defaultValue: 'Review preparation',
              })}
        </Button>
      )}
      {step > 1 && (
        <Button variant="secondary" onPress={() => setStep(step - 1)}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
      )}
    </View>
  );
}
