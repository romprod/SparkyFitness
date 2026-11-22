import { z } from 'zod';
import { daysBetween, isDayString } from '../../utils/timezone.ts';

export const LIFE_EVENT_KINDS = ['illness', 'travel', 'other'] as const;
export type LifeEventKind = (typeof LIFE_EVENT_KINDS)[number];
/** The longest window accepted, counting both its first and last day. */
export const LIFE_EVENT_MAX_DAYS = 120;
export const LIFE_EVENT_MAX_LABEL = 60;

const day = z.string().refine(isDayString, 'Use a real date (YYYY-MM-DD)');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

/**
 * An illness, travel or other window. A blank end day means the start day only. The label is a
 * short tag such as "flu"; anything longer belongs in the notes.
 */
export const lifeEventInputSchema = z
  .object({
    kind: z.enum(LIFE_EVENT_KINDS),
    start_day: day,
    end_day: day.nullable().optional(),
    label: optionalText(LIFE_EVENT_MAX_LABEL),
    notes: optionalText(2000),
  })
  .transform((value) => ({
    ...value,
    end_day: value.end_day ?? value.start_day,
  }))
  .superRefine((value, ctx) => {
    const span = daysBetween(value.start_day, value.end_day) + 1;
    if (span < 1)
      ctx.addIssue({
        code: 'custom',
        path: ['end_day'],
        message: 'The end day must be on or after the start day',
      });
    else if (span > LIFE_EVENT_MAX_DAYS)
      ctx.addIssue({
        code: 'custom',
        path: ['end_day'],
        message: `A window may cover at most ${LIFE_EVENT_MAX_DAYS} days`,
      });
  });
export type LifeEventInput = z.input<typeof lifeEventInputSchema>;

export const lifeEventSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(LIFE_EVENT_KINDS),
  start_day: z.string(),
  end_day: z.string(),
  label: z.string().nullable(),
  notes: z.string().nullable(),
});
export type LifeEvent = z.infer<typeof lifeEventSchema>;

export const lifeEventListSchema = z.object({
  life_events: z.array(lifeEventSchema),
});
