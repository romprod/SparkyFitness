import { useTranslation } from 'react-i18next';
import type { MedicationCourseAttributionInput } from '@workspace/shared';
import { useMedicationCourses } from '@/hooks/Medications/useMedicationCourses';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function MedicationCourseAttributionPicker({
  medicationId,
  initial,
  value,
  onChange,
  disabled = false,
}: {
  medicationId: string;
  initial?: MedicationCourseAttributionInput;
  value?: MedicationCourseAttributionInput | null;
  onChange: (value: MedicationCourseAttributionInput) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { scope, data, query } = useMedicationCourses(medicationId);
  if (!scope.ready) return null;
  const current = value ?? initial;
  const selectedId = current?.course_revision_id ?? 'none';
  const selected = data?.courses
    .flatMap((course) =>
      course.revisions.map((revision) => ({ course, revision }))
    )
    .find((row) => row.revision.id === selectedId && !row.revision.deleted_at);
  const options =
    data?.courses.flatMap((course) =>
      course.revisions
        .filter((revision) => !revision.deleted_at)
        .map((revision) => ({ course, revision }))
    ) ?? [];
  const changeRevision = (id: string) => {
    if (disabled || !scope.canWrite || !scope.isCurrent()) return;
    if (id === 'none') {
      onChange({
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
        scheduled_day: null,
        scheduled_for: null,
      });
      return;
    }
    const row = options.find((row) => row.revision.id === id);
    if (!row) return;
    onChange({
      course_revision_id: id,
      course_rule_id: null,
      course_step_id: null,
      course_slot_key: null,
      scheduled_day: null,
      scheduled_for: null,
      course_expected_version: row.course.version,
    });
  };
  const manualPatch = (patch: Partial<MedicationCourseAttributionInput>) => {
    if (!selected || disabled || !scope.canWrite || !scope.isCurrent()) return;
    onChange({
      course_revision_id: selected.revision.id,
      course_rule_id: current?.course_rule_id ?? null,
      course_step_id: current?.course_step_id ?? null,
      course_slot_key: null,
      scheduled_day: null,
      scheduled_for: null,
      course_expected_version: selected.course.version,
      ...patch,
    });
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-3 text-sm">
      <Label>{t('medications.courses.association', 'Plan association')}</Label>
      <Select
        value={selectedId}
        disabled={
          disabled || !scope.canWrite || query.isLoading || query.isError
        }
        onValueChange={changeRevision}
      >
        <SelectTrigger
          aria-label={t('medications.courses.association', 'Plan association')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            {t('medications.courses.noAssociation', 'No plan association')}
          </SelectItem>
          {selectedId !== 'none' &&
            !options.some((row) => row.revision.id === selectedId) && (
              <SelectItem value={selectedId}>
                {t(
                  'medications.courses.savedAssociation',
                  'Saved association (not currently available)'
                )}
              </SelectItem>
            )}
          {options.map(({ revision }) => (
            <SelectItem key={revision.id} value={revision.id}>
              {revision.name} ·{' '}
              {t('medications.courses.revisionNumber', 'Revision {{number}}', {
                number: revision.revision_no,
              })}{' '}
              · {revision.start_date} → {revision.end_date ?? '—'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.courses.associationHint',
          'Choose a revision explicitly. This does not change the actual dose, timestamp or stock. No selection keeps a new log unassigned; untouched edits preserve the saved association.'
        )}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || query.isFetching}
        onClick={async () => {
          const fresh = await query.refetch();
          if (
            !scope.isCurrent() ||
            !scope.canWrite ||
            !value?.course_revision_id
          )
            return;
          const current = fresh.data?.courses.find(
            (course) =>
              course.user_id === scope.ownerId &&
              course.revisions.some(
                (revision) =>
                  revision.id === value.course_revision_id &&
                  !revision.deleted_at
              )
          );
          if (current)
            onChange({ ...value, course_expected_version: current.version });
        }}
      >
        {t('medications.courses.refreshChoices', 'Refresh plan choices')}
      </Button>
      {query.isError && (
        <p role="status">
          {t(
            'medications.courses.associationError',
            'Could not load plan choices. Existing saved associations are preserved.'
          )}
        </p>
      )}
      {selected && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>
              {t('medications.courses.associationRule', 'Rule (optional)')}
            </Label>
            <Select
              disabled={disabled || !scope.canWrite}
              value={current?.course_rule_id ?? 'none'}
              onValueChange={(id) =>
                manualPatch({ course_rule_id: id === 'none' ? null : id })
              }
            >
              <SelectTrigger
                aria-label={t(
                  'medications.courses.associationRule',
                  'Rule (optional)'
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('common.none', 'None')}</SelectItem>
                {selected.revision.rules.map((rule, index) => (
                  <SelectItem value={rule.id} key={rule.id}>
                    {t('medications.courses.ruleNumber', 'Rule {{number}}', {
                      number: index + 1,
                    })}
                    {rule.time_of_day ? ` · ${rule.time_of_day}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>
              {t('medications.courses.associationPhase', 'Phase (optional)')}
            </Label>
            <Select
              disabled={disabled || !scope.canWrite}
              value={current?.course_step_id ?? 'none'}
              onValueChange={(id) =>
                manualPatch({ course_step_id: id === 'none' ? null : id })
              }
            >
              <SelectTrigger
                aria-label={t(
                  'medications.courses.associationPhase',
                  'Phase (optional)'
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('common.none', 'None')}</SelectItem>
                {selected.revision.steps.map((step, index) => (
                  <SelectItem value={step.id} key={step.id}>
                    {t('medications.courses.phaseNumber', 'Phase {{number}}', {
                      number: index + 1,
                    })}{' '}
                    · {step.dose} {step.dose_unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
