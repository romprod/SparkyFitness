import type { MovableSchedule } from '@workspace/shared';
import type { MedicationSchedule } from '@/types/medications';

export const asMovable = (schedule: MedicationSchedule): MovableSchedule => ({
  id: schedule.id,
  schedule_type_id: schedule.schedule_type_id,
  days_of_week: schedule.days_of_week,
  interval_days: schedule.interval_days,
  start_date: schedule.start_date,
  end_date: schedule.end_date,
  active: schedule.active,
});
