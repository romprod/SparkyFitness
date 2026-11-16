import { z } from 'zod';
import {
  medicationCourseSchema,
  medicationCourseRevisionSchema,
  medicationCourseRuleSchema,
  medicationCourseStepSchema,
  medicationCourseActivitySchema,
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
} from '../api/MedicationCourses.api.zod.ts';

const uuid = z.string().uuid();
const timestamp = z.union([z.date(), medicationCourseInstantSchema]);
export const medicationCoursesSchema = medicationCourseSchema
  .omit({ revisions: true })
  .extend({
    captured_at: timestamp,
    deleted_at: timestamp.nullable(),
  });
export const medicationCourseRevisionsSchema = medicationCourseRevisionSchema
  .omit({ rules: true, steps: true, activity: true })
  .extend({
    created_at: timestamp,
    deleted_at: timestamp.nullable(),
  });
export const medicationCourseRulesSchema = medicationCourseRuleSchema;
export const medicationCourseStepsSchema = medicationCourseStepSchema;
export const medicationCourseActivitiesSchema =
  medicationCourseActivitySchema.extend({
    from_at: timestamp,
    until_at: timestamp.nullable(),
  });
export const medicationCourseHandoffsSchema = z.object({
  id: uuid,
  user_id: uuid,
  course_id: uuid,
  revision_id: uuid,
  schedule_id: uuid.nullable(),
  original_schedule_id: uuid,
  original_rule: z.record(z.string(), z.unknown()),
  original_fingerprint: z.string(),
  cutover_day: medicationCourseDaySchema,
  capped_end_date: medicationCourseDaySchema,
  created_at: timestamp,
});
export const medicationCourseOperationsSchema = z.object({
  user_id: uuid,
  operation_id: uuid,
  actor_id: uuid,
  request_hash: z.string(),
  course_id: uuid,
  action: z.string(),
  result: z.record(z.string(), z.unknown()),
  created_at: timestamp,
});
export type MedicationCourses = z.infer<typeof medicationCoursesSchema>;
export type MedicationCourseRevisions = z.infer<
  typeof medicationCourseRevisionsSchema
>;
export type MedicationCourseRules = z.infer<typeof medicationCourseRulesSchema>;
export type MedicationCourseSteps = z.infer<typeof medicationCourseStepsSchema>;
export type MedicationCourseActivities = z.infer<
  typeof medicationCourseActivitiesSchema
>;
export type MedicationCourseHandoffs = z.infer<
  typeof medicationCourseHandoffsSchema
>;
export type MedicationCourseOperations = z.infer<
  typeof medicationCourseOperationsSchema
>;
