import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Medication } from '@/types/medications';
import { useMedicationPrescriptions } from '@/hooks/Medications/useMedicationPrescriptions';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import MedicationPrescriptionForm from './MedicationPrescriptionForm';

export default function MedicationPrescriptionLink({
  medication,
  value,
  onChange,
  disabled = false,
}: {
  medication: Medication;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { scope, query, data } = useMedicationPrescriptions();
  const id = useId();
  const [create, setCreate] = useState<HTMLElement | null>(null);
  if (!scope.ready || !scope.isCurrent()) return null;
  const options =
    data?.prescriptions.filter((row) => row.medication_id === medication.id) ??
    [];
  const missing = !!value && !options.some((row) => row.id === value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {t('medications.prescriptions.link', 'Prescription (optional)')}
      </Label>
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          value={value ?? 'none'}
          disabled={
            disabled ||
            !scope.canWrite ||
            !data ||
            query.isFetching ||
            query.isError
          }
          onChange={(event) => {
            if (scope.isCurrent() && scope.canWrite)
              onChange(
                event.target.value === 'none' ? null : event.target.value
              );
          }}
        >
          <option value="none">
            {t('medications.prescriptions.noPrescription', 'No prescription')}
          </option>
          {missing && (
            <option value={value!} disabled>
              {t(
                'medications.prescriptions.missingLink',
                'Selected prescription unavailable; choose explicitly to change it'
              )}
            </option>
          )}
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {medication.display_name || medication.name} ·{' '}
              {row.source ??
                row.prescriber ??
                row.pharmacy ??
                t('medications.prescriptions.singular', 'Prescription')}{' '}
              ·{' '}
              {t(
                `medications.prescriptions.statuses.${row.status}`,
                row.status
              )}
              {row.expiration ? ` · ${formatDate(row.expiration)}` : ''}
            </option>
          ))}
        </select>
        {scope.canWrite && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={(event) => setCreate(event.currentTarget)}
          >
            {t('medications.prescriptions.new', 'New prescription')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.prescriptions.linkHelp',
          'Only prescriptions for this medication are listed, including expired or cancelled records. Linking does not change dosing or stock quantities.'
        )}
      </p>
      {query.isError && (
        <p role="alert" className="text-sm">
          {t(
            'medications.prescriptions.loadError',
            'Could not load prescriptions.'
          )}
        </p>
      )}
      {create && (
        <MedicationPrescriptionForm
          scope={scope}
          medications={[medication]}
          fixedMedicationId={medication.id}
          onClose={() => setCreate(null)}
          onSaved={(createdId) => {
            if (scope.isCurrent()) {
              onChange(createdId);
              setCreate(null);
            }
          }}
          returnFocus={create}
        />
      )}
    </div>
  );
}

export function MedicationPrescriptionSummary({
  medicationId,
  prescriptionId,
}: {
  medicationId: string;
  prescriptionId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { scope, data } = useMedicationPrescriptions(!!prescriptionId);
  if (!scope.ready || !scope.isCurrent()) return null;
  const row = data?.prescriptions.find(
    (item) => item.id === prescriptionId && item.medication_id === medicationId
  );
  return (
    <p className="text-sm">
      {t('medications.prescriptions.link', 'Prescription (optional)')}:{' '}
      {prescriptionId === undefined
        ? t('medications.prescriptions.unchanged', 'Unchanged')
        : prescriptionId === null
          ? t('medications.prescriptions.noPrescription', 'No prescription')
          : row
            ? `${row.source ?? row.prescriber ?? row.pharmacy ?? t('medications.prescriptions.singular', 'Prescription')} · ${t(`medications.prescriptions.statuses.${row.status}`, row.status)}`
            : t(
                'medications.prescriptions.linkUnavailable',
                'Linked prescription details unavailable'
              )}
    </p>
  );
}
