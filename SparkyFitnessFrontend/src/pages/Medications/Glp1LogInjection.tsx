import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Syringe } from 'lucide-react';
import {
  INJECTION_SITES,
  localDateTimeToUtc,
  utcToLocalDateTimeInput,
  medicationDoseInMg,
  medicationCourseDoseSchema,
  type MedicationCourseAttributionInput,
  type CalculatedDrawInput,
  positiveDeviceDoseSchema,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
  todayInZone,
  intervalWarning,
  lastDoseDecay,
  medicationHalfLifeHours,
  readDosePolicy,
} from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';
import { displayQuantity } from '@/utils/displayNumber';
import InjectionSitePicker from './InjectionSitePicker';
import { useInjectionSiteSelection } from '@/hooks/useInjectionSiteSelection';
import InjectionSiteSettings from './InjectionSiteSettings';
import MedicationSyringeSettings from './MedicationSyringeSettings';
import MedicationDrawPreview from './MedicationDrawPreview';
import MedicationBlendSplit from './MedicationBlendSplit';
import { useMedicationBlends } from '@/hooks/Medications/useMedicationBlends';
import MedicationBudWarning from './MedicationBudWarning';
import MedicationCourseAttributionPicker from './MedicationCourseAttributionPicker';
import {
  useMedicationCourses,
  useMedicationCourseDue,
  HttpApiError,
} from '@/hooks/Medications/useMedicationCourses';
import {
  useMedicationSyringes,
  useMedicationDrawPreview,
} from '@/hooks/useMedicationSyringes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DateTimeInput } from '@/components/ui/TimeInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMedicationPens,
  useMedicationInjections,
  useLogInjectionMutation,
} from '@/hooks/useMedications';
import type { Medication } from '@/types/medications';

interface Glp1LogInjectionProps {
  med: Medication;
  courseContext?: MedicationCourseAttributionInput;
  plannedDose?: { value: string; unit: string } | null;
  initialTakenAt?: string;
  initialEntryDate?: string;
  initialNotes?: string;
  onLogged?: () => void;
}

