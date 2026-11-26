import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import medicationRepository, {
  inUseMessage,
} from '../models/medicationRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const med = '00000000-0000-4000-a000-0000000000c1';
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });
const none = { stock: 0, plans: 0, schedules: 0, prescriptions: 0, doses: 0 };
const sql = () =>
  mocks.query.mock.calls.map(([text]) =>
    String(text).replace(/\s+/g, ' ').trim()
  );

// BEGIN, lock, blends, counts [, DELETE, COMMIT]
function script(counts: Partial<typeof none>, blends: string[] = []) {
  mocks.query.mockImplementation(async (text: string) => {
    const q = String(text);
    if (q.includes('FOR UPDATE')) return rows([{ id: med }]);
    if (q.includes('medication_blend_components'))
      return rows(blends.map((name) => ({ name })));
    if (q.includes('AS stock')) return rows([{ ...none, ...counts }]);
    if (q.startsWith('DELETE')) return rows([{ id: med }]);
    return rows();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('deleteMedication guard', () => {
  it.each([
    [{ stock: 2 }, 'In use by 2 stock items'],
    [{ plans: 1 }, 'In use by 1 plan'],
    [{ schedules: 3 }, 'In use by 3 schedules'],
    [{ prescriptions: 1 }, 'In use by 1 prescription'],
    [{ doses: 14 }, 'In use by 14 logged doses'],
  ])('refuses %j', async (counts, start) => {
    script(counts);
    await expect(
      medicationRepository.deleteMedication(owner, med)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: `${start} — delete those first, or mark it inactive.`,
      in_use: { ...none, ...counts },
    });
    expect(sql().some((q) => q.startsWith('DELETE'))).toBe(false);
    expect(sql().at(-1)).toBe('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('lists only the non-zero parts, in order, with singular and plural forms', () => {
    expect(
      inUseMessage({
        stock: 2,
        plans: 1,
        schedules: 0,
        prescriptions: 1,
        doses: 14,
      })
    ).toBe(
      'In use by 2 stock items, 1 plan, 1 prescription, 14 logged doses — delete those first, or mark it inactive.'
    );
  });

  it('deletes an unused medicine in one transaction that locks the owner’s row', async () => {
    script({});
    await expect(
      medicationRepository.deleteMedication(owner, med)
    ).resolves.toBe(true);
    const q = sql();
    expect(q[0]).toBe('BEGIN');
    expect(q[1]).toBe(
      'SELECT id FROM medications WHERE id = $1 AND user_id = $2 FOR UPDATE'
    );
    expect(mocks.query.mock.calls[1]![1]).toEqual([med, owner]);
    expect(q.at(-2)).toMatch(/^DELETE FROM medications/);
    expect(q.at(-1)).toBe('COMMIT');
  });

  it('counts only plans that are not soft-deleted, and schedules not handed to a live plan', async () => {
    script({});
    await medicationRepository.deleteMedication(owner, med);
    const counts = sql().find((q) => q.includes('AS stock'))!;
    expect(counts).toContain('deleted_at IS NULL');
    expect(counts).toContain('medication_course_handoffs');
    expect(counts).toContain('FROM medication_pens');
    expect(counts).toContain('FROM medication_packs');
    expect(counts).toContain('FROM medication_entries');
    expect(counts).toContain('FROM injection_entries');
    expect(counts).toContain('FROM medication_prescriptions');
  });

  it('answers false and deletes nothing when the medicine is not the owner’s', async () => {
    mocks.query.mockResolvedValue(rows());
    await expect(
      medicationRepository.deleteMedication(owner, med)
    ).resolves.toBe(false);
    expect(sql()).toEqual([
      'BEGIN',
      'SELECT id FROM medications WHERE id = $1 AND user_id = $2 FOR UPDATE',
      'ROLLBACK',
    ]);
  });

  it('keeps the blend refusal ahead of the in-use counts', async () => {
    script({ doses: 5 }, ['KLOW']);
    await expect(
      medicationRepository.deleteMedication(owner, med)
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        'This medication is a component of KLOW. Remove it from the blend before deleting it.',
    });
  });
});
