import { z } from 'zod';
import { optionalDateSchema, uuidSchema } from './common.js';

const listMedicationsSchema = z
  .object({
    action: z.literal('list_medications'),
    glp1_only: z
      .boolean()
      .optional()
      .describe('Filter to GLP-1 medications only'),
    active_only: z
      .boolean()
      .optional()
      .describe('Filter to active medications only'),
  })
  .strict();

const getMedicationSchema = z
  .object({
    action: z.literal('get_medication'),
    medication_id: uuidSchema.describe('UUID of the medication'),
  })
  .strict();

const logDoseSchema = z
  .object({
    action: z.literal('log'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    status: z
      .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
      .optional()
      .describe('Dose status (defaults to taken)'),
    taken_at: z
      .string()
      .optional()
      .describe('ISO timestamp when the dose was taken'),
    entry_date: optionalDateSchema,
    dose_amount_snapshot: z
      .number()
      .optional()
      .describe('Dose amount (e.g. 10 for 10 mg)'),
    dose_unit_snapshot: z
      .string()
      .optional()
      .describe('Dose unit (e.g. mg, mL)'),
    notes: z.string().optional().describe('Optional notes about the dose'),
    pack_id: uuidSchema
      .optional()
      .describe(
        'Take the dose from this tablet/capsule pack (default: the open pack that expires first)'
      ),
    deduct_pack: z
      .boolean()
      .optional()
      .describe('Set false to log the dose without taking from any pack'),
  })
  .strict();

const listEntriesSchema = z
  .object({
    action: z.literal('list_entries'),
    medication_id: uuidSchema
      .optional()
      .describe('Filter to a specific medication'),
    from_date: optionalDateSchema,
    to_date: optionalDateSchema,
  })
  .strict();

const updateEntrySchema = z
  .object({
    action: z.literal('update_entry'),
    entry_id: uuidSchema.describe('UUID of the entry to update'),
    status: z
      .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
      .optional()
      .describe('New dose status'),
    taken_at: z
      .string()
      .optional()
      .describe('New ISO timestamp when the dose was taken'),
    entry_date: optionalDateSchema,
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('New notes (pass null to clear)'),
  })
  .strict();

const deleteEntrySchema = z
  .object({
    action: z.literal('delete_entry'),
    entry_id: uuidSchema.describe('UUID of the entry to delete'),
  })
  .strict();

const logInjectionSchema = z
  .object({
    action: z.literal('log_injection'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the GLP-1 medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    dose_mg: z
      .number()
      .optional()
      .describe(
        'Dose in mg (defaults from active titration step or medication dose)'
      ),
    site: z
      .string()
      .optional()
      .describe('Injection site (abdomen, thigh, arm, etc.)'),
    deduct_pen: z
      .boolean()
      .optional()
      .describe(
        'Whether to deduct from pen inventory (auto-picks best pen if true)'
      ),
    entry_date: optionalDateSchema,
    notes: z.string().optional().describe('Optional notes'),
  })
  .strict();

const listInjectionsSchema = z
  .object({
    action: z.literal('list_injections'),
    medication_id: uuidSchema
      .optional()
      .describe('Filter to a specific medication'),
    from_date: optionalDateSchema,
    to_date: optionalDateSchema,
  })
  .strict();

const createMedicationSchema = z
  .object({
    action: z.literal('create_medication'),
    name: z.string().min(1, 'Medication name is required'),
    strength_value: z
      .number()
      .optional()
      .describe('Strength value (e.g. 300 for 300mg)'),
    strength_unit: z
      .string()
      .optional()
      .describe('Strength unit (e.g. mg, mL)'),
    dose_amount: z
      .number()
      .positive()
      .optional()
      .describe('Default dose amount per intake'),
    dose_unit: z.string().optional().describe('Default dose unit'),
    type_id: z
      .string()
      .optional()
      .describe(
        'Medication form: pill, tablet, capsule, liquid, injection, patch, inhaler, drops, cream, suppository, other'
      ),
    reason_text: z
      .string()
      .optional()
      .describe('Why the medication is taken (condition/reason)'),
    is_glp1: z
      .boolean()
      .optional()
      .describe('Whether this is a GLP-1 medication'),
    is_supplement: z
      .boolean()
      .optional()
      .describe('Whether this is a supplement rather than a prescription'),
    is_active: z
      .boolean()
      .optional()
      .describe('Whether the medication is active'),
    notes: z.string().optional().describe('Optional notes'),
  })
  .strict();

const updateMedicationSchema = z
  .object({
    action: z.literal('update_medication'),
    medication_id: uuidSchema.describe('UUID of the medication to update'),
    name: z.string().min(1).optional().describe('New name'),
    strength_value: z
      .number()
      .nullable()
      .optional()
      .describe('New strength value'),
    strength_unit: z
      .string()
      .nullable()
      .optional()
      .describe('New strength unit'),
    dose_amount: z
      .number()
      .positive()
      .nullable()
      .optional()
      .describe('New default dose amount'),
    dose_unit: z
      .string()
      .nullable()
      .optional()
      .describe('New default dose unit'),
    type_id: z.string().nullable().optional().describe('New medication form'),
    reason_text: z.string().nullable().optional().describe('New reason'),
    is_glp1: z.boolean().optional().describe('Set GLP-1 flag'),
    is_supplement: z.boolean().optional().describe('Set supplement flag'),
    is_active: z.boolean().optional().describe('Set active flag'),
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('New notes (pass null to clear)'),
  })
  .strict();

const deleteMedicationSchema = z
  .object({
    action: z.literal('delete_medication'),
    medication_id: uuidSchema.describe('UUID of the medication to delete'),
  })
  .strict();

const listSchedulesSchema = z
  .object({
    action: z.literal('list_schedules'),
    medication_id: uuidSchema.describe('UUID of the medication'),
  })
  .strict();

const addScheduleSchema = z
  .object({
    action: z.literal('add_schedule'),
    medication_id: uuidSchema.describe('UUID of the medication'),
    schedule_type_id: z
      .enum([
        'daily',
        'specific_days',
        'every_n_days',
        'cyclic',
        'weekly',
        'monthly',
        'prn',
        'taper',
      ])
      .default('daily')
      .describe('Schedule recurrence type (defaults to daily)'),
    time_of_day: z
      .string()
      .optional()
      .describe("Time of day in 'HH:MM' 24-hour format (e.g. 08:00, 18:00)"),
    dose_amount: z
      .number()
      .positive()
      .optional()
      .describe('Dose amount for this schedule slot'),
    days_of_week: z
      .array(z.number().int().min(0).max(6))
      .optional()
      .describe('Days of week for specific_days (0=Sun … 6=Sat)'),
    interval_days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Interval in days for every_n_days'),
    with_meal: z
      .enum(['before', 'with', 'after'])
      .optional()
      .describe('Timing relative to a meal'),
    prn_reason: z
      .string()
      .optional()
      .describe('Reason for a PRN (as-needed) schedule'),
    start_date: optionalDateSchema,
  })
  .strict()
  .refine(
    (data) =>
      data.schedule_type_id !== 'specific_days' ||
      (data.days_of_week !== undefined && data.days_of_week.length > 0),
    {
      message:
        'days_of_week is required (and must be non-empty) when schedule_type_id is "specific_days".',
      path: ['days_of_week'],
    }
  )
  .refine(
    (data) =>
      data.schedule_type_id !== 'every_n_days' ||
      data.interval_days !== undefined,
    {
      message:
        'interval_days is required when schedule_type_id is "every_n_days".',
      path: ['interval_days'],
    }
  );

const deleteScheduleSchema = z
  .object({
    action: z.literal('delete_schedule'),
    schedule_id: uuidSchema.describe('UUID of the schedule to delete'),
  })
  .strict();

const packStatus = z.enum(['sealed', 'in_use', 'finished', 'discarded']);
const packFields = {
  label: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe('Pack name or label'),
  units_used: z.number().min(0).optional().describe('Units already used'),
  expiry_date: optionalDateSchema,
  lot_number: z.string().max(200).nullable().optional(),
  storage_location: z.string().max(200).nullable().optional(),
  reorder_threshold_units: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Warn when this few units are left'),
  notes: z.string().max(2000).nullable().optional(),
};

const listPacksSchema = z
  .object({
    action: z.literal('list_packs'),
    medication_id: uuidSchema
      .optional()
      .describe('Only packs of this medication (or use medication_name)'),
    include_closed: z
      .boolean()
      .optional()
      .describe('Also list finished and discarded packs'),
  })
  .strict();

const addPackSchema = z
  .object({
    action: z.literal('add_pack'),
    medication_id: uuidSchema.describe(
      'UUID of the medication or supplement (or use medication_name)'
    ),
    unit_label: z
      .string()
      .min(1)
      .max(200)
      .describe('What the pack counts: tablets, capsules, softgels, scoops'),
    units_total: z.number().positive().describe('Units in the full pack'),
    pack_status: z
      .enum(['sealed', 'in_use'])
      .optional()
      .describe('Starting state (default sealed)'),
    ...packFields,
  })
  .strict();

const updatePackSchema = z
  .object({
    action: z.literal('update_pack'),
    pack_id: uuidSchema.describe('UUID of the pack'),
    unit_label: z.string().min(1).max(200).optional(),
    units_total: z.number().positive().optional(),
    pack_status: packStatus
      .optional()
      .describe(
        'Deliberate state change: in_use (open it), finished (retire it) or discarded'
      ),
    ...packFields,
  })
  .strict();

const deletePackSchema = z
  .object({
    action: z.literal('delete_pack'),
    pack_id: uuidSchema.describe('UUID of the pack to delete'),
  })
  .strict();

export const manageMedicationsSchema = z
  .discriminatedUnion('action', [
    listMedicationsSchema,
    getMedicationSchema,
    logDoseSchema,
    listEntriesSchema,
    updateEntrySchema,
    deleteEntrySchema,
    logInjectionSchema,
    listInjectionsSchema,
    createMedicationSchema,
    updateMedicationSchema,
    deleteMedicationSchema,
    listSchedulesSchema,
    addScheduleSchema,
    deleteScheduleSchema,
    listPacksSchema,
    addPackSchema,
    updatePackSchema,
    deletePackSchema,
  ])
  .refine(
    (data) => {
      if (data.action === 'log' || data.action === 'log_injection') {
        return !!(data.medication_id || data.medication_name);
      }
      return true;
    },
    { message: 'Either medication_id or medication_name is required' }
  );

export type ManageMedicationsInput = z.infer<typeof manageMedicationsSchema>;

export const manageMedicationsInput = z.object({
  action: z
    .enum([
      'list_medications',
      'get_medication',
      'log',
      'list_entries',
      'update_entry',
      'delete_entry',
      'log_injection',
      'list_injections',
      'create_medication',
      'update_medication',
      'delete_medication',
      'list_schedules',
      'add_schedule',
      'delete_schedule',
      'list_packs',
      'add_pack',
      'update_pack',
      'delete_pack',
    ])
    .optional()
    .describe('Action to perform'),
  medication_id: uuidSchema.optional().describe('UUID of the medication'),
  medication_name: z
    .string()
    .optional()
    .describe(
      'Name of the medication (alternative to medication_id for log / log_injection)'
    ),
  entry_id: uuidSchema
    .optional()
    .describe('UUID of the entry (for update_entry / delete_entry)'),
  status: z
    .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
    .optional()
    .describe('Dose status'),
  taken_at: z
    .string()
    .optional()
    .describe('ISO timestamp when the dose was taken'),
  entry_date: optionalDateSchema.describe(
    'Calendar date for the dose (YYYY-MM-DD, defaults to today)'
  ),
  notes: z.string().nullable().optional().describe('Notes about the entry'),
  glp1_only: z
    .boolean()
    .optional()
    .describe('Filter to GLP-1 medications only'),
  active_only: z
    .boolean()
    .optional()
    .describe('Filter to active medications only'),
  from_date: optionalDateSchema,
  to_date: optionalDateSchema,
  dose_mg: z.number().optional().describe('Dose in mg (for log_injection)'),
  dosage: z
    .number()
    .optional()
    .describe('Dosage amount (alternative to dose_amount_snapshot, e.g. 10)'),
  dosage_unit: z
    .string()
    .optional()
    .describe('Dosage unit (alternative to dose_unit_snapshot, e.g. mg)'),
  dose_amount_snapshot: z
    .number()
    .optional()
    .describe('Dosage amount (alternative to dosage, e.g. 10)'),
  dose_unit_snapshot: z
    .string()
    .optional()
    .describe('Dosage unit (alternative to dosage_unit, e.g. mg)'),
  site: z.string().optional().describe('Injection site'),
  deduct_pen: z
    .boolean()
    .optional()
    .describe('Whether to deduct from pen inventory'),
  name: z
    .string()
    .optional()
    .describe('Medication name (for create_medication / update_medication)'),
  strength_value: z
    .number()
    .nullable()
    .optional()
    .describe('Strength value (e.g. 300 for 300mg)'),
  strength_unit: z
    .string()
    .nullable()
    .optional()
    .describe('Strength unit (e.g. mg, mL)'),
  dose_amount: z
    .number()
    .nullable()
    .optional()
    .describe('Default dose amount per intake'),
  dose_unit: z.string().nullable().optional().describe('Default dose unit'),
  type_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Medication form: pill, tablet, capsule, liquid, injection, patch, inhaler, drops, cream, suppository, other'
    ),
  reason_text: z
    .string()
    .nullable()
    .optional()
    .describe('Why the medication is taken'),
  is_glp1: z
    .boolean()
    .optional()
    .describe('Whether this is a GLP-1 medication'),
  is_supplement: z
    .boolean()
    .optional()
    .describe('Whether this is a supplement'),
  is_active: z
    .boolean()
    .optional()
    .describe('Whether the medication is active'),
  schedule_id: uuidSchema
    .optional()
    .describe('UUID of the schedule (for delete_schedule)'),
  schedule_type_id: z
    .string()
    .optional()
    .describe(
      'Schedule recurrence type: daily, specific_days, every_n_days, cyclic, weekly, monthly, prn, taper'
    ),
  time_of_day: z
    .string()
    .optional()
    .describe("Schedule time in 'HH:MM' 24-hour format"),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('Days of week for specific_days (0=Sun … 6=Sat)'),
  interval_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Interval in days for every_n_days'),
  with_meal: z
    .enum(['before', 'with', 'after'])
    .optional()
    .describe('Timing relative to a meal'),
  prn_reason: z.string().optional().describe('Reason for a PRN schedule'),
  start_date: optionalDateSchema,
  pack_id: uuidSchema
    .optional()
    .describe('UUID of a tablet/capsule pack (log, update_pack, delete_pack)'),
  deduct_pack: z
    .boolean()
    .optional()
    .describe('For log: false means do not take the dose from any pack'),
  include_closed: z
    .boolean()
    .optional()
    .describe('For list_packs: also list finished and discarded packs'),
  unit_label: z
    .string()
    .max(200)
    .optional()
    .describe('Pack unit: tablets, capsules, softgels, scoops'),
  units_total: z.number().positive().optional().describe('Units in the pack'),
  units_used: z.number().min(0).optional().describe('Units already used'),
  pack_status: z
    .enum(['sealed', 'in_use', 'finished', 'discarded'])
    .optional()
    .describe('Pack state for add_pack (sealed or in_use) or update_pack'),
  label: z.string().max(200).nullable().optional().describe('Pack label'),
  expiry_date: optionalDateSchema,
  lot_number: z.string().max(200).nullable().optional(),
  storage_location: z.string().max(200).nullable().optional(),
  reorder_threshold_units: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Warn when this few pack units are left'),
});
