import { z } from 'zod';
import {
  medicationStackScheduleSchema,
  stackMemberScheduleStatusSchema,
  stackNotFollowingReasonSchema,
} from './MedicationStackSchedule.api.zod.ts';

export const MAX_STACK_MEMBERS = 30;

const stackName = z
  .string()
  .trim()
  .min(1, 'Give the stack a name')
  .max(80, 'Use 80 characters or fewer');

/** Create or replace a stack: its name, notes and the medications in it, in order. */
export const medicationStackInputSchema = z.object({
  name: stackName,
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
  medication_ids: z
    .array(z.string().uuid())
    .min(1, 'Choose at least one medication or supplement')
    .max(MAX_STACK_MEMBERS)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Each item can be in a stack once'
    ),
});
export type MedicationStackInput = z.infer<typeof medicationStackInputSchema>;

export const medicationStackMemberSchema = z.object({
  medication_id: z.string().uuid(),
  name: z.string(),
  is_supplement: z.boolean(),
  is_active: z.boolean(),
  /** Absent from older servers; only a stack with a schedule reports more than `no_schedule`. */
  schedule_status: stackMemberScheduleStatusSchema.optional(),
  schedule_note: stackNotFollowingReasonSchema.nullable().optional(),
  /** The other stack, when the note is follows_other_stack. */
  schedule_note_stack_name: z.string().nullable().optional(),
  /** The medicine follows this stack's schedule, so its plan's timing is set by the stack. */
  schedule_bound: z.boolean().optional(),
});
export type MedicationStackMember = z.infer<typeof medicationStackMemberSchema>;

export const medicationStackSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  notes: z.string().nullable(),
  members: z.array(medicationStackMemberSchema),
  created_at: z.string(),
  schedule: medicationStackScheduleSchema.nullable().optional(),
});
export type MedicationStack = z.infer<typeof medicationStackSchema>;

export const medicationStackListSchema = z.object({
  stacks: z.array(medicationStackSchema),
});
export type MedicationStackList = z.infer<typeof medicationStackListSchema>;
