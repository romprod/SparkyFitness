import { beforeEach, describe, expect, it, vi } from 'vitest';
import { courseSlotKey, medicationCourseDueSchema } from '@workspace/shared';
import {
  medicationCourseFixture,
  courseFixtureIds as id,
} from './fixtures/medicationCourseFixture.js';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: mocks.getClient,
  dbContextStorage: {
    getStore: () => ({
      authenticatedUserId: '00000000-0000-4000-a000-000000000001',
    }),
  },
}));
import { getMedicationCourseDue } from '../services/medicationCourseService.js';
const now = new Date('2026-11-16T12:00:00Z'),
  day = '2026-11-05';
let actuals: Record<string, unknown>[] = [];
const key = courseSlotKey(id.revision, id.rule, day, '08:00:00');
const actual = (status = 'taken', source_kind = 'injection') => ({
  id: id.activity,
  source_kind,
  course_revision_id: id.revision,
  course_rule_id: id.rule,
  course_step_id: null,
  course_slot_key: key,
  scheduled_day: day,
  scheduled_for: `${day}T08:00:00Z`,
  entry_date: '2026-11-16',
  occurred_at: now.toISOString(),
  status,
  course_origin: true,
  medication_name: 'Synthetic recorded medication',
  dose_amount: '1',
  dose_unit: 'mg',
  dose_mg_exact: '1',
  volume_ml: '0.1',
  dose_input_unit: 'ml',
  site: null,
  notes: 'Synthetic private note',
  administration_route: 'injection',
});
describe('authoritative scheduled-slot fulfilments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actuals = [];
    const course = medicationCourseFixture();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT 'entry' AS source_kind"))
        return { rows: actuals };
      if (sql.includes('FROM user_preferences'))
        return { rows: [{ timezone: 'Europe/London' }] };
      if (sql.startsWith('SELECT c.id,'))
        return { rows: [{ id: course.id, is_active: true }] };
      if (sql.startsWith('SELECT * FROM medication_courses'))
        return { rows: [course] };
      if (sql.startsWith('SELECT *,target_dose'))
        return { rows: course.revisions };
      if (sql.includes('FROM medication_course_rules q'))
        return { rows: course.revisions.flatMap((r) => r.rules) };
      if (sql.includes('FROM medication_course_steps s'))
        return { rows: course.revisions.flatMap((r) => r.steps) };
      if (sql.includes('FROM medication_course_activity a'))
        return { rows: course.revisions.flatMap((r) => r.activity) };
      return { rows: [] };
    });
  });
  it('marks a past selected slot taken from an actual recorded now, preserving kind/id for the correct undo path', async () => {
    actuals = [actual()];
    const due = await getMedicationCourseDue(id.owner, day, now);
    expect(due.fulfilled_slots).toEqual([
      {
        course_revision_id: id.revision,
        course_rule_id: id.rule,
        course_slot_key: key,
        scheduled_day: day,
        status: 'taken',
        source_kind: 'injection',
        entry_id: id.activity,
        occurred_at: now.toISOString(),
        entry_date: '2026-11-16',
      },
    ]);
    expect(medicationCourseDueSchema.safeParse(due).success).toBe(true);
    expect(JSON.stringify(due.fulfilled_slots)).not.toContain(
      'Synthetic private note'
    );
    expect(due.slots[0]?.course_expected_version).toBe(1);
    expect(mocks.query.mock.calls[0]).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    ]);
    expect(mocks.query.mock.calls.at(-1)).toEqual(['COMMIT']);
    expect(mocks.release).toHaveBeenCalledOnce();
    for (const [sql, args] of mocks.query.mock.calls)
      if (String(sql).startsWith('SELECT')) expect(args).toContain(id.owner);
  });
  it('uses only explicit requested-slot identity, never medication/day proximity or unrelated actual history', async () => {
    actuals = [
      {
        ...actual(),
        course_revision_id: null,
        course_rule_id: null,
        course_slot_key: null,
      },
      {
        ...actual(),
        scheduled_day: '2026-11-06',
        course_slot_key: courseSlotKey(
          id.revision,
          id.rule,
          '2026-11-06',
          '08:00:00'
        ),
      },
      { ...actual(), course_rule_id: id.step },
    ];
    expect(
      (await getMedicationCourseDue(id.owner, day, now)).fulfilled_slots
    ).toEqual([]);
  });
  it('counts a revision-only dose on the slot day for the nearest open slot', async () => {
    actuals = [
      {
        ...actual('taken', 'entry'),
        course_rule_id: null,
        course_slot_key: null,
        scheduled_day: null,
        scheduled_for: null,
        entry_date: day,
        occurred_at: `${day}T19:00:00Z`,
      },
    ];
    const due = await getMedicationCourseDue(id.owner, day, now);
    expect(due.fulfilled_slots).toEqual([
      {
        course_revision_id: id.revision,
        course_rule_id: id.rule,
        course_slot_key: key,
        scheduled_day: day,
        status: 'taken',
        source_kind: 'entry',
        entry_id: id.activity,
        occurred_at: `${day}T19:00:00.000Z`,
        entry_date: day,
      },
    ]);
    expect(medicationCourseDueSchema.safeParse(due).success).toBe(true);
  });
  it.each(['skipped', 'prn_taken'])(
    'normalises explicit %s fulfilment without treating a snoozed entry as done',
    async (status) => {
      actuals = [actual(status, 'entry')];
      expect(
        (await getMedicationCourseDue(id.owner, day, now)).fulfilled_slots[0]
      ).toMatchObject({
        source_kind: 'entry',
        status: status === 'skipped' ? 'skipped' : 'taken',
      });
      actuals = [actual('snoozed', 'entry')];
      expect(
        (await getMedicationCourseDue(id.owner, day, now)).fulfilled_slots
      ).toEqual([]);
    }
  );
});
