import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  medicationStackScheduleInputSchema,
  normalizeStackTime,
  type MedicationStack,
  type MedicationStackScheduleInput,
  type MedicationStackScheduleReview,
  type StackScheduleType,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeInput } from '@/components/ui/TimeInput';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useClearStackScheduleMutation,
  useReviewStackScheduleMutation,
  useSaveStackScheduleMutation,
} from '@/hooks/Medications/useStackSchedule';
import {
  describeStackTiming,
  notFollowingText,
  reviewActionText,
  weekdayName,
} from './stackScheduleText';

const TYPES: StackScheduleType[] = [
  'daily',
  'specific_days',
  'every_n_days',
  'cyclic',
];
type Field =
  | 'schedule_type_id'
  | 'days_of_week'
  | 'interval_days'
  | 'cycle_on_days'
  | 'start_date'
  | 'time_of_day';

const newOperationId = () => crypto.randomUUID();
const toNumber = (raw: string) => (raw.trim() === '' ? null : Number(raw));
const failureStatus = (failure: unknown) =>
  (failure as { status?: number }).status;
const failureMessage = (failure: unknown) =>
  failure instanceof Error && failure.message ? failure.message : '';

/**
 * One shared schedule for a stack. Step 1 is the form; step 2 is the review of
 * what it would do to every member, which is read only until Save.
 */
