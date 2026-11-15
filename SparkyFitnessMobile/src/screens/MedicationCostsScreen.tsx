import { useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  type MedicationPurchaseView,
} from '@workspace/shared';
import {
  useMedicationCostsAccess,
  useMedicationPurchases,
  useMedicationPurchaseMutations,
} from '../hooks/useMedicationPurchases';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import Button from '../components/ui/Button';
import { ApiError } from '../services/api/errors';
import { formatDateLabel } from '../utils/dateUtils';
import type { RootStackScreenProps } from '../types/navigation';
export default function MedicationCostsScreen({
  navigation,
}: RootStackScreenProps<'MedicationCosts'>) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const native = useNativeIOSHeadersActive();
  const padding = useActiveWorkoutBarPadding('stack');
  const access = useMedicationCostsAccess();
  const query = useMedicationPurchases(access.ownerId);
  const mutations = useMedicationPurchaseMutations(
    access.ownerId ?? '',
    access.isCurrent
  );
  const [error, setError] = useState<{ scope: string; text: string } | null>(
    null
  );
  const inFlight = useRef(false);
  const open = (id?: string) =>
    navigation.navigate('MedicationPurchaseForm', id ? { purchaseId: id } : {});
  const header = useScreenHeader({
    title: t('medications.costs.title', { defaultValue: 'Costs' }),
    left: { kind: 'back' },
    ...(access.ownerId
      ? {
          right: {
            kind: 'icon' as const,
            sfSymbol: 'plus' as const,
            ionicon: 'add-outline' as const,
            onPress: () => open(),
            accessibilityLabel: t('medications.costs.addInvoice', {
              defaultValue: 'Add invoice',
            }),
          },
        }
      : {}),
  });
  const remove = (purchase: MedicationPurchaseView) => {
    const owner = access.ownerId;
    if (!owner || !access.isCurrent() || inFlight.current) return;
    Alert.alert(
      t('medications.costs.deleteTitle', { defaultValue: 'Delete invoice?' }),
      t('medications.costs.deleteMessage', {
        defaultValue:
          'The invoice is removed. Its vials and dose history are kept; the vials become uncosted.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () => {
            if (inFlight.current || !access.isCurrent()) return;
            inFlight.current = true;
            mutations.remove.mutate(
              {
                id: purchase.id,
                body: {
                  expected_owner_id: owner,
                  expected_revision: purchase.revision,
                },
              },
              {
                onError: (failure) => {
                  if (access.isCurrent())
                    setError({
                      scope: access.scopeKey,
                      text:
                        failure instanceof ApiError &&
                        failure.statusCode === 409
                          ? t('medications.costs.deleteStale', {
                              defaultValue:
                                'This invoice changed. The list has been refreshed; check it before deleting again.',
                            })
                          : t('medications.costs.deleteFailed', {
                              defaultValue:
                                'Unable to delete the invoice. Refresh the list before trying again.',
                            }),
                    });
                },
                onSettled: () => {
                  inFlight.current = false;
                },
              }
            );
          },
        },
      ]
    );
  };
  return (
    <View
      className="flex-1 bg-background"
      style={native ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: insets.bottom + 80 + padding,
        }}
        contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
      >
        {error?.scope === access.scopeKey && (
          <Text
            accessibilityRole="alert"
            className="rounded-xl bg-surface p-3 text-sm text-text-primary"
          >
            {error.text}
          </Text>
        )}
        {!access.ownerId ? (
          <>
            <Text className="text-sm text-text-primary">
              {access.isLoading
                ? t('medications.costs.loadingAccess', {
                    defaultValue: 'Checking account access…',
                  })
                : access.isError
                  ? t('medications.costs.accessFailed', {
                      defaultValue: 'Unable to check account access.',
                    })
                  : t('medications.costs.ownerOnly', {
                      defaultValue:
                        'Costs are available only for your own account.',
                    })}
            </Text>
            {access.isError && (
              <Button variant="secondary" onPress={() => void access.refetch()}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            )}
          </>
        ) : query.isLoading ? (
          <Text className="text-sm text-text-secondary">
            {t('medications.costs.loading', {
              defaultValue: 'Loading invoice data…',
            })}
          </Text>
        ) : query.isError ? (
          <>
            <Text className="text-sm text-text-primary">
              {t('medications.costs.loadFailed', {
                defaultValue: 'Unable to load invoice data.',
              })}
            </Text>
            <Button variant="secondary" onPress={() => void query.refetch()}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </>
        ) : (
          <>
            {(query.data?.purchases.length ?? 0) === 0 && (
              <View className="gap-3 rounded-xl bg-surface p-4">
                <Text className="text-base font-semibold text-text-primary">
                  {t('medications.costs.empty', {
                    defaultValue: 'No invoices yet',
                  })}
                </Text>
                <Text className="text-sm text-text-secondary">
                  {t('medications.costs.emptyHint', {
                    defaultValue:
                      'Add an order with medication or consumable lines. Shipping belongs on the invoice and can be shared across its lines.',
                  })}
                </Text>
              </View>
            )}
            <Button variant="secondary" onPress={() => open()}>
              {t('medications.costs.addInvoice', {
                defaultValue: 'Add invoice',
              })}
            </Button>
            {query.data?.purchases.map((purchase) => {
              const money = (value: string) =>
                formatPurchaseMoney(value, purchase.currency, i18n.language);
              return (
                <View
                  key={purchase.id}
                  className="gap-3 rounded-xl bg-surface p-4"
                >
                  <Text className="text-base font-semibold text-text-primary">
                    {purchase.vendor ||
                      t('medications.costs.order', { defaultValue: 'Order' })}
                  </Text>
                  <Text className="text-sm text-text-secondary">
                    {[
                      formatDateLabel(purchase.ordered_date, t, i18n.language),
                      purchase.reference,
                      purchase.currency,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text className="text-lg font-semibold text-text-primary">
                    {money(purchase.totals.total)}
                  </Text>
                  {purchase.items.map((item) => (
                    <View
                      key={item.id}
                      className="gap-1 border-t border-border-subtle pt-2"
                    >
                      <Text className="text-sm text-text-primary">
                        {t('medications.costs.ledgerLine', {
                          defaultValue: '{{quantity}} × {{description}}',
                          quantity: item.quantity,
                          description:
                            item.description ||
                            item.medication_name ||
                            (item.kind === 'medication'
                              ? t('medications.costs.removedMedication', {
                                  defaultValue: 'Removed medication',
                                })
                              : t('medications.costs.consumable', {
                                  defaultValue: 'Consumable',
                                })),
                        })}
                      </Text>
                      <Text className="text-xs text-text-secondary">
                        {t('medications.costs.ledgerShare', {
                          defaultValue:
                            '{{subtotal}} + {{share}} shipping & fees',
                          subtotal: money(item.subtotal),
                          share: money(item.allocated),
                        })}
                      </Text>
                      <Text className="text-sm text-text-primary">
                        {t('medications.costs.landedEach', {
                          defaultValue: 'Landed each: {{value}}',
                          value:
                            item.landed_unit === null
                              ? '—'
                              : money(item.landed_unit),
                        })}
                      </Text>
                      {item.kind === 'medication' && (
                        <Text className="text-xs text-text-secondary">
                          {t('medications.costs.matched', {
                            defaultValue: 'Matched vials: {{value}}',
                            value: item.vial_ids.length,
                          })}
                        </Text>
                      )}
                    </View>
                  ))}
                  {purchase.vials_linked < purchase.vials_expected && (
                    <Text className="text-xs text-text-secondary">
                      {t('medications.costs.unmatched', {
                        defaultValue:
                          'Vials not yet matched to inventory: {{value}}',
                        value: purchase.vials_expected - purchase.vials_linked,
                      })}
                    </Text>
                  )}
                  <View className="flex-row justify-between">
                    <Button
                      variant="destructive"
                      disabled={mutations.remove.isPending}
                      onPress={() => remove(purchase)}
                    >
                      {t('common.delete', { defaultValue: 'Delete' })}
                    </Button>
                    <Button variant="link" onPress={() => open(purchase.id)}>
                      {t('common.edit', { defaultValue: 'Edit' })}
                    </Button>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
