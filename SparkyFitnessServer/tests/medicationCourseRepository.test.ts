import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { courseSlotsForDay } from '@workspace/shared';
import {
  courseFixtureIds as id,
  medicationCourseFixture,
} from './fixtures/medicationCourseFixture.js';
import {
  guardLegacyScheduleMutation,
  courseFingerprint,
  courseOperationReceipt,
  lockCourseAttribution,
  transitionCourseMedicationActivity,
} from '../models/medicationCourseRepository.js';
const mock = vi.hoisted(() => ({
  actor: '00000000-0000-4000-a000-000000000001',
}));
vi.mock('../db/poolManager.js', () => ({
  dbContextStorage: { getStore: () => ({ authenticatedUserId: mock.actor }) },
}));
const query = vi.fn();
const client = { query } as unknown as PoolClient;
let fixture = medicationCourseFixture();
let active = true;
function provideCourse(sql: string) {
  if (sql.startsWith('SELECT course_id FROM medication_course_revisions'))
    return [{ course_id: fixture.id }];
  if (sql.startsWith('SELECT is_active')) return [{ is_active: active }];
  if (sql.includes('FROM user_preferences'))
    return [{ timezone: 'Europe/London' }];
  if (sql.startsWith('SELECT id FROM medication_courses'))
    return [{ id: fixture.id }];
  if (sql.startsWith('SELECT * FROM medication_courses')) return [fixture];
  if (sql.startsWith('SELECT *,target_dose')) return fixture.revisions;
  if (sql.includes('FROM medication_course_rules q'))
    return fixture.revisions.flatMap((r) => r.rules);
  if (sql.includes('FROM medication_course_steps s'))
    return fixture.revisions.flatMap((r) => r.steps);
  if (sql.includes('FROM medication_course_activity a'))
    return fixture.revisions.flatMap((r) => r.activity);
  return [];
}
describe('managed course transaction guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture = medicationCourseFixture();
    active = true;
    mock.actor = id.owner;
    query.mockImplementation(async (sql: string) => ({
      rows: provideCourse(sql),
    }));
  });
  it('canonical fingerprints preserve object identity independent of key order and distinguish ordered authored rules', () => {
    expect(courseFingerprint({ b: 2, a: 1 })).toBe(
      courseFingerprint({ a: 1, b: 2 })
    );
    expect(courseFingerprint([1, 2])).not.toBe(courseFingerprint([2, 1]));
  });
  it('returns an existing operation receipt and rejects changed payload or actor', async () => {
    const result = {
      course_id: id.course,
      revision_id: id.revision,
      version: 2,
      operation_id: id.rule,
    };
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT request_hash')
        ? [{ request_hash: 'same', actor_id: id.owner, result }]
        : [],
    }));
    expect(
      await courseOperationReceipt(client, id.owner, id.rule, 'same')
    ).toEqual(result);
    await expect(
      courseOperationReceipt(client, id.owner, id.rule, 'different')
    ).rejects.toMatchObject({ statusCode: 409 });
    mock.actor = id.medication;
    await expect(
      courseOperationReceipt(client, id.owner, id.rule, 'same')
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('keeps handed-off rules bounded and rejects direct delete while allowing unchanged numeric/time representations', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM medication_course_handoffs')
        ? [{ capped_end_date: '2026-11-15' }]
        : [
            {
              dose_amount: '1',
              time_of_day: '08:00:00',
              start_date: '2026-11-01',
              active: true,
            },
          ],
    }));
    await expect(
      guardLegacyScheduleMutation(client, id.owner, id.rule, null)
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      guardLegacyScheduleMutation(client, id.owner, id.rule, { end_date: null })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      guardLegacyScheduleMutation(client, id.owner, id.rule, {
        end_date: '2026-11-16',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      guardLegacyScheduleMutation(client, id.owner, id.rule, {
        dose_amount: 1,
        time_of_day: '08:00',
        end_date: '2026-11-15',
      })
    ).resolves.toBeUndefined();
  });
  it('permits explicit historical references after revision completion and rejects foreign rules/steps', async () => {
    fixture.revisions[0]!.status = 'completed';
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        { course_revision_id: id.revision },
        '2026-11-16'
      )
    ).resolves.toBeUndefined();
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        { course_revision_id: id.revision, course_rule_id: id.activity },
        '2026-11-16'
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });
  it('validates selected slots, accepts omitted optional phase step, and rejects stale versions without any stock write', async () => {
    fixture.revisions[0]!.steps = [
      {
        id: id.step,
        user_id: id.owner,
        revision_id: id.revision,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const now = new Date('2026-11-16T07:00:00Z');
    const slot = courseSlotsForDay({
      course: fixture,
      day: '2026-11-16',
      today: '2026-11-16',
      nowInstant: now.toISOString(),
      medicationActive: true,
      delivered: [],
    })[0]!;
    const input = {
      course_revision_id: id.revision,
      course_rule_id: id.rule,
      course_slot_key: slot.course_slot_key,
      scheduled_day: slot.scheduled_day,
      scheduled_for: slot.scheduled_for,
      course_expected_version: 1,
    };
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        input,
        '2026-11-16',
        now
      )
    ).resolves.toBeUndefined();
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        { ...input, course_expected_version: 2 },
        '2026-11-16',
        now
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE medication_pens')
      )
    ).toBe(false);
  });
  it('rejects a queued current/future slot after medication deactivation', async () => {
    const now = new Date('2026-11-16T07:00:00Z');
    const slot = courseSlotsForDay({
      course: fixture,
      day: '2026-11-16',
      today: '2026-11-16',
      nowInstant: now.toISOString(),
      medicationActive: true,
      delivered: [],
    })[0]!;
    active = false;
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        {
          course_revision_id: id.revision,
          course_rule_id: id.rule,
          course_slot_key: slot.course_slot_key,
          scheduled_day: slot.scheduled_day,
          scheduled_for: slot.scheduled_for,
          course_expected_version: 1,
        },
        '2026-11-16',
        now
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rejects a second scheduled fulfilment but permits a saved historical self correction', async () => {
    const now = new Date('2026-11-16T07:00:00Z');
    const slot = courseSlotsForDay({
      course: fixture,
      day: '2026-11-16',
      today: '2026-11-16',
      nowInstant: now.toISOString(),
      medicationActive: true,
      delivered: [],
    })[0]!;
    const stored = {
      id: id.activity,
      source_kind: 'entry',
      course_revision_id: id.revision,
      course_rule_id: id.rule,
      course_step_id: null,
      course_slot_key: slot.course_slot_key,
      scheduled_day: slot.scheduled_day,
      scheduled_for: slot.scheduled_for,
      entry_date: '2026-11-16',
      occurred_at: '2026-11-16T08:00:00Z',
      status: 'taken',
    };
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT 'entry' AS source_kind")
        ? [stored]
        : provideCourse(sql),
    }));
    const input = {
      course_revision_id: id.revision,
      course_rule_id: id.rule,
      course_slot_key: slot.course_slot_key,
      scheduled_day: slot.scheduled_day,
      scheduled_for: slot.scheduled_for,
      course_expected_version: 1,
    };
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        input,
        '2026-11-16',
        now
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    fixture.current_revision_id = null;
    fixture.revisions[0]!.status = 'completed';
    const { course_expected_version: _version, ...savedInput } = input;
    await expect(
      lockCourseAttribution(
        client,
        id.owner,
        id.medication,
        savedInput,
        '2026-11-16',
        now,
        { id: id.activity, source_kind: 'entry' }
      )
    ).resolves.toBeUndefined();
  });
  it('does not resurrect a predecessor after future tip tombstone when medication is re-enabled', async () => {
    const old = fixture.revisions[0]!;
    old.status = 'completed';
    old.activity[0]!.until_at = '2026-11-16T07:00:00Z';
    fixture.current_revision_id = null;
    fixture.revisions.push({
      ...old,
      id: id.step,
      predecessor_id: old.id,
      revision_no: 2,
      start_date: '2026-12-01',
      deleted_at: '2026-11-16T07:00:00Z',
      rules: [],
      steps: [],
      activity: [],
    });
    await transitionCourseMedicationActivity(
      client,
      id.owner,
      id.medication,
      false,
      true,
      new Date('2026-11-16T08:00:00Z')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT INTO medication_course_activity')
      )
    ).toBe(false);
  });
});
