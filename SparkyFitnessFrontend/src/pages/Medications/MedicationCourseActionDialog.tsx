import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  isCurrentCourseTip,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCourseStatusInput,
  type MedicationCourseDeleteInput,
} from '@workspace/shared';
import {
  useMedicationCourses,
  useMedicationCourseActions,
  invalidateMedicationCourses,
  HttpApiError,
} from '@/hooks/Medications/useMedicationCourses';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type CourseScope = ReturnType<typeof useMedicationCourses>['scope'];
export type CourseActionKind =
  'pause' | 'resume' | 'complete' | 'reopen' | 'delete';
export type CourseAction = {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  kind: CourseActionKind;
};
export default function MedicationCourseActionDialog({
  action,
  scope,
  onClose,
  onRefresh,
}: {
  action: CourseAction;
  scope: CourseScope;
  onClose: () => void;
  onRefresh: () => Promise<MedicationCourse | undefined>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const api = useMedicationCourseActions(scope);
  const [version, setVersion] = useState(action.course.version);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const attempt = useRef<
    MedicationCourseStatusInput | MedicationCourseDeleteInput | null
  >(null);
  const flight = useRef(false);
  const confirm = async () => {
    if (!scope.isCurrent() || !scope.canWrite || flight.current || stale)
      return;
    if (!attempt.current)
      attempt.current = {
        expected_version: version,
        operation_id: crypto.randomUUID(),
        ...(action.kind === 'delete'
          ? {}
          : {
              status:
                action.kind === 'pause'
                  ? 'paused'
                  : action.kind === 'complete'
                    ? 'completed'
                    : 'active',
            }),
      };
    flight.current = true;
    setPending(true);
    setMessage('');
    try {
      if ('status' in attempt.current)
        await api.status(action.course.id, attempt.current);
      else
        await api.remove(action.course.id, action.revision.id, attempt.current);
      if (!scope.isCurrent()) return;
      invalidateMedicationCourses(client);
      onClose();
    } catch (error) {
      if (scope.isCurrent()) {
        const known =
          error instanceof HttpApiError &&
          [400, 404, 409, 422].includes(error.status);
        if (!known || uncertain) {
          setUncertain(true);
          setMessage(
            t(
              'medications.courses.uncertain',
              'The result is not confirmed. Retry this same operation before changing or closing the plan.'
            )
          );
        } else {
          attempt.current = null;
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
  const refresh = async () => {
    if (pending || uncertain || !scope.isCurrent()) return;
    const latest = await onRefresh();
    if (!scope.isCurrent()) return;
    if (
      latest &&
      (action.kind === 'delete'
        ? latest.revisions.some(
            (row) => row.id === action.revision.id && !row.deleted_at
          )
        : isCurrentCourseTip(latest, action.revision.id))
    ) {
      setVersion(latest.version);
      setStale(false);
      setMessage(
        t(
          'medications.courses.actionRefreshed',
          'Current version refreshed. Review this action before confirming again.'
        )
      );
    } else
      setMessage(
        t(
          'medications.courses.noLongerTip',
          'This revision is no longer the current tip. Close this action and refresh the course.'
        )
      );
  };
  const title = {
    pause: t('medications.courses.pause', 'Pause course'),
    resume: t('medications.courses.resume', 'Resume course'),
    complete: t('medications.courses.complete', 'Complete course'),
    reopen: t('medications.courses.reopen', 'Reopen course'),
    delete: t('medications.courses.deleteRevision', 'Delete revision'),
  }[action.kind];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !uncertain) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          if (pending || uncertain) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending || uncertain) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {action.revision.name} ·{' '}
          {t('medications.courses.revisionNumber', 'Revision {{number}}', {
            number: action.revision.revision_no,
          })}
        </p>
        {action.kind === 'delete' ? (
          <p className="text-sm">
            {t(
              'medications.courses.deleteExplanation',
              'Recorded doses are preserved and their association with this revision is detached. Stock is unchanged. Deleting the current tip does not revive an earlier revision.'
            )}
          </p>
        ) : action.kind === 'reopen' ? (
          <p className="text-sm">
            {t(
              'medications.courses.reopenExplanation',
              'Reopening does not extend the planned end date or reactivate an archived medication. Earlier gaps are not backfilled.'
            )}
          </p>
        ) : action.kind === 'resume' ? (
          <p className="text-sm">
            {t(
              'medications.courses.resumeExplanation',
              'Resume from the current owner day. Paused gaps are not backfilled.'
            )}
          </p>
        ) : action.kind === 'pause' ? (
          <p className="text-sm">
            {t(
              'medications.courses.pauseExplanation',
              'Future course doses pause. Earlier recorded doses and activity are retained.'
            )}
          </p>
        ) : (
          <p className="text-sm">
            {t(
              'medications.courses.completeExplanation',
              'Complete this current revision without deleting recorded doses. An existing past end date is not extended.'
            )}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="rounded-md border bg-muted/20 p-3 text-sm text-foreground"
          >
            {message}
          </p>
        )}
        {stale && (
          <Button
            variant="outline"
            disabled={pending || uncertain}
            onClick={() => void refresh()}
          >
            {t('medications.courses.refresh', 'Refresh current data')}
          </Button>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={pending || uncertain}
            onClick={onClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button disabled={pending || stale} onClick={() => void confirm()}>
            {pending
              ? t('common.saving', 'Saving…')
              : uncertain
                ? t('medications.courses.retrySame', 'Retry same operation')
                : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
