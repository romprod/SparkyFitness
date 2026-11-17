import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MedicationCourseTimelineRow } from '@workspace/shared';
import {
  useMedicationCourseTimeline,
  useMedicationCourseHistory,
} from '@/hooks/Medications/useMedicationCourses';
import type { MedicationDetail } from '@/types/medications';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import MedicationCourseHistory from './MedicationCourseHistory';

function TimelineHistory({
  row,
  onClose,
}: {
  row: MedicationCourseTimelineRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useMedicationCourseHistory(row.course_id, true);
  const revision = query.data?.course.revisions.find(
    (item) =>
      query.data?.course.id === row.course_id &&
      item.id === row.revision_id &&
      !item.deleted_at
  );
  if (query.data && revision)
    return (
      <MedicationCourseHistory
        course={query.data.course}
        revision={revision}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('medications.courses.timeline.view', 'View plan')}
          </DialogTitle>
        </DialogHeader>
        <p role="status">
          {query.isError || (query.data && !revision)
            ? t(
                'medications.courses.timeline.detailsError',
                'This plan could not be loaded. Close and refresh the timeline.'
              )
            : t('common.loading', 'Loading…')}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default function MedicationCourseTimeline({
  medications,
  onClose,
  onManage,
}: {
  medications: MedicationDetail[];
  onClose: () => void;
  onManage: (row: MedicationCourseTimelineRow) => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const result = useMedicationCourseTimeline(true);
  const { scope, query, data } = result;
  const [originalScope] = useState(scope.key);
  const [history, setHistory] = useState<MedicationCourseTimelineRow | null>(
    null
  );
  useEffect(() => {
    if (!scope.ready || scope.key !== originalScope) onClose();
  }, [scope.ready, scope.key, originalScope, onClose]);
  if (!scope.ready || !scope.isCurrent() || scope.key !== originalScope)
    return null;
  const overlapScale = Math.max(
    1,
    ...(data?.overlap.map((day) => day.planned_on + day.projected_on) ?? [])
  );
  const labels = {
    authored_window: t(
      'medications.courses.timeline.authored',
      'Authored window'
    ),
    planned_on: t('medications.courses.timeline.on', 'On'),
    advisory_break: t('medications.courses.timeline.break', 'Break'),
    projected_on: t('medications.courses.timeline.projectedOn', 'Projected On'),
    projected_break: t(
      'medications.courses.timeline.projectedBreak',
      'Projected Break'
    ),
  };
  const colors = {
    authored_window: 'bg-muted border',
    planned_on: 'bg-primary/70',
    advisory_break: 'bg-muted-foreground/30',
    projected_on: 'border-2 border-dashed border-primary bg-primary/15',
    projected_break: 'border border-dashed border-muted-foreground bg-muted',
  };
  return (
    <>
      <Dialog
        open={!history}
        onOpenChange={(open) => {
          if (!open && !history) onClose();
        }}
      >
        <DialogContent className="max-w-[96vw] w-[1200px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('medications.courses.timeline.title', 'Plan timeline')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'medications.courses.timeline.scope',
                'Shows plans across all medications in this profile.'
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.courses.timeline.calendar',
              'Calendar date labels are aligned across saved plan timezones, not simultaneous instants. On and Break are advisory plan windows; saved scheduled doses are unchanged. Projected windows assume a manual restart.'
            )}
          </p>
          {query.isLoading && (
            <p role="status">{t('common.loading', 'Loading…')}</p>
          )}
          {query.isError && (
            <div role="alert">
              <p>
                {t(
                  'medications.courses.timeline.error',
                  'Could not load the plan timeline.'
                )}
              </p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          )}
          {data && !query.isError && (
            <>
              <p className="text-sm">
                {formatDate(data.window.start_date)} –{' '}
                {formatDate(data.window.end_date)} ·{' '}
                {t(
                  'medications.courses.timeline.profileToday',
                  'Profile today'
                )}
                : {formatDate(data.today)} ({data.timezone})
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(labels).map(([key, label]) => (
                  <Badge key={key} variant="outline" className="gap-1">
                    <span
                      aria-hidden="true"
                      className={`inline-block h-2 w-4 ${colors[key as keyof typeof colors]}`}
                    />
                    {label}
                  </Badge>
                ))}
              </div>
              {!data.rows.length ? (
                <p>
                  {t(
                    'medications.courses.timeline.empty',
                    'No known plan windows overlap this 20-week display.'
                  )}
                </p>
              ) : (
                <div
                  role="region"
                  aria-label={t(
                    'medications.courses.timeline.scroll',
                    'Plan timeline; scroll horizontally for all 20 weeks'
                  )}
                  tabIndex={0}
                  className="overflow-x-auto rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-[960px] p-3 space-y-3">
                    <div className="ml-[240px] relative h-9 border-b">
                      {data.week_ticks.map((tick, i) => (
                        <span
                          key={tick.day}
                          style={{ left: `${(tick.offset / 140) * 100}%` }}
                          className="absolute text-[10px]"
                        >
                          {i % 2 === 0 ? formatDate(tick.day) : '│'}
                        </span>
                      ))}
                      <span
                        style={{
                          left: `${((data.today_offset + 0.5) / 140) * 100}%`,
                        }}
                        className="absolute top-4 text-[10px] -translate-x-1/2 font-semibold"
                      >
                        {t(
                          'medications.courses.timeline.profileToday',
                          'Profile today'
                        )}
                      </span>
                    </div>
                    {data.rows.map((row) => (
                      <section
                        key={row.revision_id}
                        className="grid grid-cols-[228px_1fr] gap-3 border-b pb-3"
                        aria-label={`${row.medication_name}: ${row.name}, ${row.revision_no}`}
                      >
                        <div className="sticky left-0 z-10 bg-background pr-2 text-xs space-y-1">
                          <p className="font-semibold break-words">
                            {row.medication_name} · {row.name}
                          </p>
                          <p>
                            {t(
                              'medications.courses.revisionNumber',
                              'Revision {{number}}',
                              { number: row.revision_no }
                            )}{' '}
                            ·{' '}
                            {t(
                              `medications.courses.buckets.${row.bucket}`,
                              row.status
                            )}
                            {!row.is_current_tip &&
                              ` · ${t('medications.courses.timeline.historical', 'Historical revision')}`}
                          </p>
                          <p>
                            {row.timezone} ·{' '}
                            {t(
                              'medications.courses.timeline.localToday',
                              'Local today'
                            )}
                            : {formatDate(row.local_today)}
                          </p>
                          {row.open_end && (
                            <p>
                              {t(
                                'medications.courses.timeline.openEnd',
                                'Open end; clipped to this display'
                              )}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setHistory(row)}
                            >
                              {t(
                                'medications.courses.timeline.view',
                                'View plan'
                              )}
                            </Button>
                            {scope.canWrite &&
                              row.is_current_tip &&
                              row.medication_id &&
                              medications.some(
                                (med) => med.id === row.medication_id
                              ) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (scope.isCurrent()) onManage(row);
                                  }}
                                >
                                  {t(
                                    'medications.courses.timeline.manage',
                                    'Manage plan'
                                  )}
                                </Button>
                              )}
                          </div>
                        </div>
                        <div>
                          <div className="relative h-12" aria-hidden="true">
                            <span
                              style={{
                                left: `${((data.today_offset + 0.5) / 140) * 100}%`,
                              }}
                              className="absolute h-full border-l border-foreground/60 z-[1]"
                            />
                            {row.segments.map((segment, i) => (
                              <span
                                key={i}
                                title={`${labels[segment.kind]}: ${segment.from} – ${segment.to}`}
                                style={{
                                  left: `${(segment.offset / 140) * 100}%`,
                                  width: `${(segment.days / 140) * 100}%`,
                                }}
                                className={`absolute ${segment.kind === 'authored_window' ? 'top-1 h-10' : 'top-3 h-6'} rounded-sm ${colors[segment.kind]}`}
                              />
                            ))}
                          </div>
                          <ul className="text-xs text-muted-foreground">
                            {row.segments.map((segment, i) => (
                              <li key={i}>
                                {labels[segment.kind]}:{' '}
                                {formatDate(segment.from)} –{' '}
                                {formatDate(segment.to)}
                              </li>
                            ))}
                          </ul>
                          {row.limitations.length > 0 && (
                            <p className="text-xs">
                              {t(
                                'medications.courses.timeline.unknown',
                                'Some plan boundaries or cycle windows are unknown.'
                              )}{' '}
                              (
                              {row.limitations
                                .map((reason) =>
                                  t(
                                    `medications.courses.timeline.limitations.${reason}`,
                                    reason.replaceAll('_', ' ')
                                  )
                                )
                                .join('; ')}
                              )
                            </p>
                          )}
                        </div>
                      </section>
                    ))}
                    <section>
                      <h3 className="font-semibold text-sm">
                        {t(
                          'medications.courses.timeline.overlap',
                          'Active plan overlap'
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'medications.courses.timeline.overlapHelp',
                          'Counts current versions of active plans by calendar date; projected windows assume a manual restart. Each course is counted once. This does not describe historical activity, doses taken, exposure or drug interactions.'
                        )}
                      </p>
                      <p className="text-xs my-2">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-4 bg-primary/70 mr-1"
                        />
                        {t(
                          'medications.courses.timeline.plannedCount',
                          'Planned On'
                        )}{' '}
                        ·{' '}
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-4 border-t border-dashed border-primary bg-primary/15 mr-1"
                        />
                        {t(
                          'medications.courses.timeline.projectedCount',
                          'Hypothetical Projected On'
                        )}
                      </p>
                      <div
                        className="ml-[240px] grid grid-cols-[repeat(140,minmax(0,1fr))] h-9 my-2"
                        aria-hidden="true"
                      >
                        {data.overlap.map((day) => (
                          <div
                            key={day.day}
                            title={`${day.day}: ${day.planned_on} / ${day.projected_on}`}
                            className="flex flex-col justify-end gap-px"
                          >
                            <span
                              className="bg-primary/70"
                              style={{
                                height: `${(day.planned_on / overlapScale) * 32}px`,
                              }}
                            />
                            <span
                              className="border-t border-dashed border-primary bg-primary/15"
                              style={{
                                height: `${(day.projected_on / overlapScale) * 32}px`,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-sm">
                          {t(
                            'medications.courses.timeline.overlapDates',
                            'View overlap counts by date'
                          )}
                        </summary>
                        <table className="text-xs w-full">
                          <thead>
                            <tr>
                              <th scope="col">{t('common.date', 'Date')}</th>
                              <th scope="col">
                                {t(
                                  'medications.courses.timeline.plannedCount',
                                  'Planned On'
                                )}
                              </th>
                              <th scope="col">
                                {t(
                                  'medications.courses.timeline.projectedCount',
                                  'Hypothetical Projected On'
                                )}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.overlap.map((day) => (
                              <tr key={day.day}>
                                <th scope="row">{formatDate(day.day)}</th>
                                <td>{day.planned_on}</td>
                                <td>{day.projected_on}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {history && (
        <TimelineHistory row={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
