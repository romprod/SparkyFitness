import {
  addDays,
  INSIGHT_WINDOW_DAYS,
  instantToDay,
  type MedicationInsightStreams,
} from '@workspace/shared';
import { loadInsightRecords } from '../models/medicationInsightRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import {
  getMedicationCourseHistory,
  listMedicationCourses,
} from './medicationCourseService.js';

/**
 * Adherence over the window across the plans of the owner's injectable medications: doses taken
 * out of taken plus missed, as the course history scores them. Null when no dose was scored, or
 * when a plan's history cannot be read, so one plan never hides the other insights.
 */
async function injectableAdherence(
  owner: string,
  medicationIds: ReadonlySet<string>,
  window: { from_day: string; to_day: string },
  now: Date
): Promise<number | null> {
  if (medicationIds.size === 0) return null;
  try {
    const { courses } = await listMedicationCourses(owner, undefined, now);
    let taken = 0;
    let missed = 0;
    for (const course of courses) {
      if (!course.medication_id || !medicationIds.has(course.medication_id))
        continue;
      const history = await getMedicationCourseHistory(
        owner,
        course.id,
        window.from_day,
        window.to_day,
        now
      );
      taken += history.adherence.taken;
      missed += history.adherence.missed;
    }
    return taken + missed > 0
      ? Math.round((taken / (taken + missed)) * 100)
      : null;
  } catch {
    return null;
  }
}

export async function getMedicationInsightStreams(
  owner: string,
  authenticatedUserId: string | undefined,
  now = new Date()
): Promise<MedicationInsightStreams> {
  const timezone = await loadUserTimezone(owner);
  const today = instantToDay(now, timezone);
  const window = {
    from_day: addDays(today, -(INSIGHT_WINDOW_DAYS - 1)),
    to_day: today,
  };
  const records = await loadInsightRecords(
    owner,
    authenticatedUserId,
    window,
    timezone
  );
  const { injectable_medication_ids, ...streams } = records;
  return {
    today,
    from_day: window.from_day,
    ...streams,
    adherence_pct: await injectableAdherence(
      owner,
      new Set(injectable_medication_ids),
      window,
      now
    ),
  };
}
