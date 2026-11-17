import MedicationPrescriptionLink, {
  MedicationPrescriptionSummary,
} from './MedicationPrescriptionLink';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  medicationCoursePlanInputSchema,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
  addDays,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCoursePlanInput,
  type MedicationCourseReview,
  type MedicationCourseCreateInput,
  type MedicationCourseEditInput,
  type MedicationCourseReviseInput,
  type MedicationCourseHandoffCandidate,
  type TitrationStep,
} from '@workspace/shared';
import {
  useCourseHandoffRules,
  useMedicationCourseActions,
  HttpApiError,
  invalidateMedicationCourses,
  type useMedicationCourseScope,
} from '@/hooks/Medications/useMedicationCourses';
import { useMedicationTitration } from '@/hooks/useMedications';
import type { MedicationDetail } from '@/types/medications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import MedicationCourseRules from './MedicationCourseRules';
import MedicationCourseCycleDates from './MedicationCourseCycleDates';
import { formatScheduleDescription } from './medicationUtils';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationForecastDevices } from '@/hooks/Medications/useMedicationInventoryForecast';

type Mode = 'create' | 'handoff' | 'edit' | 'revise';
type Scope = ReturnType<typeof useMedicationCourseScope>;
type Attempt =
  | { kind: 'create'; body: MedicationCourseCreateInput }
  | { kind: 'edit'; body: MedicationCourseEditInput }
  | { kind: 'revise'; body: MedicationCourseReviseInput };
function initialPlan(
  med: MedicationDetail,
  today: string,
  revision?: MedicationCourseRevision
): MedicationCoursePlanInput {
  if (!revision)
    return {
      name: med.display_name || med.name,
      start_date: today,
      end_date: null,
      target_dose: null,
      dose_unit: med.dose_unit ?? '',
      dose_basis: 'per_injection',
      rules: [{ schedule_type_id: 'daily', time_of_day: null }],
      steps: [],
      notes: null,
    };
  return {
    name: revision.name,
    notes: revision.notes,
    start_date: revision.start_date,
    end_date: revision.end_date,
    cycle_anchor_date: revision.cycle_anchor_date,
    course_cycle_on_weeks: revision.course_cycle_on_weeks,
    course_cycle_off_weeks: revision.course_cycle_off_weeks,
    target_dose: revision.target_dose,
    dose_unit: revision.dose_unit,
    dose_basis: revision.dose_basis,
    rules: revision.rules.map((rule) => ({
      schedule_type_id: rule.schedule_type_id,
      time_of_day: rule.time_of_day,
      dose_amount: rule.dose_amount,
      days_of_week: rule.days_of_week,
      interval_days: rule.interval_days,
      day_of_month: rule.day_of_month,
      cycle_on_days: rule.cycle_on_days,
      cycle_off_days: rule.cycle_off_days,
      with_meal: rule.with_meal,
      prn_reason: rule.prn_reason,
      prn_max_per_day: rule.prn_max_per_day,
      start_date: rule.start_date,
      end_date: rule.end_date,
      anchor_date: rule.anchor_date,
    })),
    steps: revision.steps.map((step) => ({
      dose: step.dose,
      dose_unit: step.dose_unit,
      duration_days: step.duration_days,
      notes: step.notes,
    })),
  };
}

