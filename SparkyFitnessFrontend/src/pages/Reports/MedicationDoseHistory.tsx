import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cumulativeExposure,
  doseHeatmap,
  mondayIndex,
  todayInZone,
  type DoseHistoryEntry,
} from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationEntries } from '@/hooks/useMedications';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const LEVELS = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary',
];

const level = (count: number, max: number) => {
  if (count === 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
};

const mg = (value: string) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

/**
 * Dose history heatmap and cumulative exposure, both from every logged dose rather than the
 * report's date range. Exposure counts only doses recorded in mass units.
 */
export default function MedicationDoseHistory() {
  const { t } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const entries = useMedicationEntries({ fromDate: '2000-01-01' });
  const [picked, setPicked] = useState<string | null>(null);
  const today = todayInZone(timezone);
  const history = useMemo(
    () => (entries.data ?? []) as DoseHistoryEntry[],
    [entries.data]
  );
  const heat = useMemo(() => doseHeatmap(history, today), [history, today]);
  const exposure = useMemo(() => cumulativeExposure(history), [history]);
  if (entries.isLoading || entries.isError) return null;
  if (heat.days.length === 0 && exposure.length === 0) return null;

  const max = Math.max(...heat.days.map((d) => d.count), 0);
  const lead = heat.from ? mondayIndex(heat.from) : 0;
  const cells: ({ date: string; count: number } | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...heat.days,
  ];
  const pickedDay = heat.days.find((d) => d.date === picked);
  const doseWord = (count: number) =>
    t('medications.reports.heatmapDoses', '{{count}} doses', { count });

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
      {heat.days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">
              {t('medications.reports.heatmapTitle', 'Dose history')}
            </CardTitle>
            <CardDescription>
              {t('medications.reports.heatmapSince', 'Since {{date}}', {
                date: formatDate(heat.from!),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-md">
              <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
                {WEEKDAYS.map((day, i) => (
                  <span key={i}>{day}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell, i) =>
                  cell === null ? (
                    <div key={`lead-${i}`} className="aspect-square" />
                  ) : (
                    <button
                      key={cell.date}
                      type="button"
                      title={`${formatDate(cell.date)}: ${doseWord(cell.count)}`}
                      aria-label={`${formatDate(cell.date)}: ${doseWord(cell.count)}`}
                      onClick={() => setPicked(cell.date)}
                      className={`aspect-square rounded-sm ${LEVELS[level(cell.count, max)]} ${
                        cell.date === today
                          ? 'ring-1 ring-inset ring-primary'
                          : ''
                      }`}
                    />
                  )
                )}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>{t('medications.reports.heatmapLess', 'Less')}</span>
                {LEVELS.map((cls) => (
                  <span
                    key={cls}
                    className={`inline-block h-3 w-3 rounded-sm ${cls}`}
                  />
                ))}
                <span>{t('medications.reports.heatmapMore', 'More')}</span>
              </div>
              <p
                className="mt-2 min-h-5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {pickedDay
                  ? `${formatDate(pickedDay.date)}: ${doseWord(pickedDay.count)}`
                  : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {exposure.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">
              {t('medications.reports.exposureTitle', 'Cumulative exposure')}
            </CardTitle>
            <CardDescription>
              {t(
                'medications.reports.exposureSubtitle',
                'All logged doses, all time.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">
                    {t('medications.reports.exposureCompound', 'Compound')}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t('medications.reports.exposureDoses', 'Doses')}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t('medications.reports.exposureTotal', 'Total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {exposure.map((row) => (
                  <tr key={row.medication_id ?? row.name} className="border-t">
                    <td className="py-1.5">
                      {row.name}
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(row.first_date)} –{' '}
                        {formatDate(row.last_date)}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.doses}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {mg(row.total_mg)} mg
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t(
                'medications.reports.exposureNote',
                'Counts only doses recorded in mass units (mcg, mg, g). Doses logged in tablets, millilitres or other units are not converted.'
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
