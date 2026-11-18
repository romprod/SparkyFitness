import { describe, expect, it } from 'vitest';
import { ListMedicationsQuerySchema } from '../schemas/medicationSchemas.js';

const parse = (query: Record<string, unknown>) =>
  ListMedicationsQuerySchema.safeParse(query);

describe('list medications query flags', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
    ['', false],
  ])('reads activeOnly=%j as %s', (raw, expected) => {
    const result = parse({ activeOnly: raw });
    expect(result.success).toBe(true);
    expect(result.data?.activeOnly).toBe(expected);
  });

  it('reads glp1Only the same way and leaves absent flags unset', () => {
    expect(parse({ glp1Only: 'false' }).data?.glp1Only).toBe(false);
    expect(parse({ glp1Only: 'true' }).data?.glp1Only).toBe(true);
    const none = parse({});
    expect(none.data?.activeOnly).toBeUndefined();
    expect(none.data?.glp1Only).toBeUndefined();
  });

  it('rejects a word that is neither true nor false instead of guessing', () => {
    expect(parse({ activeOnly: 'maybe' }).success).toBe(false);
  });
});
