import { describe, expect, it, vi } from 'vitest';
import injectionRepository from '../models/injectionRepository.js';
import { getClient } from '../db/poolManager.js';
vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
describe('serum history query bound', () => {
  it('keeps owner and medication scoping with the latest60 actual injections', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(client as never);
    await injectionRepository.listInjections('owner', {
      medicationId: 'med',
      limit: 60,
    });
    expect(getClient).toHaveBeenCalledWith('owner');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHERE user_id = \$1 AND medication_id = \$2\s+ORDER BY injected_at DESC LIMIT \$3/
      ),
      ['owner', 'med', 60]
    );
    expect(client.release).toHaveBeenCalledOnce();
  });
});
