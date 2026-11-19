import { beforeEach, describe, expect, it, vi } from 'vitest';
import repository from '../models/medicationPenRepository.js';
import { getClient } from '../db/poolManager.js';
vi.mock('../db/poolManager.js', async () => ({
  getClient: vi.fn(),
  dbContextStorage: new (await import('node:async_hooks')).AsyncLocalStorage(),
}));
const query = vi.fn();
const release = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClient).mockResolvedValue({ query, release } as never);
});
describe('vial stock from injection history', () => {
  it('returns mass stock for variable linked doses', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          kind: 'vial',
          status: 'finished',
          concentration_mg_ml: '4',
          volume_ml: '3',
          doses_used: 3,
          stock_used_mg: '2.1',
          stock_missing_doses: '0',
          stock_linked_count: '3',
        },
      ],
    });
    const [pen] = await repository.listPens('owner', 'medicine');
    expect(pen.stock?.remainingMg).toBeCloseTo(9.9);
    expect(pen.status).toBe('in_use');
    expect(query.mock.calls[0][1]).toEqual(['owner', 'medicine']);
    expect(release).toHaveBeenCalled();
  });
  it('keeps unknown historic use unknown', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          kind: 'vial',
          concentration_mg_ml: '4',
          volume_ml: '3',
          doses_used: 8,
          stock_used_mg: '2.1',
          stock_missing_doses: '0',
          stock_linked_count: '3',
        },
      ],
    });
    expect((await repository.listPens('owner'))[0].stock).toBeNull();
  });
  it('refuses changes to preparation after use and rolls back', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            kind: 'vial',
            volume_ml: '3.000',
            concentration_mg_ml: '4',
            doses_used: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({});
    await expect(
      repository.updatePen('owner', 'vial', { volume_ml: 4 })
    ).rejects.toThrow('Preparation details cannot change');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});
