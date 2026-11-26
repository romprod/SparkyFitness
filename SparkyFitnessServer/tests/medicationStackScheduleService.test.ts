import { beforeEach, describe, expect, it, vi } from 'vitest';
import { medicationStackScheduleInputSchema } from '@workspace/shared';

const owner = '00000000-0000-4000-a000-000000000001';
const stack = '00000000-0000-4000-a000-0000000000a1';
const idOf = (n: number) =>
  `00000000-0000-4000-a000-0000000000${String(n).padStart(2, '0')}`;
const op = '00000000-0000-4000-b000-000000000001';

const state = vi.hoisted(() => ({
  events: [] as string[],
  receipts: new Map<string, unknown>(),
  existing: null as null | { version: number },
  members: [] as { medication_id: string; position: number }[],
  courses: new Map<string, { id: string; version: number; rules: unknown[] }>(),
  history: false,
  edits: [] as string[],
  revisions: [] as string[],
  failBind: false,
}));

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({
    query: vi.fn(async (sql: string) => {
      state.events.push(sql);
      return { rows: [] };
    }),
    release: vi.fn(),
  })),
  dbContextStorage: { getStore: () => undefined },
}));
vi.mock('../models/medicationCourseRepository.js', async (original) => {
  const actual =
    await original<typeof import('../models/medicationCourseRepository.js')>();
  return {
    ...actual,
    loadCourseOwnerContext: vi.fn(async () => ({
      today: '2026-11-16',
      timezone: 'UTC',
    })),
    loadCourseActuals: vi.fn(async () => []),
    loadCoursePhaseActuals: vi.fn(async () =>
      state.history
        ? [
            {
              id: 'd1',
              source_kind: 'entry',
              course_revision_id: 'rev',
              entry_date: '2026-11-10',
              status: 'taken',
              phase_family_id: 'rev',
            },
          ]
        : []
    ),
    lockMedicationCourse: vi.fn(async (_c: unknown, _o: string, id: string) => {
      state.events.push(`course:${id}`);
      return state.courses.get(id)!;
    }),
    courseOperationReceipt: vi.fn(
      async (_c: unknown, _o: string, id: string) =>
        state.receipts.get(id) ?? null
    ),
    saveCourseReceipt: vi.fn(
      async (
        _c: unknown,
        _o: string,
        action: string,
        _h: string,
        r: unknown
      ) => {
        state.events.push(`receipt:${action}`);
        state.receipts.set((r as { operation_id: string }).operation_id, r);
      }
    ),
  };
});
vi.mock('../models/medicationStackScheduleRepository.js', () => ({
  lockStack: vi.fn(async () => {
    state.events.push('stack');
    return { id: stack, name: 'Morning' };
  }),
  loadSchedule: vi.fn(async () => state.existing),
  lockMedicinesAscending: vi.fn(
    async (_c: unknown, _o: string, ids: string[]) => {
      for (const id of [...ids].sort()) state.events.push(`med:${id}`);
      return new Map(
        ids.map((id) => [id, { name: `Med ${id.slice(-2)}`, is_active: true }])
      );
    }
  ),
  stackMemberRows: vi.fn(async () => state.members),
  stackBindings: vi.fn(async () => new Map()),
  otherStackBindings: vi.fn(async () => new Map()),
  insertSchedule: vi.fn(async () => {
    state.events.push('insert-schedule');
    return {
      version: 1,
      stack_id: stack,
      updated_at: '2026-11-16T00:00:00.000Z',
    };
  }),
  updateSchedule: vi.fn(async () => {
    state.events.push('update-schedule');
    return {
      version: 2,
      stack_id: stack,
      updated_at: '2026-11-16T00:00:00.000Z',
    };
  }),
  deleteSchedule: vi.fn(),
  publicSchedule: (row: Record<string, unknown>) => row,
  bindMedication: vi.fn(
    async (_c: unknown, _o: string, _s: string, id: string) => {
      state.events.push(`bind:${id}`);
      if (state.failBind) throw new Error('forced failure');
    }
  ),
}));
vi.mock('../services/medicationCourseService.js', () => ({
  assertWrite: vi.fn(async () => undefined),
  tip: (course: { current_revision_id: string; revisions: unknown[] }) =>
    (course.revisions as { id: string }[]).find(
      (r) => r.id === course.current_revision_id
    ),
  revisionReview: vi.fn(async () => ({
    carried_steps: [],
    review_fingerprint: 'member-review',
  })),
  editCourseInTransaction: vi.fn(
    async (_c: unknown, _o: string, id: string) => {
      state.events.push(`edit:${id}`);
      state.edits.push(id);
      return { course_id: id, revision_id: 'r', version: 2, operation_id: op };
    }
  ),
  reviseCourseInTransaction: vi.fn(
    async (_c: unknown, _o: string, id: string) => {
      state.events.push(`revise:${id}`);
      state.revisions.push(id);
      return { course_id: id, revision_id: 'r2', version: 2, operation_id: op };
    }
  ),
}));