export default function Glp1LogInjection({
  med,
  courseContext,
  plannedDose,
  initialTakenAt,
  initialEntryDate,
  initialNotes,
  onLogged,
}: Glp1LogInjectionProps) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const medId = med.id;
  const courses = useMedicationCourses(medId);
  const [courseDraft, setCourseDraft] =
    useState<MedicationCourseAttributionInput | null>(null);
  const [courseOverride, setCourseOverride] =
    useState<MedicationCourseAttributionInput | null>(null);
  const [plannedOverride, setPlannedOverride] = useState<
    { value: string; unit: string } | null | undefined
  >();
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [courseStale, setCourseStale] = useState(false);
  const [courseMessage, setCourseMessage] = useState('');
  const attribution = courseOverride ?? courseContext ?? courseDraft;
  const courseSelected = Boolean(attribution?.course_revision_id);
  const explicitCourseDraft =
    courseContext !== undefined ||
    courseDraft !== null ||
    courseOverride !== null;
  const courseDue = useMedicationCourseDue(
    attribution?.scheduled_day ?? '',
    !!courseContext?.course_slot_key && !!attribution?.scheduled_day
  );
  const bindingKey = `${courses.scope.key}:${medId}`;
  const [courseBindingKey, setCourseBindingKey] = useState(bindingKey);
  if (courseBindingKey !== bindingKey) {
    setCourseBindingKey(bindingKey);
    setCourseDraft(null);
    setCourseOverride(null);
    setPlannedOverride(undefined);
    setShowCoursePicker(false);
    setCourseStale(false);
    setCourseMessage('');
  }
  const displayedPlan =
    plannedOverride === undefined ? plannedDose : plannedOverride;
  const plannedKnown =
    displayedPlan != null &&
    medicationCourseDoseSchema.safeParse(displayedPlan.value).success;
  const courseAllowed = () =>
    courses.scope.isCurrent() &&
    courses.scope.canWrite &&
    med.user_id === courses.scope.ownerId;

  const route = resolvePreparedMedicationRoute(med);
  const nasal = route === 'nasal';
  const resetUnit = nasal ? 'pumps' : 'mg';

  const pensQ = useMedicationPens(medId);
  const logMutation = useLogInjectionMutation(medId);
  // Warn, as Pitstop does, when the last logged injection is inside the minimum interval.
  const recentInjections = useMedicationInjections(medId);
  const lastTaken = (recentInjections.data ?? [])
    .map((entry) => entry.injected_at)
    .filter((value): value is string => !!value);
  const tooSoon = intervalWarning({
    takenAt: lastTaken,
    minHours: readDosePolicy(med.custom_fields).min_interval_hours,
    now: new Date(),
  });
  // How much of the last dose is probably still active, from the medication's half-life.
  const stillActive = lastDoseDecay({
    takenAt: lastTaken,
    halfLifeHours: medicationHalfLifeHours({
      name: med.name,
      custom_fields: med.custom_fields as Record<string, unknown> | null,
    }),
    now: new Date(),
  });

  const siteSelection = useInjectionSiteSelection(medId);
  const { sitesQ, site, setSelectedSite } = siteSelection;

  const inUsePen = pensQ.data?.find(
    (p) => p.status === 'in_use' || p.status === 'sealed'
  );

  const [doseMg, setDoseMg] = useState(
    courseContext
      ? ''
      : nasal
        ? '1'
        : medicationDoseInMg(med) != null
          ? String(medicationDoseInMg(med))
          : ''
  );
  const newTimeDraft = (instant = new Date().toISOString()) => {
    return {
      medicationId: medId,
      value: utcToLocalDateTimeInput(instant, timezone),
      timezone,
      automaticInstant: instant as string | null,
    };
  };
  const [timeDraft, setTimeDraft] = useState(() =>
    newTimeDraft(initialTakenAt)
  );
  if (timeDraft.medicationId !== medId) {
    setTimeDraft(newTimeDraft(initialTakenAt));
  } else if (timeDraft.automaticInstant && timeDraft.timezone !== timezone) {
    // Preferences can load after the form: keep the captured instant, not its
    // initial browser-zone wall time, when formatting an untouched default.
    setTimeDraft({
      ...timeDraft,
      value: utcToLocalDateTimeInput(timeDraft.automaticInstant, timezone),
      timezone,
    });
  }
  const injectedAt = timeDraft.value;
  const setInjectedAt = (value: string) =>
    setTimeDraft({ ...timeDraft, value, automaticInstant: null });
  const [injectionNotes, setInjectionNotes] = useState(initialNotes ?? '');
  const [penChoice, setPenChoice] = useState<string | null>(null);
  const selectedPen =
    penChoice === null
      ? inUsePen
      : pensQ.data?.find(
          (p) =>
            p.id === penChoice &&
            (p.status === 'sealed' || p.status === 'in_use')
        );
  const lostPenSelection =
    penChoice !== null && penChoice !== 'none' && !selectedPen;
  const effectivePenId = selectedPen?.id ?? 'none';
  const syringesQ = useMedicationSyringes();
  const [syringeChoice, setSyringeChoice] = useState<string | null>(null);
  const [doseUnit, setDoseUnit] =
    useState<CalculatedDrawInput['dose']['unit']>(resetUnit);
  const hasDrawConcentration =
    selectedPen?.kind === 'vial' &&
    (!!selectedPen.preparation ||
      (!nasal &&
        Number.isFinite(selectedPen.concentration_mg_ml) &&
        (selectedPen.concentration_mg_ml ?? 0) > 0));
  const availableSyringes = (syringesQ.data?.syringes ?? []).filter((device) =>
    isDeviceEligibleForRoute(device.device_type, route)
  );
  const automaticSyringe =
    availableSyringes.find(
      (syringe) => syringe.id === syringesQ.data?.default_syringe_id
    ) ?? availableSyringes[0];
  const effectiveSyringeId = hasDrawConcentration
    ? (syringeChoice ?? automaticSyringe?.id ?? 'none')
    : 'none';
  const selectedSyringe = availableSyringes.find(
    (syringe) => syringe.id === effectiveSyringeId
  );
  // Reset only the amount/unit when its vial or device identity/calibration changes.
  // Conditional render-time reset prevents an old units/mL draft reaching the new binding.
  const contextKey = JSON.stringify([
    medId,
    effectivePenId,
    selectedPen?.preparation?.id ?? selectedPen?.concentration_mg_ml,
    selectedPen?.preparation?.revision,
    route,
    effectiveSyringeId,
    selectedSyringe?.device_type,
    selectedSyringe?.graduation_type,
    selectedSyringe?.units_per_ml,
    selectedSyringe?.capacity_ml,
    selectedSyringe?.capacity_units,
    selectedSyringe?.increment,
  ]);
  const [selectionContext, setSelectionContext] = useState<string | null>(null);
  const selectionChanged =
    selectionContext !== null && selectionContext !== contextKey;
  if (
    pensQ.data !== undefined &&
    syringesQ.data !== undefined &&
    selectionContext !== contextKey
  ) {
    setSelectionContext(contextKey);
    if (selectionContext !== null) {
      setDoseMg('');
      setDoseUnit(resetUnit);
    }
  }
  const currentDose = selectionChanged ? '' : doseMg;
  const currentDoseUnit = selectionChanged ? resetUnit : doseUnit;
  const calculatedMode = nasal || effectiveSyringeId !== 'none';
  const calculatedInput: CalculatedDrawInput | null =
    calculatedMode &&
    !!selectedSyringe &&
    positiveDeviceDoseSchema.safeParse({
      value: currentDose.trim(),
      unit: currentDoseUnit,
    }).success
      ? {
          syringe_id: effectiveSyringeId,
          dose: { value: currentDose.trim(), unit: currentDoseUnit },
        }
      : null;
  const previewQ = useMedicationDrawPreview(
    calculatedMode ? effectivePenId : null,
    calculatedInput
  );
  const preview = calculatedMode && calculatedInput ? previewQ.data : undefined;
  const calculationBlocked =
    calculatedMode &&
    (!preview ||
      previewQ.isFetching ||
      previewQ.isError ||
      preview.warnings.some((warning) => warning.severity === 'block'));
  const manualDose =
    currentDoseUnit === 'mg' && currentDose.trim() ? Number(currentDose) : null;
  const blendComponents = useMedicationBlends().data?.find(
    (blend) => blend.blend_medication_id === med.id
  )?.components;
  const doseValid =
    (penChoice === 'none' || pensQ.data !== undefined) &&
    (syringeChoice === 'none' || syringesQ.data !== undefined) &&
    !lostPenSelection &&
    (calculatedMode
      ? !calculationBlocked
      : manualDose != null && Number.isFinite(manualDose) && manualDose > 0);

  const plannedInput =
    plannedKnown && displayedPlan
      ? positiveDeviceDoseSchema.safeParse({
          value: displayedPlan.value,
          unit: displayedPlan.unit,
        })
      : null;
  const usablePlannedDraw =
    calculatedMode &&
    plannedInput?.success &&
    (nasal ? ['pumps', 'mcg', 'mg'] : ['mcg', 'mg', 'ml', 'units']).includes(
      plannedInput.data.unit
    );
  const plannedManualMg =
    plannedKnown && displayedPlan
      ? medicationDoseInMg({
          dose_amount: Number(displayedPlan.value),
          dose_unit: displayedPlan.unit,
        })
      : null;
  const usePlanned = () => {
    if (!courseAllowed()) return;
    if (usablePlannedDraw && plannedInput?.success) {
      setDoseMg(plannedInput.data.value);
      setDoseUnit(plannedInput.data.unit);
    } else if (!calculatedMode && plannedManualMg !== null) {
      setDoseMg(String(plannedManualMg));
      setDoseUnit('mg');
    }
  };
  const refreshCourse = async () => {
    if (!courseAllowed()) return;
    setCourseMessage('');
    if (courseContext?.course_slot_key && attribution?.scheduled_day) {
      const fresh = await courseDue.query.refetch();
      if (!courseAllowed()) return;
      const slot = fresh.data?.slots.find(
        (slot) =>
          slot.course_revision_id === attribution.course_revision_id &&
          slot.course_rule_id === attribution.course_rule_id &&
          slot.course_slot_key === attribution.course_slot_key &&
          slot.scheduled_day === attribution.scheduled_day
      );
      if (
        !slot ||
        fresh.data?.fulfilled_slots.some(
          (row) =>
            row.course_slot_key === slot.course_slot_key &&
            row.course_revision_id === slot.course_revision_id
        )
      ) {
        setCourseMessage(
          t(
            'medications.courses.slotUnavailable',
            'This planned slot is no longer available or is already recorded. Refresh the checklist; your actual draft is retained.'
          )
        );
        return;
      }
      setCourseOverride({
        course_revision_id: slot.course_revision_id,
        course_rule_id: slot.course_rule_id,
        course_step_id: slot.course_step_id,
        course_slot_key: slot.course_slot_key,
        course_expected_version: slot.course_expected_version,
        scheduled_day: slot.scheduled_day,
        scheduled_for: slot.scheduled_for,
      });
      setPlannedOverride(
        slot.per_dose_amount == null
          ? null
          : { value: slot.per_dose_amount, unit: slot.dose_unit }
      );
    } else if (attribution?.course_revision_id) {
      const fresh = await courses.query.refetch();
      if (!courseAllowed()) return;
      const course = fresh.data?.courses.find((row) =>
        row.revisions.some(
          (revision) =>
            revision.id === attribution.course_revision_id &&
            !revision.deleted_at
        )
      );
      if (!course) {
        setCourseMessage(
          t(
            'medications.courses.slotUnavailable',
            'This planned slot is no longer available or is already recorded. Refresh the checklist; your actual draft is retained.'
          )
        );
        return;
      }
      setCourseDraft({
        ...attribution,
        course_expected_version: course.version,
      });
    }
    await Promise.all([
      pensQ.refetch(),
      syringesQ.refetch(),
      ...(calculatedMode && calculatedInput ? [previewQ.refetch()] : []),
    ]);
    if (courseAllowed()) {
      setCourseStale(false);
      setCourseMessage(
        t(
          'medications.courses.actualRefreshed',
          'Course data refreshed. Review the retained actual amount and current calculation before logging.'
        )
      );
    }
  };

  const handleLog = () => {
    if (
      !doseValid ||
      courseStale ||
      (explicitCourseDraft && !courseAllowed()) ||
      (courseSelected && !injectedAt)
    )
      return;
    const willDeduct = effectivePenId !== 'none';
    logMutation.mutate(
      {
        medication_id: medId,
        ...(attribution ?? {}),
        ...(courseSelected
          ? {
              entry_date:
                timeDraft.automaticInstant && initialEntryDate
                  ? initialEntryDate
                  : injectedAt.slice(0, 10),
            }
          : {}),
        site: nasal ? null : site || null,
        ...(calculatedMode && calculatedInput
          ? { calculated_draw: calculatedInput }
          : { dose_mg: manualDose }),
        injected_at:
          timeDraft.automaticInstant ??
          (injectedAt
            ? localDateTimeToUtc(injectedAt, timeDraft.timezone).toISOString()
            : undefined),
        pen_id: willDeduct ? effectivePenId : null,
        deduct_pen: willDeduct,
        notes: injectionNotes.trim() || null,
      },
      {
        onSuccess: () => {
          setSelectedSite(null);
          setTimeDraft(newTimeDraft());
          setInjectionNotes('');
          setCourseDraft(null);
          setCourseOverride(null);
          setPlannedOverride(undefined);
          setCourseStale(false);
          setCourseMessage('');
          onLogged?.();
        },
        onError: (error) => {
          if (
            courseSelected &&
            error instanceof HttpApiError &&
            error.status === 409
          ) {
            setCourseStale(true);
            setCourseMessage(
              t(
                'medications.courses.staleDose',
                'This course changed. Refresh before logging. Your actual draft is retained.'
              )
            );
          }
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Syringe className="h-4 w-4 text-blue-500" />{' '}
          {nasal
            ? t('medications.devices.logNasal', 'Log nasal dose')
            : t('medications.glp1.logInjection', 'Log injection')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {courseContext && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
            <p>
              {t('medications.courses.plannedDose', 'Planned dose')}:{' '}
              {plannedKnown && displayedPlan
                ? `${displayedPlan.value} ${displayedPlan.unit}`
                : t('medications.courses.unknownDose', 'Unknown')}
            </p>
            <p className="text-muted-foreground">
              {t(
                'medications.courses.enterActual',
                'Enter and confirm the actual dose. The planned amount is not an administration.'
              )}
            </p>
            {plannedKnown && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  logMutation.isPending ||
                  (!usablePlannedDraw &&
                    (calculatedMode || plannedManualMg === null))
                }
                onClick={usePlanned}
              >
                {t('medications.courses.usePlanned', 'Use planned amount')}
              </Button>
            )}
          </div>
        )}
        {!courseContext && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCoursePicker((value) => !value)}
            >
              {t('medications.courses.association', 'Plan association')}
            </Button>
            {showCoursePicker && (
              <MedicationCourseAttributionPicker
                medicationId={medId}
                value={courseDraft}
                disabled={logMutation.isPending}
                onChange={(value) => {
                  setCourseDraft(value);
                  setCourseStale(false);
                  setCourseMessage('');
                }}
              />
            )}
          </>
        )}
        {courseMessage && (
          <p
            role="status"
            className="rounded-md border bg-muted/20 p-3 text-sm text-foreground"
          >
            {courseMessage}
          </p>
        )}
        {courseStale && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshCourse()}
          >
            {t('medications.courses.refreshCourse', 'Refresh course')}
          </Button>
        )}
        <div className="space-y-1">
          <Label htmlFor="glp1-pen" className="text-xs text-muted-foreground">
            {t('medications.glp1.deduct', 'Deduct from pen/vial')}
          </Label>
          <Select
            value={effectivePenId}
            onValueChange={(value) => {
              setPenChoice(value);
              setDoseMg('');
              setDoseUnit(resetUnit);
            }}
          >
            <SelectTrigger id="glp1-pen">
              <SelectValue
                placeholder={t('medications.glp1.dontDeduct', "Don't deduct")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t('medications.glp1.dontDeduct', "Don't deduct")}
              </SelectItem>
              {(pensQ.data ?? [])
                .filter((p) => p.status === 'sealed' || p.status === 'in_use')
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t(
                      'medications.glp1.left',
                      '{{kind}}{{dose_mg}} · {{doses_total}} left',
                      {
                        kind: p.kind,
                        dose_mg: p.dose_mg ? ` ${p.dose_mg}mg` : '',
                        doses_total: (p.doses_total ?? 0) - p.doses_used,
                      }
                    )}
                    {p.concentration_mg_ml
                      ? ` · ${displayQuantity(p.concentration_mg_ml, 2)} mg/mL`
                      : ''}
                    {p.bud_date && p.bud_date < todayInZone(timezone)
                      ? ` · ${t('medications.glp1.pastUseBy', '⚠ past use-by')}`
                      : ''}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {lostPenSelection && (
          <p className="text-sm text-destructive">
            {t(
              'medications.syringes.stockUnavailable',
              'The selected stock is no longer active. Choose a pen or vial again.'
            )}
          </p>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="glp1-syringe">
              {t('medications.devices.select', 'Device')}
            </Label>
            <MedicationSyringeSettings />
          </div>
          <Select
            value={effectiveSyringeId}
            onValueChange={(value) => {
              setSyringeChoice(value);
              setDoseMg('');
              setDoseUnit(resetUnit);
            }}
            disabled={!hasDrawConcentration}
          >
            <SelectTrigger id="glp1-syringe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!nasal && (
                <SelectItem value="none">
                  {t('medications.syringes.manualDose', 'Manual dose (mg)')}
                </SelectItem>
              )}
              {availableSyringes.map((syringe) => (
                <SelectItem key={syringe.id} value={syringe.id}>
                  {syringe.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!hasDrawConcentration && (
            <p className="text-xs text-muted-foreground">
              {nasal
                ? t(
                    'medications.devices.nasalPreparationRequired',
                    'Select a prepared vial and a saved nasal pump to calculate a dose.'
                  )
                : t(
                    'medications.syringes.preparationRequired',
                    'Select a vial with a known concentration to calculate a marking.'
                  )}
            </p>
          )}
          {hasDrawConcentration &&
            syringeChoice !== null &&
            syringeChoice !== 'none' &&
            syringesQ.data !== undefined &&
            !selectedSyringe && (
              <p className="text-sm text-destructive">
                {t(
                  'medications.syringes.syringeUnavailable',
                  'The selected syringe is no longer available. Choose another syringe or Manual dose (mg).'
                )}
              </p>
            )}
          {syringesQ.data !== undefined && availableSyringes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {nasal
                ? t(
                    'medications.devices.noPump',
                    'Add a saved nasal pump to calculate and record this prepared dose.'
                  )
                : t(
                    'medications.devices.noDevice',
                    'Add a saved device to calculate a marking. Manual dose (mg) remains available.'
                  )}
            </p>
          )}
          {syringesQ.isError && (
            <p className="text-sm text-destructive">
              {t('medications.syringes.loadError', 'Could not load syringes.')}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label
              htmlFor="glp1-dose"
              className="text-xs text-muted-foreground"
            >
              {calculatedMode
                ? t('medications.syringes.enteredDose', 'Entered amount')
                : t('medications.glp1.doseMg', 'Dose (mg)')}
            </Label>
            <Input
              id="glp1-dose"
              type="text"
              inputMode="decimal"
              value={
                calculatedMode || currentDoseUnit === 'mg' ? currentDose : ''
              }
              onChange={(e) => {
                setDoseMg(e.target.value);
                if (!calculatedMode) setDoseUnit(resetUnit);
              }}
              placeholder={
                courseContext
                  ? t(
                      'medications.courses.actualPlaceholder',
                      'Enter actual amount'
                    )
                  : medicationDoseInMg(med) != null
                    ? String(medicationDoseInMg(med))
                    : '0'
              }
            />
            {calculatedMode && (
              <>
                <Label htmlFor="glp1-dose-unit" className="sr-only">
                  {t('medications.syringes.doseUnit', 'Amount unit')}
                </Label>
                <Select
                  value={currentDoseUnit}
                  onValueChange={(value) =>
                    setDoseUnit(value as typeof doseUnit)
                  }
                >
                  <SelectTrigger id="glp1-dose-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(nasal
                      ? (['pumps', 'mcg', 'mg'] as const)
                      : (['mcg', 'mg', 'ml', 'units'] as const)
                    ).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit === 'ml' ? 'mL' : unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label
              id="glp1-injected-at-label"
              className="text-xs text-muted-foreground"
            >
              {t('medications.glp1.dateTime', 'Date & time')}
            </Label>
            <DateTimeInput
              aria-labelledby="glp1-injected-at-label"
              value={injectedAt}
              onChange={setInjectedAt}
            />
          </div>
        </div>

        {
          <MedicationDrawPreview
            preview={preview}
            deviceType={
              selectedSyringe?.device_type ?? (nasal ? 'pump' : 'syringe')
            }
            isFetching={previewQ.isFetching}
            isError={previewQ.isError}
          />
        }

        {blendComponents && (
          <MedicationBlendSplit
            amount={preview ? preview.deliveredMassMcg : manualDose}
            unit={preview ? 'mcg' : 'mg'}
            components={blendComponents}
          />
        )}

        {selectedPen?.bud_date && (
          <MedicationBudWarning date={selectedPen.bud_date} />
        )}
        {!nasal && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                <Trans
                  i18nKey="medications.glp1.injectionSiteGreenSuggestedAmber"
                  defaults={
                    'Injection site · <span>green = suggested</span>, <span2>amber = resting <{{days}}d</span2>'
                  }
                  values={{ days: sitesQ.data?.restDays ?? 7 }}
                  components={{
                    span: <span className="text-green-600" />,
                    span2: <span className="text-amber-600" />,
                  }}
                />
              </Label>
              <InjectionSiteSettings />
            </div>
            <div className="mt-2">
              <InjectionSitePicker selection={siteSelection} />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('medications.glp1.notes', 'Notes')}
          </Label>
          <Input
            value={injectionNotes}
            onChange={(e) => setInjectionNotes(e.target.value)}
            placeholder={t(
              'medications.glp1.notesPlaceholder',
              'e.g. Mild stinging, felt fine'
            )}
          />
        </div>

        {tooSoon && (
          <p
            role="status"
            className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {t(
              'medications.glp1.tooSoon',
              'Last dose {{hours}} h ago. Your minimum interval is {{min}} h. You can still log it.',
              { hours: tooSoon.hours_since, min: tooSoon.min_hours }
            )}
          </p>
        )}
        {stillActive && (
          <p className="text-xs text-muted-foreground">
            {(() => {
              const since =
                stillActive.hours_since < 48
                  ? t('medications.glp1.hoursShort', '{{count}} h', {
                      count: Math.round(stillActive.hours_since),
                    })
                  : t('medications.glp1.daysShort', '{{count}} days', {
                      count: Math.round(stillActive.hours_since / 2.4) / 10,
                    });
              return stillActive.percent < 1
                ? t(
                    'medications.glp1.stillActiveTiny',
                    'Last dose {{since}} ago · under 1% still active, estimated from the half-life.',
                    { since }
                  )
                : t(
                    'medications.glp1.stillActive',
                    'Last dose {{since}} ago · about {{percent}}% still active, estimated from the half-life.',
                    { since, percent: stillActive.percent }
                  );
            })()}
          </p>
        )}
        <Button
          onClick={handleLog}
          disabled={
            !doseValid ||
            logMutation.isPending ||
            courseStale ||
            (explicitCourseDraft && !courseAllowed()) ||
            (courseSelected && !injectedAt)
          }
          className="w-full"
        >
          {logMutation.isPending
            ? t('medications.common.logging', 'Logging…')
            : nasal
              ? t('medications.devices.logNasal', 'Log nasal dose')
              : site
                ? t(
                    'medications.glp1.logInjectionAt',
                    'Log injection — {{site}}',
                    {
                      site: t(
                        'medications.sites.label.' + site,
                        INJECTION_SITES.find((s) => s.id === site)?.label ??
                          site
                      ),
                    }
                  )
                : t('medications.glp1.logInjection', 'Log injection')}
        </Button>
      </CardContent>
    </Card>
  );
}
