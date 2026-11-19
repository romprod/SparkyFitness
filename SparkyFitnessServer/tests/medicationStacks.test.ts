import { describe, expect, it } from 'vitest';
import {
  MAX_STACK_MEMBERS,
  medicationStackInputSchema,
} from '@workspace/shared';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('medication stack input', () => {
  it('trims the name, defaults notes to null and keeps the chosen order', () => {
    expect(
      medicationStackInputSchema.parse({
        name: '  Morning stack ',
        medication_ids: [id(2), id(1)],
      })
    ).toEqual({
      name: 'Morning stack',
      notes: null,
      medication_ids: [id(2), id(1)],
    });
    expect(
      medicationStackInputSchema.parse({
        name: 'A',
        notes: '  with food ',
        medication_ids: [id(1)],
      }).notes
    ).toBe('with food');
  });

  it('refuses an empty or long name, no members, repeats and too many members', () => {
    const bad = (value: object) =>
      medicationStackInputSchema.safeParse({
        medication_ids: [id(1)],
        ...value,
      }).success;
    expect(bad({ name: '   ' })).toBe(false);
    expect(bad({ name: 'x'.repeat(81) })).toBe(false);
    expect(bad({ name: 'ok', medication_ids: [] })).toBe(false);
    expect(bad({ name: 'ok', medication_ids: [id(1), id(1)] })).toBe(false);
    expect(bad({ name: 'ok', medication_ids: ['not-a-uuid'] })).toBe(false);
    expect(
      bad({
        name: 'ok',
        medication_ids: Array.from({ length: MAX_STACK_MEMBERS + 1 }, (_, i) =>
          id(i + 1)
        ),
      })
    ).toBe(false);
    expect(
      bad({
        name: 'ok',
        medication_ids: Array.from({ length: MAX_STACK_MEMBERS }, (_, i) =>
          id(i + 1)
        ),
      })
    ).toBe(true);
  });
});
