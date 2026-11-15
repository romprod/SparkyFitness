import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  penDosesLeft,
  penExpiryStatus,
  type PenExpiryStatus,
} from '../../utils/glp1';
import { useMedicationPens } from '../../hooks/useGlp1';
import { formatDateLabel, getTodayDate } from '../../utils/dateUtils';
import MedicationVialCostLink from '../medications/MedicationVialCostLink';
import PreparationSummary from './PreparationSummary';

interface Glp1InventoryCardProps {
  medicationId: string;
  onAdd: () => void;
  onEdit: (penId: string) => void;
  onCosts?: (purchaseId?: string) => void;
}

const Glp1InventoryCard: React.FC<Glp1InventoryCardProps> = ({
  medicationId,
  onAdd,
  onEdit,
  onCosts,
}) => {
  const { t, i18n } = useTranslation();
  const { data: pens = [] } = useMedicationPens(medicationId);
  const today = getTodayDate();
  const isRetired = (pen: (typeof pens)[number]) =>
    pen.status === 'finished' || pen.status === 'discarded';
  const orderedPens = [...pens].sort(
    (a, b) => Number(isRetired(a)) - Number(isRetired(b))
  );

  const expiryText = (status: PenExpiryStatus | null, date: string | null) => {
    if (!date || !status) return null;
    return status === 'expired'
      ? t('medications.glp1.inventory.expired', {
          defaultValue: 'Expired {{date}}',
          date,
        })
      : t('medications.glp1.inventory.expires', {
          defaultValue: 'Expires {{date}}',
          date,
        });
  };

  return (
    <View className="bg-surface rounded-xl p-4 mb-3 shadow-sm">
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-base font-semibold text-text-primary">
          {t('medications.glp1.inventory.title', {
            defaultValue: 'Pens and vials',
          })}
        </Text>
        <TouchableOpacity
          onPress={onAdd}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
        >
          <Text className="text-sm font-semibold text-accent-primary">
            {t('medications.glp1.inventory.add', { defaultValue: 'Add' })}
          </Text>
        </TouchableOpacity>
      </View>
      {pens.length === 0 ? (
        <Text className="text-sm text-text-muted">
          {t('medications.glp1.inventory.empty', {
            defaultValue:
              'No pens or vials yet. Add one to track doses left and expiry.',
          })}
        </Text>
      ) : (
        orderedPens.map((pen, index) => {
          const left = penDosesLeft(pen);
          const expiry = penExpiryStatus(pen.expiry_date, today);
          const lowStock =
            !isRetired(pen) &&
            pen.reorder_flag &&
            left != null &&
            pen.reorder_threshold != null &&
            left <= pen.reorder_threshold;
          const name =
            pen.label ||
            (pen.kind === 'vial'
              ? t('medications.glp1.inventory.vial', { defaultValue: 'Vial' })
              : t('medications.glp1.inventory.pen', { defaultValue: 'Pen' }));
          const statusLabel =
            pen.status === 'in_use'
              ? t('medications.glp1.inventory.status.in_use', {
                  defaultValue: 'In use',
                })
              : pen.status === 'discarded'
                ? t('medications.glp1.inventory.status.discarded', {
                    defaultValue: 'Discarded',
                  })
                : pen.status === 'finished'
                  ? t('medications.glp1.inventory.status.finished', {
                      defaultValue: 'Finished',
                    })
                  : t('medications.glp1.inventory.status.sealed', {
                      defaultValue: 'Sealed',
                    });
          const details = [
            pen.dose_mg != null ? `${pen.dose_mg} mg` : null,
            pen.stock
              ? `${pen.stock.remainingMg.toFixed(3)} mg / ${pen.stock.remainingMl.toFixed(3)} mL`
              : left != null
                ? t('medications.glp1.inventory.left', {
                    defaultValue: '{{count}} left',
                    count: left,
                  })
                : null,
            pen.stock_unknown
              ? t('medications.preparation.unknown', {
                  defaultValue:
                    'Mass stock unavailable: check preparation details and linked dose history.',
                })
              : null,
            pen.stock && pen.stock.overdrawnMg > 0
              ? t('medications.preparation.overdrawn', {
                  defaultValue: 'Logged use exceeds the recorded vial content.',
                })
              : null,
            expiryText(expiry, pen.expiry_date),
            pen.bud_date
              ? t('medications.preparation.budSummary', {
                  defaultValue: 'Beyond-use {{date}}',
                  date: formatDateLabel(pen.bud_date, t, i18n.language),
                })
              : null,
            pen.bud_source || null,
            pen.lot_number
              ? t('medications.preparation.lotSummary', {
                  defaultValue: 'Lot {{lot}}',
                  lot: pen.lot_number,
                })
              : null,
            pen.storage_location || null,
          ].filter(Boolean);
          return (
            <View key={pen.id}>
              {(index === 0 ||
                isRetired(pen) !== isRetired(orderedPens[index - 1]!)) && (
                <Text className="text-sm font-semibold text-text-secondary mt-3 mb-2">
                  {isRetired(pen)
                    ? t('medications.stock.retired', {
                        defaultValue: 'Retired stock',
                      })
                    : t('medications.stock.active', {
                        defaultValue: 'Active stock',
                      })}
                </Text>
              )}
              {index > 0 && <View className="h-px bg-chrome-border my-2" />}
              <TouchableOpacity
                onPress={() => onEdit(pen.id)}
                activeOpacity={0.6}
                accessibilityRole="button"
                className="flex-row items-center"
              >
                <View className="flex-1">
                  <Text className="text-base text-text-primary">{name}</Text>
                  <Text className="text-xs text-text-muted mt-0.5">
                    {[statusLabel, ...details].join(' · ')}
                  </Text>
                  {pen.kind === 'vial' && (
                    <PreparationSummary preparation={pen.preparation} />
                  )}
                  {(lowStock || expiry === 'expired' || expiry === 'soon') && (
                    <Text className="text-xs font-medium text-text-warning mt-0.5">
                      {lowStock
                        ? t('medications.glp1.inventory.reorder', {
                            defaultValue: 'Time to reorder',
                          })
                        : expiry === 'expired'
                          ? t('medications.glp1.inventory.expiredWarning', {
                              defaultValue: 'Past its expiry date',
                            })
                          : t('medications.glp1.inventory.expiringSoon', {
                              defaultValue: 'Expires within a week',
                            })}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
              {pen.kind === 'vial' && onCosts && (
                <MedicationVialCostLink vialId={pen.id} onOpen={onCosts} />
              )}
            </View>
          );
        })
      )}
    </View>
  );
};

export default Glp1InventoryCard;
