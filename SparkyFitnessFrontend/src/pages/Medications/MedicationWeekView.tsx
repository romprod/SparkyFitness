import { useTranslation } from 'react-i18next';
import {
  medicationWeekCellItems,
  type MedicationLogWeekResponse,
  type MedicationLogWeekActual,
  type MedicationLogWeekPlannedSlot,
  type MedSubtype,
} from '@workspace/shared';
import { formatTimeInZone } from '@/utils/timeFormatters';
import { usePreferences } from '@/contexts/PreferencesContext';

export default function MedicationWeekView({
  data,
  subtype,
  onOpenDay,
}: {
  data: MedicationLogWeekResponse;
  subtype: MedSubtype;
  onOpenDay?: (day: string, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const { formatDate, timeFormat } = usePreferences();
  const lanes = data.lanes.filter(
    (lane) =>
      subtype === 'all' ||
      (subtype === 'supplements'
        ? lane.is_supplement === true
        : lane.is_supplement === false)
  );
  const amount = (value: string | null, unit: string | null) =>
    value === null
      ? t('medications.week.doseUnknown', 'Dose unknown')
      : `${value} ${unit ?? t('medications.week.unitUnknown', '(unit unknown)')}`;
  const actualTime = (row: MedicationLogWeekActual) =>
    row.occurred_at
      ? formatTimeInZone(
          row.occurred_at,
          { kind: 'tz', tz: data.timezone },
          timeFormat
        )
      : t('medications.week.timeUnknown', 'Time unknown');
  const plannedTime = (row: MedicationLogWeekPlannedSlot) =>
    row.time_of_day ?? t('medications.week.timeNotSet', 'Time not set');
  const status = (value: string) =>
    t(`medications.week.status.${value}`, value);
  const glyph = (value: string) =>
    value === 'taken' || value === 'prn_taken'
      ? '✓'
      : value === 'missed'
        ? '×'
        : value === 'skipped'
          ? '−'
          : value === 'snoozed'
            ? '◷'
            : '○';
  const tone = (value: string) =>
    value === 'taken' || value === 'prn_taken'
      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : value === 'missed'
        ? 'border-destructive/50 bg-destructive/10 text-red-700 dark:text-red-300'
        : value === 'snoozed'
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : value === 'skipped'
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-primary/40 bg-transparent text-primary';
  const weekday = (day: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  const shortTime = (value: string) =>
    value.replace(/^(\d{1,2}:\d{2}):\d{2}/, '$1');
  const coverageSeen = new Set<string>();
  for (const item of data.coverage)
    if (
      item.coverage !== 'available' &&
      lanes.some((lane) => lane.id === item.lane_id)
    )
      coverageSeen.add(item.coverage);
  const chip = (
    key: string,
    glyphText: string,
    toneClass: string,
    time: string,
    label: string,
    dashed: boolean
  ) => (
    <span
      key={key}
      role="img"
      aria-label={label}
      title={label}
      className={`mx-auto flex w-fit min-w-9 flex-col items-center rounded-md border px-1.5 py-0.5 leading-tight ${dashed ? 'border-dashed' : ''} ${toneClass}`}
    >
      <span aria-hidden="true" className="text-sm font-semibold">
        {glyphText}
      </span>
      <span aria-hidden="true" className="text-[10px] tabular-nums">
        {time}
      </span>
    </span>
  );
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label={t('medications.week.legend', 'Dose status legend')}
      >
        {[
          'taken',
          'prn_taken',
          'planned',
          'pending',
          'missed',
          'skipped',
          'snoozed',
        ].map((value) => (
          <span key={value}>
            <span
              className={`mr-1 inline-block w-4 rounded border text-center ${tone(value)}`}
            >
              {glyph(value)}
            </span>
            {status(value)}
          </span>
        ))}
      </div>
      {!lanes.length ? (
        <p>
          {t(
            'medications.week.empty',
            'No dose records or known planned slots in this week.'
          )}
        </p>
      ) : (
        <div
          role="region"
          tabIndex={0}
          aria-label={t(
            'medications.week.scroll',
            'Weekly dose lanes; scroll horizontally for all seven days'
          )}
          className="overflow-x-auto border rounded-md focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[640px] table-fixed text-xs">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-36 sticky left-0 bg-background p-2 z-10 text-left"
                >
                  {t('medications.week.item', 'Medication / supplement')}
                </th>
                {data.days.map((day) => (
                  <th
                    scope="col"
                    key={day}
                    className={`p-2 border-l font-medium ${day === data.today ? 'bg-primary/10 text-primary' : ''}`}
                  >
                    {(() => {
                      const heading = (
                        <>
                          <span className="block">{weekday(day)}</span>
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {formatDate(day)}
                          </span>
                          {day === data.today && (
                            <span className="block text-[10px] uppercase tracking-wide">
                              {t('common.today', 'Today')}
                            </span>
                          )}
                        </>
                      );
                      return onOpenDay ? (
                        <button
                          type="button"
                          className="mx-auto block rounded px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t(
                            'medications.week.openDay',
                            'Open {{date}}',
                            { date: formatDate(day) }
                          )}
                          onClick={(event) =>
                            onOpenDay(day, event.currentTarget)
                          }
                        >
                          {heading}
                        </button>
                      ) : (
                        heading
                      );
                    })()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr key={lane.id}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-background p-2 align-middle z-10 break-words text-left font-medium"
                  >
                    {lane.name ||
                      t(
                        'medications.week.unknownItem',
                        'Unknown recorded medication'
                      )}
                  </th>
                  {data.days.map((day) => {
                    const items = medicationWeekCellItems(data, day, lane.id);
                    const coverage = [
                      ...new Set(
                        data.coverage
                          .filter(
                            (item) =>
                              item.lane_id === lane.id && item.day === day
                          )
                          .map((item) => item.coverage)
                      ),
                    ].filter((item) => item !== 'available');
                    const coverageLabel = coverage
                      .map((value) =>
                        t(`medications.week.coverage.${value}`, value)
                      )
                      .join(' · ');
                    return (
                      <td
                        key={day}
                        title={coverageLabel || undefined}
                        className={`p-1.5 border-l border-t align-middle text-center ${day === data.today ? 'bg-primary/5' : ''}`}
                      >
                        <div className="space-y-1">
                          {items.map((item) => {
                            if (item.kind === 'actual') {
                              const actual = item.actual;
                              const slot = item.planned;
                              const description = `${status(actual.status)} · ${amount(actual.dose_amount, actual.dose_unit)} · ${actualTime(actual)} (${data.timezone})${slot ? ` · ${t('medications.week.plannedTime', 'Planned')}: ${plannedTime(slot)} (${slot.timezone})` : ''}`;
                              return chip(
                                actual.key,
                                glyph(actual.status),
                                tone(actual.status),
                                actual.occurred_at ? actualTime(actual) : '',
                                `${lane.name} · ${day} · ${description}`,
                                false
                              );
                            }
                            const slot = item.planned;
                            const matched = item.actual;
                            const description = matched
                              ? t(
                                  'medications.week.recordedOtherDay',
                                  'Planned slot; recorded {{status}}: {{amount}} on {{date}}',
                                  {
                                    status: status(matched.status),
                                    amount: amount(
                                      matched.dose_amount,
                                      matched.dose_unit
                                    ),
                                    date: formatDate(matched.entry_date),
                                  }
                                )
                              : `${status(slot.status)} · ${amount(slot.dose_amount, slot.dose_unit)}`;
                            const detail = `${description} · ${plannedTime(slot)} (${slot.timezone})`;
                            return chip(
                              slot.id,
                              matched ? '↗' : glyph(slot.status),
                              tone(matched ? matched.status : slot.status),
                              slot.time_of_day
                                ? shortTime(slot.time_of_day)
                                : '',
                              `${lane.name} · ${day} · ${detail}`,
                              true
                            );
                          })}
                          {!items.length && (
                            <span
                              className="text-muted-foreground"
                              aria-label={t(
                                'medications.week.noEntry',
                                'No entry'
                              )}
                            >
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {t(
            'medications.week.provenance',
            'Actual doses use their recorded calendar date; times are displayed in {{timezone}}. Planned times keep each plan’s saved timezone. Matching date labels do not imply the same instant.',
            { timezone: data.timezone }
          )}
        </p>
        <p>
          {t(
            'medications.week.future',
            'Future plans show the recurrence currently configured; unknown future dose targets remain unknown. No hypothetical restarts are included.'
          )}
        </p>
        {[...coverageSeen].map((value) => (
          <p key={value}>{t(`medications.week.coverage.${value}`, value)}</p>
        ))}
        <p>
          {t(
            'medications.week.hoverHint',
            'Hover a mark for the dose, time and plan details.'
          )}
        </p>
      </div>
    </div>
  );
}
