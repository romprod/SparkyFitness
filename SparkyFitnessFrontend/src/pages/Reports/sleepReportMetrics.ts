import type { SleepEntry } from '@/types';

type ReportedStage = 'rem_sleep_seconds' | 'deep_sleep_seconds';

/** Reported aggregates only: missing or malformed data is not measured zero. */
export function reportedStageSeconds(
  entry: Pick<SleepEntry, ReportedStage>,
  stage: ReportedStage
): number | null {
  const value = entry[stage];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Each retained session must report a stage before its daily total is known. */
export function dailyStageSeconds(
  entries: Pick<SleepEntry, ReportedStage>[],
  stage: ReportedStage
): number | null {
  if (!entries.length) return null;
  let total = 0;
  for (const entry of entries) {
    const value = reportedStageSeconds(entry, stage);
    if (value === null) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

export function averageStageSeconds(
  entries: Pick<SleepEntry, ReportedStage>[],
  stage: ReportedStage
) {
  const known = entries
    .map((entry) => reportedStageSeconds(entry, stage))
    .filter((value): value is number => value !== null);
  const mean = known.length
    ? known.reduce((sum, value) => sum + value, 0) / known.length
    : null;
  return {
    seconds: mean !== null && Number.isFinite(mean) ? mean : null,
    days: known.length,
  };
}

/** Quote every field and escape embedded quotes, commas and line breaks. */
export function sleepReportCsv(
  headers: string[],
  rows: (string | number | null)[][]
): string {
  return [headers, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');
}
