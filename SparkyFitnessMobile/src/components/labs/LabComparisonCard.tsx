import type { LabComparisonCell } from '@workspace/shared';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLabComparison } from '../../hooks/useLabResults';
import { useRefetchOnFocus } from '../../hooks/useRefetchOnFocus';
import { formatDateLabel } from '../../utils/dateUtils';
import {
  formatLabRange,
  labResultText,
  sameLabUnit,
} from '../../utils/labResults';
import Button from '../ui/Button';
import LabStatusBadge from './LabStatusBadge';

function comparisonValue(cell: LabComparisonCell): string {
  return cell.result ? labResultText({ ...cell.result, unit: cell.unit }) : '—';
}

/** Read-only latest-report matrix within the existing Labs screen. */
export default function LabComparisonCard() {
  const { t, i18n } = useTranslation();
  const { comparison, isLoading, isError, refetch } = useLabComparison();
  useRefetchOnFocus(() => void refetch());
  const columns = comparison.panels;
  return (
    <View className="bg-surface rounded-xl p-4 mb-4 gap-3">
      <Text className="text-base font-semibold text-text-primary">
        {t('labs.comparison.title', {
          defaultValue: 'Latest three panels',
        })}
      </Text>
      {isLoading ? (
        <Text className="text-sm text-text-muted">
          {t('labs.comparison.loading', {
            defaultValue: 'Loading panel comparison…',
          })}
        </Text>
      ) : isError ? (
        <>
          <Text className="text-sm text-text-warning">
            {t('labs.comparison.failed', {
              defaultValue: 'Could not load the panel comparison.',
            })}
          </Text>
          <Button variant="secondary" onPress={() => void refetch()}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        </>
      ) : !columns.length ? (
        <Text className="text-sm text-text-muted">
          {t('labs.comparison.empty', {
            defaultValue: 'No lab panels available to compare.',
          })}
        </Text>
      ) : !comparison.rows.length ? (
        <Text className="text-sm text-text-muted">
          {t('labs.comparison.noResults', {
            defaultValue: 'These panels have no lab results to compare.',
          })}
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View className="flex-row border-b border-border-subtle pb-2">
              <Text
                style={{ width: 150 }}
                className="text-xs font-semibold text-text-secondary"
              >
                {t('labs.comparison.marker', { defaultValue: 'Marker' })}
              </Text>
              <Text
                style={{ width: 90 }}
                className="text-xs font-semibold text-text-secondary"
              >
                {t('labs.comparison.unit', { defaultValue: 'Unit' })}
              </Text>
              <Text
                style={{ width: 130 }}
                className="text-xs font-semibold text-text-secondary"
              >
                {t('labs.comparison.range', {
                  defaultValue: 'Reference range',
                })}
              </Text>
              {columns.map((panel, index) => (
                <View
                  key={panel.id}
                  style={{ width: 140 }}
                  className={index === 0 ? 'bg-raised px-2' : 'px-2'}
                >
                  <Text className="text-xs font-semibold text-text-primary">
                    {panel.collected_on
                      ? formatDateLabel(panel.collected_on, t, i18n.language)
                      : t('labs.comparison.dateUnknown', {
                          defaultValue: 'Collection date not recorded',
                        })}
                  </Text>
                  {panel.lab_name ? (
                    <Text className="text-xs text-text-muted">
                      {panel.lab_name}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            {comparison.rows.map((row) => (
              <View
                key={row.id}
                className="flex-row border-b border-border-subtle py-3"
              >
                <Text
                  style={{ width: 150 }}
                  className="text-sm font-medium text-text-primary"
                >
                  {row.name}
                </Text>
                <Text style={{ width: 90 }} className="text-xs text-text-muted">
                  {row.unit || '—'}
                </Text>
                <Text
                  style={{ width: 130 }}
                  className="text-xs text-text-muted"
                >
                  {formatLabRange(row.range.low, row.range.high, '') || '—'}
                </Text>
                {row.cells.map((cell, index) => (
                  <View
                    key={columns[index]!.id}
                    style={{ width: 140 }}
                    className={
                      index === 0 ? 'bg-raised px-2 gap-1' : 'px-2 gap-1'
                    }
                  >
                    <Text
                      className="text-sm text-text-primary"
                      accessibilityLabel={
                        cell.result
                          ? t('labs.comparison.valueRange', {
                              defaultValue:
                                '{{value}}; reference range {{range}}',
                              value: comparisonValue(cell),
                              range:
                                formatLabRange(
                                  cell.range.low,
                                  cell.range.high,
                                  cell.unit
                                ) ??
                                t('labs.comparison.rangeUnavailable', {
                                  defaultValue: 'Range unavailable',
                                }),
                            })
                          : undefined
                      }
                    >
                      {comparisonValue(cell)}
                    </Text>
                    {cell.result && <LabStatusBadge status={cell.status} />}
                    {cell.result &&
                      (cell.range.low !== row.range.low ||
                        cell.range.high !== row.range.high ||
                        ((cell.range.low !== null ||
                          cell.range.high !== null) &&
                          !sameLabUnit(
                            cell.unit,
                            row.unit,
                            cell.result.marker_key
                          ))) && (
                        <Text className="text-xs text-text-muted">
                          {formatLabRange(
                            cell.range.low,
                            cell.range.high,
                            cell.unit
                          )
                            ? t('labs.comparison.cellRange', {
                                defaultValue: 'Reference: {{range}}',
                                range: formatLabRange(
                                  cell.range.low,
                                  cell.range.high,
                                  cell.unit
                                ),
                              })
                            : t('labs.comparison.rangeUnavailable', {
                                defaultValue: 'Range unavailable',
                              })}
                        </Text>
                      )}
                    {cell.result &&
                      cell.result.entry_date !==
                        columns[index]!.collected_on && (
                        <Text className="text-xs text-text-muted">
                          {t('labs.comparison.resultDate', {
                            defaultValue: 'Result date: {{date}}',
                            date: formatDateLabel(
                              cell.result.entry_date,
                              t,
                              i18n.language
                            ),
                          })}
                        </Text>
                      )}
                    {cell.improved && (
                      <Text
                        className="text-xs text-text-success"
                        accessibilityLabel={t('labs.comparison.closer', {
                          defaultValue:
                            'Closer to reference range than prior panel',
                        })}
                      >
                        {cell.improved === 'up' ? '▲' : '▼'}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
