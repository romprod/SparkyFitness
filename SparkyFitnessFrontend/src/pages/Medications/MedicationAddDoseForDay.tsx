import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localDateTimeToUtc, medicationDoseInMg } from '@workspace/shared';
import type { Medication, MedicationDetail } from '@/types/medications';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useCreateMedicationEntryMutation } from '@/hooks/useMedications';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateTimeInput } from '@/components/ui/TimeInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Injectables with stock follow the injection flow, which needs a site and a pack. */
const isStockInjectable = (med: Medication) =>
  med.type_id === 'injection' &&
  (med.is_glp1 || medicationDoseInMg(med, 1) !== null);

/**
 * Records a dose that was taken or skipped on a day the person forgot to log. The time is theirs to
 * set, so an evening dose stays an evening dose.
 */
export default function MedicationAddDoseForDay({
  day,
  medications,
  medicationId,
}: {
  day: string;
  medications: Medication[];
  medicationId?: string;
}) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const create = useCreateMedicationEntryMutation();
  const choices = medications.filter(
    (med) => med.is_active !== false && !isStockInjectable(med)
  );
  const [medId, setMedId] = useState(
    choices.find((med) => med.id === medicationId)?.id ?? ''
  );
  const [status, setStatus] = useState<'taken' | 'skipped'>('taken');
  const [touched, setTouched] = useState(false);
  const med = choices.find((item) => item.id === medId);
  const plannedTime = (med as MedicationDetail | undefined)?.schedules?.find(
    (schedule) => schedule.time_of_day
  )?.time_of_day;
  const [time, setTime] = useState('');
  const effectiveTime =
    touched && time ? time : `${day}T${(plannedTime ?? '12:00').slice(0, 5)}`;
  const instant = new Date(localDateTimeToUtc(effectiveTime, timezone));
  const valid = !!med && Number.isFinite(instant.getTime());
  if (choices.length === 0) return null;
  return (
    <section
      aria-label={t('medications.week.addDoseTitle', 'Add a dose for this day')}
      className="space-y-2 rounded border p-3 text-sm"
    >
      <h3 className="font-semibold">
        {t('medications.week.addDoseTitle', 'Add a dose for this day')}
      </h3>
      <div className="space-y-1">
        <Label htmlFor="day-add-med">
          {t('medications.week.addDoseMedication', 'Medication or supplement')}
        </Label>
        <Select value={medId} onValueChange={setMedId}>
          <SelectTrigger id="day-add-med">
            <SelectValue
              placeholder={t('medications.week.addDosePick', 'Choose one')}
            />
          </SelectTrigger>
          <SelectContent>
            {choices.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.display_name || item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="day-add-status">
          {t('medications.week.addDoseStatus', 'What happened')}
        </Label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as typeof status)}
        >
          <SelectTrigger id="day-add-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="taken">
              {t('medications.week.status.taken', 'Taken')}
            </SelectItem>
            <SelectItem value="skipped">
              {t('medications.week.status.skipped', 'Skipped')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="day-add-time">
          {t('medications.week.actualTime', 'Actual date & time')} ({timezone})
        </Label>
        <DateTimeInput
          id="day-add-time"
          value={effectiveTime}
          onChange={(value) => {
            setTouched(true);
            setTime(value);
          }}
        />
      </div>
      {create.isError && (
        <p role="alert">
          {t('medications.week.addDoseError', 'Could not record this dose.')}
        </p>
      )}
      <Button
        size="sm"
        disabled={!valid || create.isPending}
        onClick={() => {
          if (!med) return;
          create.mutate({
            medication_id: med.id,
            status,
            taken_at: instant.toISOString(),
            entry_date: day,
            notes: null,
          });
        }}
      >
        {t('medications.week.addDoseSave', 'Record dose')}
      </Button>
    </section>
  );
}
