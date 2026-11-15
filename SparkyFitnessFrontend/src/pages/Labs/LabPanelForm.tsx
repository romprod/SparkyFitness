import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildManualLabPanel,
  labPanelMarkerOptions,
  todayInZone,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabPanelDraftRow,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useCreateManualLabPanel } from '@/hooks/Labs/useLabResults';

interface Props {
  customMarkers: LabMarkerResponse[];
  labels: LabMarkerLabels;
  onSaved: () => void;
  ownerId: string;
  isScopeCurrent?: () => boolean;
}

const LabPanelForm = ({
  customMarkers,
  labels,
  onSaved,
  ownerId,
  isScopeCurrent = () => true,
}: Props) => {
  const { t } = useTranslation();
  const [draftOwnerId] = useState(ownerId);
  const { timezone } = usePreferences();
  const save = useCreateManualLabPanel();
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
  const [date, setDate] = useState(todayInZone(timezone));
  const [labName, setLabName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const patch = (key: string, changes: Partial<LabPanelDraftRow>) =>
    setRows((items) =>
      items.map((row) => (row.key === key ? { ...row, ...changes } : row))
    );
  const submit = async () => {
    if (!draftOwnerId) return;
    if (!isScopeCurrent()) return;
    const parsed = buildManualLabPanel(
      { date, labName, notes, rows },
      todayInZone(timezone)
    );
    if (!parsed.ok) {
      const messages = {
        date: t('labs.dateInvalid', 'Enter the date of the test.'),
        future: t('labs.dateFuture', 'The test date cannot be in the future.'),
        empty: t('labs.panels.emptyValues', 'Enter at least one result.'),
        marker: t(
          'labs.panels.chooseMarker',
          'Choose a marker for each result.'
        ),
        range: t(
          'labs.rangeInvalid',
          'Enter numbers, with the low value not above the high value.'
        ),
        duplicate: t(
          'labs.panels.duplicate',
          'Use each marker only once in a panel.'
        ),
        invalid: t(
          'labs.panels.invalid',
          'Check the panel values and try again.'
        ),
      };
      setError(messages[parsed.error]);
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
        t(
          'labs.panels.saveFailed',
          'Could not save the lab panel. Your entries are kept.'
        )
      );
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t('labs.panels.add', 'Add lab panel')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <fieldset
            disabled={save.isPending || !draftOwnerId}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="panel-date">
                  {t('labs.panels.date', 'Collection date')}
                </Label>
                <Input
                  id="panel-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="panel-lab">
                  {t('labs.panels.source', 'Lab / source')}
                </Label>
                <Input
                  id="panel-lab"
                  value={labName}
                  onChange={(e) => setLabName(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            {rows.map((row, index) => (
              <fieldset
                key={row.key}
                className="space-y-3 rounded-md border p-3"
              >
                <legend className="px-1 text-sm font-medium">
                  {t('labs.panels.resultNumber', 'Result {{number}}', {
                    number: index + 1,
                  })}
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`panel-marker-${row.key}`}>
                      {t('labs.panels.marker', 'Marker')}
                    </Label>
                    <select
                      id={`panel-marker-${row.key}`}
                      value={row.marker}
                      onChange={(e) =>
                        patch(row.key, {
                          marker: e.target.value,
                          unit:
                            options.find((o) => o.id === e.target.value)
                              ?.unit ?? '',
                          low: '',
                          high: '',
                        })
                      }
                      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`panel-value-${row.key}`}>
                      {t('labs.value', 'Result')}
                    </Label>
                    <Input
                      id={`panel-value-${row.key}`}
                      value={row.value}
                      onChange={(e) =>
                        patch(row.key, { value: e.target.value })
                      }
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`panel-unit-${row.key}`}>
                      {t('labs.unit', 'Unit')}
                    </Label>
                    <Input
                      id={`panel-unit-${row.key}`}
                      value={row.unit}
                      onChange={(e) => patch(row.key, { unit: e.target.value })}
                      maxLength={40}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`panel-low-${row.key}`}>
                      {t('labs.rangeLow', 'Low')}
                    </Label>
                    <Input
                      id={`panel-low-${row.key}`}
                      inputMode="decimal"
                      value={row.low}
                      onChange={(e) => patch(row.key, { low: e.target.value })}
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`panel-high-${row.key}`}>
                      {t('labs.rangeHigh', 'High')}
                    </Label>
                    <Input
                      id={`panel-high-${row.key}`}
                      inputMode="decimal"
                      value={row.high}
                      onChange={(e) => patch(row.key, { high: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={rows.length === 1}
                    aria-label={t(
                      'labs.panels.removeNumber',
                      'Remove result {{number}}',
                      { number: index + 1 }
                    )}
                    onClick={() =>
                      setRows((items) => items.filter((r) => r.key !== row.key))
                    }
                  >
                    {t('common.remove', 'Remove')}
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const key = String(nextKey.current++);
                setRows((items) => [...items, blank(key)]);
              }}
            >
              {t('labs.panels.addResult', 'Add result')}
            </Button>
            <div className="space-y-1">
              <Label htmlFor="panel-notes">{t('labs.notes', 'Notes')}</Label>
              <Textarea
                id="panel-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </div>
          </fieldset>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive p-3 text-sm text-destructive-foreground"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={save.isPending || !draftOwnerId}
          >
            {save.isPending
              ? t('common.saving', 'Saving...')
              : t('labs.panels.save', 'Save lab panel')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
export default LabPanelForm;
