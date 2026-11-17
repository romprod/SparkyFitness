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
}: {
  data: MedicationLogWeekResponse;
  subtype: MedSubtype;
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
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.week.provenance',
          'Actual doses use their recorded calendar date; times are displayed in {{timezone}}. Planned times keep each plan’s saved timezone. Matching date labels do not imply the same instant.',
          { timezone: data.timezone }
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.week.future',
          'Future plans show the recurrence currently configured; unknown future dose targets remain unknown. No hypothetical restarts are included.'
        )}
      </p>
      <div
        className="flex flex-wrap gap-3 text-xs"
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
            {glyph(value)} {status(value)}
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
          <table className="w-full min-w-[900px] table-fixed text-xs">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-40 sticky left-0 bg-background p-2 z-10 text-left"
                >
                  {t('medications.week.item', 'Medication / supplement')}
                </th>
                {data.days.map((day) => (
                  <th
                    scope="col"
                    key={day}
                    className={`p-2 border-l ${day === data.today ? 'bg-primary/10' : ''}`}
                  >
                    {formatDate(day)}
                    {day === data.today && (
                      <span className="block">
                        {t('common.today', 'Today')}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr key={lane.id}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-background p-2 align-top z-10 break-words text-left"
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
                    return (
                      <td
                        key={day}
                        className={`p-2 border-l border-t align-top ${day === data.today ? 'bg-primary/5' : ''}`}
                      >
                        <div className="space-y-2">
                          {items.map((item) => {
                            if (item.kind === 'actual') {
                              const actual = item.actual;
                              const slot = item.planned;
                              const description = `${status(actual.status)} · ${amount(actual.dose_amount, actual.dose_unit)} · ${actualTime(actual)} (${data.timezone})${slot ? ` · ${t('medications.week.plannedTime', 'Planned')}: ${plannedTime(slot)} (${slot.timezone})` : ''}`;
                              return (
                                <span
                                  key={actual.key}
                                  role="img"
                                  aria-label={`${lane.name} · ${day} · ${description}`}
                                  title={description}
                                  className="block rounded border bg-muted/40 p-1.5 break-words"
                                >
                                  <span aria-hidden="true">
                                    {glyph(actual.status)}{' '}
                                  </span>
                                  <span>{description}</span>
                                </span>
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
                            return (
                              <span
                                key={slot.id}
                                role="img"
                                aria-label={`${lane.name} · ${day} · ${detail}`}
                                title={detail}
                                className="block rounded border border-dashed p-1.5 break-words"
                              >
                                <span aria-hidden="true">
                                  {matched ? '↗' : glyph(slot.status)}{' '}
                                </span>
                                <span>{detail}</span>
                              </span>
                            );
                          })}
                          {!items.length && (
                            <span
                              aria-label={t(
                                'medications.week.noEntry',
                                'No entry'
                              )}
                            >
                              —
                            </span>
                          )}
                          {coverage.map((value) => (
                            <p
                              key={value}
                              className="text-[10px] text-muted-foreground"
                            >
                              {t(`medications.week.coverage.${value}`, value)}
                            </p>
                          ))}
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
    </div>
  );
}
