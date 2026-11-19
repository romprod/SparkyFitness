import { useMemo } from 'react';
import { useMedicationCourses } from '@/hooks/Medications/useMedicationCourses';

/** Medications whose doses follow a live course plan, so their plain schedules are not edited. */
export function useManagedMedicationIds(): Set<string> {
  const courses = useMedicationCourses();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const course of courses.data?.courses ?? []) {
      if (course.deleted_at !== null || course.medication_id === null) continue;
      const tip = course.revisions.find(
        (revision) => revision.id === course.current_revision_id
      );
      if (tip && tip.status !== 'completed') ids.add(course.medication_id);
    }
    return ids;
  }, [courses.data]);
}
