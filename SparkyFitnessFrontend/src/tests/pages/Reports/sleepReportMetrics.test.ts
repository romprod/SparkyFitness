import {
  averageStageSeconds,
  dailyStageSeconds,
  reportedStageSeconds,
  sleepReportCsv,
} from '@/pages/Reports/sleepReportMetrics';
const row = (rem: number | null, deep: number | null) => ({
  rem_sleep_seconds: rem,
  deep_sleep_seconds: deep,
});
describe('reported sleep stages', () => {
  it('sums seconds independently only when every retained session reports the stage', () => {
    const sessions = [row(1200, 600), row(300, null)];
    expect(dailyStageSeconds(sessions, 'rem_sleep_seconds')).toBe(1500);
    expect(dailyStageSeconds(sessions, 'deep_sleep_seconds')).toBeNull();
    expect(dailyStageSeconds([], 'rem_sleep_seconds')).toBeNull();
  });
  it.each([null, undefined, -1, NaN, Infinity, '600'])(
    'keeps malformed or absent %s unknown, not measured zero',
    (value) => {
      expect(
        reportedStageSeconds(
          {
            rem_sleep_seconds: value,
            deep_sleep_seconds: 1,
          } as unknown as Parameters<typeof reportedStageSeconds>[0],
          'rem_sleep_seconds'
        )
      ).toBeNull();
    }
  );
  it('retains zero and averages known daily totals with stage-specific denominators', () => {
    const days = [row(3600, null), row(0, 1800), row(null, 0), row(-1, NaN)];
    expect(dailyStageSeconds([row(0, 0), row(0, 0)], 'rem_sleep_seconds')).toBe(
      0
    );
    expect(averageStageSeconds(days, 'rem_sleep_seconds')).toEqual({
      seconds: 1800,
      days: 2,
    });
    expect(averageStageSeconds(days, 'deep_sleep_seconds')).toEqual({
      seconds: 900,
      days: 2,
    });
    expect(averageStageSeconds([row(null, null)], 'rem_sleep_seconds')).toEqual(
      { seconds: null, days: 0 }
    );
  });
  it('does not clip reported stage seconds to another sleep duration or infer a missing metric', () => {
    expect(dailyStageSeconds([row(99999, null)], 'rem_sleep_seconds')).toBe(
      99999
    );
    expect(
      dailyStageSeconds([row(99999, null)], 'deep_sleep_seconds')
    ).toBeNull();
  });
  it('quotes CSV fields and preserves raw seconds, missing, zero, existing units and day values', () => {
    expect(
      sleepReportCsv(
        ['Date', 'Duration', 'Source', 'REM (seconds)', 'Deep sleep (seconds)'],
        [['2026-10-24', '8h 0m', 'Device, "night"\nsecond line', 0, null]]
      )
    ).toBe(
      '"Date","Duration","Source","REM (seconds)","Deep sleep (seconds)"\n"2026-10-24","8h 0m","Device, ""night""\nsecond line","0",""'
    );
  });
});
