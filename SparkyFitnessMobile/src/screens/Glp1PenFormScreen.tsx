import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import BottomSheetPicker from '../components/BottomSheetPicker';
import FormInput from '../components/FormInput';
import OptionalDateField from '../components/glp1/OptionalDateField';
import PreparationSummary from '../components/glp1/PreparationSummary';
import PreparationCreationWizard from '../components/glp1/PreparationCreationWizard';
import PreparationCorrection from '../components/glp1/PreparationCorrection';
import { useMedicationDetail } from '../hooks/useMedications';
import { getTodayDate } from '../utils/dateUtils';
import Button from '../components/ui/Button';
import Switch from '../components/ui/Switch';
import {
  useCreatePen,
  useDeletePen,
  useMedicationPens,
  useUpdatePen,
} from '../hooks/useGlp1';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { RootStackScreenProps } from '../types/navigation';
import {
  resolvePreparedMedicationRoute,
  deviceDoseSchema,
  type MedicationPen,
  type MedicationPreparationCreationInput,
} from '@workspace/shared';

type Glp1PenFormScreenProps = RootStackScreenProps<'Glp1PenForm'>;

interface FormState {
  kind: 'pen' | 'vial';
  status: MedicationPen['status'];
  label: string;
  doseMg: string;
  concentration: string;
  volume: string;
  dosesTotal: string;
  openedAt: string;
  expiryDate: string;
  reorderFlag: boolean;
  reorderThreshold: string;
  notes: string;
  lotNumber: string;
  storageLocation: string;
  budMode: 'date' | 'interval' | '';
  budDate: string;
  budDays: string;
  budBaseDate: string;
  budSource: string;
}

const EMPTY_FORM: FormState = {
  kind: 'vial',
  status: 'sealed',
  label: '',
  doseMg: '',
  concentration: '',
  volume: '',
  dosesTotal: '4',
  openedAt: '',
  expiryDate: '',
  reorderFlag: false,
  reorderThreshold: '1',
  notes: '',
  lotNumber: '',
  storageLocation: '',
  budMode: '',
  budDate: '',
  budDays: '',
  budBaseDate: '',
  budSource: '',
};

const fromPen = (pen: MedicationPen): FormState => ({
  kind: pen.kind,
  status: pen.status,
  label: pen.label ?? '',
  doseMg: pen.dose_mg != null ? String(pen.dose_mg) : '',
  concentration:
    pen.concentration_mg_ml != null ? String(pen.concentration_mg_ml) : '',
  volume: pen.volume_ml != null ? String(pen.volume_ml) : '',
  dosesTotal: pen.doses_total != null ? String(pen.doses_total) : '',
  openedAt: pen.opened_at ?? '',
  expiryDate: pen.expiry_date ?? '',
  reorderFlag: pen.reorder_flag,
  reorderThreshold:
    pen.reorder_threshold != null ? String(pen.reorder_threshold) : '1',
  notes: pen.notes ?? '',
  lotNumber: pen.lot_number ?? '',
  storageLocation: pen.storage_location ?? '',
  budMode: pen.bud_mode ?? (pen.bud_date ? 'date' : ''),
  budDate: pen.bud_date ?? '',
  budDays: pen.bud_interval_days != null ? String(pen.bud_interval_days) : '',
  budBaseDate: pen.bud_base_date ?? '',
  budSource: pen.bud_source ?? '',
});

/** Empty string -> null; otherwise the number, or NaN when it is not numeric. */
const optionalNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);

