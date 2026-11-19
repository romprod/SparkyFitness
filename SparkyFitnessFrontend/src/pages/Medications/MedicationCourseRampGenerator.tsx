import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  generateTitrationRamp,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Steps = MedicationCoursePlanInput['steps'];
type Failure = Extract<
  ReturnType<typeof generateTitrationRamp>,
  { ok: false }
>['error'];

/**
 * Fills the course's authored phases from a start dose, target dose, increase
 * and weeks per phase. The rows stay editable and nothing is saved until the
 * course goes through its normal review.
 */
export default function MedicationCourseRampGenerator({
  unit,
  hasPhases,
  disabled,
  onGenerate,
}: {
  unit: string;
  hasPhases: boolean;
  disabled: boolean;
  onGenerate: (steps: Steps) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    start: '',
    target: '',
    increase: '',
    weeks: '4',
  });
  const [error, setError] = useState<Failure | null>(null);
  const [made, setMade] = useState<number | null>(null);
  const edit = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setError(null);
    setMade(null);
  };
  const messages: Record<Failure, string> = {
    start_invalid: t(
      'medications.courses.ramp.startInvalid',
      'Enter a start dose above zero.'
    ),
    target_invalid: t(
      'medications.courses.ramp.targetInvalid',
      'Enter a target dose above zero.'
    ),
    increase_invalid: t(
      'medications.courses.ramp.increaseInvalid',
      'Enter how much each phase goes up by, above zero.'
    ),
    weeks_invalid: t(
      'medications.courses.ramp.weeksInvalid',
      'Enter weeks per phase from 0.15 (about one day) up to 104.'
    ),
    unit_missing: t(
      'medications.courses.ramp.unitMissing',
      'Set the course dose unit first.'
    ),
    start_above_target: t(
      'medications.courses.ramp.startAboveTarget',
      'The start dose must not be above the target dose.'
    ),
    too_many_phases: t(
      'medications.courses.ramp.tooMany',
      'That would need more than 100 phases. Check the increase and its unit.'
    ),
  };
  const generate = () => {
    const result = generateTitrationRamp({
      start_dose: form.start,
      target_dose: form.target,
      increase_by: form.increase,
      weeks_per_phase: Number(form.weeks),
      dose_unit: unit,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setMade(result.phases.length);
    onGenerate(result.phases);
  };
  const field = (
    id: string,
    label: string,
    key: keyof typeof form,
    inputMode: 'decimal' | 'numeric' = 'decimal'
  ) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode={inputMode}
        value={form[key]}
        disabled={disabled}
        onChange={(event) => edit({ [key]: event.target.value })}
      />
    </div>
  );
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t('medications.courses.ramp.title', 'Generate phases from a ramp')}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.courses.ramp.help',
            'Builds one phase per step from the start dose to the target dose. The last phase has no end date. You can edit every phase afterwards, and nothing is saved until you review and save the course.'
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          {field(
            'ramp-start',
            t('medications.courses.ramp.start', 'Start dose ({{unit}})', {
              unit,
            }),
            'start'
          )}
          {field(
            'ramp-target',
            t('medications.courses.ramp.target', 'Target dose ({{unit}})', {
              unit,
            }),
            'target'
          )}
          {field(
            'ramp-increase',
            t('medications.courses.ramp.increase', 'Increase by ({{unit}})', {
              unit,
            }),
            'increase'
          )}
          {field(
            'ramp-weeks',
            t('medications.courses.ramp.weeks', 'Weeks per phase'),
            'weeks'
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {messages[error]}
          </p>
        )}
        {made !== null && (
          <p role="status" className="text-sm">
            {t('medications.courses.ramp.made', {
              defaultValue_one:
                'Created {{count}} phase below. Review it, then save the course.',
              defaultValue_other:
                'Created {{count}} phases below. Review them, then save the course.',
              count: made,
            })}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={generate}
        >
          {hasPhases
            ? t(
                'medications.courses.ramp.replace',
                'Replace the phases below with this ramp'
              )
            : t('medications.courses.ramp.generate', 'Generate phases')}
        </Button>
      </div>
    </details>
  );
}
