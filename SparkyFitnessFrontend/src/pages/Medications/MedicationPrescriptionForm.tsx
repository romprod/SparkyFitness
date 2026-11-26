import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchemaV2,
  MAX_PRESCRIPTION_MEDICATIONS,
  type MedicationPrescriptionCreateV2,
  type MedicationPrescriptionUpdateV2,
} from '@workspace/shared';
import {
  useMedicationPrescription,
  useMedicationPrescriptionActions,
  useMedicationPrescriptionScope,
  useMedicationPrescriptions,
} from '@/hooks/Medications/useMedicationPrescriptions';
import { HttpApiError } from '@/hooks/Medications/useMedicationCourses';
import type { Medication } from '@/types/medications';
import {
  liveCoveredIds,
  prescriptionBasisIntent,
  prescriptionCoverage,
  type PrescriptionBasisChoice,
  type PrescriptionRecord,
} from './medicationPrescriptionPresentation';
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
  | { kind: 'create'; body: MedicationPrescriptionCreateV2 }
  | { kind: 'update'; id: string; body: MedicationPrescriptionUpdateV2 };
function seed(initial: PrescriptionRecord | undefined) {
  return {
    source: initial?.source ?? '',
    pharmacy: initial?.pharmacy ?? '',
    prescriber: initial?.prescriber ?? '',
    dose_instructions: initial?.dose_instructions ?? '',
    cost: initial?.cost ?? '',
    currency: initial?.currency ?? '',
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
  defaultCurrency,
  onClose,
  onSaved,
  returnFocus,
  onFallbackFocus,
}: {
  scope: Scope;
  medications: Medication[];
  initial?: PrescriptionRecord;
  /** The medication the prescription is for; it stays the primary. More can be added around it. */
  fixedMedicationId?: string;
  /** Currency of the newest prescription or invoice; prefills a new record. */
  defaultCurrency?: string;
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
  const [stored, setDraft] = useState(() => seed(initial));
  // The covered medicines in order; the first is the primary. Deleted ones are kept by the server.
  const [ids, setIds] = useState<string[]>(() =>
    initial
      ? liveCoveredIds(initial)
      : [fixedMedicationId ?? medications[0]?.id ?? ''].filter(Boolean)
  );
  const [choice, setChoice] = useState<PrescriptionBasisChoice>(
    initial?.cost_basis ?? ''
  );
  // An older server answers in the one-medicine shape; several medicines would be rejected there.
  const serverRows = register.data?.prescriptions;
  const manyUnsupported =
    !!serverRows?.length &&
    serverRows.every((row) => row.medications === undefined);
  const [currencyError, setCurrencyError] = useState(false);
  const [currencyTyped, setCurrencyTyped] = useState(false);
  // A new record follows the default (which may arrive after the form opens)
  // until the user types a currency; an existing record keeps its own.
  const draft =
    base || currencyTyped
      ? stored
      : { ...stored, currency: defaultCurrency ?? '' };
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
    if (key === 'currency') {
      setCurrencyTyped(true);
      setCurrencyError(false);
    }
    setDraft((old) => ({ ...old, [key]: value }));
    setMessage('');
  };
  const editIds = (next: string[]) => {
    if (locked) return;
    attempt.current = null;
    setIds(next);
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
      const fields = draft;
      if (!fields.currency.trim()) {
        setCurrencyError(true);
        return;
      }
      // A prescription cannot expire, or be due for a refill, before it was written.
      const written = fields.date_written.trim();
      const outOfOrder = (later: string) =>
        !!written && !!later.trim() && written > later.trim();
      if (outOfOrder(fields.expiration) || outOfOrder(fields.next_refill)) {
        setMessage(
          t(
            'medications.prescriptions.dateOrder',
            'Date written must be on or before the expiry and next refill dates.'
          )
        );
        return;
      }
      const operation_id = crypto.randomUUID();
      const basis = prescriptionBasisIntent({
        medicationCount: ids.length,
        baseBasis: base?.cost_basis,
        hasBase: !!base,
        costTouched,
        cost: fields.cost,
        choice,
      });
      if (base) {
        const current = liveCoveredIds(base);
        const changed =
          ids.length !== current.length ||
          ids.some((id, index) => id !== current[index]);
        const parsed = medicationPrescriptionUpdateSchemaV2.safeParse({
          ...fields,
          ...basis,
          ...(changed ? { medication_ids: ids } : {}),
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
        // One medicine is sent exactly as before several existed, so an older server accepts it.
        const parsed = medicationPrescriptionCreateSchemaV2.safeParse({
          ...fields,
          ...basis,
          ...(ids.length === 1
            ? { medication_id: ids[0] }
            : { medication_ids: ids }),
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
      // These refusals are about the draft itself, not a stale record: name them and keep editing.
      const refusal =
        error instanceof HttpApiError &&
        (error.code === 'prescription_medication_linked' ||
          error.code === 'cost_basis_per_vial_needs_one_medication')
          ? error
          : null;
      if (refusal && !uncertain) {
        attempt.current = null;
        setMessage(refusal.message);
      } else if (missing || (!uncertain && deterministic)) {
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
        setDraft(seed(fresh.data.prescription));
        setIds(liveCoveredIds(fresh.data.prescription));
        setChoice(fresh.data.prescription.cost_basis ?? '');
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
  const nameOf = (id: string) => {
    const known = medications.find((med) => med.id === id);
    return (
      (known && (known.display_name || known.name)) ||
      (base
        ? prescriptionCoverage(base).find((entry) => entry.medication_id === id)
            ?.medication_name
        : undefined) ||
      id
    );
  };
  const tombstones = base
    ? prescriptionCoverage(base).filter((entry) => entry.medication_id === null)
    : [];
  const addable = medications.filter((med) => !ids.includes(med.id));
  // Several medicines share one total price; so does a single one that already has a whole-fill price.
  const wholeFill = ids.length > 1 || base?.cost_basis === 'per_prescription';
  const field = (
    key: keyof typeof draft,
    label: string,
    type = 'text',
    inputMode?: 'decimal' | 'numeric',
    placeholder?: string
  ) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={`rx-${key}`}>{label}</Label>
      <Input
        id={`rx-${key}`}
        value={draft[key]}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={key === 'currency' && currencyError ? true : undefined}
        aria-describedby={
          key === 'currency' && currencyError ? 'rx-currency-error' : undefined
        }
        onChange={(event) => change(key, event.target.value)}
        onInput={
          key === 'cost'
            ? () => {
                if (!locked) setCostTouched(true);
              }
            : undefined
        }
      />
      {key === 'currency' && currencyError && (
        <p
          id="rx-currency-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {t(
            'medications.prescriptions.currencyRequired',
            'Enter a currency, for example GBP.'
          )}
        </p>
      )}
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
              value={base?.medication_id === null ? 'deleted' : (ids[0] ?? '')}
              onChange={(event) => {
                const next = event.target.value;
                editIds(
                  next
                    ? [next, ...ids.slice(1).filter((id) => id !== next)]
                    : ids.slice(1)
                );
              }}
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
          {(ids.length > 1 || tombstones.length > 0) && (
            <ul
              aria-label={t(
                'medications.prescriptions.covered',
                'Medications covered'
              )}
              className="space-y-1"
            >
              {ids.map((id, index) => {
                const name = nameOf(id);
                const lockedPrimary = !!fixedMedicationId && index === 0;
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {index + 1}. {name}
                      {index === 0 && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {t('medications.prescriptions.primary', 'Primary')}
                        </span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        index === 0 || (index === 1 && !!fixedMedicationId)
                      }
                      aria-label={t(
                        'medications.prescriptions.moveUp',
                        'Move {{name}} up',
                        { name }
                      )}
                      onClick={() => {
                        const next = [...ids];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        editIds(next);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === ids.length - 1 || lockedPrimary}
                      aria-label={t(
                        'medications.prescriptions.moveDown',
                        'Move {{name}} down',
                        { name }
                      )}
                      onClick={() => {
                        const next = [...ids];
                        [next[index], next[index + 1]] = [
                          next[index + 1]!,
                          next[index]!,
                        ];
                        editIds(next);
                      }}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={ids.length === 1 || lockedPrimary}
                      aria-label={t(
                        'medications.prescriptions.removeMedication',
                        'Remove {{name}}',
                        { name }
                      )}
                      onClick={() => editIds(ids.filter((x) => x !== id))}
                    >
                      ✕
                    </Button>
                  </li>
                );
              })}
              {tombstones.map((entry, index) => (
                <li
                  key={'deleted-' + index}
                  className="rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground"
                >
                  {entry.medication_name} ·{' '}
                  {t(
                    'medications.prescriptions.deletedTarget',
                    'Deleted medication'
                  )}
                </li>
              ))}
            </ul>
          )}
          {addable.length > 0 && ids.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="rx-add-medication">
                {t(
                  'medications.prescriptions.addMedication',
                  'Also covers another medication'
                )}
              </Label>
              <select
                id="rx-add-medication"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                disabled={
                  manyUnsupported || ids.length >= MAX_PRESCRIPTION_MEDICATIONS
                }
                value=""
                onChange={(event) => {
                  if (event.target.value) editIds([...ids, event.target.value]);
                }}
              >
                <option value="">
                  {manyUnsupported
                    ? t(
                        'medications.prescriptions.needsServerUpdate',
                        'Needs a server update'
                      )
                    : t(
                        'medications.prescriptions.addChoose',
                        'Add a medication…'
                      )}
                </option>
                {addable.map((med) => (
                  <option key={med.id} value={med.id}>
                    {med.display_name || med.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {ids.length > 1 && base?.cost_basis === 'per_vial' && (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.prescriptions.clearsPerVial',
                'A per-vial price belongs to one medication, so saving clears its per-vial confirmation. The cost is kept.'
              )}
            </p>
          )}
          {base?.cost !== null &&
            base?.cost !== undefined &&
            base.cost_basis !== 'per_vial' &&
            base.cost_basis !== 'per_prescription' &&
            !costTouched && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.costEstimates.unconfirmedHelp',
                  'This existing cost has no confirmed per-vial basis. Re-enter the cost to use it as an estimate; editing other fields does not confirm it.'
                )}
              </p>
            )}
          <div className="grid gap-3 sm:grid-cols-2">
            {field(
              'source',
              t('medications.prescriptions.source', 'Source'),
              'text',
              undefined,
              t(
                'medications.prescriptions.sourcePlaceholder',
                'e.g. your supplier'
              )
            )}
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
              t('medications.prescriptions.instructions', 'Dose instructions'),
              'text',
              undefined,
              t(
                'medications.prescriptions.instructionsPlaceholder',
                'e.g. 0.5 mL three times a week'
              )
            )}
            {field(
              'cost',
              wholeFill
                ? t('medications.prescriptions.totalCost', 'Total cost')
                : t('medications.costEstimates.costPerVial', 'Cost per vial'),
              'text',
              'decimal'
            )}
            {wholeFill && (
              <div className="space-y-1">
                <Label htmlFor="rx-cost-basis">
                  {t('medications.prescriptions.priceBasis', 'Price basis')}
                </Label>
                <select
                  id="rx-cost-basis"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={choice === 'per_prescription' ? choice : ''}
                  onChange={(event) => {
                    if (locked) return;
                    attempt.current = null;
                    setChoice(event.target.value as PrescriptionBasisChoice);
                  }}
                >
                  <option value="">
                    {t(
                      'medications.prescriptions.basisNone',
                      'Not used for estimates'
                    )}
                  </option>
                  <option value="per_prescription">
                    {t(
                      'medications.prescriptions.basisWhole',
                      'Whole prescription, split across its linked vials'
                    )}
                  </option>
                </select>
              </div>
            )}
            {field(
              'currency',
              t('medications.prescriptions.currency', 'Currency'),
              'text',
              undefined,
              t('medications.prescriptions.currencyPlaceholder', 'e.g. GBP')
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
              'numeric',
              'e.g. 14'
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
              (!base && !ids.length)
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
