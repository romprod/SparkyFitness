import { z } from 'zod';
import { medicationCourseDaySchema } from './MedicationCourses.api.zod.ts';
import { medicationInventoryForecastResponseSchema } from './MedicationInventoryForecast.api.zod.ts';

/** Opaque server proof for the exact queued stock identity and unchanged raw state. */
export const medicationPreparationQueueStateSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

/** Display facts only. Expand uses a fresh same-ID stock read, never a reconstructed pen. */
export const medicationPreparationQueueItemSchema = z
  .object({
    stock_id: z.string().uuid(),
    medication_id: z.string().uuid(),
    medication_name: z.string(),
    route: z.enum(['injection', 'nasal']),
    label: z.string().nullable(),
    label_mass_mg: z.string().nullable(),
    raw_status: z.literal('sealed'),
    expiry_date: medicationCourseDaySchema.nullable(),
    expired: z.boolean(),
    preparation_queue_state: medicationPreparationQueueStateSchema,
  })
  .superRefine((item, context) => {
    if (item.expired && item.expiry_date === null)
      context.addIssue({
        code: 'custom',
        message: 'An expired annotation requires a recorded expiry date',
      });
  });

/** Selection is authoritative, rather than a client-side heuristic over forecast rows. */
export const medicationInventorySupplySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('no_demand'),
    medication_id: z.null(),
  }),
  z.object({
    state: z.literal('forecast'),
    medication_id: z.string().uuid(),
  }),
  z.object({
    state: z.literal('unavailable'),
    medication_id: z.string().uuid().nullable(),
  }),
]);

export const medicationInventoryDashboardResponseSchema = z
  .object({
    forecast: medicationInventoryForecastResponseSchema,
    supply: medicationInventorySupplySchema,
    preparation_queue: z.array(medicationPreparationQueueItemSchema),
  })
  .superRefine((dashboard, context) => {
    if (dashboard.supply.medication_id !== null) {
      const selected = dashboard.forecast.medications.find(
        (medication) =>
          medication.medication_id === dashboard.supply.medication_id
      );
      if (!selected)
        context.addIssue({
          code: 'custom',
          path: ['supply', 'medication_id'],
          message:
            'The selected supply item must belong to the same forecast snapshot',
        });
      else if (
        (dashboard.supply.state === 'forecast' &&
          selected.status === 'unknown') ||
        (dashboard.supply.state === 'unavailable' &&
          selected.status !== 'unknown')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['supply', 'state'],
          message:
            'Supply state must retain the selected forecast coverage state',
        });
      }
    }
    const identities = dashboard.preparation_queue.map((item) => item.stock_id);
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: 'custom',
        path: ['preparation_queue'],
        message: 'A preparation queue contains each stock identity only once',
      });
  });
export type MedicationPreparationQueueItem = z.infer<
  typeof medicationPreparationQueueItemSchema
>;
export type MedicationInventorySupply = z.infer<
  typeof medicationInventorySupplySchema
>;
export type MedicationInventoryDashboardResponse = z.infer<
  typeof medicationInventoryDashboardResponseSchema
>;
