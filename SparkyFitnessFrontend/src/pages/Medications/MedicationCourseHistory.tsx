import { useTranslation } from 'react-i18next';
import type {
  MedicationCourse,
  MedicationCourseRevision,
} from '@workspace/shared';
import { useMedicationCourseHistory } from '@/hooks/Medications/useMedicationCourses';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatScheduleDescription } from './medicationUtils';
import { usePreferences } from '@/contexts/PreferencesContext';

export default function MedicationCourseHistory({
  course,
  revision,
  onClose,
  onReviseAssociation,
}: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  onClose: () => void;
  onReviseAssociation?: (id: string, kind: 'entry' | 'injection') => void;
}) {
  const { t } = useTranslation();
  const { timeFormat } = usePreferences();
  const history = useMedicationCourseHistory(course.id, true);
  const actuals =
    history.data?.actuals.filter(
      (row) => row.course_revision_id === revision.id
    ) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {revision.name} ·{' '}
            {t('medications.courses.revisionNumber', 'Revision {{number}}', {
              number: revision.revision_no,
            })}
          </DialogTitle>
        </DialogHeader>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {t('medications.courses.start', 'Start date')}
            </dt>
            <dd>{revision.start_date}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t('medications.courses.end', 'End date (optional)')}
            </dt>
            <dd>{revision.end_date ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t('medications.courses.target', 'Planned amount (optional)')}
            </dt>
            <dd>
              {revision.target_dose ?? '—'} {revision.dose_unit} ·{' '}
              {revision.dose_basis === 'per_week'
                ? t('medications.courses.perWeek', 'Per week')
                : t('medications.courses.perDose', 'Per administration')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t('medications.courses.zone', 'Plan timezone')}
            </dt>
            <dd>{course.timezone}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.courses.baseline',
            'Managed tracking began {{day}}. Earlier managed adherence is unavailable; legacy logs are not reconstructed.',
            { day: course.capture_day }
          )}
        </p>
        {revision.rules.map((rule) => (
          <p key={rule.id} className="text-sm">
            {formatScheduleDescription(rule, timeFormat)}
            {rule.dose_amount
              ? ` · ${rule.dose_amount} ${revision.dose_unit}`
              : ''}
          </p>
        ))}
        {revision.steps.map((step) => (
          <p key={step.id} className="text-sm">
            {t('medications.courses.phaseNumber', 'Phase {{number}}', {
              number: step.step_index + 1,
            })}
            : {step.dose} {step.dose_unit} ·{' '}
            {step.duration_days ??
              t('medications.courses.openEnded', 'open-ended')}{' '}
            {step.duration_days == null
              ? ''
              : t('medications.courses.days', 'days')}
          </p>
        ))}
        {revision.notes && (
          <p className="whitespace-pre-wrap text-sm">{revision.notes}</p>
        )}
        <h4 className="font-medium">
          {t(
            'medications.courses.ownActuals',
            'Recorded doses attributed to this revision'
          )}
        </h4>
        {history.isLoading && <p>{t('common.loading', 'Loading…')}</p>}
        {history.isError && (
          <div>
            <p role="status">
              {t(
                'medications.courses.historyError',
                'Could not load this revision’s recorded doses.'
              )}
            </p>
            <Button variant="outline" onClick={() => void history.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {history.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {history.data.from_date} → {history.data.to_date}
            </p>
            {!actuals.length ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.courses.noActuals',
                  'No recorded doses are attributed to this revision.'
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        'Tracking day',
                        'Recorded instant (UTC)',
                        'Dose',
                        'Status',
                        'Site',
                        'Notes',
                      ].map((label) => (
                        <th key={label} className="p-2 font-medium">
                          {t(`medications.courses.history.${label}`, label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {actuals.map((row) => (
                      <tr
                        key={`${row.source_kind}-${row.id}`}
                        className="border-t"
                      >
                        <td className="p-2">{row.entry_date}</td>
                        <td className="p-2">
                          <time dateTime={row.occurred_at}>
                            {row.occurred_at}
                          </time>
                        </td>
                        <td className="p-2">
                          {row.source_kind === 'injection'
                            ? `${row.dose_mg_exact ?? '—'} mg`
                            : `${row.dose_amount ?? '—'} ${row.dose_unit ?? ''}`}
                          {row.volume_ml != null && (
                            <span className="block text-muted-foreground">
                              {row.volume_ml} mL
                            </span>
                          )}
                        </td>
                        <td className="p-2">{row.status}</td>
                        <td className="p-2">{row.site ?? '—'}</td>
                        <td className="p-2 whitespace-pre-wrap">
                          {row.notes ?? '—'}
                        </td>
                        {onReviseAssociation && (
                          <td className="p-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                onReviseAssociation(row.id, row.source_kind)
                              }
                            >
                              {t(
                                'medications.courses.changeAssociation',
                                'Change association explicitly'
                              )}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
