import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  todayInZone,
  formatPurchaseMoney,
  type MedicationPrescription,
  type MedicationPrescriptionDelete,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import {
  useMedicationPrescriptions,
  useMedicationPrescription,
  useMedicationPrescriptionActions,
} from '@/hooks/Medications/useMedicationPrescriptions';
import { HttpApiError } from '@/hooks/Medications/useMedicationCourses';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import MedicationPrescriptionForm from './MedicationPrescriptionForm';
import { prescriptionRefillNotice } from './medicationPrescriptionPresentation';

function DeletePrescription({
  record,
  result,
  onClose,
  returnFocus,
  onDeletedFocus,
}: {
  record: MedicationPrescription;
  result: ReturnType<typeof useMedicationPrescriptions>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  onDeletedFocus: () => void;
}) {
  const { t } = useTranslation();
  const { scope } = result;
  const actions = useMedicationPrescriptionActions(scope);
  const detail = useMedicationPrescription(record.id, true);
  const [version, setVersion] = useState(record.version),
    [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [stale, setStale] = useState(false),
    [message, setMessage] = useState('');
  const attempt = useRef<MedicationPrescriptionDelete | null>(null);
  const flight = useRef(false);
  const completed = useRef(false);
  const confirm = async () => {
    if (
      !scope.isCurrent() ||
      !scope.canWrite ||
      pending ||
      flight.current ||
      stale
    )
      return;
    if (!attempt.current)
      attempt.current = {
        expected_version: version,
        operation_id: crypto.randomUUID(),
      };
    flight.current = true;
    setPending(true);
    try {
      await actions.remove(record.id, attempt.current);
      if (scope.isCurrent()) {
        completed.current = true;
        onClose();
      }
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (
        error instanceof HttpApiError &&
        (error.status === 404 ||
          (!uncertain && [400, 409, 410, 422].includes(error.status)))
      ) {
        attempt.current = null;
        setStale(error.status === 409 || error.status === 404);
        if (error.status === 404) {
          setUncertain(false);
          completed.current = true;
          void result.query.refetch();
        }
        setMessage(
          error.status === 404
            ? t(
                'medications.prescriptions.missingRecord',
                'This prescription or medication is no longer available. Close and refresh the list.'
              )
            : t(
                'medications.prescriptions.deleteStale',
                'Could not delete this version. Refresh the saved prescription before trying again.'
              )
        );
      } else {
        setUncertain(true);
        setMessage(
          t(
            'medications.prescriptions.deleteUncertain',
            'The deletion result is uncertain. Retry the same deletion before closing.'
          )
        );
      }
    } finally {
      flight.current = false;
      setPending(false);
    }
  };
  const reload = async () => {
    if (!scope.isCurrent() || pending || uncertain) return;
    setPending(true);
    try {
      const fresh = await detail.query.refetch();
      if (scope.isCurrent() && fresh.isSuccess && fresh.data) {
        setVersion(fresh.data.prescription.version);
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !uncertain) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!scope.isCurrent()) return;
          if (completed.current) onDeletedFocus();
          else if (returnFocus?.isConnected) returnFocus.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('medications.prescriptions.deleteTitle', 'Delete prescription?')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'medications.prescriptions.deleteHelp',
              'This removes the prescription and its stock and plan links. Stock quantities, doses and plan history are kept.'
            )}
          </DialogDescription>
        </DialogHeader>
        <p>{record.medication_name}</p>
        {message && (
          <p
            role="alert"
            className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-foreground"
          >
            {message}
          </p>
        )}
        {stale && !uncertain && (
          <Button
            variant="outline"
            onClick={() => void reload()}
            disabled={pending}
          >
            {t(
              'medications.prescriptions.reloadRecord',
              'Reload saved prescription'
            )}
          </Button>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending || uncertain}
            onClick={onClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={pending || stale || !scope.canWrite}
            onClick={() => void confirm()}
          >
            {uncertain
              ? t(
                  'medications.prescriptions.retryDelete',
                  'Retry same deletion'
                )
              : t('common.confirm', 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default function MedicationPrescriptions({
  medications,
}: {
  medications: Medication[];
}) {
  const result = useMedicationPrescriptions();
  return result.scope.ready && result.scope.isCurrent() ? (
    <PrescriptionRegister
      key={result.scope.key}
      result={result}
      medications={medications}
    />
  ) : null;
}
function PrescriptionRegister({
  result,
  medications,
}: {
  result: ReturnType<typeof useMedicationPrescriptions>;
  medications: Medication[];
}) {
  const { t } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const mobile = useIsMobile();
  const { scope, query, data } = result;
  const today = todayInZone(timezone);
  const [edit, setEdit] = useState<{
    record?: MedicationPrescription;
    trigger: HTMLElement;
  } | null>(null);
  const [remove, setRemove] = useState<{
    record: MedicationPrescription;
    trigger: HTMLElement;
  } | null>(null);
  const basic = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle ref={heading} tabIndex={-1}>
            {t('medications.prescriptions.title', 'Prescriptions')}
          </CardTitle>
          {scope.canWrite && (
            <Button
              ref={basic}
              onClick={(event) => setEdit({ trigger: event.currentTarget })}
              disabled={!medications.length}
            >
              {t('medications.prescriptions.basic', 'Basic prescription')}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.prescriptions.manual',
            'Prescription details, statuses and refill counters are recorded manually. Linking does not change doses, stock or costs elsewhere.'
          )}
        </p>
        {!medications.length && scope.canWrite && (
          <p className="text-sm">
            {t(
              'medications.prescriptions.noTarget',
              'Add a medication before creating a new prescription. Existing prescription records remain available below.'
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading && (
          <p role="status">{t('common.loading', 'Loading…')}</p>
        )}
        {query.isError && (
          <div role="alert">
            <p>
              {t(
                'medications.prescriptions.loadError',
                'Could not load prescriptions.'
              )}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {data && !query.isError && (
          <>
            {!data.prescriptions.length && (
              <p>
                {t('medications.prescriptions.empty', 'No prescriptions yet.')}
              </p>
            )}
            <ul className="grid gap-4 lg:grid-cols-2">
              {data.prescriptions.map((record) => {
                const notice = prescriptionRefillNotice(record, today);
                return (
                  <li
                    key={record.id}
                    className="rounded-md border p-4 min-w-0 space-y-3"
                  >
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold break-words">
                          {record.medication_name ||
                            t(
                              'medications.prescriptions.singular',
                              'Prescription'
                            )}
                        </p>
                        {record.medication_id === null && (
                          <p className="text-xs text-muted-foreground">
                            {t(
                              'medications.prescriptions.deletedTarget',
                              'Deleted medication'
                            )}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground break-words">
                          {record.source ??
                            record.prescriber ??
                            record.pharmacy ??
                            '—'}
                        </p>
                      </div>
                      <Badge variant="outline" className="self-start">
                        {t(
                          `medications.prescriptions.statuses.${record.status}`,
                          record.status
                        )}
                      </Badge>
                    </div>
                    {notice && (
                      <p className="rounded border bg-muted p-2 text-xs">
                        {t(
                          'medications.prescriptions.refillNotice',
                          'Next refill date is within 7 days or overdue.'
                        )}
                      </p>
                    )}
                    <details open={!mobile}>
                      <summary className="cursor-pointer text-sm md:hidden">
                        {t('common.details', 'Details')}
                      </summary>
                      <div className="space-y-2 pt-2 text-sm">
                        {record.dose_instructions && (
                          <p className="whitespace-pre-wrap break-words">
                            {record.dose_instructions}
                          </p>
                        )}
                        <p>
                          {t(
                            'medications.prescriptions.remaining',
                            'Refills remaining'
                          )}
                          : {record.refills_remaining ?? '—'}
                          {record.refills_authorized !== null &&
                            ` / ${record.refills_authorized}`}
                        </p>
                        {record.cost !== null && (
                          <p>
                            {record.cost_basis === 'per_vial'
                              ? t(
                                  'medications.costEstimates.costPerVial',
                                  'Cost per vial'
                                )
                              : t(
                                  'medications.costEstimates.unconfirmedCost',
                                  'Recorded cost (basis unconfirmed)'
                                )}
                            :{' '}
                            {formatPurchaseMoney(record.cost, record.currency)}
                          </p>
                        )}
                        {record.next_refill && (
                          <p>
                            {t(
                              'medications.prescriptions.nextRefill',
                              'Next refill date'
                            )}
                            : {formatDate(record.next_refill)}
                          </p>
                        )}
                        {record.expiration && (
                          <p>
                            {t(
                              'medications.prescriptions.expiration',
                              'Expiry date'
                            )}
                            : {formatDate(record.expiration)}
                          </p>
                        )}
                        {record.pharmacy && (
                          <p>
                            {t(
                              'medications.prescriptions.pharmacy',
                              'Pharmacy'
                            )}
                            : {record.pharmacy}
                          </p>
                        )}
                      </div>
                    </details>
                    {scope.canWrite && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) =>
                            setEdit({ record, trigger: event.currentTarget })
                          }
                        >
                          {t('common.edit', 'Edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) =>
                            setRemove({ record, trigger: event.currentTarget })
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
          </>
        )}
        {edit && (
          <MedicationPrescriptionForm
            key={edit.record?.id ?? 'new'}
            scope={scope}
            medications={medications}
            initial={edit.record}
            onClose={() => setEdit(null)}
            onSaved={() => setEdit(null)}
            returnFocus={edit.trigger}
            onFallbackFocus={() => {
              const target = basic.current;
              if (target?.isConnected && !target.disabled) target.focus();
              else heading.current?.focus();
            }}
          />
        )}
        {remove && (
          <DeletePrescription
            record={remove.record}
            result={result}
            onClose={() => setRemove(null)}
            onDeletedFocus={() => {
              const target = basic.current;
              if (target?.isConnected && !target.disabled) target.focus();
              else heading.current?.focus();
            }}
            returnFocus={remove.trigger}
          />
        )}
      </CardContent>
    </Card>
  );
}
