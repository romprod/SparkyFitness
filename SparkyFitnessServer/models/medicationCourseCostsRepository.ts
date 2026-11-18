import type { PoolClient } from 'pg';
import {
  buildInventoryForecastPlan,
  buildMedicationCourseCosts,
  type MedicationCostDose,
  type MedicationCourse,
  type MedicationCourseCosts,
  type MedicationCourseCostCourse,
  type MedicationCoursePlannedDemand,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { loadInventoryForecastSnapshot } from './medicationInventoryForecastRepository.js';
import { loadMedicationPrescriptionFinancialSnapshot } from './medicationPrescriptionFinancialSnapshot.js';
import { assertMedicationFinancialOwner } from './medicationPurchaseRepository.js';
import { buildMedicationForecastPlanInput } from '../services/medicationInventoryForecastService.js';

function currentRevision(course: MedicationCourse) {
  const live = course.revisions.filter((revision) => !revision.deleted_at);
  return (
    live.find((revision) => revision.id === course.current_revision_id) ??
    [...live].sort((a, b) => b.revision_no - a.revision_no)[0] ??
    null
  );
}
/**
 * Owner-only course spend. One read snapshot supplies the financial facts, logged
 * doses and the planned-cycle forecast plans, so actual and estimate agree.
 */
export async function getMedicationCourseCosts(
  userId: string,
  now: Date = new Date()
): Promise<MedicationCourseCosts> {
  assertMedicationFinancialOwner(userId);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await loadInventoryForecastSnapshot(client, userId, now);
    const financial = await loadMedicationPrescriptionFinancialSnapshot(
      client,
      userId
    );
    const doses = await client.query<MedicationCostDose>(
      'SELECT r.course_id,e.medication_id,e.pen_id,e.entry_date::text,e.dose_mg::text,e.volume_ml::text,e.dose_input_unit FROM injection_entries e LEFT JOIN medication_course_revisions r ON r.id=e.course_revision_id AND r.user_id=e.user_id WHERE e.user_id=$1 ORDER BY e.id',
      [userId]
    );
    const courses: MedicationCourseCostCourse[] = [];
    const planned: MedicationCoursePlannedDemand[] = [];
    for (const med of snapshot.medications) {
      const revisionCourse = new Map<string, string>();
      for (const course of med.courses) {
        if (course.deleted_at) continue;
        const revision = currentRevision(course);
        if (!revision) continue;
        for (const r of course.revisions) revisionCourse.set(r.id, course.id);
        courses.push({
          course_id: course.id,
          medication_id: med.id,
          medication_name: med.name,
          name: revision.name,
          status: revision.status,
          start_date: revision.start_date,
          end_date: revision.end_date,
        });
      }
      const built = buildMedicationForecastPlanInput(
        snapshot,
        med,
        now,
        'planned_cycles'
      );
      if (!built) continue;
      const plan = buildInventoryForecastPlan(built.planInput);
      const slotsByCourse = new Map<
        string,
        { value: string | null; unit: string | null }[]
      >();
      for (const slot of plan.slots) {
        const courseId =
          slot.plan_kind === 'course_revision'
            ? revisionCourse.get(slot.plan_id)
            : undefined;
        if (!courseId) continue;
        const list = slotsByCourse.get(courseId) ?? [];
        list.push({ value: slot.value, unit: slot.unit });
        slotsByCourse.set(courseId, list);
      }
      for (const [course_id, slots] of slotsByCourse)
        planned.push({
          course_id,
          slots,
          basis: plan.basis,
          coverage_end: plan.coverage_end,
        });
    }
    const result = buildMedicationCourseCosts({
      as_of: now.toISOString(),
      courses,
      invoices: financial.invoices,
      vials: financial.vials,
      prescriptions: financial.prescriptions,
      doses: doses.rows,
      planned,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
