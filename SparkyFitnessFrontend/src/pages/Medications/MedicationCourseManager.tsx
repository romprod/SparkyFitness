import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  courseBucket,
  isCurrentCourseTip,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCourseBucket,
  type MedicationCourseStatusInput,
  type MedicationCourseDeleteInput,
} from '@workspace/shared';
import {
  useMedicationCourses,
  useMedicationCourseActions,
  invalidateMedicationCourses,
  HttpApiError,
} from '@/hooks/Medications/useMedicationCourses';
import type { MedicationDetail } from '@/types/medications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import MedicationCourseEditor from './MedicationCourseEditor';
import MedicationCourseHistory from './MedicationCourseHistory';
import MedicationCourseCycles from './MedicationCourseCycles';
import MedicationCourseCycleAction from './MedicationCourseCycleAction';

type CourseScope = ReturnType<typeof useMedicationCourses>['scope'];
type Selection = {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
};
type Action = Selection & {
  kind: 'pause' | 'resume' | 'complete' | 'reopen' | 'delete';
};
function CourseAction({
  action,
  scope,
  onClose,
  onRefresh,
}: {
  action: Action;
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

export default function MedicationCourseManager({
  med,
  onTimeline,
  focusRevisionId,
}: {
  med: MedicationDetail;
  onTimeline?: () => void;
  focusRevisionId?: string;
}) {
  const result = useMedicationCourses(med.id);
  return result.scope.ready ? (
    <CourseManagerContent
      key={result.scope.key}
      med={med}
      result={result}
      onTimeline={onTimeline}
      focusRevisionId={focusRevisionId}
    />
  ) : null;
}
function CourseManagerContent({
  med,
  result,
  onTimeline,
  focusRevisionId,
}: {
  med: MedicationDetail;
  onTimeline?: () => void;
  focusRevisionId?: string;
  result: ReturnType<typeof useMedicationCourses>;
}) {
  const { t } = useTranslation();
  const { scope, query, data } = result;
  const [editor, setEditor] = useState<
    | (
        | { mode: 'create' | 'handoff' }
        | (Selection & { mode: 'edit' | 'revise' })
      )
    | null
  >(null);
  const [history, setHistory] = useState<Selection | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [cycleAction, setCycleAction] = useState<
    (Selection & { kind: 'end' | 'start' }) | null
  >(null);
  useEffect(() => {
    if (!focusRevisionId || !scope.ready || !data) return;
    const target = document.getElementById(
      `course-revision-${focusRevisionId}`
    );
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus();
  }, [focusRevisionId, scope.ready, data]);
  if (!scope.ready) return null;
  const rows =
    data?.courses.flatMap((course) =>
      course.revisions
        .filter((revision) => !revision.deleted_at)
        .map((revision) => ({ course, revision }))
    ) ?? [];
  const buckets: MedicationCourseBucket[] = [
    'active',
    'scheduled',
    'paused',
    'ended',
    'completed',
  ];
  const labels = {
    active: t('medications.courses.buckets.active', 'Active'),
    scheduled: t('medications.courses.buckets.scheduled', 'Scheduled'),
    paused: t('medications.courses.buckets.paused', 'Paused'),
    ended: t('medications.courses.buckets.ended', 'Past end date'),
    completed: t('medications.courses.buckets.completed', 'Completed'),
  };
  const refresh = async (id?: string) => {
    const fresh = await query.refetch();
    if (!scope.isCurrent()) return;
    return fresh.data?.courses.find((course) => course.id === id);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t('medications.courses.title', 'Versioned plans')}
          {onTimeline && (
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={onTimeline}
            >
              {t('medications.courses.timeline.entry', 'Timeline')}
            </Button>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.courses.optIn',
            'Courses are opt-in. Existing schedule rules, legacy titration and unassigned dose logs remain separate unless you explicitly hand off selected rules.'
          )}
        </p>
        {scope.canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data}
              onClick={() => setEditor({ mode: 'create' })}
            >
              {t('medications.courses.create', 'Create course')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!data || !med.schedules.length}
              onClick={() => setEditor({ mode: 'handoff' })}
            >
              {t(
                'medications.courses.createSelected',
                'Create course from selected schedule rules'
              )}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {data?.courses
          .filter(
            (course) =>
              course.current_revision_id === null &&
              course.revisions.some((revision) => !revision.deleted_at)
          )
          .map((course) => (
            <p
              key={course.id}
              role="status"
              className="rounded-md border bg-muted/20 p-3 text-sm"
            >
              {t(
                'medications.courses.deletedTip',
                'The current revision was deleted. There is no active tip; earlier revisions do not resume automatically.'
              )}
            </p>
          ))}
        {query.isLoading && <p>{t('common.loading', 'Loading…')}</p>}
        {query.isError && (
          <div>
            <p role="status" className="text-sm">
              {t(
                'medications.courses.loadError',
                'Could not load versioned plans.'
              )}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {data && !rows.length && (
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.courses.empty',
              'No versioned courses yet. Legacy schedules continue unchanged.'
            )}
          </p>
        )}
        {buckets.map((bucket) => {
          const group = rows.filter(
            ({ revision }) => courseBucket(revision, data!.today) === bucket
          );
          return group.length ? (
            <section key={bucket} className="space-y-2">
              <h4 className="font-semibold text-sm">{labels[bucket]}</h4>
              {group.map(({ course, revision }) => {
                const tip = isCurrentCourseTip(course, revision.id);
                const predecessor = course.revisions.find(
                  (row) => row.id === revision.predecessor_id
                );
                return (
                  <article
                    key={revision.id}
                    id={`course-revision-${revision.id}`}
                    tabIndex={-1}
                    aria-label={`${revision.name} — ${t('medications.courses.revisionNumber', 'Revision {{number}}', { number: revision.revision_no })}`}
                    className="space-y-2 rounded-md border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium break-words">{revision.name}</p>
                      <Badge variant="outline">
                        {t(
                          'medications.courses.revisionNumber',
                          'Revision {{number}}',
                          { number: revision.revision_no }
                        )}
                      </Badge>
                    </div>
                    <p>
                      {revision.start_date} → {revision.end_date ?? '—'}
                    </p>
                    <p>
                      {t('medications.courses.zone', 'Plan timezone')}:{' '}
                      {course.timezone}
                    </p>
                    <p>
                      {revision.target_dose ?? '—'} {revision.dose_unit} ·{' '}
                      {revision.dose_basis === 'per_week'
                        ? t('medications.courses.perWeek', 'Per week')
                        : t(
                            'medications.courses.perDose',
                            'Per administration'
                          )}
                    </p>
                    <MedicationCourseCycles
                      course={course}
                      revision={revision}
                      tip={tip}
                      canWrite={scope.canWrite}
                      onAction={(kind) => {
                        if (scope.canWrite && scope.isCurrent())
                          setCycleAction({ course, revision, kind });
                      }}
                      onRefresh={() => refresh(course.id)}
                    />
                    {predecessor && (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0"
                        onClick={() =>
                          setHistory({ course, revision: predecessor })
                        }
                      >
                        {t(
                          'medications.courses.revisedFrom',
                          'Revised from revision {{number}}',
                          { number: predecessor.revision_no }
                        )}
                      </Button>
                    )}
                    {!tip && (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'medications.courses.frozen',
                          'Plan fields and status are read-only. Recorded doses retain their original association unless you explicitly delete this revision.'
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistory({ course, revision })}
                      >
                        {t(
                          'medications.courses.detailsHistory',
                          'Details and recorded doses'
                        )}
                      </Button>
                      {!tip && scope.canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setAction({ kind: 'delete', course, revision })
                          }
                        >
                          {t(
                            'medications.courses.deleteRevision',
                            'Delete revision'
                          )}
                        </Button>
                      )}
                      {tip && scope.canWrite && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setEditor({ mode: 'edit', course, revision })
                            }
                          >
                            {t(
                              'medications.courses.edit',
                              'Edit current course'
                            )}
                          </Button>
                          {revision.status === 'active' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setEditor({
                                    mode: 'revise',
                                    course,
                                    revision,
                                  })
                                }
                              >
                                {t(
                                  'medications.courses.revise',
                                  'Revise course'
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setAction({ kind: 'pause', course, revision })
                                }
                              >
                                {t('medications.courses.pause', 'Pause course')}
                              </Button>
                            </>
                          )}
                          {revision.status === 'paused' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAction({ kind: 'resume', course, revision })
                              }
                            >
                              {t('medications.courses.resume', 'Resume course')}
                            </Button>
                          )}
                          {revision.status !== 'completed' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAction({
                                  kind: 'complete',
                                  course,
                                  revision,
                                })
                              }
                            >
                              {t(
                                'medications.courses.complete',
                                'Complete course'
                              )}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAction({ kind: 'reopen', course, revision })
                              }
                            >
                              {t('medications.courses.reopen', 'Reopen course')}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setAction({ kind: 'delete', course, revision })
                            }
                          >
                            {t(
                              'medications.courses.deleteRevision',
                              'Delete revision'
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null;
        })}
      </CardContent>
      {editor && data && (
        <MedicationCourseEditor
          key={`${scope.key}:${'revision' in editor ? editor.revision.id : 'new'}:${editor.mode}`}
          med={med}
          today={data.today}
          timezone={data.timezone}
          scope={scope}
          mode={editor.mode}
          {...('course' in editor
            ? { course: editor.course, revision: editor.revision }
            : {})}
          onClose={() => setEditor(null)}
          onRefresh={() =>
            refresh('course' in editor ? editor.course.id : undefined)
          }
        />
      )}
      {history && (
        <MedicationCourseHistory
          key={`${scope.key}:${history.revision.id}`}
          {...history}
          onClose={() => setHistory(null)}
        />
      )}
      {cycleAction && (
        <MedicationCourseCycleAction
          key={`${scope.key}:${cycleAction.revision.id}:${cycleAction.kind}`}
          course={cycleAction.course}
          revision={cycleAction.revision}
          action={cycleAction.kind}
          scope={scope}
          onClose={() => setCycleAction(null)}
          onRefresh={() => refresh(cycleAction.course.id)}
        />
      )}
      {action && (
        <CourseAction
          key={`${scope.key}:${action.revision.id}:${action.kind}`}
          action={action}
          scope={scope}
          onClose={() => setAction(null)}
          onRefresh={() => refresh(action.course.id)}
        />
      )}
    </Card>
  );
}
