import { useState, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localDateTimeToUtc,
  utcToLocalDateTimeInput,
  INJECTION_SITES,
  type MedicationLogWeekActual,
  medicationWeekOffSchedule,
  type MedicationLogWeekPlannedSlot,
  todayInZone,
  type MedSubtype,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import { useSleepEntriesQuery } from '@/hooks/CheckIn/useSleep';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { formatTimeInZone } from '@/utils/timeFormatters';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useMedicationLogWeek,
  useMedicationCalendarInjection,
} from '@/hooks/Medications/useMedicationLogWeek';
import {
  useUpdateMedicationEntryMutation,
  useUpdateInjectionEntryMutation,
  useDeleteMedicationEntryMutation,
  useDeleteInjectionEntryMutation,
} from '@/hooks/useMedications';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimeInput } from '@/components/ui/TimeInput';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import Glp1RecentInjections from './Glp1RecentInjections';
import MedicationAddDoseForDay from './MedicationAddDoseForDay';
import MedicationDailyLog from './MedicationDailyLog';
import MedicationDayWearable from './MedicationDayWearable';
import { wearableSleepForDay } from './medicationWearableFigures';

type Result = ReturnType<typeof useMedicationLogWeek>;
type Scope = Result['scope'];
function MetadataEditor({
  actual,
  scope,
  onClose,
  allowed,
}: {
  actual: MedicationLogWeekActual;
  scope: Scope;
  allowed: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = allowed;
    return () => {
      live.current = false;
    };
  }, [allowed]);
  const { timezone } = usePreferences();
  const [zone] = useState(timezone);
  const [initialTime] = useState(
    actual.occurred_at ? utcToLocalDateTimeInput(actual.occurred_at, zone) : ''
  );
  const [time, setTime] = useState(initialTime);
  const [notes, setNotes] = useState(actual.notes ?? '');
  const [site, setSite] = useState(actual.site ?? 'none');
  const entry = useUpdateMedicationEntryMutation();
  const injection = useUpdateInjectionEntryMutation();
  const mutation = actual.source_kind === 'injection' ? injection : entry;
  const validTime =
    !time ||
    Number.isFinite(new Date(localDateTimeToUtc(time, zone)).getTime());
  const save = () => {
    if (
      !live.current ||
      !allowed ||
      !scope.isCurrent() ||
      mutation.isPending ||
      !validTime
    )
      return;
    const temporal =
      time && time !== initialTime
        ? {
            entry_date: time.slice(0, 10),
            [actual.source_kind === 'injection' ? 'injected_at' : 'taken_at']:
              localDateTimeToUtc(time, zone).toISOString(),
          }
        : {};
    const body = {
      notes: notes.trim() || null,
      ...temporal,
      ...(actual.source_kind === 'injection' &&
      actual.administration_route !== 'nasal' &&
      site !== (actual.site ?? 'none')
        ? { site: site === 'none' ? null : site }
        : {}),
    };
    mutation.mutate(
      { id: actual.id, body },
      {
        onSuccess: () => {
          if (live.current && scope.isCurrent()) onClose();
        },
      }
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('medications.week.edit', 'Edit recorded dose')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'medications.week.metadataOnly',
              'Change the recorded date, time or notes. The recorded quantity and stock association are unchanged.'
            )}
          </DialogDescription>
        </DialogHeader>
        <p>
          {actual.medication_name ??
            t('medications.week.unknownItem', 'Unknown recorded medication')}
        </p>
        <Label htmlFor="calendar-actual-time">
          {t('medications.week.actualTime', 'Actual date & time')} ({zone})
        </Label>
        <DateTimeInput
          id="calendar-actual-time"
          value={time}
          onChange={setTime}
        />
        {actual.source_kind === 'injection' &&
          actual.administration_route !== 'nasal' && (
            <>
              <Label htmlFor="calendar-actual-site">
                {t('medications.glp1.injectionSite', 'Injection site')}
              </Label>
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger id="calendar-actual-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {INJECTION_SITES.map((item) => (
                    <SelectItem value={item.id} key={item.id}>
                      {t('medications.sites.label.' + item.id, item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        <Label htmlFor="calendar-actual-notes">
          {t('medications.glp1.notes', 'Notes')}
        </Label>
        <Input
          id="calendar-actual-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {mutation.isError && (
          <p role="alert">
            {t(
              'medications.week.saveError',
              'Could not save this recorded dose. Refresh and try again.'
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={
              !allowed || mutation.isPending || !validTime || !scope.isCurrent()
            }
            onClick={save}
          >
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function InjectionEditor({
  actual,
  medications,
  scope,
  onClose,
  allowed,
}: {
  actual: MedicationLogWeekActual;
  medications: Medication[];
  scope: Scope;
  allowed: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const result = useMedicationCalendarInjection(actual.id, true);
  const record = result.data;
  const med = record?.medication_id
    ? medications.find((item) => item.id === record.medication_id)
    : undefined;
  const legacyDose = record?.dose_mg == null ? null : Number(record.dose_mg);
  if (
    record &&
    med &&
    record.medication_id &&
    record.injected_at &&
    (legacyDose === null || Number.isFinite(legacyDose))
  )
    return (
      <Glp1RecentInjections
        key={record.id}
        med={med}
        initialInjection={{
          ...record,
          dose_mg: legacyDose,
          administration_route:
            record.administration_route === 'injection' ||
            record.administration_route === 'nasal'
              ? record.administration_route
              : null,
          medication_id: record.medication_id,
          injected_at: record.injected_at,
        }}
        editorOnly
        canEdit={allowed && scope.isCurrent()}
        onEditorClose={onClose}
      />
    );
  if (record)
    return (
      <MetadataEditor
        actual={{
          ...actual,
          occurred_at: record.injected_at,
          entry_date: record.entry_date,
          notes: record.notes,
          site: record.site,
          administration_route: record.administration_route ?? null,
        }}
        scope={scope}
        allowed={allowed}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('medications.week.edit', 'Edit recorded dose')}
          </DialogTitle>
        </DialogHeader>
        <p role="status">
          {result.query.isError
            ? t(
                'medications.week.editLoadError',
                'This exact recorded dose could not be loaded. Close and refresh before editing.'
              )
            : t('common.loading', 'Loading…')}
        </p>
        <Button variant="outline" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
export default function MedicationCalendarDayDetail({
  day,
  medicationId,
  result,
  medications,
  subtype,
  onClose,
  onRestoreFocus,
  onSelectDate,
}: {
  day: string;
  medicationId?: string;
  result: Result;
  medications: Medication[];
  subtype: MedSubtype;
  onClose: () => void;
  onRestoreFocus?: () => void;
  onSelectDate: (day: string) => void;
}) {
  const { t } = useTranslation();
  const { formatDate, timeFormat, timezone: calendarZone } = usePreferences();
  const { hasWritePermission } = useActiveUser();
  // The watch block is for days that have happened. It reads the same sleep
  // query as the daily log, so the night is fetched once and shown once.
  const showWearable = day <= todayInZone(calendarZone);
  const wearableSleep = useSleepEntriesQuery(day, day);
  const hideLogSleep =
    showWearable && wearableSleepForDay(wearableSleep.data, day) !== null;
  const [action, setAction] = useState<{
    kind: 'edit' | 'delete';
    actual: MedicationLogWeekActual;
  } | null>(null);
  const deleteEntry = useDeleteMedicationEntryMutation();
  const deleteInjection = useDeleteInjectionEntryMutation();
  const data = result.data;
  const scope = result.scope;
  if (!scope.ready || !scope.isCurrent()) return null;
  const lanes =
    data?.lanes.filter(
      (lane) =>
        subtype === 'all' ||
        (subtype === 'supplements'
          ? lane.is_supplement === true
          : lane.is_supplement === false)
    ) ?? [];
  const laneIds = new Set(
    lanes
      .filter((lane) => !medicationId || lane.medication_id === medicationId)
      .map((lane) => lane.id)
  );
  const actuals =
    data?.actuals.filter(
      (actual) => actual.entry_date === day && laneIds.has(actual.lane_id)
    ) ?? [];
  const planned =
    data?.planned_slots.filter(
      (slot) => slot.scheduled_day === day && laneIds.has(slot.lane_id)
    ) ?? [];
  const dose = (amount: string | null, unit: string | null) =>
    amount === null
      ? t('medications.week.doseUnknown', 'Dose unknown')
      : `${amount} ${unit ?? t('medications.week.unitUnknown', '(unit unknown)')}`;
  const hasWrite = (actual: MedicationLogWeekActual) =>
    scope.isCurrent() &&
    (hasWritePermission('can_manage_medications') ||
      (lanes.find((lane) => lane.id === actual.lane_id)?.is_supplement ===
        true &&
        hasWritePermission('diary')));
  const canWrite = (actual: MedicationLogWeekActual) =>
    !result.query.isFetching && hasWrite(actual);
  if (action && !hasWrite(action.actual)) setAction(null);
  const plannedRow = (slot: MedicationLogWeekPlannedSlot) => {
    const fulfilled = data?.fulfilled_slots.find(
      (match) => match.planned_id === slot.id
    )?.actual;
    return (
      <li key={slot.id} className="rounded border border-dashed p-3 text-sm">
        <p className="font-medium">
          {lanes.find((lane) => lane.id === slot.lane_id)?.name ||
            t('medications.week.unknownItem', 'Unknown recorded medication')}
        </p>
        <p>
          {slot.time_of_day ?? t('medications.week.timeNotSet', 'Time not set')}{' '}
          ({slot.timezone}) · {dose(slot.dose_amount, slot.dose_unit)} ·{' '}
          {t(`medications.week.status.${slot.status}`, slot.status)}
        </p>
        {fulfilled && (
          <p>
            {t(
              'medications.week.recordedOtherDay',
              'Planned slot; recorded {{status}}: {{amount}} on {{date}}',
              {
                status: t(
                  `medications.week.status.${fulfilled.status}`,
                  fulfilled.status
                ),
                amount: dose(fulfilled.dose_amount, fulfilled.dose_unit),
                date: formatDate(fulfilled.entry_date),
              }
            )}
            {fulfilled.entry_date !== day && (
              <Button
                variant="link"
                size="sm"
                onClick={() => onSelectDate(fulfilled.entry_date)}
              >
                {t('medications.week.viewActualDate', 'View recorded date')}
              </Button>
            )}
          </p>
        )}
      </li>
    );
  };
  const deleting = action?.kind === 'delete';
  const mutation =
    action?.actual.source_kind === 'injection' ? deleteInjection : deleteEntry;
  return (
    <>
      <Dialog
        open={!action}
        onOpenChange={(open) => {
          if (!open && !action) onClose();
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!action) onRestoreFocus?.();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t('medications.week.dayDetail', 'Day detail')} ·{' '}
              {formatDate(day)}
            </DialogTitle>
            <DialogDescription>
              {t(
                'medications.week.detailHelp',
                'Planned rows are read-only. Recorded doses retain their actual dates and quantities.'
              )}
            </DialogDescription>
          </DialogHeader>
          {result.query.isLoading && (
            <p role="status">{t('common.loading', 'Loading…')}</p>
          )}
          {result.query.isError && (
            <p role="alert">
              {t('medications.week.error', 'Could not load the dose calendar.')}
            </p>
          )}
          {data && !result.query.isError && (
            <>
              <h3 className="font-semibold">
                {t('medications.week.planned', 'Planned')}
              </h3>
              <ul className="space-y-2">{planned.map(plannedRow)}</ul>
              <h3 className="font-semibold">
                {t('medications.week.actuals', 'Recorded doses')}
              </h3>
              <ul className="space-y-2">
                {actuals.map((actual) => {
                  const off = medicationWeekOffSchedule(data, actual);
                  return (
                    <li key={actual.key} className="rounded border p-3 text-sm">
                      <p className="font-medium">
                        {actual.medication_name ||
                          t(
                            'medications.week.unknownItem',
                            'Unknown recorded medication'
                          )}
                      </p>
                      <p>
                        {dose(actual.dose_amount, actual.dose_unit)} ·{' '}
                        {t(
                          `medications.week.status.${actual.status}`,
                          actual.status
                        )}
                      </p>
                      <p>
                        {actual.occurred_at
                          ? `${formatTimeInZone(actual.occurred_at, { kind: 'tz', tz: data.timezone }, timeFormat)} (${data.timezone})`
                          : t('medications.week.timeUnknown', 'Time unknown')}
                      </p>
                      {off && (
                        <p className="text-amber-800 dark:text-amber-300">
                          {off.credited_to
                            ? t(
                                'medications.week.offScheduleCredited',
                                'Off schedule: counted toward the dose planned for {{date}}',
                                {
                                  date: formatDate(
                                    off.credited_to.scheduled_day
                                  ),
                                }
                              )
                            : t(
                                'medications.week.offScheduleExtra',
                                'Off schedule: no dose was planned for this'
                              )}
                        </p>
                      )}
                      {actual.notes && (
                        <p className="break-words">{actual.notes}</p>
                      )}
                      {canWrite(actual) && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAction({ kind: 'edit', actual })}
                          >
                            {t('common.edit', 'Edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAction({ kind: 'delete', actual })
                            }
                          >
                            {t('common.delete', 'Delete')}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!planned.length && !actuals.length && (
                <p>{t('medications.week.noDoses', 'No doses on this date.')}</p>
              )}
              {(hasWritePermission('can_manage_medications') ||
                hasWritePermission('diary')) &&
                day <= data.today && (
                  <MedicationAddDoseForDay
                    day={day}
                    medicationId={medicationId}
                    medications={medications.filter(
                      (med) =>
                        subtype === 'all' ||
                        (subtype === 'supplements'
                          ? med.is_supplement
                          : !med.is_supplement)
                    )}
                  />
                )}
            </>
          )}
          {showWearable && <MedicationDayWearable day={day} />}
          <div className="border-t pt-3">
            <MedicationDailyLog date={day} hideSleep={hideLogSleep} />
          </div>
          <Button variant="outline" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
        </DialogContent>
      </Dialog>
      {action?.kind === 'edit' &&
        (action.actual.source_kind === 'injection' ? (
          <InjectionEditor
            actual={action.actual}
            medications={medications}
            scope={scope}
            allowed={hasWrite(action.actual)}
            onClose={() => setAction(null)}
          />
        ) : (
          <MetadataEditor
            actual={action.actual}
            scope={scope}
            allowed={hasWrite(action.actual)}
            onClose={() => setAction(null)}
          />
        ))}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !mutation.isPending) setAction(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('medications.week.deleteTitle', 'Delete recorded dose?')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'medications.week.deleteHelp',
                  'This deletes the selected recorded dose. Any deducted stock is restored through the existing reconciliation flow.'
                )}
              </DialogDescription>
            </DialogHeader>
            {mutation.isError && (
              <p role="alert">
                {t(
                  'medications.week.deleteError',
                  'Could not delete this dose. Refresh and try again.'
                )}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setAction(null)}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                disabled={mutation.isPending || !canWrite(action.actual)}
                onClick={() => {
                  if (!canWrite(action.actual)) return;
                  mutation.mutate(action.actual.id, {
                    onSuccess: () => {
                      if (scope.isCurrent()) setAction(null);
                    },
                  });
                }}
              >
                {t('common.confirm', 'Confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