import {
  reviewStackSchedule,
  saveStackSchedule,
} from '../services/medicationStackScheduleService.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const schedule = medicationStackScheduleInputSchema.parse({
  schedule_type_id: 'daily',
  time_of_day: '09:00',
});
const course = (n: number, time: string, extra: unknown[] = []) => ({
  id: `c${n}`,
  version: 1,
  medication_id: idOf(n),
  current_revision_id: 'rev',
  revisions: [
    {
      id: 'rev',
      course_id: `c${n}`,
      name: `P${n}`,
      notes: null,
      status: 'active',
      start_date: '2026-11-01',
      end_date: null,
      cycle_anchor_date: null,
      target_dose: '1',
      dose_unit: 'mg',
      dose_basis: 'per_injection',
      course_cycle_on_weeks: null,
      course_cycle_off_weeks: null,
      deleted_at: null,
      phase_family_id: null,
      steps: [],
      rules: [
        {
          id: `q${n}`,
          user_id: owner,
          revision_id: 'rev',
          rule_index: 0,
          schedule_type_id: 'daily',
          time_of_day: time,
          dose_amount: '1',
        },
        ...extra,
      ],
    },
  ],
  deleted_at: null,
});
const setup = (times: string[]) => {
  // Members listed by position in descending id order, to prove locks go by id.
  state.members = times.map((_, i) => ({
    medication_id: idOf(times.length - i),
    position: i,
  }));
  times.forEach((time, i) => {
    const n = times.length - i;
    state.courses.set(`c${n}`, course(n, time) as never);
  });
};
describe('stack schedule service', () => {
  beforeEach(() => {
    state.events = [];
    state.receipts.clear();
    state.existing = null;
    state.courses.clear();
    state.history = false;
    state.edits = [];
    state.revisions = [];
    state.failBind = false;
  });

  const body = (over: Record<string, unknown> = {}) => ({
    schedule,
    operation_id: op,
    expected_version: 0,
    review_fingerprint: '',
    effective_from: '2026-11-16',
    skipped_member_ids: [] as string[],
    acknowledged_member_ids: [] as string[],
    ...over,
  });
  const reviewed = () => reviewStackSchedule(owner, stack, { schedule }, NOW);

  // The course lookup runs on the client; answer it from the registered courses.
  beforeEach(async () => {
    const pool = await import('../db/poolManager.js');
    vi.mocked(pool.getClient).mockImplementation((async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        state.events.push(sql.startsWith('SELECT c.id') ? 'live-course' : sql);
        if (sql.startsWith('SELECT c.id FROM medication_courses')) {
          const n = Number(String(params[1]).slice(-2));
          return { rows: state.courses.has(`c${n}`) ? [{ id: `c${n}` }] : [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })) as unknown as typeof pool.getClient);
  });

  it('takes the stack lock, then medicines by ascending id, then each course', async () => {
    setup(['08:00:00', '08:00:00', '08:00:00']);
    await reviewed();
    const order = state.events.filter((e) => /^(stack|med:|course:)/.test(e));
    expect(order).toEqual([
      'stack',
      `med:${idOf(1)}`,
      `med:${idOf(2)}`,
      `med:${idOf(3)}`,
      'course:c1',
      'course:c2',
      'course:c3',
    ]);
  });

  it('names an in-place edit, and leaves a member that already has the timing', async () => {
    setup(['08:00:00', '09:00:00']);
    const review = await reviewed();
    // Position order: id 2 first (08:00, edit), then id 1 (09:00, unchanged).
    expect(review.members.map((m) => [m.medication_id, m.action])).toEqual([
      [idOf(2), 'edit'],
      [idOf(1), 'unchanged'],
    ]);
    expect(state.edits).toEqual([]);
  });

  it('applies edits, binds every follower and writes one receipt', async () => {
    setup(['08:00:00', '09:00:00']);
    const review = await reviewed();
    const { result, created } = await saveStackSchedule(
      owner,
      stack,
      body({ review_fingerprint: review.review_fingerprint }),
      NOW
    );
    expect(created).toBe(true);
    expect(state.edits).toEqual(['c2']);
    expect(result.applied.map((a) => a.action)).toEqual(['edit', 'unchanged']);
    expect(state.events.filter((e) => e.startsWith('receipt:'))).toEqual([
      'receipt:stack_schedule:set',
    ]);
    const writes = state.events.filter((e) =>
      /^(insert-schedule|bind:|edit:)/.test(e)
    );
    expect(writes[0]).toBe('insert-schedule');
  });

  it('replays the stored result without touching anything', async () => {
    setup(['08:00:00']);
    const review = await reviewed();
    const args = body({ review_fingerprint: review.review_fingerprint });
    await saveStackSchedule(owner, stack, args, NOW);
    state.events = [];
    state.edits = [];
    const replay = await saveStackSchedule(owner, stack, args, NOW);
    expect(replay.created).toBe(false);
    expect(state.edits).toEqual([]);
    expect(state.events.some((e) => e === 'stack')).toBe(false);
  });

  it('refuses a stale version, a changed fingerprint and a changed left-out list with 409, writing nothing', async () => {
    setup(['08:00:00']);
    const review = await reviewed();
    state.existing = { version: 3 };
    await expect(
      saveStackSchedule(
        owner,
        stack,
        body({ review_fingerprint: review.review_fingerprint }),
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    state.existing = null;
    await expect(
      saveStackSchedule(
        owner,
        stack,
        body({ review_fingerprint: 'stale' }),
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      saveStackSchedule(
        owner,
        stack,
        body({
          review_fingerprint: review.review_fingerprint,
          skipped_member_ids: [idOf(1)],
        }),
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(state.edits).toEqual([]);
    expect(state.events.some((e) => e.startsWith('insert-schedule'))).toBe(
      false
    );
    expect(state.receipts.size).toBe(0);
  });

  it('asks for confirmation before several slots become one', async () => {
    state.members = [{ medication_id: idOf(1), position: 0 }];
    state.courses.set(
      'c1',
      course(1, '08:00:00', [
        {
          id: 'q1b',
          user_id: owner,
          revision_id: 'rev',
          rule_index: 1,
          schedule_type_id: 'daily',
          time_of_day: '20:00:00',
          dose_amount: '1',
        },
      ]) as never
    );
    const review = await reviewed();
    expect(review.members[0]).toMatchObject({
      needs_ack: true,
      action: 'edit',
    });
    expect(review.members[0]!.warnings[0]).toContain('2 timed slots');
    await expect(
      saveStackSchedule(
        owner,
        stack,
        body({ review_fingerprint: review.review_fingerprint }),
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 422 });
    await saveStackSchedule(
      owner,
      stack,
      body({
        review_fingerprint: review.review_fingerprint,
        acknowledged_member_ids: [idOf(1)],
      }),
      NOW
    );
    expect(state.edits).toEqual(['c1']);
  });

  it('writes a successor for a follower with delivered doses', async () => {
    state.history = true;
    setup(['08:00:00']);
    const review = await reviewed();
    expect(review.members[0]!.action).toBe('revise');
    expect(review.effective_from).toBe('2026-11-16');
    await saveStackSchedule(
      owner,
      stack,
      body({ review_fingerprint: review.review_fingerprint }),
      NOW
    );
    expect(state.revisions).toEqual(['c1']);
    expect(state.edits).toEqual([]);
  });

  it('refuses an effective day earlier than today', async () => {
    state.history = true;
    setup(['08:00:00']);
    await expect(
      reviewStackSchedule(
        owner,
        stack,
        { schedule, effective_from: '2026-11-10' },
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('surfaces a failure part-way through so the transaction rolls back', async () => {
    setup(['08:00:00', '08:00:00']);
    const review = await reviewed();
    state.failBind = true;
    state.events = [];
    const events = state.events;
    await expect(
      saveStackSchedule(
        owner,
        stack,
        body({ review_fingerprint: review.review_fingerprint }),
        NOW
      )
    ).rejects.toThrow('forced failure');
    expect(events).toContain('ROLLBACK');
    expect(events).not.toContain('COMMIT');
    expect(state.receipts.size).toBe(0);
  });
});
