import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  medicationPrescriptionCreateSchema,
  medicationPrescriptionUpdateSchema,
  type MedicationPrescription,
  type MedicationPrescriptionCreate,
  type MedicationPrescriptionUpdate,
} from '@workspace/shared';
import {
  useMedicationPrescription,
  useMedicationPrescriptionActions,
  useMedicationPrescriptionScope,
  useMedicationPrescriptions,
} from '@/hooks/Medications/useMedicationPrescriptions';
import { HttpApiError } from '@/hooks/Medications/useMedicationCourses';
import type { Medication } from '@/types/medications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

type Scope = ReturnType<typeof useMedicationPrescriptionScope>;
type Attempt =
  | { kind: 'create'; body: MedicationPrescriptionCreate }
  | { kind: 'update'; id: string; body: MedicationPrescriptionUpdate };
function seed(initial: MedicationPrescription | undefined, target: string) {
  return {
    medication_id: initial?.medication_id ?? target,
    source: initial?.source ?? '',
    pharmacy: initial?.pharmacy ?? '',
    prescriber: initial?.prescriber ?? '',
    dose_instructions: initial?.dose_instructions ?? '',
    cost: initial?.cost ?? '',
    currency: initial?.currency ?? 'AUD',
    quantity: initial?.quantity == null ? '' : String(initial.quantity),
    refills_authorized:
      initial?.refills_authorized == null
        ? ''
        : String(initial.refills_authorized),
    refills_remaining:
      initial?.refills_remaining == null
        ? ''
        : String(initial.refills_remaining),
    date_written: initial?.date_written ?? '',
    next_refill: initial?.next_refill ?? '',
    expiration: initial?.expiration ?? '',
    lead_time_days:
      initial?.lead_time_days == null ? '' : String(initial.lead_time_days),
    status: initial?.status ?? 'active',
  };
}
export default function MedicationPrescriptionForm({
  scope,
  medications,
  initial,
  fixedMedicationId,
  onClose,
  onSaved,
  returnFocus,
  onFallbackFocus,
}: {
  scope: Scope;
  medications: Medication[];
  initial?: MedicationPrescription;
  fixedMedicationId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
  returnFocus?: HTMLElement | null;
  onFallbackFocus?: () => void;
}) {
  const { t } = useTranslation();
  const actions = useMedicationPrescriptionActions(scope);
  const register = useMedicationPrescriptions();
  const detail = useMedicationPrescription(initial?.id, !!initial);
  const [base, setBase] = useState(initial);
  const [costTouched, setCostTouched] = useState(false);
  const [draft, setDraft] = useState(() =>
    seed(initial, fixedMedicationId ?? medications[0]?.id ?? '')
  );
  const [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [stale, setStale] = useState(false),
    [message, setMessage] = useState('');
  const attempt = useRef<Attempt | null>(null);
  const flight = useRef(false);
  const locked = pending || uncertain;
  const change = (key: keyof typeof draft, value: string) => {
    if (locked) return;
    attempt.current = null;
    if (key === 'cost') setCostTouched(true);
    setDraft((old) => ({ ...old, [key]: value }));
    setMessage('');
  };
  const save = async () => {
    if (
      !scope.isCurrent() ||
      !scope.ready ||
      !scope.canWrite ||
      flight.current ||
      stale
    )
      return;
    if (!attempt.current) {
      const { medication_id, ...fields } = draft;
      const operation_id = crypto.randomUUID();
      const basis = costTouched
        ? { cost_basis: fields.cost.trim() ? ('per_vial' as const) : null }
        : base?.cost_basis === 'per_vial' && fields.cost.trim()
          ? { cost_basis: 'per_vial' as const }
          : {};
      if (base) {
        const parsed = medicationPrescriptionUpdateSchema.safeParse({
          ...fields,
          ...basis,
          operation_id,
          expected_version: base.version,
        });
        if (!parsed.success) {
          setMessage(
            parsed.error.issues
              .map(
                (issue) =>
                  `${issue.path.join('.').replaceAll('_', ' ')}: ${issue.message}`
              )
              .join('; ')
          );
          return;
        }
        attempt.current = { kind: 'update', id: base.id, body: parsed.data };
      } else {
        const parsed = medicationPrescriptionCreateSchema.safeParse({
          ...fields,
          ...basis,
          medication_id,
          operation_id,
        });
        if (!parsed.success) {
          setMessage(
            parsed.error.issues
              .map(
                (issue) =>
                  `${issue.path.join('.').replaceAll('_', ' ')}: ${issue.message}`
              )
              .join('; ')
          );
          return;
        }
        attempt.current = { kind: 'create', body: parsed.data };
      }
    }
    flight.current = true;
    setPending(true);
    setMessage('');
    try {
      const saved =
        attempt.current.kind === 'create'
          ? await actions.create(attempt.current.body)
          : await actions.update(attempt.current.id, attempt.current.body);
      if (scope.isCurrent()) onSaved(saved.id);
    } catch (error) {
      if (!scope.isCurrent()) return;
      const deterministic =
        error instanceof HttpApiError &&
        [400, 404, 409, 410, 422].includes(error.status);
      const missing = error instanceof HttpApiError && error.status === 404;
      if (missing || (!uncertain && deterministic)) {
        attempt.current = null;
        setStale(!!base && (error.status === 409 || missing));
        if (missing) {
          setUncertain(false);
          void register.query.refetch();
        }
        setMessage(
          error.status === 404
            ? t(
                'medications.prescriptions.missingRecord',
                'This prescription or medication is no longer available. Close and refresh the list.'
              )
            : error.status === 409 && base
              ? t(
                  'medications.prescriptions.stale',
                  'This prescription changed. Reload the saved record before saving again.'
                )
              : t(
                  'medications.prescriptions.rejected',
                  'The prescription was not accepted. Check the fields and try again.'
                )
        );
      } else {
        setUncertain(true);
        setMessage(
          t(
            'medications.prescriptions.uncertain',
            'The result is uncertain. Retry this same save before editing or closing.'
          )
        );
      }
    } finally {
      flight.current = false;
      setPending(false);
    }
  };
  const reload = async () => {
    if (!scope.isCurrent() || locked || !base) return;
    setPending(true);
    try {
      const fresh = await detail.query.refetch();
      if (!scope.isCurrent()) return;
      if (fresh.isSuccess && fresh.data?.prescription) {
        setBase(fresh.data.prescription);
        setDraft(seed(fresh.data.prescription, ''));
        setCostTouched(false);
        attempt.current = null;
        setStale(false);
        setMessage('');
      } else
        setMessage(
          t(
            'medications.prescriptions.reloadError',
            'Could not reload the saved prescription. Your draft is retained.'
          )
        );
    } finally {
      setPending(false);
    }
  };
  const field = (
    key: keyof typeof draft,
    label: string,
    type = 'text',
    inputMode?: 'decimal' | 'numeric'
  ) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={`rx-${key}`}>{label}</Label>
      <Input
        id={`rx-${key}`}
        value={draft[key]}
        type={type}
        inputMode={inputMode}
        onChange={(event) => change(key, event.target.value)}
        onInput={
          key === 'cost'
            ? () => {
                if (!locked) setCostTouched(true);
              }
            : undefined
        }
      />
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (scope.isCurrent()) {
            if (returnFocus?.isConnected) returnFocus.focus();
            else onFallbackFocus?.();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {base
              ? t('medications.prescriptions.edit', 'Edit prescription')
              : t('medications.prescriptions.basic', 'Basic prescription')}
          </DialogTitle>
        </DialogHeader>
        <fieldset disabled={locked} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rx-medication">
              {t('medications.prescriptions.medication', 'Medication')}
            </Label>
            <select
              id="rx-medication"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              disabled={!!base || !!fixedMedicationId}
              value={
                base?.medication_id === null ? 'deleted' : draft.medication_id
              }
              onChange={(event) => change('medication_id', event.target.value)}
            >
              {base?.medication_id === null ? (
                <option value="deleted">
                  {base.medication_name} ·{' '}
                  {t(
                    'medications.prescriptions.deletedTarget',
                    'Deleted medication'
                  )}
                </option>
              ) : (
                <>
                  <option value="">
                    {t(
                      'medications.prescriptions.chooseMedication',
                      'Choose a medication'
                    )}
                  </option>
                  {medications.map((med) => (
                    <option key={med.id} value={med.id}>
                      {med.display_name || med.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          {base?.cost !== null &&
            base?.cost !== undefined &&
            base.cost_basis !== 'per_vial' &&
            !costTouched && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.costEstimates.unconfirmedHelp',
                  'This existing cost has no confirmed per-vial basis. Re-enter the cost to use it as an estimate; editing other fields does not confirm it.'
                )}
              </p>
            )}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('source', t('medications.prescriptions.source', 'Source'))}
            {field(
              'pharmacy',
              t('medications.prescriptions.pharmacy', 'Pharmacy')
            )}
            {field(
              'prescriber',
              t('medications.prescriptions.prescriber', 'Prescriber')
            )}
            {field(
              'dose_instructions',
              t('medications.prescriptions.instructions', 'Dose instructions')
            )}
            {field(
              'cost',
              t('medications.costEstimates.costPerVial', 'Cost per vial'),
              'text',
              'decimal'
            )}
            {field(
              'currency',
              t('medications.prescriptions.currency', 'Currency')
            )}
            {field(
              'quantity',
              t('medications.prescriptions.quantity', 'Quantity'),
              'text',
              'numeric'
            )}
            {field(
              'refills_authorized',
              t('medications.prescriptions.authorized', 'Refills authorized'),
              'text',
              'numeric'
            )}
            {field(
              'refills_remaining',
              t('medications.prescriptions.remaining', 'Refills remaining'),
              'text',
              'numeric'
            )}
            {field(
              'date_written',
              t('medications.prescriptions.written', 'Date written'),
              'date'
            )}
            {field(
              'next_refill',
              t('medications.prescriptions.nextRefill', 'Next refill date'),
              'date'
            )}
            {field(
              'expiration',
              t('medications.prescriptions.expiration', 'Expiry date'),
              'date'
            )}
            {field(
              'lead_time_days',
              t('medications.prescriptions.lead', 'Reorder lead time (days)'),
              'text',
              'numeric'
            )}
            {base && (
              <div className="space-y-1">
                <Label htmlFor="rx-status">
                  {t('medications.prescriptions.status', 'Stored status')}
                </Label>
                <select
                  id="rx-status"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={draft.status}
                  onChange={(event) => change('status', event.target.value)}
                >
                  {(['active', 'expired', 'cancelled'] as const).map(
                    (status) => (
                      <option key={status} value={status}>
                        {t(
                          `medications.prescriptions.statuses.${status}`,
                          status
                        )}
                      </option>
                    )
                  )}
                </select>
              </div>
            )}
          </div>
        </fieldset>
        {message && (
          <p
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-foreground break-words"
          >
            {message}
          </p>
        )}
        {stale && !uncertain && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void reload()}
          >
            {t(
              'medications.prescriptions.reload',
              'Reload saved prescription (discards this draft)'
            )}
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={locked} onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={
              pending ||
              stale ||
              !scope.ready ||
              !scope.canWrite ||
              (!base && !draft.medication_id)
            }
            onClick={() => void save()}
          >
            {pending
              ? t('common.saving', 'Saving…')
              : uncertain
                ? t('medications.prescriptions.retry', 'Retry same save')
                : t('medications.prescriptions.save', 'Save prescription')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
