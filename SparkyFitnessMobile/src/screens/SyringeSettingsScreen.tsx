import { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  medicationSyringeInputSchema,
  normalizeMedicationDevice,
  type MedicationSyringe,
  type MedicationSyringeInput,
} from '@workspace/shared';
import BottomSheetPicker from '../components/BottomSheetPicker';
import FormInput from '../components/FormInput';
import Button from '../components/ui/Button';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useSyringeMutations, useSyringes } from '../hooks/useSyringes';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { RootStackScreenProps } from '../types/navigation';

interface Draft {
  id?: string;
  name: string;
  graduation_type: 'units' | 'ml';
  device_type: 'syringe' | 'pen' | 'pump';
  is_shared?: boolean;
  units_per_ml: string;
  capacity_ml: string;
  capacity_units: string;
  increment: string;
}
const emptyDraft: Draft = {
  name: '',
  graduation_type: 'units',
  device_type: 'syringe',
  units_per_ml: '100',
  capacity_ml: '1',
  capacity_units: '100',
  increment: '1',
};
const fromSyringe = (row: MedicationSyringe): Draft => ({
  ...row,
  device_type: row.device_type ?? 'syringe',
  units_per_ml: String(row.units_per_ml),
  capacity_units: String(row.capacity_units),
});

export default function SyringeSettingsScreen({
  navigation,
}: RootStackScreenProps<'SyringeSettings'>) {
  const { t } = useTranslation();
  const query = useSyringes();
  const mutations = useSyringeMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const insets = useSafeAreaInsets();
  const native = useNativeIOSHeadersActive();
  const barPadding = useActiveWorkoutBarPadding('stack');
  const busy =
    mutations.save.isPending ||
    mutations.remove.isPending ||
    mutations.setDefault.isPending;
  const fail = () =>
    Alert.alert(
      t('common.error', { defaultValue: 'Error' }),
      t('medications.syringes.saveFailed', {
        defaultValue: 'Unable to save this change.',
      })
    );
  const save = () => {
    if (!draft || draft.is_shared || busy) return;
    const unitsPerMl = Number(draft.units_per_ml);
    const capacityUnits = Number(draft.capacity_units);
    const parsed = medicationSyringeInputSchema.safeParse({
      name: draft.name,
      device_type: draft.device_type,
      graduation_type:
        draft.device_type === 'pump' ? 'ml' : draft.graduation_type,
      units_per_ml: draft.device_type === 'pump' ? 1 : unitsPerMl,
      capacity_ml: draft.capacity_ml.trim(),
      capacity_units: draft.device_type === 'pump' ? 0 : capacityUnits,
      increment: draft.increment.trim(),
    });
    if (!parsed.success) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.syringes.invalid', {
          defaultValue:
            'Enter a name and positive capacities, scale and increment. Units per mL and capacity units must be whole numbers.',
        })
      );
      return;
    }
    const body: MedicationSyringeInput = normalizeMedicationDevice(parsed.data);
    mutations.save.mutate(
      { id: draft.id, body },
      { onSuccess: () => setDraft(null), onError: fail }
    );
  };
  const header = useScreenHeader({
    title: t('medications.devices.title', { defaultValue: 'Devices' }),
    left: { kind: 'dismiss', onPress: () => navigation.goBack() },
    ...(draft && !draft.is_shared
      ? {
          right: {
            kind: 'primary' as const,
            onPress: save,
            busy,
            disabled: busy,
          },
        }
      : {}),
  });
  const textField = (
    key: Exclude<
      keyof Draft,
      'id' | 'graduation_type' | 'device_type' | 'is_shared'
    >,
    label: string,
    decimal = true
  ) => (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-text-secondary">{label}</Text>
      <FormInput
        accessibilityLabel={label}
        value={draft?.[key] ?? ''}
        editable={!draft?.is_shared}
        keyboardType={
          key === 'name' ? 'default' : decimal ? 'decimal-pad' : 'number-pad'
        }
        onChangeText={(value) =>
          setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
        }
      />
    </View>
  );
  return (
    <View
      className="flex-1 bg-background"
      style={native ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          padding: 16,
          rowGap: 16,
          paddingBottom: insets.bottom + 80 + barPadding,
        }}
        contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        {query.isLoading && (
          <Text className="text-text-muted">
            {t('common.loading', { defaultValue: 'Loading...' })}
          </Text>
        )}
        {query.isError && (
          <Text className="text-text-warning">
            {t('medications.syringes.loadFailed', {
              defaultValue: 'Unable to load syringe settings.',
            })}
          </Text>
        )}
        {!draft ? (
          <>
            <Text className="text-sm font-medium text-text-secondary">
              {t('medications.syringes.default', {
                defaultValue: 'Default syringe',
              })}
            </Text>
            <BottomSheetPicker
              value={query.data?.default_syringe_id ?? ''}
              onSelect={(id) => {
                if (!busy)
                  mutations.setDefault.mutate(id || null, { onError: fail });
              }}
              title={t('medications.syringes.default', {
                defaultValue: 'Default syringe',
              })}
              options={[
                {
                  value: '',
                  label: t('medications.syringes.none', {
                    defaultValue: 'None',
                  }),
                },
                ...(query.data?.syringes ?? []).map((row) => ({
                  value: row.id,
                  label: row.name,
                })),
              ]}
            />
            {(query.data?.syringes ?? []).map((row) => (
              <TouchableOpacity
                key={row.id}
                accessibilityRole="button"
                onPress={() => setDraft(fromSyringe(row))}
                className="bg-surface rounded-xl p-4"
              >
                <Text className="text-base text-text-primary">{row.name}</Text>
                {row.is_shared && (
                  <Text className="text-sm text-text-muted">
                    {t('medications.devices.shared', {
                      defaultValue: 'Shared device · read-only',
                    })}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
            <Button onPress={() => setDraft({ ...emptyDraft })}>
              {t('medications.devices.add', { defaultValue: 'Add device' })}
            </Button>
          </>
        ) : (
          <>
            {textField(
              'name',
              t('medications.syringes.name', { defaultValue: 'Name' })
            )}
            {draft.is_shared ? (
              <Text className="text-sm text-text-muted">
                {t('medications.devices.shared', {
                  defaultValue: 'Shared device · read-only',
                })}
              </Text>
            ) : (
              <BottomSheetPicker
                value={draft.device_type}
                title={t('medications.devices.type', {
                  defaultValue: 'Device type',
                })}
                onSelect={(device_type) =>
                  setDraft({
                    ...draft,
                    device_type,
                    graduation_type:
                      device_type === 'pump' ? 'ml' : draft.graduation_type,
                  })
                }
                options={[
                  {
                    value: 'syringe' as const,
                    label: t('medications.devices.syringe', {
                      defaultValue: 'Syringe',
                    }),
                  },
                  {
                    value: 'pen' as const,
                    label: t('medications.devices.pen', {
                      defaultValue: 'Pen',
                    }),
                  },
                  {
                    value: 'pump' as const,
                    label: t('medications.devices.pump', {
                      defaultValue: 'Nasal pump',
                    }),
                  },
                ]}
              />
            )}
            {draft.device_type !== 'pump' && (
              <>
                <BottomSheetPicker
                  value={draft.graduation_type}
                  onSelect={(value) => {
                    if (!draft.is_shared)
                      setDraft({ ...draft, graduation_type: value });
                  }}
                  title={t('medications.syringes.graduation', {
                    defaultValue: 'Graduation type',
                  })}
                  options={[
                    {
                      value: 'units' as const,
                      label: t('medications.syringes.units', {
                        defaultValue: 'Units',
                      }),
                    },
                    {
                      value: 'ml' as const,
                      label: t('medications.syringes.ml', {
                        defaultValue: 'mL',
                      }),
                    },
                  ]}
                />
                {textField(
                  'units_per_ml',
                  t('medications.syringes.unitsPerMl', {
                    defaultValue: 'Units per mL',
                  }),
                  false
                )}
              </>
            )}
            {textField(
              'capacity_ml',
              t('medications.syringes.capacityMl', {
                defaultValue: 'Capacity (mL)',
              })
            )}
            {draft.device_type !== 'pump' && (
              <>
                {' '}
                {textField(
                  'capacity_units',
                  t('medications.syringes.capacityUnits', {
                    defaultValue: 'Capacity (units)',
                  }),
                  false
                )}
              </>
            )}
            {textField(
              'increment',
              draft.device_type === 'pump'
                ? t('medications.devices.sprayIncrement', {
                    defaultValue: 'mL per spray',
                  })
                : t('medications.syringes.increment', {
                    defaultValue: 'Marking increment',
                  })
            )}
            <Button
              variant="secondary"
              onPress={() => setDraft(null)}
              disabled={busy}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            {draft.id && !draft.is_shared && (
              <Button
                variant="destructive"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    t('medications.syringes.deleteTitle', {
                      defaultValue: 'Delete syringe?',
                    }),
                    t('medications.syringes.deleteMessage', {
                      defaultValue:
                        'This removes the reusable syringe setting. Saved injection calculations are preserved.',
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
                          mutations.remove.mutate(draft.id!, {
                            onSuccess: () => setDraft(null),
                            onError: fail,
                          }),
                      },
                    ]
                  )
                }
              >
                {t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
