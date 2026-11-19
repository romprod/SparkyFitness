import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import injectionRepository from '../models/injectionRepository.js';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', async () => ({
  getClient: vi.fn(),
  dbContextStorage: new (await import('node:async_hooks')).AsyncLocalStorage(),
}));

type Route = [match: string | RegExp, result: unknown];
// The repository runs a few lock and validation queries around the interesting
// statements, so answer by SQL text instead of by call order.
const medicationRow = { id: 'med', type_id: 'injection', route_id: null };

describe('injectionRepository', () => {
  let mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  const userId = uuidv4();
  const medicationId = uuidv4();
  const penId = uuidv4();
  const injectionId = uuidv4();

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(mockClient as never);
    mockClient.query.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const route = (...routes: Route[]) =>
    mockClient.query.mockImplementation(async (sql: string) => {
      for (const [match, result] of routes)
        if (typeof match === 'string' ? sql.includes(match) : match.test(sql))
          return result;
      if (sql.includes('FROM medications WHERE id=$1 AND user_id=$2 FOR SHARE'))
        return { rows: [medicationRow] };
      return { rows: [], rowCount: 0 };
    });

  describe('createInjection', () => {
    it('deducts the given pen inside the transaction', async () => {
      route(
        ['FROM medication_pens WHERE id=$1', { rows: [{ id: penId }] }],
        [
          'INSERT INTO injection_entries',
          { rows: [{ id: injectionId, pen_id: penId }] },
        ],
        [
          'doses_used = doses_used + 1',
          { rows: [{ id: penId, doses_used: 2, status: 'in_use' }] },
        ]
      );

      const result = await injectionRepository.createInjection(userId, {
        medication_id: medicationId,
        pen_id: penId,
        dose_mg: 1,
        deduct_pen: true,
      });

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO injection_entries'),
        expect.arrayContaining([medicationId, userId, penId, 1])
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('doses_used = doses_used + 1'),
        [penId, userId]
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result.pen).toEqual({
        id: penId,
        doses_used: 2,
        status: 'in_use',
      });
      // No auto-pick lookup when a pen_id is given.
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringMatching(
          /^SELECT id FROM medication_pens\s+WHERE user_id/
        ),
        expect.anything()
      );
    });

    it('auto-picks a pen when deduct_pen is set without pen_id', async () => {
      const pickedPenId = uuidv4();
      route(
        ['FROM medication_pens WHERE id=$1', { rows: [{ id: pickedPenId }] }],
        [
          /SELECT id FROM medication_pens\s+WHERE user_id/,
          { rows: [{ id: pickedPenId }] },
        ],
        [
          'INSERT INTO injection_entries',
          { rows: [{ id: injectionId, pen_id: pickedPenId }] },
        ],
        [
          'doses_used = doses_used + 1',
          { rows: [{ id: pickedPenId, doses_used: 1, status: 'in_use' }] },
        ]
      );

      const result = await injectionRepository.createInjection(userId, {
        medication_id: medicationId,
        dose_mg: 1,
        deduct_pen: true,
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        [userId, medicationId]
      );
      // The picked pen id is stored on the injection row (delete keys on it).
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO injection_entries'),
        expect.arrayContaining([pickedPenId])
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('doses_used = doses_used + 1'),
        [pickedPenId, userId]
      );
      expect(result.pen?.id).toBe(pickedPenId);
    });

    it('does not record a pen_id when deduct_pen is false, even if one is passed', async () => {
      route([
        'INSERT INTO injection_entries',
        { rows: [{ id: injectionId, pen_id: null }] },
      ]);

      await injectionRepository.createInjection(userId, {
        medication_id: medicationId,
        pen_id: penId,
        dose_mg: 1,
        deduct_pen: false,
      });

      // No auto-pick and no deduction happen.
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringMatching(
          /^SELECT id FROM medication_pens\s+WHERE user_id/
        ),
        expect.anything()
      );
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('doses_used = doses_used + 1'),
        expect.anything()
      );
      // The persisted pen_id (INSERT param index 2) is null, so a later delete
      // won't wrongly credit a dose back.
      const insertCall = mockClient.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO injection_entries')
      );
      expect(insertCall?.[1]?.[2]).toBeNull();
    });

    it('logs without deduction when no candidate pen exists', async () => {
      route([
        'INSERT INTO injection_entries',
        { rows: [{ id: injectionId, pen_id: null }] },
      ]); // auto-pick finds nothing

      const result = await injectionRepository.createInjection(userId, {
        medication_id: medicationId,
        dose_mg: 1,
        deduct_pen: true,
      });

      expect(result.pen).toBeNull();
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('doses_used = doses_used + 1'),
        expect.anything()
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it.each([
      ['mcg', 500, 0.5],
      ['mg', 0.5, 0.5],
      ['mL', 0.5, null],
    ])(
      'resolves non-GLP-1 %s defaults without changing the meaning of the unit',
      async (unit, amount, expected) => {
        route(
          [
            'medication_titration_steps',
            {
              rows: [
                {
                  dose_mg: null,
                  dose_amount: amount,
                  dose_unit: unit,
                  is_glp1: false,
                },
              ],
            },
          ],
          ['INSERT INTO injection_entries', { rows: [{ id: injectionId }] }]
        );
        await injectionRepository.createInjection(userId, {
          medication_id: medicationId,
        });
        const insert = mockClient.query.mock.calls.find(([sql]) =>
          String(sql).includes('INSERT INTO injection_entries')
        );
        expect(insert?.[1]?.[6]).toBe(expected);
      }
    );

    it('resolves a missing dose from titration/medication defaults', async () => {
      route(
        ['medication_titration_steps', { rows: [{ dose_mg: 0.5 }] }],
        [
          'INSERT INTO injection_entries',
          { rows: [{ id: injectionId, dose_mg: 0.5 }] },
        ]
      );

      await injectionRepository.createInjection(userId, {
        medication_id: medicationId,
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('medication_titration_steps'),
        [userId, medicationId]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO injection_entries'),
        expect.arrayContaining([0.5])
      );
    });

    it('rolls back when a query fails', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO injection_entries'))
          throw new Error('boom');
        if (sql.includes('FOR SHARE')) return { rows: [medicationRow] };
        return { rows: [], rowCount: 0 };
      });

      await expect(
        injectionRepository.createInjection(userId, {
          medication_id: medicationId,
          dose_mg: 1,
        })
      ).rejects.toThrow('boom');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('deleteInjection', () => {
    it('credits the dose back to the pen the injection deducted', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ pen_id: penId }] }) // identify vial
        .mockResolvedValueOnce({ rows: [{ id: penId }] }) // lock vial before injection
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: injectionId, pen_id: penId }],
        }) // DELETE
        .mockResolvedValueOnce({}) // UPDATE pen restore
        .mockResolvedValueOnce({}); // COMMIT

      const ok = await injectionRepository.deleteInjection(userId, injectionId);

      expect(ok).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('RETURNING id, pen_id'),
        [injectionId, userId]
      );
      const restore = mockClient.query.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' && sql.includes('GREATEST(doses_used - 1, 0)')
      );
      expect(restore).toBeDefined();
      expect(restore?.[0]).toContain("THEN 'in_use'");
      expect(restore?.[0]).toContain('reorder_flag');
      expect(restore?.[1]).toEqual([penId, userId]);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('does not touch pens when the injection had no pen', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ pen_id: null }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: injectionId, pen_id: null }],
        }) // DELETE
        .mockResolvedValueOnce({}); // COMMIT

      const ok = await injectionRepository.deleteInjection(userId, injectionId);

      expect(ok).toBe(true);
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('GREATEST(doses_used - 1, 0)'),
        expect.anything()
      );
    });

    it('returns false when nothing was deleted', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // DELETE
        .mockResolvedValueOnce({}); // COMMIT

      const ok = await injectionRepository.deleteInjection(userId, injectionId);
      expect(ok).toBe(false);
    });

    it('rolls back when the restore fails', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ pen_id: penId }] }) // identify vial
        .mockResolvedValueOnce({ rows: [{ id: penId }] }) // lock vial before injection
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: injectionId, pen_id: penId }],
        }) // DELETE
        .mockRejectedValueOnce(new Error('restore failed')); // UPDATE fails

      await expect(
        injectionRepository.deleteInjection(userId, injectionId)
      ).rejects.toThrow('restore failed');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateInjection', () => {
    it('updates only provided fields scoped to the user', async () => {
      route(
        [
          'UPDATE injection_entries',
          { rows: [{ id: injectionId, site: 'right_thigh' }] },
        ],
        [
          'SELECT * FROM injection_entries',
          { rows: [{ id: injectionId, medication_id: medicationId }] },
        ]
      );

      const result = await injectionRepository.updateInjection(
        userId,
        injectionId,
        { site: 'right_thigh', dose_mg: 0.5 }
      );

      const [sql, values] = mockClient.query.mock.calls.find(([text]) =>
        String(text).includes('UPDATE injection_entries')
      )!;
      expect(sql).toContain('UPDATE injection_entries');
      expect(sql).toContain('site = $3');
      expect(sql).toContain('dose_mg = $4');
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(values).toEqual([injectionId, userId, 'right_thigh', 0.5]);
      expect(result).toEqual({ id: injectionId, site: 'right_thigh' });
    });

    it('returns null when the injection does not exist', async () => {
      route();
      const result = await injectionRepository.updateInjection(
        userId,
        injectionId,
        { site: 'left_abdomen' }
      );
      expect(result).toBeNull();
    });

    it('returns the current row when no fields are provided', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: injectionId }],
      });
      const result = await injectionRepository.updateInjection(
        userId,
        injectionId,
        {}
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [injectionId, userId]
      );
      expect(result).toEqual({ id: injectionId });
    });
  });
});
