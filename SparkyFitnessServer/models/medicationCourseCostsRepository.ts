import type { PoolClient } from 'pg';
import {
  buildMedicationCourseCosts,
  type MedicationCostDose,
  type MedicationCourse,
  type MedicationCourseCosts,
  type MedicationCourseCostCourse,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { loadInventoryForecastSnapshot } from './medicationInventoryForecastRepository.js';
import { loadMedicationPrescriptionFinancialSnapshot } from './medicationPrescriptionFinancialSnapshot.js';
import { assertMedicationFinancialOwner } from './medicationPurchaseRepository.js';

function currentRevision(course: MedicationCourse) {
  const live = course.revisions.filter((revision) => !revision.deleted_at);
  return (
    live.find((revision) => revision.id === course.current_revision_id) ??
    [...live].sort((a, b) => b.revision_no - a.revision_no)[0] ??
    null
  );
}
/**
 * Owner-only course spend: consumed cost per course from one read snapshot of
 * the financial facts, logged doses and courses.
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
    for (const med of snapshot.medications) {
      for (const course of med.courses) {
        if (course.deleted_at) continue;
        const revision = currentRevision(course);
        if (!revision) continue;
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
    }
    const result = buildMedicationCourseCosts({
      as_of: now.toISOString(),
      courses,
      invoices: financial.invoices,
      vials: financial.vials,
      prescriptions: financial.prescriptions,
      doses: doses.rows,
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
