import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import {
  INJECTION_SITES,
  positiveDrawDoseSchema,
  drawDoseSchema,
  deviceDoseSchema,
  normalizeDeviceDose,
  recordedDoseForEdit,
  drawDeliveredMg,
  type DeviceDose,
  type DrawPreviewInput,
  type MedicationEntryStatus,
  type UpdateInjectionInput,
  type UpdateMedicationEntryInput,
} from '@workspace/shared';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import BottomSheetPicker from '../components/BottomSheetPicker';
import FormInput from '../components/FormInput';
import SyringeDrawPreview from '../components/glp1/SyringeDrawPreview';
import { useSyringes, useSyringeDrawPreview } from '../hooks/useSyringes';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import TimeSheet, { type TimeSheetRef } from '../components/TimeSheet';
import { useUpdateInjection } from '../hooks/useGlp1';
import { useUpdateMedicationEntry } from '../hooks/useMedications';
import { usePreferences } from '../hooks/usePreferences';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { addLog } from '../services/LogService';
import type { RootStackScreenProps } from '../types/navigation';
import {
  deviceDoseUnitOptions,
  deviceCalibrationContext,
} from '../utils/medicationDevices';
import { getDeviceTimezone } from '../utils/dateUtils';
import { editedTakenAt, entryTimeOfDay } from '../utils/medicationAdherence';
import { injectionSiteLabel } from '../utils/medicationLocalization';
import { formatLocalizedTimeOfDay } from '../utils/medicationScheduleLocalization';

type MedicationEntryEditScreenProps =
  RootStackScreenProps<'MedicationEntryEdit'>;

const NO_SITE = 'none';

/** Statuses a scheduled dose can be corrected between; as-needed doses keep theirs. */
const EDITABLE_STATUSES: MedicationEntryStatus[] = [
  'taken',
  'skipped',
  'snoozed',
];

