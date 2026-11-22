import type { DoseExportRecord } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * Every recorded dose and injection of the owner, newest first, for the CSV download. Plain
 * medication entries and injections live in separate tables, so both are read and laid out alike.
 * A medication that has since been deleted keeps the name saved with its record.
 */
export async function listDoseExportRecords(
  userId: string,
  authenticatedUserId?: string
): Promise<DoseExportRecord[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT 'entry'::text AS entry_type, e.taken_at, e.entry_date::text AS entry_date,
              COALESCE(e.med_name_snapshot, NULLIF(m.display_name,''), m.name) AS medication,
              m.is_supplement, e.status, NULL::text AS administration_route,
              e.dose_amount_snapshot::text AS dose_amount, e.dose_unit_snapshot AS dose_unit,
              NULL::text AS volume_ml, NULL::text AS syringe_units, NULL::text AS site,
              NULL::text AS vial, e.source, e.scheduled_for, r.name AS plan, e.notes
         FROM medication_entries e
         LEFT JOIN medications m ON m.id=e.medication_id AND m.user_id=e.user_id
         LEFT JOIN medication_course_revisions r ON r.id=e.course_revision_id AND r.user_id=e.user_id
        WHERE e.user_id=$1
       UNION ALL
       SELECT 'injection'::text, i.injected_at, i.entry_date::text,
              COALESCE(i.medication_name_snapshot, NULLIF(m.display_name,''), m.name),
              m.is_supplement, 'taken'::text, i.administration_route,
              i.dose_mg::text, 'mg'::text,
              i.volume_ml::text, i.syringe_units::text, i.site,
              COALESCE(NULLIF(p.label,''), p.lot_number), i.source, i.scheduled_for, r.name, i.notes
         FROM injection_entries i
         LEFT JOIN medications m ON m.id=i.medication_id AND m.user_id=i.user_id
         LEFT JOIN medication_pens p ON p.id=i.pen_id AND p.user_id=i.user_id
         LEFT JOIN medication_course_revisions r ON r.id=i.course_revision_id AND r.user_id=i.user_id
        WHERE i.user_id=$1
       ORDER BY taken_at DESC NULLS LAST, entry_date DESC`,
      [userId]
    );
    return result.rows as DoseExportRecord[];
  } finally {
    client.release();
  }
}
