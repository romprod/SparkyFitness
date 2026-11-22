import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import {
  LIFE_EVENT_KINDS,
  LIFE_EVENT_MAX_LABEL,
  lifeEventDayCounts,
  lifeEventInputSchema,
  type LifeEvent,
  type LifeEventKind,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useAddLifeEventMutation,
  useDeleteLifeEventMutation,
  useLifeEvents,
} from '@/hooks/Medications/useLifeEvents';

const KIND_FALLBACK: Record<LifeEventKind, string> = {
  illness: 'Illness',
  travel: 'Travel',
  other: 'Other',
};

/**
 * Illness, travel and other windows, as Pitstop keeps them: days inside a window are shaded on the
 * report charts and counted. A window is a tag for context, never an explanation of a change.
 */
export default function LifeEventsCard({
  startDate,
  endDate,
}: {
  /** The report's range, for the count of days inside windows. */
  startDate: string;
  endDate: string;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { data, query } = useLifeEvents();
  const add = useAddLifeEventMutation();
  const remove = useDeleteLifeEventMutation();
  const [kind, setKind] = useState<LifeEventKind>('illness');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState<LifeEvent | null>(null);

  const kindLabel = (value: LifeEventKind) =>
    t(`medications.lifeEvents.kind.${value}`, KIND_FALLBACK[value]);
  const events = data ?? [];
  const counts = lifeEventDayCounts(events, startDate, endDate);

  const describe = (event: LifeEvent) =>
    event.start_day === event.end_day
      ? formatDate(event.start_day)
      : `${formatDate(event.start_day)} → ${formatDate(event.end_day)}`;

  async function submit(submitted: React.FormEvent) {
    submitted.preventDefault();
    setError(null);
    setSaved(false);
    const input = {
      kind,
      start_day: start,
      end_day: end || null,
      label: label || null,
      notes: notes || null,
    };
    const parsed = lifeEventInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          t('medications.lifeEvents.invalid', 'Check the dates and try again.')
      );
      return;
    }
    try {
      await add.mutateAsync(input);
      setLabel('');
      setStart('');
      setEnd('');
      setNotes('');
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t(
              'medications.lifeEvents.saveFailed',
              'Could not save the window. Please try again.'
            )
      );
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CalendarRange className="h-4 w-4" />
          {t('medications.lifeEvents.title', 'Illness and travel windows')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            'medications.lifeEvents.intro',
            'Days inside a window are shaded on the charts and counted. A window is context, never an explanation of a change.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={submit}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          aria-label={t(
            'medications.lifeEvents.formLabel',
            'Add an illness or travel window'
          )}
        >
          <div className="space-y-1">
            <Label htmlFor="life-event-kind">
              {t('medications.lifeEvents.kindLabel', 'Kind')}
            </Label>
            <select
              id="life-event-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as LifeEventKind)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {LIFE_EVENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {kindLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="life-event-label">
              {t('medications.lifeEvents.labelLabel', 'Label')}
            </Label>
            <Input
              id="life-event-label"
              value={label}
              maxLength={LIFE_EVENT_MAX_LABEL}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('medications.lifeEvents.labelPlaceholder', 'flu')}
            />
            <p className="text-[11px] text-muted-foreground">
              {t(
                'medications.lifeEvents.labelHint',
                'Short label only, e.g. flu or work trip; details go in notes.'
              )}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="life-event-start">
              {t('medications.lifeEvents.startLabel', 'Start day')}
            </Label>
            <Input
              id="life-event-start"
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="life-event-end">
              {t('medications.lifeEvents.endLabel', 'End day (inclusive)')}
            </Label>
            <Input
              id="life-event-end"
              type="date"
              min={start || undefined}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t(
                'medications.lifeEvents.endHint',
                'Blank = the start day only. At most 120 days.'
              )}
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="life-event-notes">
              {t('medications.lifeEvents.notesLabel', 'Notes')}
            </Label>
            <Textarea
              id="life-event-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" size="sm" disabled={add.isPending || !start}>
              <Plus className="mr-1 h-4 w-4" />
              {add.isPending
                ? t('medications.lifeEvents.saving', 'Saving…')
                : t('medications.lifeEvents.add', 'Add window')}
            </Button>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            {saved && !error && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('medications.lifeEvents.saved', 'Window saved.')}
              </p>
            )}
          </div>
        </form>

        {query.isError ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.lifeEvents.loadFailed',
              'Could not load the windows.'
            )}
          </p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('medications.lifeEvents.empty', 'No windows tagged yet.')}
          </p>
        ) : (
          <>
            {counts.any > 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.lifeEvents.inRange',
                  'Days inside windows in this range: illness {{illness}}, travel {{travel}}, other {{other}}.',
                  {
                    illness: counts.illness,
                    travel: counts.travel,
                    other: counts.other,
                  }
                )}
              </p>
            )}
            <ul className="divide-y">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{kindLabel(event.kind)}</Badge>
                    {event.label && (
                      <span className="font-medium">{event.label}</span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {describe(event)}
                    </span>
                    {event.notes && (
                      <span className="basis-full text-xs text-muted-foreground">
                        {event.notes}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(event)}
                    aria-label={t(
                      'medications.lifeEvents.deleteLabel',
                      'Delete window {{what}}',
                      {
                        what: `${event.label ?? kindLabel(event.kind)} ${describe(event)}`,
                      }
                    )}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    {t('medications.lifeEvents.delete', 'Delete')}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('medications.lifeEvents.deleteTitle', 'Delete this window?')}
        description={t(
          'medications.lifeEvents.deleteDescription',
          'It will no longer be shaded on the charts. This cannot be undone.'
        )}
        variant="destructive"
        confirmLabel={t('medications.lifeEvents.delete', 'Delete')}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target)
            remove.mutate(target.id, {
              onError: (failure) =>
                setError(
                  failure instanceof Error
                    ? failure.message
                    : t(
                        'medications.lifeEvents.deleteFailed',
                        'Could not delete the window.'
                      )
                ),
            });
        }}
      />
    </Card>
  );
}
