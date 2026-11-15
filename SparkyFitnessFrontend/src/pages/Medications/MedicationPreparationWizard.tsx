import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  calculatePreparationValues,
  previewPreparationCreation,
  positiveDeviceDoseSchema,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
  type DeviceDose,
  isDayString,
  medicationDoseInMg,
  medicationPreparationInputSchema,
  medicationPreparationCorrectionValuesSchema,
  todayInZone,
  type MedicationPreparationCreationInput,
  type MedicationPreparationCorrectionValues,
  type MedicationPreparationReviewInput,
  type MedicationPreparationReview,
  type MedicationPreparationCorrectionInput,
} from '@workspace/shared';
import MedicationDrawPreview from './MedicationDrawPreview';
import { useMedicationSyringes } from '@/hooks/useMedicationSyringes';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useCreatePenMutation,
  useMedicationPens,
  useUpdatePenMutation,
  usePreparationReview,
  useCorrectPreparationMutation,
} from '@/hooks/useMedications';
import type {
  Medication,
  MedicationPen,
  MedicationPenWriteInput,
} from '@/types/medications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Preparation input is separate from editable inventory metadata and recorded draws. */
export default function MedicationPreparationWizard({
  med,
  pen,
  onClose,
}: {
  med: Medication;
  pen?: MedicationPen;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const saved = pen?.preparation;
  const pensQ = useMedicationPens(med.id);
  const currentRevision =
    pensQ.data?.find((row) => row.id === pen?.id)?.preparation?.revision ??
    saved?.revision ??
    0;
  const route = resolvePreparedMedicationRoute(med);
  const nasal = route === 'nasal';
  const actualDoseUnit = med.dose_unit?.toLowerCase();
  const targetUnits = nasal
    ? (['pumps', 'mcg', 'mg'] as const)
    : (['mcg', 'mg', 'ml', 'units'] as const);
  const compatibleDefault =
    targetUnits.some((unit) => unit === actualDoseUnit) &&
    med.dose_amount != null &&
    med.dose_amount > 0;
  const [targetValue, setTargetValue] = useState(
    compatibleDefault ? String(med.dose_amount) : ''
  );
  const [targetUnit, setTargetUnit] = useState<DeviceDose['unit']>(
    compatibleDefault
      ? (actualDoseUnit as DeviceDose['unit'])
      : nasal
        ? 'pumps'
        : 'mcg'
  );
  const devicesQ = useMedicationSyringes();
  const eligibleDevices = (devicesQ.data?.syringes ?? []).filter((device) =>
    isDeviceEligibleForRoute(device.device_type, route)
  );
  const device =
    eligibleDevices.find(
      (row) => row.id === devicesQ.data?.default_syringe_id
    ) ?? eligibleDevices[0];
  const deviceKey = JSON.stringify([
    device?.id,
    device?.device_type,
    device?.capacity_ml,
    device?.units_per_ml,
    device?.graduation_type,
    device?.increment,
  ]);
  const [targetDeviceKey, setTargetDeviceKey] = useState<string | null>(null);
  const targetDeviceChanged =
    targetDeviceKey !== null && targetDeviceKey !== deviceKey;
  if (devicesQ.data !== undefined && targetDeviceKey !== deviceKey) {
    setTargetDeviceKey(deviceKey);
    if (targetDeviceKey !== null) setTargetValue('');
  }
  const correcting = !!saved;
  const [step, setStep] = useState(correcting ? 2 : 1);
  const [mode, setMode] = useState<'reconstituted' | 'premixed'>(
    saved?.mode ?? 'reconstituted'
  );
  const [mass, setMass] = useState(
    saved ? (saved.exact?.mass_value ?? String(saved.mass_value)) : ''
  );
  const [massUnit, setMassUnit] = useState<'mg' | 'mcg'>(
    saved?.mass_unit ?? 'mg'
  );
  const [dryVolume, setDryVolume] = useState(
    saved?.mode === 'reconstituted'
      ? (saved.exact?.final_volume_ml ?? String(saved.final_volume_ml))
      : '2'
  );
  const [premixVolume, setPremixVolume] = useState(
    saved?.mode === 'premixed'
      ? (saved.exact?.final_volume_ml ?? String(saved.final_volume_ml))
      : ''
  );
  const volume = mode === 'premixed' ? premixVolume : dryVolume;
  const setVolume = mode === 'premixed' ? setPremixVolume : setDryVolume;
  const [labelConcentration, setLabelConcentration] = useState(
    saved?.mode === 'premixed'
      ? (saved.label_concentration_value ??
          saved.exact?.concentration_mg_ml ??
          String(saved.concentration_mg_ml))
      : ''
  );
  const [preparedDate, setPreparedDate] = useState(
    saved?.prepared_date ?? todayInZone(timezone)
  );
  const [diluent, setDiluent] = useState(saved?.diluent ?? '');
  const [label, setLabel] = useState(pen?.label ?? '');
  const [budMode, setBudMode] = useState<'none' | 'date' | 'interval'>(
    pen?.bud_mode ?? (pen?.bud_date ? 'date' : 'none')
  );
  const [budDate, setBudDate] = useState(pen?.bud_date ?? '');
  const [budDays, setBudDays] = useState(
    pen?.bud_interval_days != null ? String(pen.bud_interval_days) : ''
  );
  const [budBaseDate, setBudBaseDate] = useState(pen?.bud_base_date ?? '');
  const [budSource, setBudSource] = useState(pen?.bud_source ?? '');
  const [reviewInput, setReviewInput] =
    useState<MedicationPreparationReviewInput | null>(null);
  const [operationId, setOperationId] = useState('');
  const [attempted, setAttempted] = useState<{
    body: MedicationPreparationCorrectionInput;
    review: MedicationPreparationReview;
  } | null>(null);
  const create = useCreatePenMutation(med.id);
  const attach = useUpdatePenMutation(med.id);
  const correct = useCorrectPreparationMutation(med.id);
  const reviewQ = usePreparationReview(
    correcting ? pen!.id : null,
    reviewInput
  );
  const review =
    attempted?.review ??
    (!reviewQ.isFetching && !reviewQ.isError ? reviewQ.data : undefined);
  const pending = create.isPending || attach.isPending || correct.isPending;
  const rawCreation: MedicationPreparationCreationInput =
    mode === 'premixed'
      ? {
          mode,
          label_concentration_value: labelConcentration.trim(),
          label_concentration_unit: 'mg/ml',
          final_volume_ml: volume.trim(),
          prepared_date: preparedDate,
          diluent: diluent.trim() || null,
        }
      : {
          mode,
          mass_value: mass.trim(),
          mass_unit: massUnit,
          final_volume_ml: volume.trim(),
          prepared_date: preparedDate,
          diluent: diluent.trim() || null,
        };
  const parsedCreation =
    medicationPreparationInputSchema.safeParse(rawCreation);
  const targetInput = positiveDeviceDoseSchema.safeParse({
    value: targetDeviceChanged ? '' : targetValue.trim(),
    unit: targetUnit,
  });
  const estimate = !correcting
    ? previewPreparationCreation(
        rawCreation,
        targetInput.success ? targetInput.data : null,
        device ?? null
      )
    : null;
  const values = parsedCreation.success
    ? calculatePreparationValues(parsedCreation.data)
    : null;
  const correctionValues: MedicationPreparationCorrectionValues =
    mode === 'premixed'
      ? {
          mode,
          label_concentration_value: labelConcentration.trim(),
          label_concentration_unit: 'mg/ml',
          final_volume_ml: volume.trim(),
          prepared_date: preparedDate,
          diluent: diluent.trim() || null,
        }
      : {
          mode,
          mass_value: mass.trim(),
          mass_unit: massUnit,
          final_volume_ml: volume.trim(),
          prepared_date: preparedDate,
          diluent: diluent.trim() || null,
        };
  const preparationValid = correcting
    ? medicationPreparationCorrectionValuesSchema.safeParse(correctionValues)
        .success
    : parsedCreation.success && values !== null;
  let derivedBud = budDate;
  if (budMode === 'interval') {
    try {
      derivedBud =
        isDayString(budBaseDate) &&
        budDays !== '' &&
        Number.isInteger(Number(budDays)) &&
        Number(budDays) >= 0 &&
        Number(budDays) <= 36500
          ? addDays(budBaseDate, Number(budDays))
          : '';
    } catch {
      derivedBud = '';
    }
  }
  const budValid =
    budMode === 'none' ||
    (isDayString(derivedBud) && (budMode !== 'interval' || !!budSource.trim()));
  const bud = {
    bud_mode: budMode === 'none' ? null : budMode,
    bud_date: budMode === 'none' ? null : derivedBud,
    bud_interval_days: budMode === 'interval' ? Number(budDays) : null,
    bud_base_date: budMode === 'interval' ? budBaseDate : null,
    bud_source: budSource.trim() || null,
  };
  const budChanged =
    budMode !== (pen?.bud_mode ?? (pen?.bud_date ? 'date' : 'none')) ||
    budDate !== (pen?.bud_date ?? '') ||
    budDays !==
      (pen?.bud_interval_days != null ? String(pen.bud_interval_days) : '') ||
    budBaseDate !== (pen?.bud_base_date ?? '') ||
    budSource !== (pen?.bud_source ?? '');
  const openReview = () => {
    correct.reset?.();
    setAttempted(null);
    if (!preparationValid || !budValid) return;
    if (correcting) {
      setReviewInput({
        expected_revision: currentRevision,
        preparation: correctionValues,
        ...(budChanged ? { bud } : {}),
      });
      setOperationId(crypto.randomUUID());
    }
    setStep(3);
  };
  const save = () => {
    if (pending || !preparationValid || !budValid) return;
    if (correcting) {
      if (!reviewInput || !review?.can_confirm) return;
      if (
        !attempted &&
        (reviewQ.isFetching ||
          reviewQ.isError ||
          currentRevision !== review.expected_revision)
      )
        return;
      const body = attempted?.body ?? {
        ...reviewInput,
        review_hash: review.review_hash,
        operation_id: operationId,
      };
      setAttempted({ body, review });
      correct.mutate(
        {
          id: pen!.id,
          body,
        },
        {
          onSuccess: onClose,
          onError: (error) => {
            if ('status' in error && error.status === 409) {
              setAttempted(null);
              setStep(2);
              setReviewInput(null);
            }
          },
        }
      );
    } else {
      const body: MedicationPenWriteInput = {
        kind: 'vial',
        label: label.trim() || null,
        preparation: rawCreation,
        ...(budChanged || !pen ? bud : {}),
      };
      if (pen) {
        if (pen.status !== 'in_use') {
          body.status = 'in_use';
          body.lifecycle_intent = true;
        }
        attach.mutate({ id: pen.id, body }, { onSuccess: onClose });
      } else {
        body.status = 'in_use';
        body.dose_mg = medicationDoseInMg(med);
        body.opened_at = preparedDate;
        create.mutate(body, { onSuccess: onClose });
      }
    }
  };
  const error = create.error || attach.error || correct.error;
  const field = (
    name: string,
    title: string,
    value: string,
    set: (next: string) => void,
    type = 'text'
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`preparation-${name}`}>{title}</Label>
      <Input
        id={`preparation-${name}`}
        type={type}
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {correcting
              ? t('medications.preparationFlow.edit', 'Edit preparation')
              : t('medications.stock.prepare', 'Prepare a vial')}
          </DialogTitle>
        </DialogHeader>
        <div
          className="flex gap-2"
          aria-label={t(
            'medications.preparationFlow.progress',
            'Preparation steps'
          )}
        >
          {(correcting ? [2, 3] : [1, 2, 3]).map((number) => (
            <span
              key={number}
              className={`h-1 flex-1 rounded-full ${number <= step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
        {step === 1 && (
          <div className="space-y-3">
            <h3 className="font-medium">
              {t(
                'medications.preparationFlow.typeQuestion',
                'How does this vial come?'
              )}
            </h3>
            {(['reconstituted', 'premixed'] as const).map((option) => (
              <Button
                key={option}
                className="h-auto w-full justify-start whitespace-normal py-4 text-left"
                variant={mode === option ? 'default' : 'outline'}
                onClick={() => {
                  setMode(option);
                  setStep(2);
                }}
              >
                {option === 'reconstituted'
                  ? t(
                      'medications.preparationFlow.dry',
                      'Dry powder — add diluent to mix'
                    )
                  : t(
                      'medications.preparationFlow.premixed',
                      'Premixed — ready to use, known concentration'
                    )}
              </Button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            {correcting && (
              <div className="flex gap-2">
                {(['reconstituted', 'premixed'] as const).map((option) => (
                  <Button
                    key={option}
                    className="flex-1"
                    variant={mode === option ? 'default' : 'outline'}
                    onClick={() => setMode(option)}
                  >
                    {option === 'reconstituted'
                      ? t('medications.preparationFlow.dryShort', 'Dry powder')
                      : t('medications.preparation.premixed', 'Premixed')}
                  </Button>
                ))}
              </div>
            )}
            {!pen &&
              field(
                'label',
                t('medications.preparationFlow.label', 'Vial label (optional)'),
                label,
                setLabel
              )}
            {mode === 'reconstituted' ? (
              <>
                {field(
                  'mass',
                  t('medications.preparationFlow.powder', 'Powder in the vial'),
                  mass,
                  setMass
                )}
                <div className="space-y-1">
                  <Label htmlFor="preparation-mass-unit">
                    {t('medications.preparation.massUnit', 'Mass unit')}
                  </Label>
                  <Select
                    value={massUnit}
                    onValueChange={(unit) => setMassUnit(unit as 'mg' | 'mcg')}
                  >
                    <SelectTrigger id="preparation-mass-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mg">mg</SelectItem>
                      <SelectItem value="mcg">mcg</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {field(
                  'volume',
                  t(
                    'medications.preparationFlow.diluentVolume',
                    'Diluent added (mL)'
                  ),
                  volume,
                  setVolume
                )}
                <div className="flex flex-wrap gap-2">
                  {['1', '2', '3', '5'].map((amount) => (
                    <Button
                      type="button"
                      key={amount}
                      size="sm"
                      variant={volume === amount ? 'default' : 'outline'}
                      onClick={() => setVolume(amount)}
                    >
                      {amount} mL
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.preparationFlow.copyLabel',
                    'Copy the concentration and fill volume from the label.'
                  )}
                </p>
                {field(
                  'concentration',
                  t(
                    'medications.preparationFlow.labelConcentration',
                    'Label concentration (mg/mL)'
                  ),
                  labelConcentration,
                  setLabelConcentration
                )}
                {field(
                  'volume',
                  t(
                    'medications.preparationFlow.fillVolume',
                    'Volume in the vial (mL)'
                  ),
                  volume,
                  setVolume
                )}
              </>
            )}
            {field(
              'date',
              t('medications.preparation.preparedDate', 'Prepared date'),
              preparedDate,
              setPreparedDate,
              'date'
            )}
            {field(
              'diluent',
              t('medications.preparation.diluent', 'Diluent (optional)'),
              diluent,
              setDiluent
            )}
            <div className="space-y-1">
              <Label htmlFor="preparation-bud-mode">
                {t('medications.preparation.bud', 'Beyond-use date (BUD)')}
              </Label>
              <Select
                value={budMode}
                onValueChange={(value) => setBudMode(value as typeof budMode)}
              >
                <SelectTrigger id="preparation-bud-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t(
                      'medications.preparationFlow.notRecorded',
                      'Not recorded'
                    )}
                  </SelectItem>
                  <SelectItem value="date">
                    {t('medications.preparationFlow.explicitDate', 'Date')}
                  </SelectItem>
                  <SelectItem value="interval">
                    {t(
                      'medications.preparationFlow.interval',
                      'Interval and source'
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {budMode === 'date' &&
              field(
                'bud-date',
                t('medications.preparationFlow.useBy', 'Use by'),
                budDate,
                setBudDate,
                'date'
              )}
            {budMode === 'interval' && (
              <>
                {field(
                  'bud-days',
                  t('medications.preparationFlow.days', 'Days'),
                  budDays,
                  setBudDays
                )}
                {field(
                  'bud-base',
                  t('medications.preparationFlow.base', 'From date'),
                  budBaseDate,
                  setBudBaseDate,
                  'date'
                )}
              </>
            )}
            {budMode !== 'none' &&
              field(
                'bud-source',
                t('medications.preparation.budSource', 'BUD source'),
                budSource,
                setBudSource
              )}
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.preparationFlow.noAssumption',
                'Use the date or interval from your product or clinician guidance. No interval is assumed.'
              )}
            </p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <h3 className="font-medium">
              {t('medications.preparationFlow.review', 'Review preparation')}
            </h3>
            {correcting ? (
              <>
                {!attempted && reviewQ.isFetching && (
                  <p>
                    {t(
                      'medications.preparationFlow.reviewing',
                      'Checking preparation and recorded draws…'
                    )}
                  </p>
                )}
                {!attempted && reviewQ.isError && (
                  <Badge
                    variant="destructive"
                    className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
                  >
                    {t(
                      'medications.preparationFlow.reviewError',
                      'Could not review these changes. Go back and review again.'
                    )}
                  </Badge>
                )}
                {!attempted &&
                  review &&
                  currentRevision !== review.expected_revision && (
                    <Badge
                      variant="destructive"
                      className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
                    >
                      {t(
                        'medications.preparationFlow.changed',
                        'This preparation changed. Go back and review again.'
                      )}
                    </Badge>
                  )}
                {review && (
                  <>
                    <dl className="grid grid-cols-1 gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                      <dt>
                        {t(
                          'medications.preparation.concentration',
                          'Concentration'
                        )}
                      </dt>
                      <dd className="min-w-0 break-words">
                        {review.before.concentration_mg_ml} →{' '}
                        {review.after.concentration_mg_ml} mg/mL
                      </dd>
                      <dt>
                        {t(
                          'medications.preparationFlow.remaining',
                          'Remaining in vial'
                        )}
                      </dt>
                      <dd className="min-w-0 break-words">
                        {review.before.remaining_ml ?? '—'} →{' '}
                        {review.after.remaining_ml ?? '—'} mL
                      </dd>
                      <dt>
                        {t(
                          'medications.preparationFlow.affected',
                          'Logged doses affected'
                        )}
                      </dt>
                      <dd className="min-w-0 break-words">
                        {review.affected_dose_count}
                      </dd>
                    </dl>
                    {review.stock_unknown && (
                      <p className="text-muted-foreground">
                        {t(
                          'medications.preparationFlow.unknown',
                          'Available stock remains unknown because physical draw history is incomplete.'
                        )}
                      </p>
                    )}
                    {review.overdraw_warning && (
                      <Badge
                        variant="destructive"
                        className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
                      >
                        {t(
                          'medications.preparationFlow.deficit',
                          'Recorded draws exceed the corrected fill. Available stock will be zero.'
                        )}
                      </Badge>
                    )}
                    {!review.can_confirm && (
                      <Badge
                        variant="destructive"
                        className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
                      >
                        {t(
                          'medications.preparationFlow.incomplete',
                          'These changes cannot be confirmed with incomplete physical draw history.'
                        )}
                      </Badge>
                    )}
                  </>
                )}
              </>
            ) : (
              values && (
                <dl className="grid grid-cols-1 gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                  <dt>
                    {t(
                      'medications.preparation.concentration',
                      'Concentration'
                    )}
                  </dt>
                  <dd className="min-w-0 break-words">
                    {estimate?.values.concentration_mg_ml ??
                      values.concentration_mg_ml}{' '}
                    mg/mL
                  </dd>
                  <dt>{t('medications.preparation.mass', 'Vial content')}</dt>
                  <dd className="min-w-0 break-words">
                    {estimate?.values.mass_mg ?? values.mass_mg} mg
                  </dd>
                  <dt>
                    {t('medications.preparation.finalVolume', 'Final volume')}
                  </dt>
                  <dd className="min-w-0 break-words">{volume} mL</dd>
                </dl>
              )
            )}
            {!correcting && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {t('medications.preparationFlow.estimate', 'Draw estimate')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {field(
                    'target',
                    t('medications.preparationFlow.target', 'Target amount'),
                    targetDeviceChanged ? '' : targetValue,
                    setTargetValue
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="preparation-target-unit">
                      {t('medications.syringes.doseUnit', 'Amount unit')}
                    </Label>
                    <Select
                      value={targetUnit}
                      onValueChange={(unit) =>
                        setTargetUnit(unit as DeviceDose['unit'])
                      }
                    >
                      <SelectTrigger id="preparation-target-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {targetUnits.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit === 'ml' ? 'mL' : unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {device?.name ??
                    t(
                      'medications.preparationFlow.noDevice',
                      'No eligible saved device. Add one in Cabinet to calculate a marking.'
                    )}
                </p>
                <MedicationDrawPreview
                  preview={estimate?.draw ?? undefined}
                  deviceType={
                    device?.device_type ?? (nasal ? 'pump' : 'syringe')
                  }
                  isFetching={false}
                  isError={false}
                />
                {estimate?.doses_in_vial != null && (
                  <p className="text-sm">
                    {t(
                      'medications.preparationFlow.yield',
                      'Estimated doses in vial: {{doses}}',
                      { doses: estimate.doses_in_vial }
                    )}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(
                    'medications.preparationFlow.estimateOnly',
                    'This estimates a draw and does not log a dose.'
                  )}
                </p>
              </div>
            )}
            <p className="text-sm">
              {t('medications.preparation.preparedDate', 'Prepared date')}:{' '}
              {preparedDate}
            </p>
            {budMode !== 'none' && (
              <p className="text-sm">
                {t('medications.preparationFlow.useBy', 'Use by')}: {derivedBud}
                {budSource && ` · ${budSource}`}
              </p>
            )}
            {error && (
              <Badge
                variant="destructive"
                className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
              >
                {error.message}
              </Badge>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {step > (correcting ? 2 : 1) && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setStep(step - 1);
                setReviewInput(null);
                setAttempted(null);
              }}
            >
              {t('common.back', 'Back')}
            </Button>
          )}
          {step === 2 && (
            <Button
              disabled={
                !preparationValid ||
                !budValid ||
                (correcting && pensQ.isFetching)
              }
              onClick={openReview}
            >
              {t('medications.preparationFlow.review', 'Review preparation')}
            </Button>
          )}
          {step === 3 && (
            <Button
              disabled={
                pending ||
                (correcting &&
                  !attempted &&
                  (!review?.can_confirm ||
                    currentRevision !== review.expected_revision ||
                    reviewQ.isFetching ||
                    reviewQ.isError))
              }
              onClick={save}
            >
              {pending
                ? t('common.saving', 'Saving…')
                : t('medications.preparationFlow.confirm', 'Confirm and save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
