import { z } from 'zod';

export const lifeEventsIdSchema = z.string().or(z.number());

export const lifeEventsSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  kind: z.string(),
  start_day: z.date(),
  end_day: z.date(),
  label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const lifeEventsInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  kind: z.string().optional(),
  start_day: z.date().optional(),
  end_day: z.date().optional(),
  label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const lifeEventsMutatorSchema = lifeEventsInitializerSchema.partial();

export type LifeEvents = z.infer<typeof lifeEventsSchema>;
export type LifeEventsInitializer = z.infer<typeof lifeEventsInitializerSchema>;
export type LifeEventsMutator = z.infer<typeof lifeEventsMutatorSchema>;
