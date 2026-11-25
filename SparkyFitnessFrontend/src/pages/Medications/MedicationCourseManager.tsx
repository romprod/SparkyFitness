import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  courseAdvanceProposal,
  courseBucket,
  isCurrentCourseTip,
  type CourseAdvanceProposal,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCourseBucket,
} from '@workspace/shared';
import { useMedicationCourses } from '@/hooks/Medications/useMedicationCourses';
import { useMedicationInjections } from '@/hooks/useMedications';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { MedicationDetail } from '@/types/medications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MedicationCourseEditor from './MedicationCourseEditor';
import MedicationCourseHistory from './MedicationCourseHistory';
import MedicationCourseCycles from './MedicationCourseCycles';
import MedicationCourseCycleAction from './MedicationCourseCycleAction';
import MedicationCourseActionDialog, {
  type CourseAction,
} from './MedicationCourseActionDialog';

type Selection = {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
};
type Action = CourseAction;

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
        | (Selection & {
            mode: 'edit' | 'revise';
            advance?: CourseAdvanceProposal;
          })
      )
    | null
  >(null);
  const { formatDate } = usePreferences();
  const injectionsQ = useMedicationInjections(med.id, scope.canWrite);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem('course-advance-dismissed');
    } catch {
      return null;
    }
  });
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
  // The latest recent injection, when it was attributed to a step of a live plan
  // and its amount matches the next phase, suggests moving the plan on.
  const latestInjection = [...(injectionsQ.data ?? [])].sort((a, b) =>
    b.injected_at.localeCompare(a.injected_at)
  )[0];
  const advanceSuggestion = (() => {
    if (!data || !scope.canWrite || !latestInjection) return null;
    if (latestInjection.id === dismissed) return null;
    if (
      latestInjection.entry_date < addDays(data.today, -14) ||
      latestInjection.dose_mg == null
    )
      return null;
    const row = rows.find(
      ({ revision }) => revision.id === latestInjection.course_revision_id
    );
    if (
      !row ||
      !isCurrentCourseTip(row.course, row.revision.id) ||
      courseBucket(row.revision, data.today) !== 'active'
    )
      return null;
    const proposal = courseAdvanceProposal({
      revision: row.revision,
      attributedStepId: latestInjection.course_step_id,
      loggedDose: {
        amount: latestInjection.dose_mg_exact ?? latestInjection.dose_mg,
        unit: 'mg',
      },
    });
    return proposal ? { ...row, proposal, entry: latestInjection } : null;
  })();
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
        {advanceSuggestion && (
          <div
            role="status"
            data-testid="advance-banner"
            className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"
          >
            <p>
              {t(
                'medications.courses.advance.banner',
                'Your latest dose ({{dose}} {{unit}} on {{date}}) matches phase {{to}} of {{count}}, but the plan is on phase {{from}}. Review moving the plan to phase {{to}}?',
                {
                  dose: advanceSuggestion.proposal.matched_dose,
                  unit: advanceSuggestion.proposal.matched_dose_unit,
                  date: formatDate(advanceSuggestion.entry.entry_date),
                  to: advanceSuggestion.proposal.to_phase,
                  from: advanceSuggestion.proposal.from_phase,
                  count: advanceSuggestion.proposal.phase_count,
                }
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  setEditor({
                    mode: 'revise',
                    course: advanceSuggestion.course,
                    revision: advanceSuggestion.revision,
                    advance: advanceSuggestion.proposal,
                  })
                }
              >
                {t('medications.courses.advance.review', 'Review phase change')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDismissed(advanceSuggestion.entry.id);
                  try {
                    localStorage.setItem(
                      'course-advance-dismissed',
                      advanceSuggestion.entry.id
                    );
                  } catch {
                    /* the choice still holds for this visit */
                  }
                }}
              >
                {t('medications.courses.advance.keep', 'Keep current plan')}
              </Button>
            </div>
          </div>
        )}
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
          {...('advance' in editor && editor.advance
            ? { advance: editor.advance }
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
        <MedicationCourseActionDialog
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
