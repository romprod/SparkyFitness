import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  buildManualLabPanel,
  labPanelMarkerOptions,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabPanelDraftRow,
} from '@workspace/shared';
import Button from '../ui/Button';
import BottomSheetPicker from '../BottomSheetPicker';
import CalendarSheet, { type CalendarSheetRef } from '../CalendarSheet';
import { useCreateManualLabPanel } from '../../hooks/useLabResults';
import { formatDateLabel, getTodayDate } from '../../utils/dateUtils';

interface Props {
  customMarkers: Pick<LabMarkerResponse, 'id' | 'name' | 'unit'>[];
  labels: LabMarkerLabels;
  onSaved: () => void;
  ownerId: string;
  isScopeCurrent?: () => boolean;
}
const INPUT =
  'bg-raised border border-border-subtle rounded-xl px-3 py-2.5 text-sm text-text-primary';
const LabPanelForm = ({
  customMarkers,
  labels,
  onSaved,
  ownerId,
  isScopeCurrent = () => true,
}: Props) => {
  const { t, i18n } = useTranslation();
  const [draftOwnerId] = useState(ownerId);
  const options = useMemo(
    () => labPanelMarkerOptions(customMarkers, labels),
    [customMarkers, labels]
  );
  const nextKey = useRef(1);
  const blank = (key: string): LabPanelDraftRow => ({
    key,
    marker: options[0]?.id ?? '',
    unit: options[0]?.unit ?? '',
    value: '',
    low: '',
    high: '',
  });
  const [rows, setRows] = useState<LabPanelDraftRow[]>(() => [
    blank('initial'),
  ]);
  const [date, setDate] = useState(getTodayDate());
  const [labName, setLabName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const calendar = useRef<CalendarSheetRef>(null);
  const save = useCreateManualLabPanel();
  const patch = (key: string, changes: Partial<LabPanelDraftRow>) =>
    setRows((items) =>
      items.map((row) => (row.key === key ? { ...row, ...changes } : row))
    );
  const submit = async () => {
    if (!draftOwnerId || !isScopeCurrent()) return;
    const parsed = buildManualLabPanel(
      { date, labName, notes, rows },
      getTodayDate()
    );
    if (!parsed.ok) {
      const errors = {
        date: t('labs.dateInvalid', {
          defaultValue: 'Enter the date of the test.',
        }),
        future: t('labs.dateFuture', {
          defaultValue: 'The test date cannot be in the future.',
        }),
        empty: t('labs.panels.emptyValues', {
          defaultValue: 'Enter at least one result.',
        }),
        marker: t('labs.panels.chooseMarker', {
          defaultValue: 'Choose a marker for each result.',
        }),
        range: t('labs.rangeInvalid', {
          defaultValue:
            'Enter numbers, with the low value not above the high value.',
        }),
        duplicate: t('labs.panels.duplicate', {
          defaultValue: 'Use each marker only once in a panel.',
        }),
        invalid: t('labs.panels.invalid', {
          defaultValue: 'Check the panel values and try again.',
        }),
      };
      setError(errors[parsed.error]);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        ...parsed.body,
        expected_owner_id: draftOwnerId,
      });
      if (isScopeCurrent()) onSaved();
    } catch {
      setError(
        t('labs.panels.saveFailed', {
          defaultValue: 'Could not save the lab panel. Your entries are kept.',
        })
      );
    }
  };
  const locale = i18n.language.startsWith('pl') ? 'pl-PL' : 'en-US';
  return (
    <View className="bg-surface rounded-xl p-4 gap-3 mb-4">
      <Text className="text-lg font-semibold text-text-primary">
        {t('labs.panels.add', { defaultValue: 'Add lab panel' })}
      </Text>
      <Text className="text-sm text-text-secondary">
        {t('labs.panels.date', { defaultValue: 'Collection date' })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('labs.panels.date', {
          defaultValue: 'Collection date',
        })}
        disabled={save.isPending || !draftOwnerId}
        onPress={() => calendar.current?.present()}
        className={INPUT}
      >
        <Text className="text-text-primary">
          {formatDateLabel(date, t, locale)}
        </Text>
      </Pressable>
      <Text className="text-sm text-text-secondary">
        {t('labs.panels.source', { defaultValue: 'Lab / source' })}
      </Text>
      <TextInput
        className={INPUT}
        accessibilityLabel={t('labs.panels.source', {
          defaultValue: 'Lab / source',
        })}
        value={labName}
        onChangeText={setLabName}
        editable={!save.isPending}
        maxLength={200}
      />
      {rows.map((row, index) => (
        <View
          key={row.key}
          className="border border-border-subtle rounded-xl p-3 gap-3"
        >
          <Text className="text-sm font-semibold text-text-primary">
            {t('labs.panels.resultNumber', {
              defaultValue: 'Result {{number}}',
              number: index + 1,
            })}
          </Text>
          <BottomSheetPicker
            value={row.marker}
            title={t('labs.panels.markerNumber', {
              defaultValue: 'Marker {{number}}',
              number: index + 1,
            })}
            options={options.map((option) => ({
              value: option.id,
              label: option.name,
            }))}
            onSelect={(marker) => {
              if (!save.isPending)
                patch(row.key, {
                  marker,
                  unit: options.find((o) => o.id === marker)?.unit ?? '',
                  low: '',
                  high: '',
                });
            }}
          />
          <TextInput
            className={INPUT}
            accessibilityLabel={t('labs.panels.resultNumber', {
              defaultValue: 'Result {{number}}',
              number: index + 1,
            })}
            placeholder={t('labs.value', { defaultValue: 'Result' })}
            value={row.value}
            onChangeText={(value) => patch(row.key, { value })}
            editable={!save.isPending}
            maxLength={200}
          />
          <TextInput
            className={INPUT}
            accessibilityLabel={t('labs.unit', { defaultValue: 'Unit' })}
            placeholder={t('labs.unit', { defaultValue: 'Unit' })}
            value={row.unit}
            onChangeText={(unit) => patch(row.key, { unit })}
            editable={!save.isPending}
            maxLength={40}
          />
          <Text className="text-xs text-text-muted">
            {t('labs.rangeOptional', {
              defaultValue: 'Reference range (optional)',
            })}
          </Text>
          <View className="flex-row gap-2">
            <TextInput
              className={`${INPUT} flex-1`}
              accessibilityLabel={t('labs.rangeLow', { defaultValue: 'Low' })}
              placeholder={t('labs.rangeLow', { defaultValue: 'Low' })}
              keyboardType="decimal-pad"
              value={row.low}
              onChangeText={(low) => patch(row.key, { low })}
              editable={!save.isPending}
            />
            <TextInput
              className={`${INPUT} flex-1`}
              accessibilityLabel={t('labs.rangeHigh', { defaultValue: 'High' })}
              placeholder={t('labs.rangeHigh', { defaultValue: 'High' })}
              keyboardType="decimal-pad"
              value={row.high}
              onChangeText={(high) => patch(row.key, { high })}
              editable={!save.isPending}
            />
          </View>
          <Button
            variant="ghost"
            disabled={rows.length === 1 || save.isPending}
            onPress={() =>
              setRows((items) => items.filter((r) => r.key !== row.key))
            }
          >
            {t('labs.panels.removeNumber', {
              defaultValue: 'Remove result {{number}}',
              number: index + 1,
            })}
          </Button>
        </View>
      ))}
      <Button
        variant="secondary"
        disabled={save.isPending || !draftOwnerId}
        onPress={() => {
          const key = String(nextKey.current++);
          setRows((items) => [...items, blank(key)]);
        }}
      >
        {t('labs.panels.addResult', { defaultValue: 'Add result' })}
      </Button>
      <TextInput
        className={INPUT}
        accessibilityLabel={t('labs.notes', { defaultValue: 'Notes' })}
        placeholder={t('labs.notes', { defaultValue: 'Notes' })}
        multiline
        value={notes}
        onChangeText={setNotes}
        editable={!save.isPending}
        maxLength={2000}
      />
      {error && (
        <Text
          accessibilityRole="alert"
          className="text-text-danger-subtle text-sm"
        >
          {error}
        </Text>
      )}
      <Button
        variant="primary"
        disabled={save.isPending || !draftOwnerId}
        onPress={() => void submit()}
      >
        {save.isPending
          ? t('common.saving', { defaultValue: 'Saving…' })
          : t('labs.panels.save', { defaultValue: 'Save lab panel' })}
      </Button>
      <CalendarSheet
        ref={calendar}
        selectedDate={date}
        maxDate={getTodayDate()}
        onSelectDate={(value) => {
          setDate(value);
          calendar.current?.dismiss();
        }}
      />
    </View>
  );
};
export default LabPanelForm;