const MedicationEntryEditScreen: React.FC<MedicationEntryEditScreenProps> = ({
  route,
  navigation,
}) => {
  const { t } = useTranslation();
  const entry =
    'entry' in route.params
      ? route.params.entry
      : {
          ...route.params.injection,
          status: 'taken' as const,
          taken_at: route.params.injection.injected_at,
          med_name_snapshot: route.params.medicationName ?? null,
          dose_amount_snapshot: route.params.injection.dose_mg,
          entry_type: 'injection' as const,
        };
  const isInjection = entry.entry_type === 'injection';
  const canEditStatus =
    !isInjection && EDITABLE_STATUSES.includes(entry.status);
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const { preferences } = usePreferences();
  const timezone = getDeviceTimezone();
  const timeSheetRef = useRef<TimeSheetRef>(null);

  const updateEntry = useUpdateMedicationEntry();
  const updateInjection = useUpdateInjection();
  const isSaving = updateEntry.isPending || updateInjection.isPending;

  const [timeOfDay, setTimeOfDay] = useState(() =>
    entryTimeOfDay(entry.taken_at, timezone)
  );
  const [timeTouched, setTimeTouched] = useState(false);
  const [status, setStatus] = useState<MedicationEntryStatus>(entry.status);
  const [site, setSite] = useState(entry.site ?? NO_SITE);
  const [siteTouched, setSiteTouched] = useState(false);
  const [notes, setNotes] = useState(entry.notes ?? '');

  const devices = useSyringes();
  const nasal = entry.administration_route === 'nasal';
  const originalDevice = devices.data?.syringes.find(
    (device) => device.id === entry.syringe_id
  );
  const originalUnit = drawDoseSchema.shape.unit.safeParse(
    entry.dose_input_unit
  );
  const recorded = recordedDoseForEdit(
    {
      dose_mg: entry.dose_mg_exact ?? entry.dose_amount_snapshot,
      volume_ml: entry.volume_ml,
      syringe_units: entry.syringe_units,
      dose_input_unit: originalUnit.success ? originalUnit.data : 'mg',
    },
    originalDevice
  );
  const calculatedInjection =
    isInjection && entry.volume_ml != null && entry.dose_input_unit != null;
  const doseReadOnly =
    calculatedInjection &&
    (!entry.syringe_id ||
      !entry.pen_id ||
      (!devices.isLoading && !originalDevice));
  const doseContext = JSON.stringify([
    entry.preparation_id ?? entry.pen_id,
    deviceCalibrationContext(originalDevice),
  ]);
  const [edits, setEdits] = useState<{
    dose: DeviceDose;
    context: string;
  } | null>(null);
  const staleContext = edits !== null && edits.context !== doseContext;
  const dose: DeviceDose = doseReadOnly
    ? (recorded ?? { value: '', unit: 'mg' })
    : staleContext
      ? { value: '', unit: recorded?.unit ?? 'mg' }
      : (edits?.dose ?? recorded ?? { value: '', unit: 'mg' });
  const doseChanged =
    calculatedInjection &&
    !doseReadOnly &&
    !(recorded === null && dose.value.trim() === '') &&
    edits !== null &&
    (staleContext ||
      dose.value !== recorded?.value ||
      dose.unit !== recorded?.unit);
  const parsed = deviceDoseSchema.safeParse(dose);
  let validDose = false;
  if (parsed.success && originalDevice) {
    try {
      validDose = positiveDrawDoseSchema.safeParse(
        normalizeDeviceDose(parsed.data, originalDevice)
      ).success;
    } catch {
      validDose = false;
    }
  }
  const drawInput: DrawPreviewInput | null =
    calculatedInjection &&
    doseChanged &&
    !doseReadOnly &&
    !staleContext &&
    parsed.success &&
    validDose
      ? {
          syringe_id: entry.syringe_id!,
          editing_injection_id: entry.id,
          dose: parsed.data,
        }
      : null;
  const preview = useSyringeDrawPreview(
    drawInput ? (entry.pen_id ?? null) : null,
    drawInput,
    doseContext
  );
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const previewKey =
    drawInput && preview.data?.review?.state
      ? JSON.stringify([drawInput, preview.data.review.state, doseContext])
      : null;
  const reviewing = previewKey !== null && reviewKey === previewKey;
  const drawBlocked =
    doseChanged &&
    (doseReadOnly ||
      !drawInput ||
      preview.isFetching ||
      preview.isError ||
      !preview.data?.review?.state ||
      preview.data.warnings.some((warning) => warning.severity === 'block'));
  const changeDose = (next: DeviceDose) => {
    setEdits({ dose: next, context: doseContext });
    setReviewKey(null);
  };

  const handleSave = () => {
    if (isSaving || drawBlocked) return;
    if (doseChanged && !reviewing) {
      setReviewKey(previewKey);
      return;
    }
    const entryDay = entry.entry_date.slice(0, 10);
    const timeChange = timeTouched
      ? { at: editedTakenAt(entryDay, timeOfDay, timezone), day: entryDay }
      : null;
    const trimmedNotes = notes.trim() || null;

    const onSuccess = () => {
      Toast.show({
        type: 'success',
        text1: t('medications.entryEdit.saved', {
          defaultValue: 'Dose updated',
        }),
      });
      navigation.goBack();
    };
    const onError = (error: Error) => {
      setReviewKey(null);
      if (doseChanged) void preview.refetch();
      addLog(`Failed to update medication entry: ${error.message}`, 'ERROR');
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.entryEdit.saveFailed', {
          defaultValue: 'Failed to save: {{error}}',
          error: error.message,
        })
      );
    };

    if (isInjection) {
      const body: UpdateInjectionInput = {
        ...(timeChange
          ? { injected_at: timeChange.at, entry_date: timeChange.day }
          : {}),
        ...(siteTouched ? { site: site === NO_SITE ? null : site } : {}),
        notes: trimmedNotes,
        ...(calculatedInjection &&
        doseChanged &&
        drawInput &&
        preview.data?.review
          ? {
              calculated_draw: {
                syringe_id: drawInput.syringe_id,
                dose: drawInput.dose,
                expected_preview_state: preview.data.review.state,
                review_intent: true,
              },
            }
          : {}),
      };
      updateInjection.mutate({ id: entry.id, body }, { onSuccess, onError });
    } else {
      const body: UpdateMedicationEntryInput = {
        ...(timeChange
          ? { taken_at: timeChange.at, entry_date: timeChange.day }
          : {}),
        notes: trimmedNotes,
        ...(canEditStatus ? { status } : {}),
      };
      updateEntry.mutate({ id: entry.id, body }, { onSuccess, onError });
    }
  };

  const title = t('medications.entryEdit.title', {
    defaultValue: 'Edit logged dose',
  });
  const header = useScreenHeader({
    title,
    nativeTitle: title,
    left: { kind: 'dismiss', onPress: () => navigation.goBack() },
    right: {
      kind: 'primary',
      label:
        doseChanged && !reviewing
          ? t('medications.devices.reviewDose', {
              defaultValue: 'Review dose change',
            })
          : t('common.save', { defaultValue: 'Save' }),
      busy: isSaving,
      disabled: drawBlocked,
      busyLabel: t('common.saving', { defaultValue: 'Saving…' }),
      onPress: handleSave,
    },
  });

  const statusOptions = useMemo(
    () => [
      {
        label: t('medications.dose.taken', { defaultValue: 'Taken' }),
        value: 'taken' as const,
      },
      {
        label: t('medications.dose.skipped', { defaultValue: 'Skipped' }),
        value: 'skipped' as const,
      },
      {
        label: t('medications.today.snoozed', { defaultValue: 'Snoozed' }),
        value: 'snoozed' as const,
      },
    ],
    [t]
  );

  const siteOptions = useMemo(
    () => [
      {
        label: t('medications.entryEdit.noSite', { defaultValue: 'No site' }),
        value: NO_SITE,
      },
      ...INJECTION_SITES.map((s) => ({
        label: injectionSiteLabel(s.id, t),
        value: s.id,
      })),
    ],
    [t]
  );

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          padding: 16,
          rowGap: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        {entry.med_name_snapshot != null && (
          <Text className="text-lg font-semibold text-text-primary">
            {entry.med_name_snapshot}
          </Text>
        )}

        <SettingsRowGroup>
          <SettingsRow
            title={t('medications.entryEdit.takenAt', {
              defaultValue: 'Taken at',
            })}
            accessibilityLabel={t('medications.entryEdit.setTime', {
              defaultValue: 'Set time',
            })}
            onPress={() => timeSheetRef.current?.present()}
            rightAccessory={
              <Text className="text-base text-text-secondary">
                {formatLocalizedTimeOfDay(
                  timeOfDay,
                  undefined,
                  preferences?.time_format
                )}
              </Text>
            }
          />
        </SettingsRowGroup>

        {canEditStatus && (
          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.entryEdit.status', { defaultValue: 'Status' })}
            </Text>
            <BottomSheetPicker
              value={status}
              options={statusOptions}
              onSelect={setStatus}
              title={t('medications.entryEdit.status', {
                defaultValue: 'Status',
              })}
            />
          </View>
        )}

        {isInjection && !nasal && (
          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.entryEdit.site', {
                defaultValue: 'Injection site',
              })}
            </Text>
            <BottomSheetPicker
              value={site}
              options={siteOptions}
              onSelect={(value) => {
                if (value !== site) {
                  setSite(value);
                  setSiteTouched(true);
                }
              }}
              title={t('medications.entryEdit.site', {
                defaultValue: 'Injection site',
              })}
            />
          </View>
        )}

        {calculatedInjection && (
          <View className="gap-2">
            <Text className="text-sm font-medium text-text-secondary">
              {t('medications.glp1.log.dose', { defaultValue: 'Dose (mg)' })}
            </Text>
            {recorded && (
              <Text className="text-sm text-text-muted">
                {t('medications.devices.recordedDose', {
                  defaultValue: 'Recorded delivered dose: {{value}} {{unit}}',
                  value: recorded.value,
                  unit: recorded.unit,
                })}
              </Text>
            )}
            <FormInput
              accessibilityLabel={t('medications.devices.editDose', {
                defaultValue: 'Dose value',
              })}
              value={dose.value}
              onChangeText={(value) => changeDose({ value, unit: dose.unit })}
              editable={!doseReadOnly && !devices.isLoading}
              keyboardType="decimal-pad"
            />
            {!doseReadOnly && (
              <BottomSheetPicker
                value={dose.unit}
                options={deviceDoseUnitOptions(originalDevice?.device_type, t)}
                onSelect={(unit) => changeDose({ value: dose.value, unit })}
                title={t('medications.syringes.inputUnit', {
                  defaultValue: 'Input unit',
                })}
              />
            )}
            {doseReadOnly && (
              <Text className="text-sm text-text-muted">
                {t('medications.syringes.originalUnavailable', {
                  defaultValue:
                    'The original syringe or vial is no longer available. The dose is read-only; other details can still be edited.',
                })}
              </Text>
            )}
            {
              <SyringeDrawPreview
                data={drawInput ? preview.data : undefined}
                pending={preview.isFetching}
                failed={preview.isError}
                showNeutral
                neutralDeviceType={
                  nasal ? 'pump' : (originalDevice?.device_type ?? 'syringe')
                }
              />
            }
            {reviewing && preview.data?.review && (
              <View className="gap-2">
                <Text className="text-sm text-text-primary">
                  {t('medications.devices.doseReview', {
                    defaultValue: 'Delivered dose: {{before}} → {{after}} mg',
                    before: preview.data.review.previous?.doseMg ?? '—',
                    after: drawDeliveredMg(preview.data),
                  })}
                </Text>
                <Text className="text-sm text-text-secondary">
                  {t('medications.devices.volumeReview', {
                    defaultValue: 'Delivered volume: {{before}} → {{after}} mL',
                    before: preview.data.review.previous?.volumeMl ?? '—',
                    after: preview.data.deliveredVolumeMl,
                  })}
                </Text>
                <Text className="text-sm text-text-secondary">
                  {t('medications.devices.stockReview', {
                    defaultValue: 'Remaining volume: {{before}} → {{after}} mL',
                    before: preview.data.review.remainingBeforeMl ?? '—',
                    after: preview.data.review.remainingAfterMl ?? '—',
                  })}
                </Text>
              </View>
            )}
          </View>
        )}

        <View className="gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {t('medications.form.notes', { defaultValue: 'Notes' })}
          </Text>
          <FormInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={{ minHeight: 72 }}
          />
        </View>
      </KeyboardAwareScrollView>

      <TimeSheet
        ref={timeSheetRef}
        value={timeOfDay}
        timeFormat={preferences?.time_format}
        onSelectTime={(time) => {
          if (time !== timeOfDay) {
            setTimeOfDay(time);
            setTimeTouched(true);
          }
        }}
      />
    </View>
  );
};

export default MedicationEntryEditScreen;
