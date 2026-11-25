import {
  ADHERENCE_WINDOW_DAYS,
  addDays,
  adherenceFigure,
  INSIGHT_WINDOW_DAYS,
  instantToDay,
  type MedicationAdherenceRow,
  type MedicationAdherenceWindow,
  type MedicationInsightStreams,
} from '@workspace/shared';
import {
  loadAdherenceMedications,
  loadInsightRecords,
} from '../models/medicationInsightRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import {
  getMedicationCourseHistory,
  listMedicationCourses,
} from './medicationCourseService.js';

type CourseAdherence = Awaited<
  ReturnType<typeof getMedicationCourseHistory>
>['adherence'];

/**
 * The scored adherence of every live plan of the given medications over the window, as the course
 * history scores it. One entry per plan; errors propagate.
 */
async function scoreMedicationCourses(
  owner: string,
  medicationIds: ReadonlySet<string>,
  window: { from_day: string; to_day: string },
  now: Date
): Promise<{ medication_id: string; adherence: CourseAdherence }[]> {
  if (medicationIds.size === 0) return [];
  const { courses } = await listMedicationCourses(owner, undefined, now);
  const scored: { medication_id: string; adherence: CourseAdherence }[] = [];
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
    scored.push({
      medication_id: course.medication_id,
      adherence: history.adherence,
    });
  }
  return scored;
}

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
  try {
    const scored = await scoreMedicationCourses(
      owner,
      medicationIds,
      window,
      now
    );
    let taken = 0;
    let missed = 0;
    for (const { adherence } of scored) {
      taken += adherence.taken;
      missed += adherence.missed;
    }
    return taken + missed > 0
      ? Math.round((taken / (taken + missed)) * 100)
      : null;
  } catch {
    return null;
  }
}

/**
 * Adherence for each injectable medication on a plan over the 90 days ending today, and overall.
 * A medication is listed when one of its plans has a slot in the window, or a taken dose was
 * logged in it. Unlike the Insights card this fails loudly: an unreadable plan is an error.
 */
export async function getMedicationAdherenceWindow(
  owner: string,
  authenticatedUserId: string | undefined,
  now = new Date()
): Promise<MedicationAdherenceWindow> {
  const timezone = await loadUserTimezone(owner);
  const today = instantToDay(now, timezone);
  const window = {
    from_day: addDays(today, -(ADHERENCE_WINDOW_DAYS - 1)),
    to_day: today,
  };
  const medications = await loadAdherenceMedications(
    owner,
    authenticatedUserId,
    window
  );
  const scored = await scoreMedicationCourses(
    owner,
    new Set(medications.map((medication) => medication.id)),
    window,
    now
  );
  const rows: MedicationAdherenceRow[] = [];
  const allDays: { date: string; taken: number; missed: number }[] = [];
  for (const medication of medications) {
    const plans = scored.filter((plan) => plan.medication_id === medication.id);
    const hasSlot = plans.some((plan) =>
      plan.adherence.days.some((day) => day.slots.length > 0)
    );
    if (!hasSlot && !medication.dosed_in_window) continue;
    const days = plans.flatMap((plan) => plan.adherence.days);
    allDays.push(...days);
    rows.push({
      medication_id: medication.id,
      name: medication.name,
      ...adherenceFigure(days),
    });
  }
  return {
    today,
    from_day: window.from_day,
    to_day: window.to_day,
    overall: adherenceFigure(allDays),
    medications: rows,
  };
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
