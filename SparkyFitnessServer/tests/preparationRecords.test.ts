import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculatePreparationValues,
  medicationPreparationInputSchema,
} from '@workspace/shared';
import { resolveBud } from '../services/medicationPreparationService.js';
import repository from '../models/medicationPenRepository.js';
import { getClient } from '../db/poolManager.js';
vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
const query = vi.fn();
const release = vi.fn();
const prep = {
  mode: 'reconstituted' as const,
  mass_value: 12000,
  mass_unit: 'mcg' as const,
  final_volume_ml: 3,
  prepared_date: '2026-11-15',
  diluent: 'Labelled diluent',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClient).mockResolvedValue({ query, release } as never);
});
describe('persisted preparation contract', () => {
  it('normalises labelled mcg independently of an injection dose', () => {
    expect(calculatePreparationValues(prep)).toEqual({
      mass_mg: 12,
      concentration_mg_ml: 4,
    });
    expect(
      calculatePreparationValues({
        ...prep,
        mass_value: 1e308,
        final_volume_ml: 1e-308,
      })
    ).toBeNull();
  });
  it('rejects invalid calendar dates and nonpositive values', () => {
    expect(
      medicationPreparationInputSchema.safeParse({
        ...prep,
        prepared_date: '2026-02-30',
      }).success
    ).toBe(false);
    expect(
      medicationPreparationInputSchema.safeParse({ ...prep, mass_value: 0 })
        .success
    ).toBe(false);
  });
  it('derives canonical values and returns fresh persisted preparation', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'med' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'vial' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'vial',
            preparation: { ...prep, mass_mg: 12, concentration_mg_ml: 4 },
          },
        ],
      })
      .mockResolvedValueOnce({});
    const result = await repository.createPen('owner', 'med', {
      kind: 'vial',
      preparation: prep,
    });
    expect(result.preparation.mass_mg).toBe(12);
    expect(query.mock.calls[2][1].slice(5, 7)).toEqual(['4', '3']);
    expect(query.mock.calls[3][1]).toContain('owner');
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
  it('rejects a medication outside the selected owner', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    await expect(
      repository.createPen('owner', 'other', {
        kind: 'vial',
        preparation: prep,
      })
    ).rejects.toThrow('Medication not found');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('rejects inconsistent client concentration before writing', async () => {
    query.mockResolvedValue({});
    await expect(
      repository.createPen('owner', 'med', {
        kind: 'vial',
        preparation: prep,
        concentration_mg_ml: 4000,
      })
    ).rejects.toThrow('must match');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('rejects changing an existing snapshot even before use', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ kind: 'vial', doses_used: 0 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...prep,
            mass_value: '12000',
            final_volume_ml: '3',
            concentration_mg_ml: '4',
          },
        ],
      })
      .mockResolvedValueOnce({});
    await expect(
      repository.updatePen('owner', 'vial', {
        preparation: { ...prep, mass_value: 10000 },
      })
    ).rejects.toThrow('immutable');
  });
  it('does not attach a preparation to legacy used stock', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ kind: 'vial', doses_used: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({});
    await expect(
      repository.updatePen('owner', 'vial', { preparation: prep })
    ).rejects.toThrow('Only unused');
  });
  it('rejects declaring used stock while attaching a legacy preparation in the same patch', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ kind: 'vial', doses_used: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({});
    await expect(
      repository.updatePen('owner', 'vial', {
        preparation: prep,
        doses_used: 2,
        label: 'Not saved',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      query.mock.calls.some(([sql]) =>
        /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)
      )
    ).toBe(false);
  });
  it('preserves injection-linked inventory on deletion', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ doses_used: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({});
    await expect(repository.deletePen('owner', 'vial')).rejects.toThrow(
      'cannot be removed'
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});
describe('explicit beyond-use basis', () => {
  it('preserves a legacy date on unrelated edits and source-only edits', () => {
    expect(
      resolveBud({ notes: 'updated' }, { bud_date: '2026-12-01' })
    ).toEqual({});
    expect(
      resolveBud(
        { bud_source: 'Product label' },
        { bud_mode: 'interval', bud_date: '2026-12-01' }
      )
    ).toEqual({});
  });
  it('uses entered calendar interval without a global default', () => {
    expect(
      resolveBud({
        bud_mode: 'interval',
        bud_base_date: '2026-11-15',
        bud_interval_days: 10,
        bud_source: 'Product label',
      })
    ).toEqual({ bud_date: '2026-11-25' });
    expect(() => resolveBud({ bud_mode: 'interval' })).toThrow('requires');
    expect(resolveBud({ bud_mode: 'date', bud_date: '2026-12-01' })).toEqual(
      {}
    );
  });
  it('protects configured dates from old-client implicit defaults', () => {
    expect(() =>
      resolveBud(
        { bud_date: '2026-12-13' },
        { bud_mode: 'date', bud_date: '2026-12-01', bud_source: 'Label' }
      )
    ).toThrow('explicit beyond-use');
    expect(
      resolveBud(
        { bud_date: '2026-12-01' },
        { bud_mode: 'interval', bud_date: '2026-12-01' }
      )
    ).toEqual({});
    expect(() =>
      resolveBud(
        { bud_source: null },
        { bud_mode: 'interval', bud_date: '2026-12-01' }
      )
    ).toThrow('source');
  });
  it('requires a real date for explicit date mode and permits deliberate clear', () => {
    expect(() => resolveBud({ bud_mode: 'date', bud_date: null })).toThrow(
      'explicit calendar date'
    );
    expect(
      resolveBud({ bud_mode: 'date' }, { bud_date: '2026-12-01' })
    ).toEqual({});
    expect(
      resolveBud(
        {
          bud_mode: null,
          bud_date: null,
          bud_source: null,
          bud_base_date: null,
          bud_interval_days: null,
        },
        { bud_mode: 'date', bud_date: '2026-12-01' }
      )
    ).toEqual({});
  });
  it('rejects a conflicting date for an interval basis', () => {
    expect(() =>
      resolveBud({
        bud_mode: 'interval',
        bud_base_date: '2026-11-15',
        bud_interval_days: 10,
        bud_source: 'Product label',
        bud_date: '2026-12-01',
      })
    ).toThrow('does not match');
  });
});
