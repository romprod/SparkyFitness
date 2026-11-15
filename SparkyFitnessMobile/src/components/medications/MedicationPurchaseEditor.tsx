import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  medicationPurchaseInputSchema,
  formatPurchaseMoney,
  PURCHASE_CONSUMABLE_CATEGORIES,
  type MedicationPurchaseCreateInput,
  type MedicationPurchaseEditorData,
  type MedicationPurchaseView,
} from '@workspace/shared';
import { useMedicationPurchaseMutations } from '../../hooks/useMedicationPurchases';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../../services/nativeTabBarPreference';
import { ApiError, getApiErrorMessage } from '../../services/api/errors';
import { useActiveWorkoutBarPadding } from '../ActiveWorkoutBar';
import {
  blankPurchaseLine,
  purchaseDraft,
  purchaseInput,
  purchasePreview,
  type PurchaseDraft,
  type PurchaseLineDraft,
} from '../../utils/medicationPurchases';
import { newUuid } from '../../utils/ids';
import BottomSheetPicker from '../BottomSheetPicker';
import FormInput from '../FormInput';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import OptionalDateField from '../glp1/OptionalDateField';

export default function MedicationPurchaseEditor({
  ownerId,
  initial,
  data,
  isScopeCurrent,
  onClose,
  onReload,
}: {
  ownerId: string;
  initial?: MedicationPurchaseView;
  data: MedicationPurchaseEditorData;
  isScopeCurrent: () => boolean;
  onClose: () => void;
  onReload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const native = useNativeIOSHeadersActive();
  const padding = useActiveWorkoutBarPadding('stack');
  const [draft, setDraft] = useState(() =>
    purchaseDraft(initial, data.medications[0]?.id)
  );
  const [revision] = useState(initial?.revision);
  const [draftOwner] = useState(ownerId);
  const [invoiceItemIds] = useState(
    () => new Set(initial?.items.map((item) => item.id) ?? [])
  );
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  const pinned = useRef<MedicationPurchaseCreateInput | null>(null);
  const inFlight = useRef(false);
  const mutations = useMedicationPurchaseMutations(draftOwner, isScopeCurrent);
  const busy = mutations.create.isPending || mutations.update.isPending;
  const locked = busy || uncertain || conflict || !isScopeCurrent();
  const preview = purchasePreview(draft);
  const money = (value: string) =>
    formatPurchaseMoney(value, draft.currency || 'AUD', i18n.language);
  const setHeader = <K extends Exclude<keyof PurchaseDraft, 'items'>>(
    key: K,
    value: PurchaseDraft[K]
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const setLine = (key: string, patch: Partial<PurchaseLineDraft>) =>
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((line) =>
        line.key === key ? { ...line, ...patch } : line
      ),
    }));
  const fail = (failure: Error) => {
    if (!isScopeCurrent()) return;
    if (!initial && uncertainRef.current) {
      setUncertain(true);
    } else if (failure instanceof ApiError && failure.statusCode === 409) {
      conflictRef.current = true;
      setConflict(true);
      setUncertain(false);
      pinned.current = null;
    } else if (
      failure instanceof ApiError &&
      [400, 401, 403, 404, 422].includes(failure.statusCode)
    ) {
      pinned.current = null;
      setUncertain(false);
    } else if (!initial) {
      uncertainRef.current = true;
      setUncertain(true);
    }
    setError(
      getApiErrorMessage(failure) ??
        t('medications.costs.saveFailed', {
          defaultValue:
            'Unable to save the invoice. Retry the same save to check its outcome.',
        })
    );
  };
  const save = () => {
    if (
      inFlight.current ||
      busy ||
      conflictRef.current ||
      conflict ||
      !isScopeCurrent() ||
      ownerId !== draftOwner
    )
      return;
    const parsed = medicationPurchaseInputSchema.safeParse(
      purchaseInput(draft)
    );
    if (!pinned.current) {
      if (
        draft.items.some(
          (line) => line.kind === 'consumable' && !line.description.trim()
        )
      ) {
        setError(
          t('medications.costs.consumableDescription', {
            defaultValue:
              'Enter a description for each consumable line, or remove the unused line.',
          })
        );
        return;
      }
      if (
        !parsed.success ||
        draft.items.some(
          (line) =>
            line.kind === 'medication' && !line.medication_id && !line.id
        )
      ) {
        setError(
          t('medications.costs.invalid', {
            defaultValue:
              'Check the dates, positive whole quantities, nonnegative prices and medication on each new medication line.',
          })
        );
        return;
      }
      const links = draft.items.flatMap((line) => line.vial_ids);
      if (new Set(links).size !== links.length) {
        setError(
          t('medications.costs.duplicateVial', {
            defaultValue: 'A vial can be matched only once on an invoice.',
          })
        );
        return;
      }
      const unavailable = draft.items.some((line) =>
        line.vial_ids.some(
          (id) =>
            !data.vials.some(
              (vial) =>
                vial.id === id &&
                vial.medication_id === line.medication_id &&
                (vial.purchase_item_id === null ||
                  invoiceItemIds.has(vial.purchase_item_id))
            )
        )
      );
      if (unavailable) {
        setError(
          t('medications.costs.unavailableVial', {
            defaultValue:
              'A matched vial is no longer available for this line. Remove it or reload the invoice.',
          })
        );
        return;
      }
      if (!initial)
        pinned.current = {
          ...parsed.data,
          expected_owner_id: draftOwner,
          operation_id: newUuid(),
        };
    }
    setError(null);
    inFlight.current = true;
    const callbacks = {
      onSuccess: () => {
        if (isScopeCurrent()) onClose();
      },
      onError: fail,
      onSettled: () => {
        inFlight.current = false;
      },
    };
    if (initial && parsed.success && revision)
      mutations.update.mutate(
        {
          id: initial.id,
          body: {
            ...parsed.data,
            expected_owner_id: draftOwner,
            expected_revision: revision,
          },
        },
        callbacks
      );
    else if (pinned.current) mutations.create.mutate(pinned.current, callbacks);
    else inFlight.current = false;
  };
  const title = initial
    ? t('medications.costs.editInvoice', { defaultValue: 'Edit invoice' })
    : t('medications.costs.addInvoice', { defaultValue: 'Add invoice' });
  const header = useScreenHeader({
    title,
    left: { kind: 'dismiss', onPress: onClose },
    right: {
      kind: 'primary',
      onPress: save,
      busy,
      disabled: busy || conflict || !isScopeCurrent(),
      label: uncertain
        ? t('medications.costs.retry', { defaultValue: 'Retry save' })
        : t('common.save', { defaultValue: 'Save' }),
    },
  });
  const textField = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    decimal = false
  ) => (
    <View className="gap-1.5">
      <Text className="text-sm text-text-secondary">{label}</Text>
      <FormInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(text) => {
          if (!locked) onChange(text);
        }}
        editable={!locked}
        keyboardType={decimal ? 'decimal-pad' : 'default'}
      />
    </View>
  );
  const methods = [
    {
      value: 'value' as const,
      label: t('medications.costs.byValue', {
        defaultValue: 'Pro-rata by line value',
      }),
    },
    {
      value: 'quantity' as const,
      label: t('medications.costs.byQuantity', {
        defaultValue: 'Equal per unit',
      }),
    },
    {
      value: 'none' as const,
      label: t('medications.costs.noAllocation', {
        defaultValue: "Don't allocate (keep separate)",
      }),
    },
  ];
  const categoryLabels = {
    needle: t('medications.costs.needle', { defaultValue: 'Needles' }),
    syringe: t('medications.costs.syringe', { defaultValue: 'Syringes' }),
    swab: t('medications.costs.swab', { defaultValue: 'Swabs' }),
    sharps_container: t('medications.costs.sharps', {
      defaultValue: 'Sharps container',
    }),
    pen_tip: t('medications.costs.penTips', { defaultValue: 'Pen tips' }),
    bac_water: t('medications.costs.water', {
      defaultValue: 'Bacteriostatic water',
    }),
    other: t('medications.costs.other', { defaultValue: 'Other' }),
  };
  return (
    <View
      className="flex-1 bg-background"
      style={native ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: insets.bottom + 80 + padding,
        }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
      >
        {error && (
          <View className="rounded-xl border border-border-subtle bg-surface p-3">
            <Text
              accessibilityRole="alert"
              className="text-sm text-text-primary"
            >
              {error}
            </Text>
          </View>
        )}
        {uncertain && (
          <Text className="text-sm text-text-primary">
            {t('medications.costs.uncertain', {
              defaultValue:
                'The save may have completed. Retry sends the same invoice operation; its fields are locked until the outcome is known.',
            })}
          </Text>
        )}
        {conflict && (
          <Button variant="secondary" onPress={onReload}>
            {t('medications.costs.reload', { defaultValue: 'Reload invoice' })}
          </Button>
        )}
        <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="text-base font-semibold text-text-primary">
            {t('medications.costs.invoice', { defaultValue: 'Invoice' })}
          </Text>
          {textField(
            t('medications.costs.supplier', { defaultValue: 'Supplier' }),
            draft.vendor,
            (value) => setHeader('vendor', value)
          )}
          {textField(
            t('medications.costs.reference', {
              defaultValue: 'Invoice / order no.',
            }),
            draft.reference,
            (value) => setHeader('reference', value)
          )}
          <OptionalDateField
            label={t('medications.costs.ordered', { defaultValue: 'Ordered' })}
            value={draft.ordered_date}
            onChange={(value) => {
              if (!locked) setHeader('ordered_date', value);
            }}
          />
          <OptionalDateField
            label={t('medications.costs.received', {
              defaultValue: 'Received',
            })}
            value={draft.received_date}
            onChange={(value) => {
              if (!locked) setHeader('received_date', value);
            }}
          />
        </View>
        <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="text-base font-semibold text-text-primary">
            {t('medications.costs.charges', {
              defaultValue: 'Shipping & fees',
            })}
          </Text>
          <Text className="text-sm text-text-secondary">
            {t('medications.costs.chargesHint', {
              defaultValue:
                'Enter charges once on the invoice. The selected method shares them across its lines.',
            })}
          </Text>
          {textField(
            t('medications.costs.shipping', { defaultValue: 'Shipping' }),
            draft.shipping_cost,
            (value) => setHeader('shipping_cost', value),
            true
          )}
          {textField(
            t('medications.costs.tax', { defaultValue: 'Tax / GST' }),
            draft.tax_cost,
            (value) => setHeader('tax_cost', value),
            true
          )}
          {textField(
            t('medications.costs.fees', { defaultValue: 'Other fees' }),
            draft.other_fees,
            (value) => setHeader('other_fees', value),
            true
          )}
          {textField(
            t('medications.costs.discount', { defaultValue: 'Discount' }),
            draft.discount,
            (value) => setHeader('discount', value),
            true
          )}
          {textField(
            t('medications.costs.currency', { defaultValue: 'Currency' }),
            draft.currency,
            (value) => setHeader('currency', value)
          )}
          <BottomSheetPicker
            value={draft.allocation_method}
            title={t('medications.costs.allocation', {
              defaultValue: 'Share shipping & fees',
            })}
            options={methods}
            onSelect={(value) => {
              if (!locked) setHeader('allocation_method', value);
            }}
          />
          {preview?.effective_method === 'quantity-fallback' && (
            <Text className="text-sm text-text-primary">
              {t('medications.costs.quantityFallback', {
                defaultValue:
                  'Every line is zero-priced, so charges are split equally per unit.',
              })}
            </Text>
          )}
          {preview && preview.unallocated !== '0.00' && (
            <Text className="text-sm text-text-secondary">
              {t('medications.costs.unallocated', {
                defaultValue: 'Unallocated charges: {{value}}',
                value: money(preview.unallocated),
              })}
            </Text>
          )}
        </View>
        {draft.items.map((line, index) => {
          const allocated = preview?.lines.find((item) => item.id === line.key);
          const elsewhere = new Set(
            draft.items
              .filter((item) => item.key !== line.key)
              .flatMap((item) => item.vial_ids)
          );
          const candidates = data.vials.filter(
            (vial) =>
              vial.medication_id === line.medication_id &&
              !elsewhere.has(vial.id) &&
              (vial.purchase_item_id === null ||
                invoiceItemIds.has(vial.purchase_item_id))
          );
          const missing = line.vial_ids.filter(
            (id) => !candidates.some((vial) => vial.id === id)
          );
          return (
            <View key={line.key} className="gap-3 rounded-xl bg-surface p-4">
              <Text className="text-base font-semibold text-text-primary">
                {t('medications.costs.line', {
                  defaultValue: '{{kind}} · line {{number}}',
                  kind:
                    line.kind === 'medication'
                      ? t('medications.costs.medication', {
                          defaultValue: 'Medication',
                        })
                      : t('medications.costs.consumable', {
                          defaultValue: 'Consumable',
                        }),
                  number: index + 1,
                })}
              </Text>
              {draft.items.length > 1 && (
                <Button
                  variant="destructive"
                  disabled={locked}
                  onPress={() =>
                    setDraft((previous) => ({
                      ...previous,
                      items: previous.items.filter(
                        (item) => item.key !== line.key
                      ),
                    }))
                  }
                >
                  {t('medications.costs.removeLine', {
                    defaultValue: 'Remove line {{number}}',
                    number: index + 1,
                  })}
                </Button>
              )}
              {line.kind === 'medication' ? (
                <>
                  {line.id && !line.medication_id && (
                    <Text className="text-sm text-text-secondary">
                      {t('medications.costs.orphan', {
                        defaultValue:
                          'Medication removed. This invoice line and its price are retained.',
                      })}
                    </Text>
                  )}
                  <BottomSheetPicker
                    value={line.medication_id ?? ''}
                    title={t('medications.costs.medication', {
                      defaultValue: 'Medication',
                    })}
                    options={[
                      {
                        value: '',
                        label: t('medications.costs.chooseMedication', {
                          defaultValue: 'Choose medication',
                        }),
                      },
                      ...data.medications.map((med) => ({
                        value: med.id,
                        label: med.name,
                      })),
                    ]}
                    onSelect={(value) => {
                      if (!locked)
                        setLine(line.key, {
                          medication_id: value || null,
                          vial_ids: [],
                        });
                    }}
                  />
                </>
              ) : (
                <BottomSheetPicker
                  value={line.category}
                  title={t('medications.costs.category', {
                    defaultValue: 'Category',
                  })}
                  options={PURCHASE_CONSUMABLE_CATEGORIES.map((value) => ({
                    value,
                    label: categoryLabels[value],
                  }))}
                  onSelect={(value) => {
                    if (!locked) setLine(line.key, { category: value });
                  }}
                />
              )}
              {textField(
                t('medications.costs.description', {
                  defaultValue: 'Description',
                }),
                line.description,
                (value) => setLine(line.key, { description: value })
              )}
              {textField(
                line.kind === 'medication'
                  ? t('medications.costs.vials', { defaultValue: 'Vials' })
                  : t('medications.costs.packs', { defaultValue: 'Packs' }),
                line.quantity,
                (value) => setLine(line.key, { quantity: value }),
                true
              )}
              {textField(
                t('medications.costs.unitCost', { defaultValue: 'Unit cost' }),
                line.unit_cost,
                (value) => setLine(line.key, { unit_cost: value }),
                true
              )}
              {line.kind === 'consumable' && (
                <>
                  {textField(
                    t('medications.costs.perPack', {
                      defaultValue: 'Per pack',
                    }),
                    line.units_per_pack,
                    (value) => setLine(line.key, { units_per_pack: value }),
                    true
                  )}
                  {textField(
                    t('medications.costs.perDose', {
                      defaultValue: 'Used per dose',
                    }),
                    line.units_per_dose,
                    (value) => setLine(line.key, { units_per_dose: value }),
                    true
                  )}
                </>
              )}
              {allocated && (
                <View className="gap-1 rounded-xl border border-border-subtle p-3">
                  <Text className="text-sm text-text-primary">
                    {t('medications.costs.lineSubtotal', {
                      defaultValue: 'Line: {{value}}',
                      value: money(allocated.subtotal),
                    })}
                  </Text>
                  <Text className="text-sm text-text-secondary">
                    {t('medications.costs.lineShare', {
                      defaultValue: 'Shipping & fee share: {{value}}',
                      value: money(allocated.allocated),
                    })}
                  </Text>
                  <Text className="text-sm font-semibold text-text-primary">
                    {t('medications.costs.landedEach', {
                      defaultValue: 'Landed each: {{value}}',
                      value:
                        allocated.landed_unit === null
                          ? '—'
                          : money(allocated.landed_unit),
                    })}
                  </Text>
                </View>
              )}
              {line.kind === 'medication' && (
                <View className="gap-2">
                  <Text className="text-sm font-medium text-text-primary">
                    {t('medications.costs.match', {
                      defaultValue:
                        'Match existing vials ({{selected}} of {{quantity}})',
                      selected: line.vial_ids.length,
                      quantity: line.quantity,
                    })}
                  </Text>
                  {candidates.length === 0 && (
                    <Text className="text-sm text-text-secondary">
                      {t('medications.costs.noVials', {
                        defaultValue:
                          'No available matching vials. Add stock in inventory, then link it here.',
                      })}
                    </Text>
                  )}
                  {[
                    ...candidates.map((vial) => ({
                      id: vial.id,
                      label: [
                        vial.label || vial.medication_name,
                        vial.label_mass_mg != null
                          ? t('medications.stock.labelMassSummary', {
                              defaultValue: 'Vial label amount: {{value}} mg',
                              value: vial.label_mass_mg,
                            })
                          : vial.prepared_mass_mg != null
                            ? t('medications.costs.preparedContent', {
                                defaultValue: 'Prepared content: {{value}} mg',
                                value: vial.prepared_mass_mg,
                              })
                            : null,
                        vial.status,
                        vial.lot_number,
                        vial.expiry_date,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    })),
                    ...missing.map((id) => ({
                      id,
                      label: t('medications.costs.missingVial', {
                        defaultValue:
                          'Unavailable matched vial · remove to continue',
                      }),
                    })),
                  ].map((vial) => (
                    <View
                      key={vial.id}
                      className="flex-row items-center gap-3 rounded-xl border border-border-subtle p-3"
                    >
                      <Text className="flex-1 text-sm text-text-primary">
                        {vial.label}
                      </Text>
                      <Switch
                        accessibilityLabel={vial.label}
                        value={line.vial_ids.includes(vial.id)}
                        disabled={locked}
                        onValueChange={(selected) => {
                          if (!locked)
                            setLine(line.key, {
                              vial_ids: selected
                                ? [...line.vial_ids, vial.id]
                                : line.vial_ids.filter((id) => id !== vial.id),
                            });
                        }}
                      />
                    </View>
                  ))}
                  {line.vial_ids.length > Number(line.quantity) && (
                    <Text className="text-sm text-text-primary">
                      {t('medications.costs.overmatch', {
                        defaultValue:
                          'More vials are matched than this line bought. Raise the quantity or untick a vial; this warning does not block saving.',
                      })}
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}
        <View className="gap-2">
          <Button
            variant="secondary"
            disabled={locked}
            onPress={() =>
              setDraft((previous) => ({
                ...previous,
                items: [
                  ...previous.items,
                  blankPurchaseLine('medication', data.medications[0]?.id),
                ],
              }))
            }
          >
            {t('medications.costs.addMedication', {
              defaultValue: 'Add medication line',
            })}
          </Button>
          <Button
            variant="secondary"
            disabled={locked}
            onPress={() =>
              setDraft((previous) => ({
                ...previous,
                items: [...previous.items, blankPurchaseLine('consumable')],
              }))
            }
          >
            {t('medications.costs.addConsumable', {
              defaultValue: 'Add consumable line',
            })}
          </Button>
        </View>
        {preview && (
          <View className="gap-2 rounded-xl bg-surface p-4">
            <Text className="text-sm text-text-secondary">
              {t('medications.costs.subtotal', {
                defaultValue: 'Lines: {{value}}',
                value: money(preview.subtotal),
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('medications.costs.chargesTotal', {
                defaultValue: 'Shipping & fees: {{value}}',
                value: money(preview.overhead),
              })}
            </Text>
            <Text className="text-base font-semibold text-text-primary">
              {t('medications.costs.total', {
                defaultValue: 'Invoice total: {{value}}',
                value: money(preview.total),
              })}
            </Text>
          </View>
        )}
        {textField(
          t('medications.costs.notes', { defaultValue: 'Notes' }),
          draft.notes,
          (value) => setHeader('notes', value)
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
