import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import {
  INJECTION_SITES,
  localDateTimeToUtc,
  utcToLocalDateTimeInput,
  positiveDeviceDoseSchema,
  recordedDoseForEdit,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
  type DeviceDose,
  type DrawPreviewInput,
  type MedicationCourseAttributionInput,
} from '@workspace/shared';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useMedicationInjections,
  useUpdateInjectionMutation,
  useDeleteInjectionMutation,
} from '@/hooks/useMedications';
import MedicationDrawPreview from './MedicationDrawPreview';
import MedicationCourseAttributionPicker from './MedicationCourseAttributionPicker';
import {
  useMedicationCourseScope,
  HttpApiError,
} from '@/hooks/Medications/useMedicationCourses';
import {
  useMedicationDrawPreview,
  useMedicationSyringes,
} from '@/hooks/useMedicationSyringes';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { Medication, InjectionEntry } from '@/types/medications';

interface Glp1RecentInjectionsProps {
  med: Medication;
}

export default function Glp1RecentInjections({
  med,
}: Glp1RecentInjectionsProps) {
  const { t } = useTranslation();
  const { formatDate, timezone } = usePreferences();
  const medId = med.id;
  const courseScope = useMedicationCourseScope();
  const [association, setAssociation] =
    useState<MedicationCourseAttributionInput | null>(null);
  const [showAssociation, setShowAssociation] = useState(false);
  const [associationStale, setAssociationStale] = useState(false);

  const injQ = useMedicationInjections(medId);
  const updateInjMutation = useUpdateInjectionMutation(medId);
  const deleteInjMutation = useDeleteInjectionMutation(medId);

  const [editingInj, setEditingInj] = useState<InjectionEntry | null>(null);
  const [editSite, setEditSite] = useState('');
  const [editDoseMg, setEditDoseMg] = useState('');
  const [editInjectedAt, setEditInjectedAt] = useState('');
  const [editTimeTouched, setEditTimeTouched] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editDoseUnit, setEditDoseUnit] = useState<DeviceDose['unit']>('mg');
  const [seedDose, setSeedDose] = useState<DeviceDose | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedState, setReviewedState] = useState<string | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [deviceBinding, setDeviceBinding] = useState('');

  const syringesQ = useMedicationSyringes();
  const calculatedEntry = !!editingInj?.dose_input_unit;
  const nasal = editingInj?.administration_route === 'nasal';
  const editRoute =
    editingInj?.administration_route ?? resolvePreparedMedicationRoute(med);
  const originalDevice = syringesQ.data?.syringes.find(
    (device) => device.id === editingInj?.syringe_id
  );
  const currentBinding = JSON.stringify([
    editingInj?.id,
    originalDevice?.id,
    originalDevice?.device_type,
    originalDevice?.increment,
    originalDevice?.units_per_ml,
    originalDevice?.capacity_ml,
    originalDevice?.graduation_type,
  ]);
  const bindingChanged = !!editingInj && deviceBinding !== currentBinding;
  if (bindingChanged) {
    const delivered = recordedDoseForEdit(editingInj!, originalDevice);
    setDeviceBinding(currentBinding);
    setSeedDose(delivered);
    setEditDoseMg(amountTouched ? '' : (delivered?.value ?? ''));
    setEditDoseUnit(delivered?.unit ?? 'mg');
    setAmountTouched(false);
    setReviewing(false);
  }
  const canChangeCalculatedAmount =
    !!editingInj?.pen_id &&
    !!originalDevice &&
    isDeviceEligibleForRoute(originalDevice.device_type, editRoute);
  const amountChanged =
    !!editingInj &&
    (calculatedEntry
      ? amountTouched &&
        !bindingChanged &&
        (seedDose
          ? editDoseUnit !== seedDose.unit ||
            editDoseMg.trim() !== seedDose.value
          : editDoseMg.trim() !== '')
      : editDoseMg.trim()
        ? Number(editDoseMg) !== editingInj.dose_mg
        : editingInj.dose_mg !== null);
  const editTimeInvalid = editTimeTouched && !editInjectedAt;
  const positiveAmount = positiveDeviceDoseSchema.safeParse({
    value: editDoseMg.trim(),
    unit: editDoseUnit,
  }).success;
  const editPreviewInput: DrawPreviewInput | null =
    calculatedEntry &&
    amountChanged &&
    positiveAmount &&
    canChangeCalculatedAmount
      ? {
          syringe_id: editingInj!.syringe_id!,
          editing_injection_id: editingInj!.id,
          dose: { value: editDoseMg.trim(), unit: editDoseUnit },
        }
      : null;
  const previewQ = useMedicationDrawPreview(
    editPreviewInput ? (editingInj?.pen_id ?? null) : null,
    editPreviewInput
  );
  const currentPreview =
    !previewQ.isFetching && !previewQ.isError ? previewQ.data : undefined;
  const freshPreview =
    reviewing &&
    amountChanged &&
    currentPreview?.review?.state !== reviewedState
      ? undefined
      : currentPreview;
  const staleReview =
    reviewing &&
    amountChanged &&
    !previewQ.isFetching &&
    currentPreview?.review?.state !== reviewedState;
  const editAmountBlocked =
    calculatedEntry &&
    amountChanged &&
    (!canChangeCalculatedAmount ||
      !positiveAmount ||
      !previewQ.data?.review?.state ||
      previewQ.isFetching ||
      previewQ.isError ||
      previewQ.data.warnings.some((warning) => warning.severity === 'block'));

  const openEdit = (inj: InjectionEntry) => {
    setAssociation(null);
    setShowAssociation(false);
    setAssociationStale(false);
    const device = syringesQ.data?.syringes.find(
      (row) => row.id === inj.syringe_id
    );
    setDeviceBinding(
      JSON.stringify([
        inj.id,
        device?.id,
        device?.device_type,
        device?.increment,
        device?.units_per_ml,
        device?.capacity_ml,
        device?.graduation_type,
      ])
    );
    setAmountTouched(false);
    setEditingInj(inj);
    setEditSite(inj.site ?? 'none');
    const delivered = recordedDoseForEdit(
      inj,
      syringesQ.data?.syringes.find((device) => device.id === inj.syringe_id)
    );
    setSeedDose(delivered);
    setEditDoseMg(
      inj.dose_input_unit
        ? (delivered?.value ?? '')
        : inj.dose_mg != null
          ? String(inj.dose_mg_exact ?? inj.dose_mg)
          : ''
    );
    setEditDoseUnit(delivered?.unit ?? 'mg');
    setReviewing(false);
    setEditInjectedAt(utcToLocalDateTimeInput(inj.injected_at, timezone));
    setEditTimeTouched(false);
    setEditNotes(inj.notes ?? '');
  };

  const handleSaveEdit = () => {
    if (
      !editingInj ||
      associationStale ||
      (association !== null &&
        (!courseScope.isCurrent() || !courseScope.canWrite)) ||
      editTimeInvalid ||
      editAmountBlocked ||
      (calculatedEntry &&
        amountChanged &&
        (!reviewing ||
          !reviewedState ||
          currentPreview?.review?.state !== reviewedState))
    )
      return;
    updateInjMutation.mutate(
      {
        id: editingInj.id,
        body: {
          ...(association ?? {}),
          ...(!nasal ? { site: editSite === 'none' ? null : editSite } : {}),
          ...(amountChanged
            ? calculatedEntry && editPreviewInput
              ? {
                  calculated_draw: {
                    syringe_id: editPreviewInput.syringe_id,
                    dose: editPreviewInput.dose,
                    review_intent: true,
                    expected_preview_state: reviewedState!,
                  },
                }
              : { dose_mg: editDoseMg ? Number(editDoseMg) : null }
            : {}),
          ...(editTimeTouched && editInjectedAt
            ? {
                injected_at: localDateTimeToUtc(
                  editInjectedAt,
                  timezone
                ).toISOString(),
                // Keep the calendar day in step with the edited local time.
                entry_date: editInjectedAt.substring(0, 10),
              }
            : {}),
          notes: editNotes.trim() || null,
        },
      },
      {
        onSuccess: () => setEditingInj(null),
        onError: (error) => {
          if (
            association !== null &&
            error instanceof HttpApiError &&
            error.status === 409
          )
            setAssociationStale(true);
          setReviewing(false);
          if (editPreviewInput) void previewQ.refetch();
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {resolvePreparedMedicationRoute(med) === 'nasal'
            ? t('medications.devices.recentDoses', 'Recent doses')
            : t('medications.glp1.recentInjections', 'Recent injections')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(injQ.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            {resolvePreparedMedicationRoute(med) === 'nasal'
              ? t('medications.devices.noDoses', 'No doses logged yet.')
              : t('medications.glp1.noInjections', 'No injections logged yet.')}
          </p>
        )}
        {(injQ.data ?? []).slice(0, 8).map((inj) => (
          <div
            key={inj.id}
            className="flex items-center justify-between rounded-md border p-2 text-sm gap-2"
          >
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate">
                {inj.administration_route === 'nasal'
                  ? t('medications.devices.nasalDose', 'Nasal dose')
                  : inj.administration_route === 'injection'
                    ? (INJECTION_SITES.find((s) => s.id === inj.site)?.label ??
                      inj.site ??
                      t('medications.devices.injection', 'Injection'))
                    : `${t('medications.devices.recordedDose', 'Recorded dose')}${inj.site ? ` · ${INJECTION_SITES.find((s) => s.id === inj.site)?.label ?? inj.site}` : ''}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {inj.dose_mg != null
                  ? t(
                      'medications.glp1RecentInjections.mg',
                      '{{dose_mg}} mg · ',
                      { dose_mg: inj.dose_mg_exact ?? inj.dose_mg }
                    )
                  : ''}
                {formatDate(inj.injected_at)}
              </span>
              {inj.notes && (
                <span className="text-xs text-muted-foreground italic mt-0.5 block truncate">
                  {t(
                    'medications.glp1RecentInjections.note',
                    'Note: {{notes}}',
                    { notes: inj.notes }
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => openEdit(inj)}
                aria-label={
                  inj.administration_route === 'nasal'
                    ? t('medications.devices.editDose', 'Edit dose')
                    : t(
                        'medications.glp1RecentInjections.editInjectionEntry',
                        'Edit injection entry'
                      )
                }
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => deleteInjMutation.mutate(inj.id)}
                disabled={deleteInjMutation.isPending}
                aria-label={t(
                  'medications.glp1RecentInjections.deleteInjectionEntry',
                  'Delete injection entry'
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      {/* Edit Injection Dialog */}
      <Dialog
        open={!!editingInj}
        onOpenChange={(open) => !open && setEditingInj(null)}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {nasal
                ? t('medications.devices.editDose', 'Edit dose')
                : t('medications.glp1.editInjection', 'Edit injection')}
            </DialogTitle>
          </DialogHeader>
          {!reviewing && (
            <div className="space-y-4 py-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowAssociation((value) => !value)}
              >
                {t('medications.courses.association', 'Plan association')}
              </Button>
              {showAssociation && editingInj && (
                <MedicationCourseAttributionPicker
                  medicationId={medId}
                  initial={editingInj}
                  value={association}
                  disabled={updateInjMutation.isPending}
                  onChange={(value) => {
                    setAssociation(value);
                    setAssociationStale(false);
                    setReviewing(false);
                  }}
                />
              )}
              {associationStale && (
                <p
                  role="status"
                  className="rounded-md border bg-muted/20 p-3 text-sm"
                >
                  {t(
                    'medications.courses.associationStale',
                    'This plan association changed. Refresh plan choices and select explicitly before saving. Your actual dose and time are retained.'
                  )}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="glp1-edit-dose"
                    className="text-xs text-muted-foreground"
                  >
                    {calculatedEntry
                      ? t('medications.syringes.enteredDose', 'Entered amount')
                      : t('medications.glp1.doseMg', 'Dose (mg)')}
                  </Label>
                  <Input
                    id="glp1-edit-dose"
                    type="text"
                    inputMode="decimal"
                    readOnly={calculatedEntry && !canChangeCalculatedAmount}
                    value={editDoseMg}
                    onChange={(e) => {
                      setEditDoseMg(e.target.value);
                      setAmountTouched(true);
                    }}
                  />
                  {calculatedEntry && (
                    <>
                      <Label htmlFor="correction-unit" className="sr-only">
                        {t('medications.syringes.doseUnit', 'Amount unit')}
                      </Label>
                      <Select
                        value={editDoseUnit}
                        onValueChange={(unit) => {
                          setEditDoseUnit(unit as DeviceDose['unit']);
                          setAmountTouched(true);
                        }}
                        disabled={!canChangeCalculatedAmount}
                      >
                        <SelectTrigger id="correction-unit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(originalDevice?.device_type === 'pump'
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
                    id="glp1-edit-injected-at-label"
                    className="text-xs text-muted-foreground"
                  >
                    {t('medications.glp1.dateTime', 'Date & time')}
                  </Label>
                  <DateTimeInput
                    required
                    aria-labelledby="glp1-edit-injected-at-label"
                    value={editInjectedAt}
                    onChange={(value) => {
                      setEditInjectedAt(value);
                      setEditTimeTouched(true);
                    }}
                  />
                </div>
              </div>
              {calculatedEntry && !canChangeCalculatedAmount && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'medications.syringes.originalUnavailable',
                    'The original syringe or vial is unavailable, so the amount cannot be changed. Notes, site and time can still be edited.'
                  )}
                </p>
              )}
              {calculatedEntry && (
                <MedicationDrawPreview
                  preview={editPreviewInput ? previewQ.data : undefined}
                  deviceType={
                    originalDevice?.device_type ?? (nasal ? 'pump' : 'syringe')
                  }
                  isFetching={previewQ.isFetching}
                  isError={previewQ.isError}
                />
              )}
              {!nasal && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('medications.glp1.injectionSite', 'Injection site')}
                  </Label>
                  <Select value={editSite} onValueChange={setEditSite}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {INJECTION_SITES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {t('medications.sites.label.' + s.id, s.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label
                  htmlFor="glp1-edit-notes"
                  className="text-xs text-muted-foreground"
                >
                  {t('medications.glp1.notes', 'Notes')}
                </Label>
                <Input
                  id="glp1-edit-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>
          )}
          {reviewing && (
            <div className="space-y-3 py-2">
              <h3 className="font-medium">
                {t('medications.doseCorrection.review', 'Review changes')}
              </h3>
              {amountChanged && freshPreview?.review ? (
                <>
                  <dl className="grid grid-cols-1 gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                    <dt>
                      {t(
                        'medications.doseCorrection.delivered',
                        'Delivered dose'
                      )}
                    </dt>
                    <dd className="min-w-0 break-words">
                      {freshPreview.review.previous?.doseMg ??
                        editingInj?.dose_mg ??
                        '—'}{' '}
                      mg → {freshPreview.deliveredMassMcg} mcg
                    </dd>
                    <dt>
                      {t('medications.doseCorrection.volume', 'Draw volume')}
                    </dt>
                    <dd className="min-w-0 break-words">
                      {freshPreview.review.previous?.volumeMl ??
                        editingInj?.volume_ml ??
                        '—'}{' '}
                      → {freshPreview.deliveredVolumeMl} mL
                    </dd>
                    <dt>
                      {t(
                        'medications.doseCorrection.remaining',
                        'Remaining in vial'
                      )}
                    </dt>
                    <dd className="min-w-0 break-words">
                      {freshPreview.review.remainingBeforeMl ?? '—'} →{' '}
                      {freshPreview.review.remainingAfterMl ?? '—'} mL
                    </dd>
                  </dl>
                  <MedicationDrawPreview
                    preview={freshPreview}
                    deviceType={
                      originalDevice?.device_type ??
                      (nasal ? 'pump' : 'syringe')
                    }
                    isFetching={previewQ.isFetching}
                    isError={previewQ.isError}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {amountChanged
                    ? staleReview
                      ? t(
                          'medications.doseCorrection.stale',
                          'The dose or vial balance changed. Go back and review again.'
                        )
                      : t(
                          'medications.doseCorrection.checking',
                          'Checking the current dose and vial balance…'
                        )
                    : t(
                        'medications.doseCorrection.unchanged',
                        'The recorded dose and vial balance will not change.'
                      )}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingInj(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            {reviewing && (
              <Button variant="outline" onClick={() => setReviewing(false)}>
                {t('common.back', 'Back')}
              </Button>
            )}
            <Button
              onClick={() => {
                if (calculatedEntry && !reviewing) {
                  setReviewedState(previewQ.data?.review?.state ?? null);
                  setReviewing(true);
                } else handleSaveEdit();
              }}
              disabled={
                updateInjMutation.isPending ||
                associationStale ||
                (association !== null &&
                  (!courseScope.isCurrent() || !courseScope.canWrite)) ||
                editAmountBlocked ||
                staleReview ||
                editTimeInvalid
              }
            >
              {updateInjMutation.isPending
                ? t('common.saving', 'Saving...')
                : calculatedEntry
                  ? reviewing
                    ? t(
                        'medications.doseCorrection.confirm',
                        'Confirm and save'
                      )
                    : t('medications.doseCorrection.review', 'Review changes')
                  : t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
