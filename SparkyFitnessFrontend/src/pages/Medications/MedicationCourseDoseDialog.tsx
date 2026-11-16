import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localDateTimeToUtc,
  medicationCourseDoseSchema,
  utcToLocalDateTimeInput,
  type MedicationCourseAttributionInput,
  type MedicationCourseExpectedSlot,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimeInput } from '@/components/ui/TimeInput';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateMedicationEntryMutation } from '@/hooks/useMedications';
import { useMedicationCourseScope } from '@/hooks/Medications/useMedicationCourses';
import type { MedicationDetail } from '@/types/medications';
import Glp1LogInjection from './Glp1LogInjection';

function slotAttribution(
  slot: MedicationCourseExpectedSlot
): MedicationCourseAttributionInput {
  return {
    course_revision_id: slot.course_revision_id,
    course_rule_id: slot.course_rule_id,
    course_step_id: slot.course_step_id,
    course_slot_key: slot.course_slot_key,
    course_expected_version: slot.course_expected_version,
    scheduled_day: slot.scheduled_day,
    scheduled_for: slot.scheduled_for,
  };
}

interface Props {
  med: MedicationDetail;
  slot: MedicationCourseExpectedSlot;
  prepared: boolean;
  takenAt: string;
  notes: string | null;
  onClose: () => void;
  onLogged: () => void;
  onRefresh?: () => Promise<MedicationCourseExpectedSlot | null>;
}

/** Managed expected amounts never become actual quantities without confirmation. */
export default function MedicationCourseDoseDialog({
  med,
  slot,
  prepared,
  takenAt,
  notes,
  onClose,
  onLogged,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const scope = useMedicationCourseScope();
  const { timezone } = usePreferences();
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const localTime = timeDraft ?? utcToLocalDateTimeInput(takenAt, timezone);
  const mutation = useCreateMedicationEntryMutation();
  const [actual, setActual] = useState('');
  const [unit, setUnit] = useState('');
  const [stale, setStale] = useState(false);
  const [reviewedSlot, setReviewedSlot] = useState(slot);
  const [refreshing, setRefreshing] = useState(false);
  const context = slotAttribution(reviewedSlot);
  const plannedDose = medicationCourseDoseSchema.safeParse(
    reviewedSlot.per_dose_amount
  ).success
    ? { value: reviewedSlot.per_dose_amount!, unit: reviewedSlot.dose_unit }
    : null;
  const allowed =
    scope.canWrite && scope.isCurrent() && med.user_id === scope.ownerId;
  const valid =
    localTime.length >= 16 &&
    actual.trim() !== '' &&
    Number.isFinite(Number(actual)) &&
    Number(actual) > 0 &&
    unit.trim() !== '';
  const submit = () => {
    if (
      !allowed ||
      !scope.canWrite ||
      !scope.isCurrent() ||
      !valid ||
      refreshing ||
      stale ||
      mutation.isPending
    )
      return;
    mutation.mutate(
      {
        medication_id: med.id,
        status: 'taken',
        taken_at:
          timeDraft === null
            ? takenAt
            : localDateTimeToUtc(localTime, timezone).toISOString(),
        entry_date: localTime.slice(0, 10),
        notes,
        ...context,
        dose_amount_snapshot: Number(actual),
        dose_unit_snapshot: unit.trim(),
      },
      {
        onSuccess: onLogged,
        onError: (error) => {
          if ((error as { status?: number }).status === 409) setStale(true);
        },
      }
    );
  };
  const refresh = async () => {
    if (!onRefresh || refreshing || !scope.isCurrent() || !scope.canWrite)
      return;
    setRefreshing(true);
    try {
      const fresh = await onRefresh();
      if (
        fresh &&
        fresh.course_slot_key === reviewedSlot.course_slot_key &&
        scope.isCurrent() &&
        scope.canWrite
      ) {
        setReviewedSlot(fresh);
        setStale(false);
      }
    } catch {
      // Keep the existing draft stopped; a failed read cannot authorise a retry.
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('medications.courses.confirmActual', 'Confirm actual dose')}
          </DialogTitle>
        </DialogHeader>
        {prepared && allowed ? (
          <Glp1LogInjection
            med={med}
            courseContext={context}
            plannedDose={plannedDose}
            initialTakenAt={takenAt}
            initialNotes={notes ?? ''}
            onLogged={onLogged}
          />
        ) : (
          <div className="space-y-3">
            <p>{med.display_name || med.name}</p>
            <p className="text-sm text-muted-foreground">
              {t('medications.courses.plannedDose', 'Planned dose')}:{' '}
              {plannedDose === null
                ? t('medications.courses.unknownDose', 'Unknown')
                : `${plannedDose.value} ${plannedDose.unit}`}
            </p>
            <Label id="course-actual-time-label">
              {t('medications.courses.actualTime', 'Actual date and time')}
            </Label>
            <DateTimeInput
              aria-labelledby="course-actual-time-label"
              value={localTime}
              onChange={setTimeDraft}
            />
            <Label htmlFor="course-actual-dose">
              {t('medications.courses.actualAmount', 'Actual amount')}
            </Label>
            <Input
              id="course-actual-dose"
              inputMode="decimal"
              value={actual}
              onChange={(event) => setActual(event.target.value)}
              disabled={!allowed || mutation.isPending}
            />
            <Label htmlFor="course-actual-unit">
              {t('medications.courses.actualUnit', 'Actual unit')}
            </Label>
            <Input
              id="course-actual-unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              disabled={!allowed || mutation.isPending}
            />
            {stale && (
              <p role="alert">
                {t(
                  'medications.courses.staleDose',
                  'The course changed. Refresh the checklist and review the dose before trying again. Your draft has been kept.'
                )}
              </p>
            )}
            {stale && onRefresh && (
              <Button
                variant="outline"
                onClick={refresh}
                disabled={!allowed || refreshing}
              >
                {t('medications.courses.refreshCourse', 'Refresh course')}
              </Button>
            )}
            <Button
              onClick={submit}
              disabled={
                !allowed || !valid || stale || refreshing || mutation.isPending
              }
            >
              {t('medications.courses.confirmActual', 'Confirm actual dose')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
