import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type {
  MedicationCourse,
  MedicationCourseRevision,
  MedicationCourseCycleActionInput,
  MedicationCourseCycleReview,
} from '@workspace/shared';
import {
  useMedicationCourseActions,
  useMedicationCourseScope,
  invalidateMedicationCourses,
  HttpApiError,
} from '@/hooks/Medications/useMedicationCourses';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import MedicationCourseCycleDates from './MedicationCourseCycleDates';

type Scope = ReturnType<typeof useMedicationCourseScope>;
export default function MedicationCourseCycleAction({
  course,
  revision,
  action,
  scope,
  onClose,
  onRefresh,
}: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  action: 'end' | 'start';
  scope: Scope;
  onClose: () => void;
  onRefresh: () => Promise<MedicationCourse | undefined>;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const client = useQueryClient();
  const api = useMedicationCourseActions(scope);
  const [version, setVersion] = useState(course.version);
  const [review, setReview] = useState<MedicationCourseCycleReview | null>(
    null
  );
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const flight = useRef(false);
  const attempt = useRef<MedicationCourseCycleActionInput | null>(null);
  const live = () => scope.canWrite && scope.isCurrent();
  const requestReview = async () => {
    if (!live() || flight.current || uncertain || stale) return;
    flight.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await api.cycleReview(course.id, {
        action,
        expected_version: version,
      });
      if (!live()) return;
      if (
        result.action !== action ||
        result.cycle.course_id !== course.id ||
        result.cycle.revision_id !== revision.id ||
        result.cycle.version !== version
      ) {
        setReview(null);
        setStale(true);
        setMessage(
          t(
            'medications.courseCycles.changed',
            'This course changed. Refresh current data and review the change again.'
          )
        );
        return;
      }
      setReview(result);
    } catch (error) {
      if (live()) {
        setReview(null);
        setStale(error instanceof HttpApiError && error.status === 409);
        setMessage(
          error instanceof HttpApiError
            ? error.message
            : t(
                'medications.courseCycles.reviewError',
                'Could not review this cycle change. Try again.'
              )
        );
      }
    } finally {
      flight.current = false;
      setPending(false);
    }
  };
  const refresh = async () => {
    if (!live() || flight.current || uncertain) return;
    flight.current = true;
    setPending(true);
    try {
      const latest = await onRefresh();
      if (!live()) return;
      if (!latest || latest.current_revision_id !== revision.id) {
        setStale(true);
        setMessage(
          t(
            'medications.courses.noLongerTip',
            'This revision is no longer the current tip. Close this action and refresh the course.'
          )
        );
        return;
      }
      setVersion(latest.version);
      setReview(null);
      attempt.current = null;
      setStale(false);
      setMessage(
        t(
          'medications.courseCycles.refreshed',
          'Current data refreshed. Review the change again before confirming.'
        )
      );
    } catch {
      if (live())
        setMessage(
          t(
            'medications.courses.refreshError',
            'Could not refresh the course. Your draft is retained.'
          )
        );
    } finally {
      flight.current = false;
      setPending(false);
    }
  };
  const confirm = async () => {
    if (
      !live() ||
      flight.current ||
      !review ||
      !review.can_commit ||
      (!uncertain && stale)
    )
      return;
    if (!attempt.current)
      attempt.current = {
        operation_id: crypto.randomUUID(),
        expected_version: review.cycle.version,
        review_fingerprint: review.review_fingerprint,
      };
    flight.current = true;
    setPending(true);
    setMessage('');
    try {
      if (action === 'end') await api.cycleEnd(course.id, attempt.current);
      else await api.cycleStart(course.id, attempt.current);
      if (!live()) return;
      invalidateMedicationCourses(client);
      onClose();
    } catch (error) {
      if (live()) {
        const known =
          error instanceof HttpApiError &&
          [400, 404, 409, 422].includes(error.status);
        if (uncertain || !known) {
          setUncertain(true);
          setMessage(
            t(
              'medications.courses.uncertain',
              'The result is not confirmed. Retry this same operation before changing or closing the plan.'
            )
          );
        } else {
          attempt.current = null;
          setReview(null);
          setStale(error.status === 409);
          setMessage(error.message);
          invalidateMedicationCourses(client);
        }
      }
    } finally {
      flight.current = false;
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {action === 'end'
              ? t('medications.courseCycles.end', 'End cycle')
              : t('medications.courseCycles.start', 'Start next cycle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="break-words font-medium">{revision.name}</p>
          <p>
            {t(
              'medications.courseCycles.manual',
              'This is a manual change. Review the dates before confirming. Recorded doses and their original associations are preserved.'
            )}
          </p>
          {review && (
            <>
              <MedicationCourseCycleDates dates={review.cycle} />
              <dl className="space-y-1">
                <div>
                  <dt className="text-muted-foreground">
                    {t(
                      'medications.courseCycles.effectiveDay',
                      'Effective day'
                    )}
                  </dt>
                  <dd>{formatDate(review.effective_day)}</dd>
                </div>
                {action === 'end' ? (
                  <div>
                    <dt className="text-muted-foreground">
                      {t(
                        'medications.courseCycles.endToApply',
                        'End date to apply'
                      )}
                    </dt>
                    <dd>
                      {review.candidate_end_date
                        ? formatDate(review.candidate_end_date)
                        : '—'}
                    </dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt className="text-muted-foreground">
                        {t(
                          'medications.courseCycles.newStart',
                          'New revision start'
                        )}
                      </dt>
                      <dd>
                        {review.new_start_date
                          ? formatDate(review.new_start_date)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {t('medications.courseCycles.newEnd', 'New cycle end')}
                      </dt>
                      <dd>
                        {review.new_end_date
                          ? formatDate(review.new_end_date)
                          : '—'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {action === 'start' && (
                <>
                  <p>
                    {t(
                      `medications.courseCycles.continuity.${review.phase_continuity}`,
                      {
                        retained:
                          'Authored phase progression is retained; it is not reset.',
                        not_applicable:
                          'No phased progression applies to this plan.',
                        unknown:
                          'Phase progression is unknown; no new dose has been inferred.',
                      }[review.phase_continuity]
                    )}
                  </p>
                  <p>
                    {review.first_due
                      ? t(
                          'medications.courseCycles.firstDue',
                          'First planned administration: {{day}} {{time}} ({{timezone}})',
                          {
                            day: formatDate(review.first_due.scheduled_day),
                            time: review.first_due.time_of_day ?? '',
                            timezone: review.cycle.timezone,
                          }
                        )
                      : t(
                          'medications.courseCycles.noFirstDue',
                          'No administration is available within the new cycle’s unchanged schedule bounds.'
                        )}
                  </p>
                  <p className="text-muted-foreground">
                    {t(
                      'medications.courseCycles.activation',
                      'New activity begins when the change is confirmed. This does not log a dose or fill earlier time slots.'
                    )}
                  </p>
                </>
              )}
              {review.conflicts.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-destructive bg-destructive/10 p-3 pl-7 text-foreground">
                  {review.conflicts.map((conflict, index) => (
                    <li key={`${conflict.code}:${index}`}>
                      {conflict.message}
                    </li>
                  ))}
                </ul>
              )}
              {!review.can_commit && (
                <p role="status">
                  {t(
                    'medications.courseCycles.cannotConfirm',
                    'This change cannot be confirmed. Review the reported conflict and the existing plan before trying again.'
                  )}
                </p>
              )}
            </>
          )}
          {message && (
            <p
              role="status"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground"
            >
              {message}
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={pending || uncertain}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          {stale && (
            <Button
              variant="outline"
              disabled={pending || uncertain}
              onClick={() => void refresh()}
            >
              {t('medications.courses.refresh', 'Refresh current data')}
            </Button>
          )}
          {!review && (
            <Button
              disabled={pending || uncertain || stale || !scope.canWrite}
              onClick={() => void requestReview()}
            >
              {pending
                ? t('common.loading', 'Loading…')
                : t('medications.courseCycles.review', 'Review cycle change')}
            </Button>
          )}
          {review && (
            <Button
              disabled={
                pending ||
                !review.can_commit ||
                (!uncertain && stale) ||
                !scope.canWrite
              }
              onClick={() => void confirm()}
            >
              {pending
                ? t('common.saving', 'Saving…')
                : uncertain
                  ? t('medications.courseCycles.retry', 'Retry same change')
                  : t('medications.courseCycles.confirm', 'Confirm change')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
