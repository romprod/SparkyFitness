import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STACK_MEMBERS,
  medicationStackInputSchema,
} from '@workspace/shared';

const queries: { sql: string; params: unknown[] }[] = [];
let known = 2;
const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (sql.includes('FROM medications')) return { rows: [], rowCount: known };
    return { rows: [], rowCount: 1 };
  }),
  release: vi.fn(),
};
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => fakeClient),
}));

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

describe('medication stack member writes', () => {
  beforeEach(() => {
    queries.length = 0;
    known = 2;
  });

  it('diffs members on update instead of deleting every row', async () => {
    const { updateStack } =
      await import('../models/medicationStackRepository.js');
    const input = {
      name: 'Renamed',
      notes: null,
      medication_ids: [id(2), id(1)],
    };
    expect(await updateStack(id(9), id(8), input)).toBe(true);
    const sql = queries.map((q) => q.sql);
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    const member = sql.filter((q) => q.includes('medication_stack_members'));
    expect(member).toHaveLength(3);
    // Only members missing from the list are deleted.
    expect(member[0]).toMatch(/^DELETE .*AND NOT \(medication_id = ANY/);
    expect(queries.find((q) => q.sql.startsWith('DELETE'))!.params).toEqual([
      id(8),
      input.medication_ids,
    ]);
    // Positions change only where they differ; inserts skip existing members.
    expect(member[1]).toMatch(/^UPDATE .*sm\.position <> want\.position - 1/);
    expect(member[2]).toMatch(/^INSERT .*WHERE NOT EXISTS/);
  });

  it('refuses unknown or repeated medications before touching members', async () => {
    known = 1;
    const { updateStack } =
      await import('../models/medicationStackRepository.js');
    await expect(
      updateStack(id(9), id(8), {
        name: 'x',
        notes: null,
        medication_ids: [id(1), id(1)],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    const sql = queries.map((q) => q.sql);
    expect(sql.some((q) => q.includes('medication_stack_members'))).toBe(false);
    expect(sql.at(-1)).toBe('ROLLBACK');
  });
});
