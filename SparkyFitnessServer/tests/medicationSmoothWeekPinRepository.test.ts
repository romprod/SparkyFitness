import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockDbClient,
  type MockDbClient,
} from './helpers/mockDbClient.js';
import {
  listSmoothWeekPins,
  pinSmoothWeekMedication,
  unpinSmoothWeekMedication,
} from '../models/medicationSmoothWeekPinRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({ getClient: vi.fn() }));

const userId = '00000000-0000-4000-a000-000000000001';
const medicationId = '00000000-0000-4000-a000-0000000000a1';

describe('medicationSmoothWeekPinRepository', () => {
  let client: MockDbClient;
  beforeEach(() => {
    client = createMockDbClient();
    client.query.mockReset();
    vi.mocked(getClient).mockResolvedValue(client as never);
  });

  it('lists pinned medication ids under the user scope', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ medication_id: medicationId }],
      rowCount: 1,
    });
    expect(await listSmoothWeekPins(userId)).toEqual([medicationId]);
    expect(getClient).toHaveBeenCalledWith(userId);
    expect(client.release).toHaveBeenCalled();
  });

  it('pins an owned medication with ON CONFLICT DO NOTHING', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await pinSmoothWeekMedication(userId, medicationId)).toBe(true);
    expect(String(client.query.mock.calls[1][0])).toContain(
      'ON CONFLICT DO NOTHING'
    );
    expect(client.query.mock.calls[1][1]).toEqual([userId, medicationId]);
  });

  it('does not insert and returns false for a medication that is not the user’s', async () => {
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await pinSmoothWeekMedication(userId, medicationId)).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalled();
  });

  it('unpins by user and medication and releases the client', async () => {
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await unpinSmoothWeekMedication(userId, medicationId);
    expect(String(client.query.mock.calls[0][0])).toContain('DELETE FROM');
    expect(client.query.mock.calls[0][1]).toEqual([userId, medicationId]);
    expect(client.release).toHaveBeenCalled();
  });
});
