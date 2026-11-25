import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseStepInputSchema,
} from './MedicationCourses.api.zod.ts';
import { medicationStackSchema } from './MedicationStacks.api.zod.ts';

export const MAX_STACK_SETUP_COMPONENTS = 20;
export const MAX_STACK_SETUP_VIALS = 50;
export const MAX_STACK_SETUP_STEPS = 50;

const badAmount =
  'Add at least one component with a concentration and positive dose.';
const badQuantity = 'Each component needs a whole vial quantity of 1 or more.';
const tooManyVials = `A stack can have at most ${MAX_STACK_SETUP_VIALS} vials.`;

/** A finite positive amount with at most six decimals, so stored decimals stay exact. */
const amount = (message: string, max: number) =>
  z
    .number({ error: message })
    .finite(message)
    .positive(message)
    .max(max, message)
    .refine((value) => new Decimal(value).decimalPlaces() <= 6, message);

export const medicationStackSetupComponentSchema = z
  .object({
    medication_name: z
      .string({ error: 'Name each component.' })
      .trim()
      .min(1, 'Name each component.')
      .max(200, 'Use 200 characters or fewer'),
    concentration_value: amount(badAmount, 1_000_000),
    concentration_unit: z.enum(['mcg/ml', 'mg/ml']),
    vial_volume_ml: amount('Each vial needs a volume above zero.', 1000),
    quantity: z
      .number({ error: badQuantity })
      .int(badQuantity)
      .min(1, badQuantity)
      .max(MAX_STACK_SETUP_VIALS, tooManyVials),
    dose_volume_ml: amount(badAmount, 1000),
    /** Titration ramp phases, in the course step shape; masses in mcg or mg. */
    steps: z
      .array(
        medicationCourseStepInputSchema.extend({
          dose_unit: z.enum(['mcg', 'mg']),
        })
      )
      .max(MAX_STACK_SETUP_STEPS)
      .optional(),
  })
  .strict();
export type MedicationStackSetupComponent = z.infer<
  typeof medicationStackSetupComponentSchema
>;

export const medicationStackSetupInputSchema = z
  .object({
    operation_id: z.string().uuid(),
    name: z
      .string({ error: 'Give the stack a name.' })
      .trim()
      .min(1, 'Give the stack a name.')
      .max(80, 'Use 80 characters or fewer'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .transform((value) => (value ? value : null)),
    start_date: medicationCourseDaySchema.optional(),
    time_of_day: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullable()
      .optional(),
    components: z
      .array(medicationStackSetupComponentSchema)
      .min(1, badAmount)
      .max(
        MAX_STACK_SETUP_COMPONENTS,
        `A stack can have at most ${MAX_STACK_SETUP_COMPONENTS} components.`
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.components.forEach((component, index) => {
      const key = component.medication_name.toLowerCase();
      if (seen.has(key))
        context.addIssue({
          code: 'custom',
          path: ['components', index, 'medication_name'],
          message: 'Each component needs its own medicine; remove the repeat.',
        });
      seen.add(key);
      if (component.dose_volume_ml > component.vial_volume_ml)
        context.addIssue({
          code: 'custom',
          path: ['components', index, 'dose_volume_ml'],
          message: 'A dose cannot be larger than its vial.',
        });
      if (component.steps?.length && value.start_date === undefined)
        context.addIssue({
          code: 'custom',
          path: ['start_date'],
          message: 'A titration ramp needs a stack start date.',
        });
    });
    if (
      value.components.reduce((sum, item) => sum + item.quantity, 0) >
      MAX_STACK_SETUP_VIALS
    )
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: tooManyVials,
      });
  });
export type MedicationStackSetupInput = z.infer<
  typeof medicationStackSetupInputSchema
>;
/** What a client sends, before the name and notes are tidied. */
export type MedicationStackSetupRequest = z.input<
  typeof medicationStackSetupInputSchema
>;

export const medicationStackSetupResultSchema = z.object({
  operation_id: z.string().uuid(),
  stack: medicationStackSchema,
  components: z.array(
    z.object({
      medication_id: z.string().uuid(),
      medication_name: z.string(),
      medication_created: z.boolean(),
      vial_ids: z.array(z.string().uuid()),
      course_id: z.string().uuid(),
      dose_amount: z.string(),
      dose_unit: z.enum(['mcg', 'mg']),
    })
  ),
});
export type MedicationStackSetupResult = z.infer<
  typeof medicationStackSetupResultSchema
>;
