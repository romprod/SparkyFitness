import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import { getInjection } from '../models/injectionRepository.js';
describe('exact scoped injection correction read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
  });
  it('selects only the bound exact ID and owner and retains original stock/snapshot fields', async () => {
    const row = {
      id: 'id',
      medication_id: null,
      pen_id: 'stock',
      dose_mg_exact: '0.125',
      medication_name_snapshot: 'Synthetic saved',
    };
    mocks.query.mockResolvedValue({ rows: [row] });
    expect(await getInjection('owner', 'id')).toEqual(row);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id=$1 AND user_id=$2'),
      ['id', 'owner']
    );
    expect(mocks.query.mock.calls[0]![0]).not.toMatch(
      /UPDATE|INSERT|DELETE|FOR UPDATE/
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('returns null for an absent scoped row without falling back to any medication list', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await getInjection('foreign', 'id')).toBeNull();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('releases on a read error', async () => {
    mocks.query.mockRejectedValue(new Error('Synthetic read failure'));
    await expect(getInjection('owner', 'id')).rejects.toThrow(
      'Synthetic read failure'
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