export default function MedicationCourseEditor({
  med,
  today,
  timezone,
  scope,
  mode: initialMode,
  course,
  revision,
  onClose,
  onRefresh,
}: {
  med: MedicationDetail;
  today: string;
  timezone: string;
  scope: Scope;
  mode: Mode;
  course?: MedicationCourse;
  revision?: MedicationCourseRevision;
  onClose: () => void;
  onRefresh: () => Promise<MedicationCourse | undefined>;
}) {
  const { t } = useTranslation();
  const actions = useMedicationCourseActions(scope);
  const preparedRoute = resolvePreparedMedicationRoute(med);
  const devicesQuery = useMedicationForecastDevices(preparedRoute !== null);
  const eligibleDevices =
    devicesQuery.data?.syringes.filter((device) =>
      isDeviceEligibleForRoute(device.device_type, preparedRoute)
    ) ?? [];
  const preferredDevice = eligibleDevices.find(
    (device) => device.id === devicesQuery.data?.default_syringe_id
  );
  const { timeFormat, formatDate } = usePreferences();
  const [onWeeks, setOnWeeks] = useState(
    revision?.course_cycle_on_weeks != null
      ? String(revision.course_cycle_on_weeks)
      : ''
  );
  const [offWeeks, setOffWeeks] = useState(
    revision?.course_cycle_off_weeks != null
      ? String(revision.course_cycle_off_weeks)
      : ''
  );
  const client = useQueryClient();
  const [mode, setMode] = useState(initialMode);
  const [draft, setDraft] = useState(() => ({
    ...initialPlan(med, today, revision),
    ...(initialMode === 'revise' ? { start_date: today } : {}),
  }));
  // Omission preserves an existing binding, including a deleted explicit device.
  const deviceSelection =
    draft.device_id !== undefined
      ? (draft.device_id ?? 'preferred')
      : revision?.device_choice === 'explicit'
        ? (revision.device_id ?? 'missing')
        : 'preferred';
  const prescriptionSelection =
    draft.prescription_id !== undefined
      ? draft.prescription_id
      : revision?.prescription_id;
  const selectedDeviceMissing =
    deviceSelection !== 'preferred' &&
    !eligibleDevices.some((device) => device.id === deviceSelection);
  const [baseVersion, setBaseVersion] = useState(course?.version ?? 0);
  const [selected, setSelected] = useState<MedicationCourseHandoffCandidate[]>(
    []
  );
  const handoffQ = useCourseHandoffRules(med.id, mode === 'handoff');
  const titrationQ = useMedicationTitration(med.id);
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [review, setReview] = useState<MedicationCourseReview | null>(null);
  const [carryAdopted, setCarryAdopted] = useState(false);
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const live = () => scope.isCurrent() && scope.canWrite;
  const locked = pending || uncertain;
  const change = (patch: Partial<MedicationCoursePlanInput>) => {
    if (locked) return;
    setDraft((old) => ({ ...old, ...patch }));
    setReview(null);
    setMessage('');
    setAck(false);
  };
  const handoff =
    mode === 'handoff'
      ? {
          cutover_day: draft.start_date,
          selected_rules: selected.map((row) => ({
            schedule_id: row.schedule_id,
            fingerprint: row.fingerprint,
          })),
        }
      : undefined;
  const parseWeeks = (raw: string) =>
    raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : NaN;
  const parsed = medicationCoursePlanInputSchema.safeParse({
    ...draft,
    course_cycle_on_weeks: parseWeeks(onWeeks),
    course_cycle_off_weeks: parseWeeks(offWeeks),
  });
  const weeksValid = (raw: string) =>
    raw === '' || (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 104);
  const cycleFieldsValid =
    weeksValid(onWeeks) &&
    weeksValid(offWeeks) &&
    (offWeeks === '' || onWeeks !== '');
  const valid =
    parsed.success &&
    cycleFieldsValid &&
    (mode !== 'handoff' || selected.length > 0);
  const refresh = async () => {
    if (!live() || locked) return;
    try {
      const latest = await onRefresh();
      if (!live()) return;
      if (revision && latest?.current_revision_id !== revision.id) {
        setStale(true);
        setReview(null);
        setMessage(
          t(
            'medications.courses.noLongerTip',
            'This revision is no longer the current tip. Close this action and refresh the course.'
          )
        );
        return;
      }
      if (latest) setBaseVersion(latest.version);
      if (mode === 'handoff') {
        const fresh = await handoffQ.refetch();
        if (!live()) return;
        if (fresh.data)
          setSelected((rows) =>
            rows
              .map((row) =>
                fresh.data!.rules.find(
                  (current) =>
                    current.schedule_id === row.schedule_id &&
                    !current.already_handed_off
                )
              )
              .filter((row): row is MedicationCourseHandoffCandidate => !!row)
          );
      }
      setReview(null);
      setStale(false);
      setMessage(
        t(
          'medications.courses.refreshed',
          'Current data refreshed. Review your retained draft again.'
        )
      );
    } catch {
      if (live())
        setMessage(
          t(
            'medications.courses.refreshError',
            'Could not refresh the course. Your draft is retained.'
          )
        );
    }
  };
  const requestReview = async () => {
    if (!live() || locked || !parsed.success || !valid) return;
    setPending(true);
    setMessage('');
    try {
      const result = await actions.review(med.id, course?.id ?? null, {
        ...parsed.data,
        expected_version: baseVersion,
        ...(handoff ? { handoff } : {}),
      });
      if (!live()) return;
      if (mode === 'revise' && !carryAdopted) {
        setCarryAdopted(true);
        if (
          JSON.stringify(result.carried_steps) !==
          JSON.stringify(parsed.data.steps)
        ) {
          setDraft((old) => ({ ...old, steps: result.carried_steps }));
          setReview(null);
          setMessage(
            t(
              'medications.courses.carryReview',
              'Remaining phases copied from this revision’s recorded doses and original schedule. Check the editable values, then review again.'
            )
          );
          return;
        }
      }
      setReview(result);
      setAck(false);
      setStale(false);
    } catch (error) {
      if (live()) {
        setReview(null);
        setStale(error instanceof HttpApiError && error.status === 409);
        setMessage(
          error instanceof HttpApiError
            ? error.message
            : t(
                'medications.courses.reviewError',
                'Could not review this plan. Your draft is retained.'
              )
        );
      }
    } finally {
      setPending(false);
    }
  };
  const confirm = async () => {
    if (
      !live() ||
      pending ||
      !review ||
      (!uncertain && ((mode === 'handoff' && !ack) || stale))
    )
      return;
    if (!attempt.current) {
      const operation_id = crypto.randomUUID();
      const common = {
        ...review.plan,
        operation_id,
        expected_version: review.expected_version,
      };
      attempt.current =
        mode === 'create' || mode === 'handoff'
          ? {
              kind: 'create',
              body: {
                ...common,
                medication_id: med.id,
                native_reminder_limitation_acknowledged:
                  mode === 'handoff' && ack,
                review_fingerprint: review.review_fingerprint,
                ...(handoff ? { handoff } : {}),
              },
            }
          : mode === 'revise'
            ? {
                kind: 'revise',
                body: {
                  ...common,
                  review_fingerprint: review.review_fingerprint,
                },
              }
            : { kind: 'edit', body: common };
    }
    const pinned = attempt.current;
    setPending(true);
    setMessage('');
    try {
      if (pinned.kind === 'create') await actions.create(pinned.body);
      else if (pinned.kind === 'revise')
        await actions.revise(course!.id, pinned.body);
      else await actions.edit(course!.id, pinned.body);
      if (!live()) return;
      invalidateMedicationCourses(client);
      onClose();
    } catch (error) {
      if (live()) {
        const known =
          error instanceof HttpApiError &&
          [400, 404, 409, 422].includes(error.status);
        if (!known || uncertain) {
          setUncertain(true);
          setMessage(
            t(
              'medications.courses.uncertain',
              'The result is not confirmed. Retry this same operation before changing or closing the plan.'
            )
          );
        } else {
          attempt.current = null;
          setReview(null);
          setAck(false);
          setStale(error.status === 409);
          setMessage(error.message);
          invalidateMedicationCourses(client);
        }
      }
    } finally {
      setPending(false);
    }
  };
  const copyLegacySteps = (steps: TitrationStep[]) =>
    change({
      steps: steps
        .filter((step) => selectedSteps.includes(step.id))
        .map((step) => ({
          dose: String(step.dose_mg),
          dose_unit: step.dose_unit,
          duration_days:
            step.planned_weeks == null ? null : step.planned_weeks * 7,
          notes: step.note,
        })),
    });
  const materialBlocked = mode === 'edit' && review?.requires_revision;
  const heading =
    mode === 'revise'
      ? t('medications.courses.revise', 'Revise course')
      : mode === 'edit'
        ? t('medications.courses.edit', 'Edit current course')
        : t('medications.courses.create', 'Create course');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        {message && (
          <p
            role="status"
            className="rounded-md border bg-muted/20 p-3 text-sm text-foreground"
          >
            {message}
          </p>
        )}
        {stale && (
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => void refresh()}
          >
            {t('medications.courses.refresh', 'Refresh current data')}
          </Button>
        )}
        {!review ? (
          <fieldset disabled={locked} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('medications.courses.zone', 'Plan timezone')}:{' '}
              {course?.timezone ?? timezone}
            </p>
            {mode === 'handoff' && (
              <div className="space-y-2 rounded-md border p-3">
                <h4 className="font-medium">
                  {t(
                    'medications.courses.selectLegacy',
                    'Select legacy schedule rules'
                  )}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.courses.handoffHint',
                    'Only selected rules end before the cutover day. Unselected rules continue. Existing logs remain legacy and unassigned.'
                  )}
                </p>
                {handoffQ.isLoading && <p>{t('common.loading', 'Loading…')}</p>}
                {handoffQ.isError && (
                  <p>
                    {t(
                      'medications.courses.rulesLoadError',
                      'Could not load legacy rules. Refresh to try again.'
                    )}
                  </p>
                )}
                {(handoffQ.data?.rules ?? []).map((row) => (
                  <label
                    key={row.schedule_id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      disabled={row.already_handed_off}
                      checked={selected.some(
                        (selected) => selected.schedule_id === row.schedule_id
                      )}
                      onChange={(event) => {
                        if (locked) return;
                        setSelected((rows) =>
                          event.target.checked
                            ? [...rows, row]
                            : rows.filter(
                                (selected) =>
                                  selected.schedule_id !== row.schedule_id
                              )
                        );
                        setReview(null);
                      }}
                    />
                    {formatScheduleDescription(
                      (
                        selected.find(
                          (selected) => selected.schedule_id === row.schedule_id
                        ) ?? row
                      ).rule,
                      timeFormat
                    )}
                    {row.already_handed_off &&
                      t(
                        'medications.courses.alreadyHandedOff',
                        ' (already handed off)'
                      )}
                  </label>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selected.length}
                  onClick={() =>
                    change({ rules: selected.map((row) => ({ ...row.rule })) })
                  }
                >
                  {t(
                    'medications.courses.copySelectedRules',
                    'Copy selected rules into this course'
                  )}
                </Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="course-name">
                  {t('medications.courses.name', 'Course name')}
                </Label>
                <Input
                  id="course-name"
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-start">
                  {mode === 'handoff'
                    ? t('medications.courses.cutover', 'Cutover day')
                    : t('medications.courses.start', 'Start date')}
                </Label>
                <Input
                  id="course-start"
                  type="date"
                  min={
                    mode === 'revise' && revision
                      ? addDays(revision.start_date, 1)
                      : undefined
                  }
                  value={draft.start_date}
                  onChange={(event) =>
                    change({ start_date: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-end">
                  {t('medications.courses.end', 'End date (optional)')}
                </Label>
                <Input
                  id="course-end"
                  type="date"
                  value={draft.end_date ?? ''}
                  onChange={(event) =>
                    change({ end_date: event.target.value || null })
                  }
                />
                {mode === 'revise' && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'medications.courses.inheritEnd',
                      'Blank keeps the previous end date.'
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-anchor">
                  {t(
                    'medications.courses.cycleAnchor',
                    'Schedule cycle anchor (optional)'
                  )}
                </Label>
                <Input
                  id="course-anchor"
                  type="date"
                  value={draft.cycle_anchor_date ?? ''}
                  onChange={(event) =>
                    change({ cycle_anchor_date: event.target.value || null })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-target">
                  {t('medications.courses.target', 'Planned amount (optional)')}
                </Label>
                <Input
                  id="course-target"
                  inputMode="decimal"
                  value={draft.target_dose ?? ''}
                  onChange={(event) =>
                    change({ target_dose: event.target.value || null })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="course-unit">
                  {t('medications.courses.unit', 'Dose unit')}
                </Label>
                <Input
                  id="course-unit"
                  value={draft.dose_unit}
                  onChange={(event) =>
                    change({ dose_unit: event.target.value })
                  }
                />
              </div>
            </div>
            <Label>{t('medications.courses.basis', 'Dose basis')}</Label>
            <Select
              value={draft.dose_basis}
              onValueChange={(value) =>
                change({
                  dose_basis: value as MedicationCoursePlanInput['dose_basis'],
                })
              }
            >
              <SelectTrigger
                aria-label={t('medications.courses.basis', 'Dose basis')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_injection">
                  {t('medications.courses.perDose', 'Per administration')}
                </SelectItem>
                <SelectItem value="per_week">
                  {t('medications.courses.perWeek', 'Per week')}
                </SelectItem>
              </SelectContent>
            </Select>
            <MedicationPrescriptionLink
              medication={med}
              value={prescriptionSelection}
              onChange={(id) => change({ prescription_id: id })}
              disabled={locked}
            />
            {preparedRoute && (
              <div className="space-y-2">
                <Label htmlFor="course-device">
                  {t(
                    'medications.forecasts.planDevice',
                    'Forecast device (optional)'
                  )}
                </Label>
                <Select
                  value={deviceSelection}
                  onValueChange={(value) =>
                    change({ device_id: value === 'preferred' ? null : value })
                  }
                >
                  <SelectTrigger id="course-device">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preferred">
                      {t(
                        'medications.forecasts.usePreferred',
                        'Use saved preferred device'
                      )}
                      {preferredDevice ? ` · ${preferredDevice.name}` : ''}
                    </SelectItem>
                    {selectedDeviceMissing && (
                      <SelectItem value={deviceSelection} disabled>
                        {t(
                          'medications.forecasts.missingSelectedDevice',
                          'Missing saved device — selection retained'
                        )}
                      </SelectItem>
                    )}
                    {eligibleDevices.map((device) => (
                      <SelectItem key={device.id} value={device.id}>
                        {device.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'medications.forecasts.planDeviceHelp',
                    'Forecasts use this real device, or a compatible saved preferred device. This does not change recorded doses or select a device for actual logging.'
                  )}
                </p>
                {devicesQuery.isError && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t(
                      'medications.forecasts.devicesError',
                      'Could not load devices. Your existing selection is retained.'
                    )}
                  </p>
                )}
              </div>
            )}
            <MedicationCourseRules
              rules={draft.rules}
              disabled={locked}
              onChange={(rules) => change({ rules })}
            />
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="font-medium">
                {t(
                  'medications.courseCycles.planTitle',
                  'Weekly cycle plan (optional)'
                )}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="course-cycle-on-weeks">
                    {t('medications.courseCycles.onWeeks', 'Run for (weeks)')}
                  </Label>
                  <Input
                    id="course-cycle-on-weeks"
                    inputMode="numeric"
                    value={onWeeks}
                    aria-invalid={!cycleFieldsValid}
                    onChange={(event) => {
                      if (!locked) {
                        setOnWeeks(event.target.value);
                        change({});
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="course-cycle-off-weeks">
                    {t(
                      'medications.courseCycles.offWeeks',
                      'Then break (weeks)'
                    )}
                  </Label>
                  <Input
                    id="course-cycle-off-weeks"
                    inputMode="numeric"
                    value={offWeeks}
                    aria-invalid={!cycleFieldsValid}
                    onChange={(event) => {
                      if (!locked) {
                        setOffWeeks(event.target.value);
                        change({});
                      }
                    }}
                  />
                </div>
              </div>
              {!cycleFieldsValid && (
                <p
                  role="status"
                  className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-foreground"
                >
                  {t(
                    'medications.courseCycles.invalidWeeks',
                    'Use whole weeks from 1 to 104. Enter Run for before adding a break, or leave both fields blank.'
                  )}
                </p>
              )}
              {revision?.course_cycle_anchor_date && (
                <p className="text-sm">
                  {t(
                    'medications.courseCycles.anchor',
                    'Recorded weekly cycle anchor'
                  )}
                  : {formatDate(revision.course_cycle_anchor_date)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.courseCycles.advisory',
                  'Cycle dates are planned only. Saving them does not stop scheduled doses or start another cycle. Use the reviewed End cycle or Start next cycle actions explicitly.'
                )}
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">
                {t('medications.courses.phases', 'Authored phases (optional)')}
              </h4>
              {draft.steps.map((step, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
                >
                  <Input
                    aria-label={t(
                      'medications.courses.phaseDose',
                      'Phase {{number}} dose',
                      { number: index + 1 }
                    )}
                    inputMode="decimal"
                    value={step.dose}
                    onChange={(event) =>
                      change({
                        steps: draft.steps.map((row, i) =>
                          i === index
                            ? { ...row, dose: event.target.value }
                            : row
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={t(
                      'medications.courses.phaseUnit',
                      'Phase {{number}} unit',
                      { number: index + 1 }
                    )}
                    value={step.dose_unit}
                    onChange={(event) =>
                      change({
                        steps: draft.steps.map((row, i) =>
                          i === index
                            ? { ...row, dose_unit: event.target.value }
                            : row
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={t(
                      'medications.courses.phaseDays',
                      'Phase {{number}} duration in days (blank is open-ended)',
                      { number: index + 1 }
                    )}
                    type="number"
                    min="0"
                    step="1"
                    value={step.duration_days ?? ''}
                    onChange={(event) =>
                      change({
                        steps: draft.steps.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                duration_days:
                                  event.target.value === ''
                                    ? null
                                    : Number(event.target.value),
                              }
                            : row
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={t(
                      'medications.courses.phaseNotes',
                      'Phase {{number}} notes',
                      { number: index + 1 }
                    )}
                    value={step.notes ?? ''}
                    onChange={(event) =>
                      change({
                        steps: draft.steps.map((row, i) =>
                          i === index
                            ? { ...row, notes: event.target.value || null }
                            : row
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      change({
                        steps: draft.steps.filter((_, i) => i !== index),
                      })
                    }
                  >
                    {t('medications.courses.removePhase', 'Remove phase')}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  change({
                    steps: [
                      ...draft.steps,
                      {
                        dose: '',
                        dose_unit: draft.dose_unit,
                        duration_days: null,
                        notes: null,
                      },
                    ],
                  })
                }
              >
                {t('medications.courses.addPhase', 'Add phase')}
              </Button>
            </div>
            {(mode === 'create' || mode === 'handoff') &&
              (titrationQ.data?.length ?? 0) > 0 && (
                <details className="rounded-md border p-3">
                  <summary>
                    {t(
                      'medications.courses.copyLegacyPhases',
                      'Copy selected legacy titration values'
                    )}
                  </summary>
                  <p className="my-2 text-sm text-muted-foreground">
                    {t(
                      'medications.courses.copyLegacyHint',
                      'Copies only selected authored dose, unit and duration values for review. Active/done states and old logged history are not transferred.'
                    )}
                  </p>
                  {titrationQ.data!.map((step) => (
                    <label key={step.id} className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedSteps.includes(step.id)}
                        onChange={(event) =>
                          setSelectedSteps((rows) =>
                            event.target.checked
                              ? [...rows, step.id]
                              : rows.filter((id) => id !== step.id)
                          )
                        }
                      />
                      {step.dose_mg} {step.dose_unit} ·{' '}
                      {step.planned_weeks ?? '—'}{' '}
                      {t('medications.courses.weeks', 'weeks')}
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedSteps.length}
                    onClick={() => copyLegacySteps(titrationQ.data!)}
                  >
                    {t(
                      'medications.courses.copyValues',
                      'Copy selected values for review'
                    )}
                  </Button>
                </details>
              )}
            <Label htmlFor="course-notes">{t('common.notes', 'Notes')}</Label>
            <Input
              id="course-notes"
              value={draft.notes ?? ''}
              onChange={(event) =>
                change({ notes: event.target.value || null })
              }
            />
            {draft.start_date < today && (
              <p className="rounded-md border bg-muted/20 p-3 text-sm">
                {t(
                  'medications.courses.backdated',
                  'This plan starts before the new tracking baseline. Earlier managed adherence is unavailable; existing logs remain unassigned.'
                )}
              </p>
            )}
            {!parsed.success && (
              <p role="status" className="text-sm">
                {parsed.error.issues[0]?.message}
              </p>
            )}
          </fieldset>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              {t('medications.courses.zone', 'Plan timezone')}:{' '}
              {review.timezone}
            </p>
            {preparedRoute && (
              <p className="break-words">
                {t('medications.forecasts.deviceBasis', 'Device basis')}:{' '}
                {review.device_binding.device_name ??
                  t(
                    'medications.forecasts.missingDevice',
                    'No usable saved device'
                  )}{' '}
                ·{' '}
                {t(
                  `medications.forecasts.deviceSource.${review.device_binding.source}`,
                  {
                    plan: 'Selected for the plan',
                    preferred: 'Saved preferred device',
                    missing: 'Missing device selection',
                    incompatible: 'Incompatible device selection',
                  }[review.device_binding.source]
                )}
              </p>
            )}
            <h4 className="font-semibold">
              {t('medications.courses.review', 'Review changes')}
            </h4>
            <MedicationPrescriptionSummary
              medicationId={med.id}
              prescriptionId={
                review.plan.prescription_id !== undefined
                  ? review.plan.prescription_id
                  : (revision?.prescription_id ??
                    (mode === 'create' || mode === 'handoff'
                      ? null
                      : undefined))
              }
            />
            <p>
              {review.plan.name} · {review.plan.start_date} →{' '}
              {review.plan.end_date ?? '—'}
            </p>
            <p>
              {review.plan.target_dose ?? '—'} {review.plan.dose_unit} ·{' '}
              {review.plan.dose_basis === 'per_week'
                ? t('medications.courses.perWeek', 'Per week')
                : t('medications.courses.perDose', 'Per administration')}
            </p>
            {review.plan.rules.map((rule, index) => (
              <p key={index}>
                {formatScheduleDescription(rule, timeFormat)}
                {rule.dose_amount
                  ? ` · ${rule.dose_amount} ${review.plan.dose_unit}`
                  : ''}
                {rule.schedule_type_id === 'cyclic' && (
                  <span className="block text-muted-foreground">
                    {t(
                      'medications.courses.effectiveCycleDate',
                      'Effective cycle date'
                    )}
                    :{' '}
                    {formatDate(
                      review.plan.cycle_anchor_date ??
                        rule.anchor_date ??
                        rule.start_date ??
                        review.plan.start_date
                    )}
                  </span>
                )}
              </p>
            ))}
            {review.plan.course_cycle_on_weeks != null && (
              <div className="space-y-1 rounded-md border p-3">
                <p>
                  {t(
                    'medications.courseCycles.onSummary',
                    'Run for {{weeks}} weeks',
                    { weeks: review.plan.course_cycle_on_weeks }
                  )}
                  {review.plan.course_cycle_off_weeks != null
                    ? ` · ${t('medications.courseCycles.offSummary', 'Then break {{weeks}} weeks', { weeks: review.plan.course_cycle_off_weeks })}`
                    : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'medications.courseCycles.advisory',
                    'Cycle dates are planned only. Saving them does not stop scheduled doses or start another cycle. Use the reviewed End cycle or Start next cycle actions explicitly.'
                  )}
                </p>
              </div>
            )}
            {review.cycle_plan_preview && (
              <MedicationCourseCycleDates dates={review.cycle_plan_preview} />
            )}
            {review.plan.steps.map((step, index) => (
              <p key={index}>
                {t('medications.courses.phaseNumber', 'Phase {{number}}', {
                  number: index + 1,
                })}
                : {step.dose} {step.dose_unit} ·{' '}
                {step.duration_days ??
                  t('medications.courses.openEnded', 'open-ended')}{' '}
                {step.duration_days == null
                  ? ''
                  : t('medications.courses.days', 'days')}
              </p>
            ))}
            {handoff && (
              <p className="rounded-md border p-3">
                {t(
                  'medications.courses.handoffReview',
                  '{{count}} selected legacy rules end before {{day}}; this course begins {{day}}. Unselected rules continue. Old logs remain legacy and unassigned.',
                  { count: selected.length, day: handoff.cutover_day }
                )}
              </p>
            )}
            {review.material_changes.length > 0 && (
              <p>
                {t('medications.courses.changedFields', 'Changed fields')}:{' '}
                {review.material_changes
                  .map((field) =>
                    t(
                      `medications.courses.changed.${field}`,
                      (
                        {
                          schedule: 'Schedule rules',
                          dose_basis: 'Dose basis',
                          start_date: 'Start date',
                          steps: 'Phase order or duration',
                        } as Record<string, string>
                      )[field] ?? field
                    )
                  )
                  .join(', ')}
              </p>
            )}
            {review.resumed_dose && (
              <p>
                {t('medications.courses.resumedDose', 'Proposed resumed dose')}:{' '}
                {review.resumed_dose} {review.resumed_dose_unit ?? '—'}
              </p>
            )}
            {mode === 'revise' && (
              <p>
                {review.phase_progress_known
                  ? t(
                      'medications.courses.phaseKnown',
                      'The phase-carry proposal uses this revision’s recorded doses and original schedule.'
                    )
                  : t(
                      'medications.courses.phaseUnknown',
                      'Phase progress is unknown. No progress was inferred; review the authored phases.'
                    )}
              </p>
            )}
            {mode === 'revise' &&
              JSON.stringify(review.carried_steps) !==
                JSON.stringify(review.plan.steps) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    setDraft((old) => ({
                      ...old,
                      steps: review.carried_steps,
                    }));
                    setReview(null);
                    setAck(false);
                    setMessage(
                      t(
                        'medications.courses.carryReview',
                        'Remaining phases copied from this revision’s recorded doses and original schedule. Check the editable values, then review again.'
                      )
                    );
                  }}
                >
                  {t(
                    'medications.courses.useCarry',
                    'Use this remaining-phase proposal and review again'
                  )}
                </Button>
              )}
            {review.warnings.map((warning, index) => (
              <p key={index} className="rounded-md border bg-muted/20 p-3">
                {warning}
              </p>
            ))}
            {materialBlocked ? (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <p>
                  {t(
                    'medications.courses.materialReview',
                    'These changes require a new revision; recorded doses stay with the old revision.'
                  )}
                </p>
                {revision?.status === 'active' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMode('revise');
                      setDraft({ ...review.plan, start_date: today });
                      setReview(null);
                      setCarryAdopted(false);
                      setAck(false);
                    }}
                  >
                    {t('medications.courses.revise', 'Revise course')}
                  </Button>
                ) : (
                  <p>
                    {t(
                      'medications.courses.resumeFirst',
                      'Resume or reopen the current tip explicitly before revising these fields.'
                    )}
                  </p>
                )}
              </div>
            ) : mode === 'handoff' ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={ack}
                  onChange={(event) => setAck(event.target.checked)}
                />
                {t(
                  'medications.courses.nativeAck',
                  'Versioned plans appear in the website checklist. The existing native mobile app will not schedule reminders for them until updated.'
                )}
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.courses.nativeAck',
                  'Versioned plans appear in the website checklist. The existing native mobile app will not schedule reminders for them until updated.'
                )}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={onClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          {review ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => {
                  setReview(null);
                  setAck(false);
                }}
              >
                {t('common.back', 'Back')}
              </Button>
              <Button
                type="button"
                disabled={
                  pending ||
                  (!uncertain &&
                    ((mode === 'handoff' && !ack) ||
                      !!materialBlocked ||
                      stale))
                }
                onClick={() => void confirm()}
              >
                {pending
                  ? t('common.saving', 'Saving…')
                  : uncertain
                    ? t('medications.courses.retrySame', 'Retry same operation')
                    : t('medications.courses.confirm', 'Confirm course')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={locked || !valid || stale}
              onClick={() => void requestReview()}
            >
              {pending
                ? t('common.loading', 'Loading…')
                : t('medications.courses.review', 'Review changes')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