export default function MedicationStackScheduleDialog({
  stack,
  onClose,
}: {
  stack: MedicationStack;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const existing = stack.schedule ?? null;
  const reviewMutation = useReviewStackScheduleMutation();
  const saveMutation = useSaveStackScheduleMutation();
  const clearMutation = useClearStackScheduleMutation();

  const [type, setType] = useState<StackScheduleType>(
    existing?.schedule_type_id ?? 'daily'
  );
  const [days, setDays] = useState<number[]>(existing?.days_of_week ?? []);
  const [interval, setInterval] = useState(
    existing?.interval_days != null ? String(existing.interval_days) : ''
  );
  const [on, setOn] = useState(
    existing?.cycle_on_days != null ? String(existing.cycle_on_days) : ''
  );
  const [off, setOff] = useState(
    existing?.cycle_off_days != null ? String(existing.cycle_off_days) : ''
  );
  const [time, setTime] = useState(
    normalizeStackTime(existing?.time_of_day) ?? ''
  );
  const [start, setStart] = useState(existing?.start_date ?? '');
  const [showErrors, setShowErrors] = useState(false);

  const [review, setReview] = useState<MedicationStackScheduleReview | null>(
    null
  );
  const [effective, setEffective] = useState('');
  const [effectiveMoved, setEffectiveMoved] = useState(false);
  const [acked, setAcked] = useState<string[]>([]);
  const [leaveOut, setLeaveOut] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // One id per review attempt: a retry of the same save reuses it, a new review starts a new attempt.
  const operationId = useRef(newOperationId());

  const draft = {
    schedule_type_id: type,
    time_of_day: time || null,
    days_of_week: type === 'specific_days' ? days : null,
    interval_days: type === 'every_n_days' ? toNumber(interval) : null,
    cycle_on_days: type === 'cyclic' ? toNumber(on) : null,
    cycle_off_days: type === 'cyclic' ? toNumber(off) : null,
    start_date: start || null,
  };
  const parsed = medicationStackScheduleInputSchema.safeParse(draft);
  const problems: Partial<Record<Field, string>> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'schedule_type_id') as Field;
      problems[key] ??= issue.message;
    }
  const shown = (field: Field) => (showErrors ? problems[field] : undefined);
  const cycleProblem = shown('cycle_on_days');

  const busy =
    reviewMutation.isPending ||
    saveMutation.isPending ||
    clearMutation.isPending;
  const edit = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setter(value);
      setError('');
    };
  };

  const runReview = (
    schedule: MedicationStackScheduleInput,
    effectiveFrom: string | undefined
  ) => {
    setError('');
    setStale(false);
    reviewMutation.mutate(
      {
        id: stack.id,
        body: {
          schedule,
          ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
        },
      },
      {
        onSuccess: (result) => {
          operationId.current = newOperationId();
          setReview(result);
          setEffective(result.effective_from);
          setAcked((old) =>
            old.filter((id) =>
              result.members.some(
                (member) => member.medication_id === id && member.needs_ack
              )
            )
          );
        },
        onError: (failure) =>
          setError(
            failureMessage(failure) ||
              t(
                'medications.stacks.schedule.reviewFailed',
                'Could not review the schedule. Please try again.'
              )
          ),
      }
    );
  };

  const next = () => {
    if (!parsed.success) {
      setShowErrors(true);
      return;
    }
    setLeaveOut(false);
    setAcked([]);
    setEffectiveMoved(false);
    runReview(parsed.data, undefined);
  };

  const moveEffective = (value: string) => {
    setEffective(value);
    setEffectiveMoved(true);
    // Moving the date changes what the review says, so it is read again.
    if (review && parsed.success && value && value >= review.today)
      runReview(parsed.data, value);
  };

  const reviewAgain = () => {
    if (!parsed.success) return;
    runReview(parsed.data, effectiveMoved ? effective : undefined);
  };

  const changing = review
    ? review.members.filter(
        (member) => member.action === 'edit' || member.action === 'revise'
      )
    : [];
  const needAck = review?.members.filter((member) => member.needs_ack) ?? [];
  const leftOut = review
    ? review.members.filter((member) =>
        review.skipped_member_ids.includes(member.medication_id)
      )
    : [];
  const effectiveValid = !!review && !!effective && effective >= review.today;
  const canSave =
    !!review &&
    parsed.success &&
    effectiveValid &&
    !stale &&
    !busy &&
    needAck.every((member) => acked.includes(member.medication_id)) &&
    (review.skipped_member_ids.length === 0 || leaveOut);

  const save = () => {
    if (!review || !parsed.success || !canSave) return;
    setError('');
    saveMutation.mutate(
      {
        id: stack.id,
        body: {
          schedule: parsed.data,
          operation_id: operationId.current,
          expected_version: review.expected_version,
          review_fingerprint: review.review_fingerprint,
          effective_from: effective,
          skipped_member_ids: review.skipped_member_ids,
          acknowledged_member_ids: needAck
            .map((member) => member.medication_id)
            .filter((id) => acked.includes(id)),
        },
      },
      {
        onSuccess: onClose,
        onError: (failure) => {
          if (failureStatus(failure) === 409) {
            setStale(true);
            setError(
              failureMessage(failure) ||
                t(
                  'medications.stacks.schedule.stale',
                  'The stack or its plans changed since this review. Review again to continue; your draft is kept.'
                )
            );
          } else
            setError(
              failureMessage(failure) ||
                t(
                  'medications.stacks.schedule.saveFailed',
                  'Could not save the stack schedule. Please try again.'
                )
            );
        },
      }
    );
  };

  const remove = () => {
    if (!existing) return;
    setError('');
    clearMutation.mutate(
      {
        id: stack.id,
        body: {
          operation_id: newOperationId(),
          expected_version: existing.version,
        },
      },
      {
        onSuccess: onClose,
        onError: (failure) => {
          setConfirmRemove(false);
          setError(
            failureMessage(failure) ||
              t(
                'medications.stacks.schedule.removeFailed',
                'Could not remove the stack schedule. Please try again.'
              )
          );
        },
      }
    );
  };

  const typeLabel: Record<StackScheduleType, string> = {
    daily: t('medications.stacks.schedule.type.daily', 'Daily'),
    specific_days: t(
      'medications.stacks.schedule.type.specificDays',
      'Specific days'
    ),
    every_n_days: t('medications.stacks.schedule.type.everyN', 'Every N days'),
    cyclic: t('medications.stacks.schedule.type.cyclic', 'Cycle on/off'),
  };
  const counted = type === 'every_n_days' || type === 'cyclic';
  const fieldError = (message?: string) =>
    message && (
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    );

  const form = (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="stack-schedule-type">
          {t('medications.stacks.schedule.howOften', 'How often')}
        </Label>
        <Select
          value={type}
          onValueChange={(value) => {
            const chosen = value as StackScheduleType;
            setType(chosen);
            setError('');
            // As in Pitstop, an interval starts at 3 days and a cycle at 5 on / 2 off.
            if (chosen === 'every_n_days' && !interval) setInterval('3');
            if (chosen === 'cyclic' && !on) {
              setOn('5');
              setOff('2');
            }
          }}
        >
          <SelectTrigger id="stack-schedule-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {typeLabel[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldError(shown('schedule_type_id'))}
      </div>
      {type === 'specific_days' && (
        <div className="space-y-1">
          <div
            role="group"
            aria-label={t('medications.stacks.schedule.weekdays', 'Weekdays')}
            className="flex flex-wrap gap-1"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <Button
                key={day}
                type="button"
                size="sm"
                variant={days.includes(day) ? 'secondary' : 'outline'}
                aria-pressed={days.includes(day)}
                onClick={() =>
                  edit(setDays)(
                    days.includes(day)
                      ? days.filter((d) => d !== day)
                      : [...days, day]
                  )
                }
              >
                {weekdayName(t, day)}
              </Button>
            ))}
          </div>
          {fieldError(shown('days_of_week'))}
        </div>
      )}
      {type === 'every_n_days' && (
        <div className="space-y-1">
          <Label htmlFor="stack-schedule-interval">
            {t('medications.stacks.schedule.interval', 'Days between doses')}
          </Label>
          <Input
            id="stack-schedule-interval"
            type="number"
            step="1"
            min="2"
            value={interval}
            onChange={(event) => edit(setInterval)(event.target.value)}
          />
          {fieldError(shown('interval_days'))}
        </div>
      )}
      {type === 'cyclic' && (
        <div className="space-y-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="stack-schedule-on">
                {t('medications.stacks.schedule.daysOn', 'Days on')}
              </Label>
              <Input
                id="stack-schedule-on"
                type="number"
                step="1"
                min="1"
                value={on}
                onChange={(event) => edit(setOn)(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stack-schedule-off">
                {t('medications.stacks.schedule.daysOff', 'Days off')}
              </Label>
              <Input
                id="stack-schedule-off"
                type="number"
                step="1"
                min="1"
                value={off}
                onChange={(event) => edit(setOff)(event.target.value)}
              />
            </div>
          </div>
          {fieldError(cycleProblem)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label id="stack-schedule-time-label">
            {t('medications.stacks.schedule.time', 'Time of day (optional)')}
          </Label>
          <TimeInput
            aria-labelledby="stack-schedule-time-label"
            value={time}
            onChange={edit(setTime)}
          />
          {fieldError(shown('time_of_day'))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="stack-schedule-start">
            {counted
              ? t('medications.stacks.schedule.start', 'Start date')
              : t(
                  'medications.stacks.schedule.startOptional',
                  'Start date (optional)'
                )}
          </Label>
          <Input
            id="stack-schedule-start"
            type="date"
            value={start}
            onChange={(event) => edit(setStart)(event.target.value)}
          />
          {fieldError(shown('start_date'))}
        </div>
      </div>
    </div>
  );

  const today = review?.today ?? '';
  const table = review && (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {t(
              'medications.stacks.schedule.reviewCaption',
              'What the schedule does to each plan'
            )}
          </caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">
                {t('medications.stacks.schedule.col.medicine', 'Medicine')}
              </th>
              <th className="py-1 pr-2 font-medium">
                {t('medications.stacks.schedule.col.today', 'Today')}
              </th>
              <th className="py-1 pr-2 font-medium">
                {t('medications.stacks.schedule.col.new', 'New')}
              </th>
              <th className="py-1 font-medium">
                {t('medications.stacks.schedule.col.result', 'Result')}
              </th>
            </tr>
          </thead>
          <tbody>
            {review.members.map((member) => {
              const blockedText = member.blockers.length
                ? member.blockers.join(' ')
                : notFollowingText(t, member.reason, member.reason_stack_name);
              const current = member.current_timing?.length
                ? member.current_timing
                    .map((timing) => describeStackTiming(t, timing))
                    .join('; ')
                : t('medications.stacks.schedule.noPlan', 'No plan yet');
              return (
                <tr
                  key={member.medication_id}
                  className="border-b align-top last:border-0"
                >
                  <th scope="row" className="py-2 pr-2 text-left font-medium">
                    {member.name}
                  </th>
                  <td className="py-2 pr-2 text-muted-foreground">{current}</td>
                  <td className="py-2 pr-2">
                    {describeStackTiming(t, member.new_timing)}
                  </td>
                  <td className="py-2">
                    <span>
                      {reviewActionText(t, member.action, {
                        effective: formatDate(
                          effective || review.effective_from
                        ),
                        blocked: blockedText,
                      })}
                    </span>
                    {member.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-xs text-amber-700 dark:text-amber-300"
                      >
                        {warning}
                      </p>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-1">
        <Label htmlFor="stack-schedule-effective">
          {t('medications.stacks.schedule.effectiveFrom', 'Effective from')}
        </Label>
        <Input
          id="stack-schedule-effective"
          type="date"
          min={today}
          value={effective}
          disabled={busy}
          onChange={(event) => moveEffective(event.target.value)}
        />
        {effective && !effectiveValid && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              'medications.stacks.schedule.effectiveEarly',
              'Choose today or a later day.'
            )}
          </p>
        )}
      </div>
      {needAck.map((member) => (
        <div key={member.medication_id} className="flex items-start gap-2">
          <Checkbox
            id={`stack-ack-${member.medication_id}`}
            checked={acked.includes(member.medication_id)}
            onCheckedChange={(value) =>
              setAcked((old) =>
                value === true
                  ? [...old, member.medication_id]
                  : old.filter((id) => id !== member.medication_id)
              )
            }
          />
          <Label
            htmlFor={`stack-ack-${member.medication_id}`}
            className="font-normal"
          >
            {t(
              'medications.stacks.schedule.ack',
              '{{name}} has several slots; the stack schedule replaces them with one',
              { name: member.name }
            )}
          </Label>
        </div>
      ))}
      {review.skipped_member_ids.length > 0 && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="stack-leave-out"
            checked={leaveOut}
            onCheckedChange={(value) => setLeaveOut(value === true)}
          />
          <Label htmlFor="stack-leave-out" className="font-normal">
            {t(
              'medications.stacks.schedule.leaveOut',
              'Leave these out for now: {{names}}',
              { names: leftOut.map((member) => member.name).join(', ') }
            )}
          </Label>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {changing.length > 0
          ? t('medications.stacks.schedule.confirm', {
              defaultValue_one:
                'Saving rewrites the timing of {{count}} plan. Doses and titration steps stay as they are. Doses already logged and your history stay as they are.',
              defaultValue_other:
                'Saving rewrites the timing of {{count}} plans. Doses and titration steps stay as they are. Doses already logged and your history stay as they are.',
              count: changing.length,
            })
          : t(
              'medications.stacks.schedule.confirmNone',
              'No plan needs to change right now. Plans you add later will follow this schedule.'
            )}
      </p>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('medications.stacks.schedule.title', 'Stack schedule')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'medications.stacks.schedule.subtitle',
                'Applies to every plan in this stack.'
              )}
            </DialogDescription>
          </DialogHeader>
          {review ? table : form}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {existing && !review && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                >
                  {t('medications.stacks.schedule.remove', 'Remove schedule')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {review ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setReview(null);
                      setStale(false);
                      setError('');
                    }}
                  >
                    {t('medications.stacks.schedule.back', 'Back')}
                  </Button>
                  {stale && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={reviewAgain}
                    >
                      {t(
                        'medications.stacks.schedule.reviewAgain',
                        'Review again'
                      )}
                    </Button>
                  )}
                  <Button type="button" disabled={!canSave} onClick={save}>
                    {t(
                      'medications.stacks.schedule.save',
                      'Save stack schedule'
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={onClose}>
                    {t('common.cancel', 'Cancel')}
                  </Button>
                  <Button type="button" disabled={busy} onClick={next}>
                    {t('medications.stacks.schedule.review', 'Review')}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        onConfirm={remove}
        variant="destructive"
        title={t(
          'medications.stacks.schedule.removeTitle',
          'Remove the stack schedule?'
        )}
        description={t(
          'medications.stacks.schedule.removeBody',
          'Plans keep the timing they have now, and each medicine can be edited on its own again. Doses already logged and your history stay as they are.'
        )}
        confirmLabel={t(
          'medications.stacks.schedule.removeConfirm',
          'Remove schedule'
        )}
        confirmDisabled={clearMutation.isPending}
      />
    </>
  );
}
