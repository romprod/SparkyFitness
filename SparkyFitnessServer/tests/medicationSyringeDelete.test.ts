import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getClient: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: mocks.getClient,
  dbContextStorage: { getStore: () => ({ authenticatedUserId: 'owner' }) },
}));
import { deleteSyringe } from '../models/medicationSyringeRepository.js';
const id = '00000000-0000-4000-a000-000000000001';
const client = {
  query: mocks.query,
  release: mocks.release,
} as unknown as PoolClient;
const sqls = () => mocks.query.mock.calls.map(([sql]) => String(sql));
const stub = (steps: { owned: boolean; used: boolean }) =>
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FOR UPDATE'))
      return { rows: steps.owned ? [{ id }] : [] };
    if (sql.includes('FROM injection_entries'))
      return { rows: steps.used ? [{ '?column?': 1 }] : [] };
    if (sql.startsWith('DELETE')) return { rows: [{ id }] };
    return { rows: [] };
  });
describe('deleteSyringe', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.release.mockReset();
    mocks.getClient.mockReset().mockResolvedValue(client);
  });
  it('deletes an unused device in one transaction', async () => {
    stub({ owned: true, used: false });
    await expect(deleteSyringe('owner', id)).resolves.toBe(true);
    const all = sqls();
    expect(all[0]).toBe('BEGIN');
    expect(
      all.some((s) => s.startsWith('DELETE FROM medication_syringes'))
    ).toBe(true);
    expect(all.at(-1)).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it('refuses with a 409 and never deletes when a dose used the device', async () => {
    stub({ owned: true, used: true });
    await expect(deleteSyringe('owner', id)).rejects.toMatchObject({
      message: 'Syringe is linked to recorded doses and cannot be removed.',
      statusCode: 409,
    });
    const all = sqls();
    expect(all.some((s) => s.startsWith('DELETE'))).toBe(false);
    expect(all).toContain('ROLLBACK');
    expect(all).not.toContain('COMMIT');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it('returns false for a device the user does not own', async () => {
    stub({ owned: false, used: false });
    await expect(deleteSyringe('owner', id)).resolves.toBe(false);
    expect(sqls().some((s) => s.startsWith('DELETE'))).toBe(false);
  });
  it('still maps a foreign key violation to the same 409', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE'))
        throw Object.assign(new Error('fk'), { code: '23503' });
      return { rows: [{ id }] };
    });
    mocks.query.mockImplementationOnce(async () => ({ rows: [] }));
    mocks.query.mockImplementationOnce(async () => ({ rows: [{ id }] }));
    mocks.query.mockImplementationOnce(async () => ({ rows: [] }));
    await expect(deleteSyringe('owner', id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