const Glp1PenFormScreen: React.FC<Glp1PenFormScreenProps> = ({
  route,
  navigation,
}) => {
  const { t } = useTranslation();
  const { medicationId, penId } = route.params;
  const isEditing = !!penId;
  const medication = useMedicationDetail(medicationId).data;
  const preparationRoute =
    resolvePreparedMedicationRoute(medication ?? {}) ?? 'injection';
  const candidateTarget = deviceDoseSchema.safeParse({
    value: String(medication?.dose_amount ?? ''),
    unit: medication?.dose_unit?.toLowerCase(),
  });
  const preparationTarget = candidateTarget.success
    ? candidateTarget.data
    : null;
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');

  const { data: pens } = useMedicationPens(medicationId);
  const existing = useMemo(
    () => pens?.find((p) => p.id === penId),
    [pens, penId]
  );
  const createPen = useCreatePen();
  const updatePen = useUpdatePen();
  const deletePen = useDeletePen();

  const [edits, setEdits] = useState<Partial<FormState>>({});
  const form: FormState = useMemo(
    () => ({
      ...(existing ? fromPen(existing) : EMPTY_FORM),
      ...edits,
    }),
    [existing, edits]
  );
  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setEdits((prev) => ({ ...prev, [key]: value })),
    []
  );

  const [recordPreparation, setRecordPreparation] = useState(!isEditing);
  const [creationInput, setCreationInput] =
    useState<MedicationPreparationCreationInput | null>(null);
  const [creationReady, setCreationReady] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const onPreparationChange = useCallback(
    (input: MedicationPreparationCreationInput | null, ready: boolean) => {
      setCreationInput(input);
      setCreationReady(ready);
    },
    []
  );
  const canRecordPreparation =
    !existing?.preparation && (!existing || existing.doses_used === 0);
  const recordingPreparation =
    form.kind === 'vial' && canRecordPreparation && recordPreparation;

  const isSaving = createPen.isPending || updatePen.isPending;

  const handleSave = () => {
    if (isSaving || correcting || (isEditing && !existing)) return;
    if (recordingPreparation && (!creationInput || !creationReady)) return;
    const doseMg = optionalNumber(form.doseMg);
    const dosesTotal = optionalNumber(form.dosesTotal);
    const concentration =
      form.kind === 'vial' && !recordingPreparation
        ? optionalNumber(form.concentration)
        : null;
    const volume =
      form.kind === 'vial'
        ? recordingPreparation
          ? null
          : optionalNumber(form.volume)
        : null;
    const threshold = form.reorderFlag
      ? optionalNumber(form.reorderThreshold)
      : null;
    const numbers = [doseMg, dosesTotal, concentration, volume, threshold];
    if (numbers.some((n) => n !== null && !Number.isFinite(n))) {
      Alert.alert(
        t('medications.form.invalidNumber', { defaultValue: 'Invalid number' }),
        t('medications.glp1.form.invalidNumbers', {
          defaultValue: 'Please enter valid numbers.',
        })
      );
      return;
    }
    const budEdited = [
      'budMode',
      'budDate',
      'budDays',
      'budBaseDate',
      'budSource',
    ].some((key) => key in edits);
    const intervalDays = optionalNumber(form.budDays);
    if (budEdited && form.budMode === 'date' && !form.budDate) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.preparation.invalidBudDate', {
          defaultValue: 'Select a beyond-use date or choose Not set.',
        })
      );
      return;
    }
    if (
      budEdited &&
      form.budMode === 'interval' &&
      (intervalDays === null ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 0 ||
        !form.budBaseDate ||
        !form.budSource.trim())
    ) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.preparation.invalidBud', {
          defaultValue:
            'Enter a base date, a whole number of days (zero or more) and the source of that duration.',
        })
      );
      return;
    }
    const preparationInput = recordingPreparation ? creationInput : null;
    const body = {
      kind: form.kind,
      ...('status' in edits && form.status !== existing?.status
        ? { status: form.status, lifecycle_intent: true }
        : {}),
      label: form.label.trim() || null,
      dose_mg: doseMg,
      concentration_mg_ml: concentration,
      volume_ml: volume,
      doses_total: dosesTotal,
      opened_at: form.openedAt || null,
      expiry_date: form.expiryDate || null,
      ...(preparationInput ? { preparation: preparationInput } : {}),
      ...('lotNumber' in edits
        ? { lot_number: form.lotNumber.trim() || null }
        : {}),
      ...('storageLocation' in edits
        ? { storage_location: form.storageLocation.trim() || null }
        : {}),
      ...(budEdited
        ? {
            bud_mode: form.budMode || null,
            bud_date: form.budMode === 'date' ? form.budDate || null : null,
            bud_interval_days:
              form.budMode === 'interval' ? intervalDays : null,
            bud_base_date:
              form.budMode === 'interval' ? form.budBaseDate || null : null,
            bud_source: form.budMode ? form.budSource.trim() || null : null,
          }
        : {}),
      reorder_flag: form.reorderFlag,
      reorder_threshold: threshold,
      notes: form.notes.trim() || null,
    };
    const onError = (error: Error) =>
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.glp1.form.saveFailed', {
          defaultValue: 'Failed to save: {{error}}',
          error: error.message,
        })
      );
    if (penId) {
      updatePen.mutate(
        { id: penId, body },
        { onSuccess: () => navigation.goBack(), onError }
      );
    } else {
      createPen.mutate(
        { medicationId, body },
        { onSuccess: () => navigation.goBack(), onError }
      );
    }
  };

  const handleDelete = useCallback(() => {
    if (!penId) return;
    Alert.alert(
      t('medications.glp1.form.deletePenTitle', {
        defaultValue: 'Delete pen or vial',
      }),
      t('medications.glp1.form.deletePenMessage', {
        defaultValue: 'Delete this pen or vial from your inventory?',
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
            deletePen.mutate(penId, {
              onSuccess: () => navigation.goBack(),
            }),
        },
      ]
    );
  }, [penId, deletePen, navigation, t]);

  const title = isEditing
    ? t('medications.glp1.form.editPen', { defaultValue: 'Edit pen or vial' })
    : t('medications.glp1.form.newPen', { defaultValue: 'New pen or vial' });
  const header = useScreenHeader({
    title,
    nativeTitle: title,
    left: { kind: 'dismiss', onPress: () => navigation.goBack() },
    right: {
      kind: 'primary',
      label: t('common.save', { defaultValue: 'Save' }),
      busy: isSaving,
      disabled:
        (isEditing && !existing) ||
        (recordingPreparation && !creationReady) ||
        correcting,
      busyLabel: t('common.saving', { defaultValue: 'Saving…' }),
      onPress: handleSave,
    },
  });

  const kindOptions = useMemo(
    () => [
      {
        label: t('medications.glp1.inventory.pen', { defaultValue: 'Pen' }),
        value: 'pen' as const,
      },
      {
        label: t('medications.glp1.inventory.vial', { defaultValue: 'Vial' }),
        value: 'vial' as const,
      },
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
        {isEditing && (
          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.stock.status', {
                defaultValue: 'Inventory status',
              })}
            </Text>
            <BottomSheetPicker
              value={form.status}
              onSelect={(v) => setField('status', v)}
              title={t('medications.stock.status', {
                defaultValue: 'Inventory status',
              })}
              options={[
                {
                  value: 'sealed' as const,
                  label: t('medications.glp1.inventory.status.sealed', {
                    defaultValue: 'Sealed',
                  }),
                },
                {
                  value: 'in_use' as const,
                  label: t('medications.glp1.inventory.status.in_use', {
                    defaultValue: 'In use',
                  }),
                },
                {
                  value: 'finished' as const,
                  label: t('medications.glp1.inventory.status.finished', {
                    defaultValue: 'Finished',
                  }),
                },
                {
                  value: 'discarded' as const,
                  label: t('medications.glp1.inventory.status.discarded', {
                    defaultValue: 'Discarded',
                  }),
                },
              ]}
            />
          </View>
        )}

        <View className="gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {t('medications.glp1.form.kind', { defaultValue: 'Type' })}
          </Text>
          {existing?.preparation ? (
            <Text className="text-base text-text-primary">
              {kindOptions.find((option) => option.value === form.kind)?.label}
            </Text>
          ) : (
            <BottomSheetPicker
              value={form.kind}
              options={kindOptions}
              onSelect={(v) => setField('kind', v)}
              title={t('medications.glp1.form.kind', { defaultValue: 'Type' })}
            />
          )}
        </View>

        <View className="gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {t('medications.glp1.form.label', { defaultValue: 'Label' })}
          </Text>
          <FormInput
            accessibilityLabel={t('medications.glp1.form.label', {
              defaultValue: 'Label',
            })}
            value={form.label}
            onChangeText={(v) => setField('label', v)}
          />
        </View>

        <View className="flex-row gap-4">
          <View className="flex-1 gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.glp1.form.doseMg', {
                defaultValue: 'Dose per shot (mg)',
              })}
            </Text>
            <FormInput
              value={form.doseMg}
              onChangeText={(v) => setField('doseMg', v)}
              keyboardType="decimal-pad"
            />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.glp1.form.dosesTotal', {
                defaultValue: 'Doses in total',
              })}
            </Text>
            <FormInput
              value={form.dosesTotal}
              onChangeText={(v) => setField('dosesTotal', v)}
              keyboardType="number-pad"
            />
          </View>
        </View>

        {form.kind === 'vial' && (
          <View className="gap-3">
            {isEditing && !existing?.preparation && (
              <PreparationSummary preparation={null} />
            )}
            {existing?.preparation && (
              <>
                <PreparationSummary preparation={existing.preparation} />
                {!correcting ? (
                  <Button
                    variant="secondary"
                    onPress={() => setCorrecting(true)}
                  >
                    {t('medications.preparation.edit', {
                      defaultValue: 'Edit preparation',
                    })}
                  </Button>
                ) : (
                  <PreparationCorrection
                    pen={existing}
                    onClose={() => setCorrecting(false)}
                  />
                )}
              </>
            )}
            {canRecordPreparation && (
              <View className="flex-row justify-between items-center">
                <Text className="text-base text-text-primary">
                  {t('medications.preparation.record', {
                    defaultValue: 'Save preparation details',
                  })}
                </Text>
                <Switch
                  accessibilityLabel={t('medications.preparation.record', {
                    defaultValue: 'Save preparation details',
                  })}
                  value={recordPreparation}
                  onValueChange={setRecordPreparation}
                />
              </View>
            )}
            {recordingPreparation && (
              <PreparationCreationWizard
                target={preparationTarget}
                administrationRoute={preparationRoute}
                initialDate={isEditing ? '' : getTodayDate()}
                initialVolume={form.volume}
                onChange={onPreparationChange}
              />
            )}
          </View>
        )}
        {form.kind === 'vial' && !recordingPreparation && (
          <View className="flex-row gap-4">
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">
                {t('medications.glp1.form.concentration', {
                  defaultValue: 'mg per mL',
                })}
              </Text>
              <FormInput
                value={form.concentration}
                editable={!existing?.preparation}
                onChangeText={(v) => setField('concentration', v)}
                keyboardType="decimal-pad"
              />
            </View>
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">
                {t('medications.preparation.finalVolume', {
                  defaultValue: 'Final volume (mL)',
                })}
              </Text>
              <FormInput
                accessibilityLabel={t('medications.preparation.finalVolume', {
                  defaultValue: 'Final volume (mL)',
                })}
                value={form.volume}
                editable={!existing?.preparation}
                onChangeText={(v) => setField('volume', v)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        )}

        <OptionalDateField
          label={t('medications.glp1.form.openedAt', {
            defaultValue: 'Opened',
          })}
          value={form.openedAt}
          onChange={(v) => setField('openedAt', v)}
        />
        <OptionalDateField
          label={t('medications.glp1.form.expiry', { defaultValue: 'Expires' })}
          value={form.expiryDate}
          onChange={(v) => setField('expiryDate', v)}
        />

        {form.kind === 'vial' && (
          <>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.lot', {
                defaultValue: 'Lot / batch number (optional)',
              })}
            </Text>
            <FormInput
              accessibilityLabel={t('medications.preparation.lot', {
                defaultValue: 'Lot / batch number (optional)',
              })}
              value={form.lotNumber}
              onChangeText={(v) => setField('lotNumber', v)}
            />
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.storage', {
                defaultValue: 'Storage location (optional)',
              })}
            </Text>
            <FormInput
              accessibilityLabel={t('medications.preparation.storage', {
                defaultValue: 'Storage location (optional)',
              })}
              value={form.storageLocation}
              onChangeText={(v) => setField('storageLocation', v)}
            />
          </>
        )}
        <Text className="text-sm text-text-secondary">
          {t('medications.preparation.bud', {
            defaultValue: 'Beyond-use date',
          })}
        </Text>
        <BottomSheetPicker
          value={form.budMode}
          onSelect={(v) => setField('budMode', v)}
          title={t('medications.preparation.bud', {
            defaultValue: 'Beyond-use date',
          })}
          options={[
            {
              value: '' as const,
              label: t('medications.glp1.form.notSet', {
                defaultValue: 'Not set',
              }),
            },
            {
              value: 'date' as const,
              label: t('medications.preparation.budExplicit', {
                defaultValue: 'Explicit date',
              }),
            },
            {
              value: 'interval' as const,
              label: t('medications.preparation.budInterval', {
                defaultValue: 'Duration from a date',
              }),
            },
          ]}
        />
        {form.budMode === 'date' && (
          <OptionalDateField
            label={t('medications.preparation.bud', {
              defaultValue: 'Beyond-use date',
            })}
            value={form.budDate}
            onChange={(v) => setField('budDate', v)}
          />
        )}
        {form.budMode === 'interval' && (
          <>
            <OptionalDateField
              label={t('medications.preparation.budBase', {
                defaultValue: 'Beyond-use base date',
              })}
              value={form.budBaseDate}
              onChange={(v) => setField('budBaseDate', v)}
            />
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.budDays', {
                defaultValue: 'Beyond-use duration (days)',
              })}
            </Text>
            <FormInput
              accessibilityLabel={t('medications.preparation.budDays', {
                defaultValue: 'Beyond-use duration (days)',
              })}
              value={form.budDays}
              onChangeText={(v) => setField('budDays', v)}
              keyboardType="number-pad"
            />
          </>
        )}
        {form.budMode !== '' && (
          <>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.budSource', {
                defaultValue: 'Beyond-use source / instructions',
              })}
            </Text>
            <FormInput
              accessibilityLabel={t('medications.preparation.budSource', {
                defaultValue: 'Beyond-use source / instructions',
              })}
              value={form.budSource}
              onChangeText={(v) => setField('budSource', v)}
            />
          </>
        )}

        <View className="flex-row justify-between items-center">
          <Text className="text-base text-text-primary">
            {t('medications.glp1.form.reorderFlag', {
              defaultValue: 'Remind me to reorder',
            })}
          </Text>
          <Switch
            value={form.reorderFlag}
            onValueChange={(v) => setField('reorderFlag', v)}
          />
        </View>
        {form.reorderFlag && (
          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">
              {t('medications.glp1.form.reorderThreshold', {
                defaultValue: 'Reorder when doses left reach',
              })}
            </Text>
            <FormInput
              value={form.reorderThreshold}
              onChangeText={(v) => setField('reorderThreshold', v)}
              keyboardType="number-pad"
            />
          </View>
        )}

        <View className="gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {t('medications.form.notes', { defaultValue: 'Notes' })}
          </Text>
          <FormInput
            value={form.notes}
            onChangeText={(v) => setField('notes', v)}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={{ minHeight: 72 }}
          />
        </View>

        {isEditing && (
          <Button variant="destructive" onPress={handleDelete}>
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
};

export default Glp1PenFormScreen;
