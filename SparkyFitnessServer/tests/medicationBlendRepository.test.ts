import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  blendsContaining,
  listBlends,
  replaceBlend,
} from '../models/medicationBlendRepository.js';
import medicationRepository from '../models/medicationRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const blend = '00000000-0000-4000-a000-0000000000b1';
const a = '00000000-0000-4000-a000-0000000000c1';
const b = '00000000-0000-4000-a000-0000000000c2';
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });
const sql = () =>
  mocks.query.mock.calls.map(([text]) =>
    String(text).replace(/\s+/g, ' ').trim()
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('listing blends', () => {
  it('reads the owner’s blends and makes a plain list when none has components', async () => {
    mocks.query.mockResolvedValueOnce(
      rows([
        {
          blend_medication_id: blend,
          name: 'KLOW',
          components: [{ name: 'A' }],
        },
        { blend_medication_id: a, name: 'Other', components: null },
      ])
    );
    const list = await listBlends(owner, owner);
    expect(list.map((x) => [x.name, x.components.length])).toEqual([
      ['KLOW', 1],
      ['Other', 0],
    ]);
    expect(mocks.query.mock.calls[0]![1]).toEqual([owner]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalled();
  });
});

describe('replacing a composition', () => {
  const input = {
    components: [
      { component_medication_id: a, mass_mg: '50', source: 'label' as const },
      { component_medication_id: b, mass_mg: '10', source: 'coa' as const },
    ],
  };
  const refuses = async (work: Promise<unknown>) =>
    work.then(
      () => null,
      (e: Error & { statusCode?: number }) => ({
        status: e.statusCode,
        message: e.message,
      })
    );

  it('checks ownership, then swaps the rows in order inside one transaction', async () => {
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }])) // the blend is the owner's
      .mockResolvedValueOnce(rows([{}, {}])) // both components are the owner's
      .mockResolvedValueOnce(rows()) // no component is a blend
      .mockResolvedValueOnce(rows()) // the blend is no component
      .mockResolvedValueOnce(rows()) // delete
      .mockResolvedValueOnce(rows()) // insert a
      .mockResolvedValueOnce(rows()) // insert b
      .mockResolvedValueOnce(
        rows([{ blend_medication_id: blend, name: 'KLOW', components: [] }])
      )
      .mockResolvedValueOnce(rows()); // COMMIT
    const saved = await replaceBlend(owner, blend, input, owner);
    expect(saved.blend_medication_id).toBe(blend);
    const text = sql();
    expect(text[0]).toBe('BEGIN');
    expect(text[5]).toMatch(/^DELETE FROM medication_blend_components/);
    expect(text[6]).toMatch(/^INSERT INTO medication_blend_components/);
    expect(mocks.query.mock.calls[6]![1]).toEqual([
      blend,
      a,
      owner,
      '50',
      'label',
      0,
    ]);
    expect(mocks.query.mock.calls[7]![1]).toEqual([
      blend,
      b,
      owner,
      '10',
      'coa',
      1,
    ]);
    expect(text.at(-1)).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a medication that is not the owner’s, and writes nothing', async () => {
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows());
    expect(await refuses(replaceBlend(owner, blend, input))).toMatchObject({
      status: 404,
    });
    expect(sql().at(-1)).toBe('ROLLBACK');
    expect(
      sql().some((q) => q.startsWith('DELETE') || q.startsWith('INSERT'))
    ).toBe(false);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('refuses a blend that contains itself before looking at anything else', async () => {
    mocks.query.mockResolvedValue(rows([{ name: 'KLOW' }]));
    expect(
      await refuses(
        replaceBlend(owner, blend, {
          components: [
            { component_medication_id: blend, mass_mg: '1', source: 'label' },
          ],
        })
      )
    ).toMatchObject({ status: 400, message: 'A blend cannot contain itself.' });
    expect(sql().at(-1)).toBe('ROLLBACK');
  });

  it('refuses components that are not the owner’s', async () => {
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }]))
      .mockResolvedValueOnce(rows([{}])) // only one of two found
      .mockResolvedValueOnce(rows());
    expect(await refuses(replaceBlend(owner, blend, input))).toMatchObject({
      status: 400,
      message: 'One or more components were not found.',
    });
  });

  it('refuses nesting both ways, naming the blend in the way', async () => {
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }]))
      .mockResolvedValueOnce(rows([{}, {}]))
      .mockResolvedValueOnce(rows([{ name: 'Wolverine' }]))
      .mockResolvedValueOnce(rows());
    expect(await refuses(replaceBlend(owner, blend, input))).toMatchObject({
      status: 400,
      message: 'Wolverine is itself a blend, so it cannot be a component.',
    });
    vi.clearAllMocks();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }]))
      .mockResolvedValueOnce(rows([{}, {}]))
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ name: 'Wolverine' }]))
      .mockResolvedValueOnce(rows());
    expect(await refuses(replaceBlend(owner, blend, input))).toMatchObject({
      status: 400,
      message: expect.stringContaining('component of Wolverine'),
    });
    expect(sql().some((q) => q.startsWith('DELETE'))).toBe(false);
  });

  it('clears the composition for an empty list without looking at components', async () => {
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }]))
      .mockResolvedValueOnce(rows()) // delete
      .mockResolvedValueOnce(rows()) // reload: nothing left
      .mockResolvedValueOnce(rows());
    const saved = await replaceBlend(owner, blend, { components: [] });
    expect(saved).toEqual({
      blend_medication_id: blend,
      name: 'KLOW',
      components: [],
    });
    expect(sql().some((q) => q.startsWith('INSERT'))).toBe(false);
  });
});

describe('what stops a component being deleted', () => {
  it('lists the blends a medication is in', async () => {
    mocks.query.mockResolvedValueOnce(
      rows([{ name: 'KLOW' }, { name: 'Wolverine' }])
    );
    expect(await blendsContaining(owner, a)).toEqual(['KLOW', 'Wolverine']);
  });

  it('refuses a blend component before counting anything else, naming the blends', async () => {
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockResolvedValueOnce(rows([{ id: a }])) // lock
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }])); // blends
    await expect(
      medicationRepository.deleteMedication(owner, a)
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        'This medication is a component of KLOW. Remove it from the blend before deleting it.',
    });
    expect(sql().at(-1)).toBe('ROLLBACK');
    expect(sql().some((q) => q.startsWith('DELETE'))).toBe(false);
  });

  it('turns the database’s refusal into the same 409 when a blend appears after the check', async () => {
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockResolvedValueOnce(rows([{ id: a }])) // lock
      .mockResolvedValueOnce(rows()) // no blends yet
      .mockResolvedValueOnce(
        rows([{ stock: 0, plans: 0, schedules: 0, prescriptions: 0, doses: 0 }])
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('violates foreign key'), {
          code: '23503',
          constraint: 'medication_blend_components_component_fk',
        })
      )
      .mockResolvedValueOnce(rows()) // ROLLBACK
      .mockResolvedValueOnce(rows([{ name: 'KLOW' }]));
    await expect(
      medicationRepository.deleteMedication(owner, a)
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        'This medication is a component of KLOW. Remove it from the blend before deleting it.',
    });
  });

  it('leaves every other failure as it was', async () => {
    const boom = new Error('connection lost');
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockRejectedValueOnce(boom);
    await expect(medicationRepository.deleteMedication(owner, a)).rejects.toBe(
      boom
    );
  });
});
