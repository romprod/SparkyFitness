import type { PoolClient } from 'pg';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { loadMedicationCourseTimelineSnapshot } from '../models/medicationCourseTimelineRepository.js';
import { courseTimelineSnapshotFixture } from './fixtures/medicationCourseTimelineFixture.js';
const query = vi.fn(),
  release = vi.fn();
const client = { query, release } as unknown as PoolClient;
const now = new Date('2026-11-16T23:30:00Z'),
  owner = '00000000-0000-4000-a000-000000000001';
describe('minimal owner-scoped timeline snapshot facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (sql: string) => {
      const c = courseTimelineSnapshotFixture().courses[0]!;
      if (sql.startsWith('SELECT timezone'))
        return { rows: [{ timezone: 'Pacific/Kiritimati' }] };
      if (sql.includes('FROM medication_courses WHERE')) {
        const { revisions: _revisions, ...root } = c;
        return {
          rows: [
            {
              ...root,
              current_revision_id: null,
              captured_at: new Date(root.captured_at),
            },
          ],
        };
      }
      if (sql.includes('FROM medication_course_revisions r'))
        return {
          rows: [
            { ...c.revisions[0], course_id: c.id },
            {
              ...c.revisions[0],
              course_id: c.id,
              id: '00000000-0000-4000-a000-000000000088',
              predecessor_id: c.revisions[0]!.id,
              revision_no: 2,
              start_date: '2026-11-15',
              deleted_at: new Date('2026-11-16T12:00:00Z'),
            },
          ],
        };
      if (sql.includes('FROM medication_course_activity a'))
        return {
          rows: [
            {
              revision_id: c.revisions[0]!.id,
              from_at: new Date('2026-11-01T00:00:00Z'),
              until_at: null,
            },
          ],
        };
      if (sql.includes('FROM medications m'))
        return {
          rows: [
            {
              id: c.medication_id,
              name: 'Synthetic archived name',
              is_active: false,
            },
          ],
        };
      throw new Error('Unexpected timeline query');
    });
  });
  it('uses the supplied client for only owner-scoped plan/activity/master SELECTs and retains tombstone lineage', async () => {
    const result = await loadMedicationCourseTimelineSnapshot(
      client,
      owner,
      now
    );
    expect(result).toMatchObject({
      as_of: now.toISOString(),
      today: '2026-11-17',
      timezone: 'Pacific/Kiritimati',
    });
    expect(result.courses[0]!.current_revision_id).toBeNull();
    expect(result.courses[0]!.revisions).toHaveLength(2);
    expect(result.courses[0]!.revisions[1]!.deleted_at).toBe(
      '2026-11-16T12:00:00.000Z'
    );
    expect(result.medications.get(result.courses[0]!.medication_id!)).toEqual({
      name: 'Synthetic archived name',
      is_active: false,
    });
    for (const [sql, values] of query.mock.calls) {
      expect(values).toEqual([owner]);
      expect(sql.trimStart()).toMatch(/^SELECT /);
      expect(sql).not.toMatch(
        /medication_entries|injection_entries|medication_pens|preparations|dose_amount|target_dose|notes|FOR UPDATE|FOR SHARE/
      );
    }
    expect(release).not.toHaveBeenCalled();
  });
  it('keeps missing medication distinct from a known inactive medication', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation((sql: string, ...args: unknown[]) =>
      sql.includes('FROM medications m')
        ? Promise.resolve({ rows: [] })
        : original(sql, ...args)
    );
    const result = await loadMedicationCourseTimelineSnapshot(
      client,
      owner,
      now
    );
    expect(result.medications.size).toBe(0);
    expect(result.courses[0]!.medication_name_snapshot).toBe(
      'Synthetic medication'
    );
  });
  it('preserves non-null invalid timestamp markers instead of inventing absent history', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation((sql: string, ...args: unknown[]) =>
      sql.includes('FROM medication_course_activity a')
        ? Promise.resolve({
            rows: [
              {
                revision_id:
                  courseTimelineSnapshotFixture().courses[0]!.revisions[0]!.id,
                from_at: '2026-11-01T00:00:00Z',
                until_at: 'infinity',
              },
            ],
          })
        : original(sql, ...args)
    );
    const result = await loadMedicationCourseTimelineSnapshot(
      client,
      owner,
      now
    );
    expect(result.courses[0]!.revisions[0]!.activity[0]!.until_at).toBe(
      'infinity'
    );
  });
});
