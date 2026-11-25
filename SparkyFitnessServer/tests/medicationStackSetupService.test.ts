import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  medicationStackSetupInputSchema,
  type MedicationStackSetupRequest,
} from '@workspace/shared';

const owner = '00000000-0000-4000-a000-000000000001';
const op = (n: number) =>
  `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  receipts: new Map<string, { hash: string; actor: string; result: unknown }>(),
  stackNames: [] as string[],
  medicines: [] as {
    id: string;
    name: string;
    is_active: boolean;
  }[],
  schedules: [] as { medication_id: string }[],
  plans: [] as {
    medication_id: string;
    status: 'active' | 'paused' | 'completed';
    start_date: string;
    end_date: string | null;
  }[],
  seq: 0,
  assertWrite: vi.fn(),
  createMedication: vi.fn(),
  createPen: vi.fn(),
  createCourse: vi.fn(),
  createStack: vi.fn(),
  loadStack: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../db/poolManager.js', () => ({
  getClient: state.getClient,
  dbContextStorage: { getStore: () => undefined },
}));
vi.mock('../models/medicationRepository.js', () => ({
  createMedication: state.createMedication,
}));
vi.mock('../models/medicationPenRepository.js', () => ({
  createPen: state.createPen,
}));
vi.mock('../models/medicationStackRepository.js', () => ({
  createStack: state.createStack,
  loadStack: state.loadStack,
}));
vi.mock('../services/medicationCourseService.js', () => ({
  assertWrite: state.assertWrite,
  createCourseInTransaction: state.createCourse,
}));

import { setupPremixedStack } from '../services/medicationStackSetupService.js';

const NOW = new Date('2026-11-25T12:00:00Z');
const uuid = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

const fakeClient = () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('FROM user_preferences')) return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('FROM medication_course_operations')) {
      const old = state.receipts.get(String(params[1]));
      return {
        rows: old
          ? [
              {
                request_hash: old.hash,
                actor_id: old.actor,
                result: old.result,
              },
            ]
          : [],
      };
    }
    if (sql.startsWith('INSERT INTO medication_course_operations')) {
      state.receipts.set(String(params[1]), {
        hash: String(params[3]),
        actor: String(params[2]),
        result: JSON.parse(String(params[6])),
      });
      return { rows: [] };
    }
    if (sql.includes('FROM medication_stacks')) {
      const wanted = String(params[1]).trim().toLowerCase();
      return {
        rows: state.stackNames.some((n) => n.toLowerCase() === wanted)
          ? [{}]
          : [],
      };
    }
    if (sql.includes('FROM medication_schedules'))
      return {
        rows: state.schedules.filter((r) =>
          (params[1] as string[]).includes(r.medication_id)
        ),
      };
    if (sql.includes('FROM medication_courses c'))
      return {
        rows: state.plans.filter((p) =>
          (params[1] as string[]).includes(p.medication_id)
        ),
      };
    if (sql.includes('FROM medications')) {
      expect(params[0]).toBe(owner);
      const wanted = String(params[1]).trim().toLowerCase();
      const hit = state.medicines.find((m) => m.name.toLowerCase() === wanted);
      return { rows: hit ? [{ id: hit.id, is_active: hit.is_active }] : [] };
    }
    return { rows: [] };
  });
  return { query, release: vi.fn() } as unknown as PoolClient & {
    query: typeof query;
    release: ReturnType<typeof vi.fn>;
  };
};

let client: ReturnType<typeof fakeClient>;
const verbs = () =>
  client.query.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql));
const writes = () =>
  state.createMedication.mock.calls.length +
  state.createPen.mock.calls.length +
  state.createCourse.mock.calls.length +
  state.createStack.mock.calls.length;

const request = (
  overrides: Partial<MedicationStackSetupRequest> = {}
): ReturnType<typeof medicationStackSetupInputSchema.parse> =>
  medicationStackSetupInputSchema.parse({
    operation_id: op(1),
    name: 'Peptide stack',
    start_date: '2026-11-25',
    components: [
      {
        medication_name: 'Peptide A',
        concentration_value: 5,
        concentration_unit: 'mg/ml',
        vial_volume_ml: 5,
        quantity: 3,
        dose_volume_ml: 0.2,
      },
    ],
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.receipts.clear();
  state.stackNames = [];
  state.medicines = [];
  state.plans = [];
  state.schedules = [];
  state.seq = 0;
  client = fakeClient();
  state.getClient.mockResolvedValue(client);
  state.assertWrite.mockResolvedValue(undefined);
  state.createMedication.mockImplementation(async () => ({
    id: uuid(100 + state.seq++),
  }));
  state.createPen.mockImplementation(async () => ({
    id: uuid(200 + state.seq++),
  }));
  state.createCourse.mockImplementation(async () => ({
    course_id: uuid(300 + state.seq++),
    revision_id: uuid(400 + state.seq++),
    version: 1,
    operation_id: op(99),
  }));
  state.createStack.mockImplementation(async () => uuid(500));
  state.loadStack.mockImplementation(
    async (_c: unknown, _o: string, id: string) => ({
      id,
      name: 'Peptide stack',
      notes: null,
      members: [],
      created_at: NOW.toISOString(),
    })
  );
});

describe('set up a premixed stack', () => {
  it('creates the medicine, vials, preparation, plan and stack in one transaction with the right amounts', async () => {
    const result = await setupPremixedStack(owner, request(), NOW);

    expect(state.getClient).toHaveBeenCalledTimes(1);
    expect(state.getClient).toHaveBeenCalledWith(owner);
    expect(verbs()).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);

    // The new medicine is a minimal injectable one, written on the shared client.
    expect(state.createMedication).toHaveBeenCalledWith(
      owner,
      { name: 'Peptide A', type_id: 'injection' },
      client
    );

    // Three vials: the first in use, the rest sealed; each carries the premixed label.
    expect(state.createPen).toHaveBeenCalledTimes(3);
    const vials = state.createPen.mock.calls.map(([, , data, joined]) => ({
      data,
      joined,
    }));
    expect(vials.map((v) => v.data.status)).toEqual([
      'in_use',
      'sealed',
      'sealed',
    ]);
    expect(vials.every((v) => v.joined === client)).toBe(true);
    expect(vials[0]!.data.opened_at).toBe('2026-11-25');
    expect(vials[1]!.data.opened_at).toBeUndefined();
    for (const { data } of vials) {
      expect(data.kind).toBe('vial');
      expect(data.preparation).toMatchObject({
        mode: 'premixed',
        label_concentration_value: '5',
        label_concentration_unit: 'mg/ml',
        final_volume_ml: 5,
        prepared_date: '2026-11-25',
      });
    }

    // 5 mg/mL x 0.2 mL = 1 mg, a daily plan from the start date.
    expect(state.createCourse).toHaveBeenCalledTimes(1);
    const [courseClient, courseOwner, course] =
      state.createCourse.mock.calls[0]!;
    expect(courseClient).toBe(client);
    expect(courseOwner).toBe(owner);
    expect(course).toMatchObject({
      name: 'Peptide A',
      start_date: '2026-11-25',
      target_dose: '1',
      dose_unit: 'mg',
      dose_basis: 'per_injection',
      steps: [],
      rules: [
        { schedule_type_id: 'daily', time_of_day: null, dose_amount: '1' },
      ],
    });

    expect(state.createStack).toHaveBeenCalledWith(
      owner,
      {
        name: 'Peptide stack',
        notes: null,
        medication_ids: [result.components[0]!.medication_id],
      },
      client
    );
    expect(result.components[0]).toMatchObject({
      medication_name: 'Peptide A',
      medication_created: true,
      vial_ids: [uuid(201), uuid(202), uuid(203)],
      dose_amount: '1',
      dose_unit: 'mg',
    });
    expect(result.stack.id).toBe(uuid(500));
    expect(result.operation_id).toBe(op(1));
    expect(state.receipts.get(op(1))).toBeDefined();
  });

  it('writes a mcg dose below 1 mg and a mg dose from 1 mg, and keeps component order', async () => {
    const result = await setupPremixedStack(
      owner,
      request({
        time_of_day: '08:30',
        components: [
          {
            medication_name: 'Peptide A',
            concentration_value: 250,
            concentration_unit: 'mcg/ml',
            vial_volume_ml: 5,
            quantity: 1,
            dose_volume_ml: 0.1,
          },
          {
            medication_name: 'Peptide B',
            concentration_value: 2.5,
            concentration_unit: 'mg/ml',
            vial_volume_ml: 5,
            quantity: 2,
            dose_volume_ml: 0.5,
          },
        ],
      }),
      NOW
    );
    expect(result.components.map((c) => [c.dose_amount, c.dose_unit])).toEqual([
      ['25', 'mcg'],
      ['1.25', 'mg'],
    ]);
    const courses = state.createCourse.mock.calls.map(([, , c]) => c);
    expect(courses.map((c) => c.rules[0].time_of_day)).toEqual([
      '08:30',
      '08:30',
    ]);
    const prep = state.createPen.mock.calls[0]![2].preparation;
    // 250 mcg/mL is stored as the 0.25 mg/mL the preparation model uses.
    expect(prep.label_concentration_value).toBe('0.25');
    expect(state.createStack.mock.calls[0]![1].medication_ids).toEqual(
      result.components.map((c) => c.medication_id)
    );
  });

  it('defaults the start date to today in the owner timezone', async () => {
    await setupPremixedStack(
      owner,
      request({ start_date: undefined }),
      new Date('2026-11-25T23:30:00Z')
    );
    expect(state.createCourse.mock.calls[0]![2].start_date).toBe('2026-11-25');
  });

  it('passes a titration ramp through as the plan steps, with no flat rule dose', async () => {
    const steps = [
      { dose: '250', dose_unit: 'mcg' as const, duration_days: 14 },
      { dose: '500', dose_unit: 'mcg' as const, duration_days: null },
    ];
    await setupPremixedStack(
      owner,
      request({
        components: [
          {
            medication_name: 'Peptide A',
            concentration_value: 5,
            concentration_unit: 'mg/ml',
            vial_volume_ml: 5,
            quantity: 1,
            dose_volume_ml: 0.2,
            steps,
          },
        ],
      }),
      NOW
    );
    const course = state.createCourse.mock.calls[0]![2];
    expect(course.steps).toEqual(steps.map((s) => ({ ...s })));
    expect(course.rules[0].dose_amount).toBeNull();
  });

  it('reuses an existing medicine found by name, ignoring case and spaces', async () => {
    state.medicines = [{ id: uuid(7), name: 'peptide a', is_active: true }];
    const result = await setupPremixedStack(
      owner,
      request({
        components: [
          {
            medication_name: '  PEPTIDE A ',
            concentration_value: 5,
            concentration_unit: 'mg/ml',
            vial_volume_ml: 5,
            quantity: 1,
            dose_volume_ml: 0.2,
          },
        ],
      }),
      NOW
    );
    expect(state.createMedication).not.toHaveBeenCalled();
    expect(result.components[0]).toMatchObject({
      medication_id: uuid(7),
      medication_created: false,
    });
    expect(state.createPen.mock.calls[0]![1]).toBe(uuid(7));
    expect(state.createCourse.mock.calls[0]![2].medication_id).toBe(uuid(7));
  });

  it.each([
    ['active', 'active', '2026-11-01', null],
    ['scheduled', 'active', '2026-12-01', null],
    ['paused', 'paused', '2026-11-01', null],
  ] as const)(
    'refuses the whole request when a found medicine has a %s plan, writing nothing',
    async (_label, status, start, end) => {
      state.medicines = [{ id: uuid(7), name: 'Peptide B', is_active: true }];
      state.plans = [
        { medication_id: uuid(7), status, start_date: start, end_date: end },
      ];
      await expect(
        setupPremixedStack(
          owner,
          request({
            components: [
              {
                medication_name: 'Peptide A',
                concentration_value: 5,
                concentration_unit: 'mg/ml',
                vial_volume_ml: 5,
                quantity: 1,
                dose_volume_ml: 0.2,
              },
              {
                medication_name: 'peptide b',
                concentration_value: 5,
                concentration_unit: 'mg/ml',
                vial_volume_ml: 5,
                quantity: 1,
                dose_volume_ml: 0.2,
              },
            ],
          }),
          NOW
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          'peptide b already has an active plan. Add it to a stack from the stack list instead.',
      });
      expect(writes()).toBe(0);
      expect(verbs()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(state.receipts.size).toBe(0);
    }
  );

  it('refuses the whole request when a found medicine has a live legacy schedule, writing nothing', async () => {
    state.medicines = [{ id: uuid(7), name: 'Peptide B', is_active: true }];
    state.schedules = [{ medication_id: uuid(7) }];
    await expect(
      setupPremixedStack(
        owner,
        request({
          components: [
            {
              medication_name: 'Peptide A',
              concentration_value: 5,
              concentration_unit: 'mg/ml',
              vial_volume_ml: 5,
              quantity: 1,
              dose_volume_ml: 0.2,
            },
            {
              medication_name: 'Peptide B',
              concentration_value: 5,
              concentration_unit: 'mg/ml',
              vial_volume_ml: 5,
              quantity: 1,
              dose_volume_ml: 0.2,
            },
          ],
        }),
        NOW
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        'Peptide B already has a schedule. Add it to a stack from the stack list instead.',
    });
    expect(writes()).toBe(0);
    expect(verbs()).toEqual(['BEGIN', 'ROLLBACK']);
    const query = state.calls.find((c) =>
      c.sql.includes('FROM medication_schedules')
    )!;
    expect(query.sql).toContain('active = true');
    expect(query.sql).toContain('end_date IS NULL OR end_date >= $3');
    expect(query.params[2]).toBe('2026-11-25');
  });

  it('does not treat a completed or ended plan as active', async () => {
    state.medicines = [{ id: uuid(7), name: 'Peptide A', is_active: true }];
    state.plans = [
      {
        medication_id: uuid(7),
        status: 'active',
        start_date: '2026-01-01',
        end_date: '2026-02-01',
      },
    ];
    await expect(
      setupPremixedStack(owner, request(), NOW)
    ).resolves.toBeDefined();
  });

  it('refuses an existing stack name and an archived medicine before writing', async () => {
    state.stackNames = ['PEPTIDE STACK'];
    await expect(
      setupPremixedStack(owner, request(), NOW)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'You already have a stack with that name.',
    });
    expect(writes()).toBe(0);

    state.stackNames = [];
    state.medicines = [{ id: uuid(7), name: 'Peptide A', is_active: false }];
    await expect(
      setupPremixedStack(owner, request({ operation_id: op(2) }), NOW)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(writes()).toBe(0);
  });

  it('returns the first result for a retry and creates nothing more', async () => {
    const first = await setupPremixedStack(owner, request(), NOW);
    const writesAfterFirst = writes();
    const second = await setupPremixedStack(owner, request(), NOW);
    expect(second).toEqual(first);
    expect(writes()).toBe(writesAfterFirst);
    expect(verbs()).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  });

  it('refuses the same operation id with a different request', async () => {
    await setupPremixedStack(owner, request(), NOW);
    const before = writes();
    await expect(
      setupPremixedStack(owner, request({ name: 'Another stack' }), NOW)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'This operation ID was already used for a different request.',
    });
    expect(writes()).toBe(before);
  });

  it('rolls back and saves no receipt when a later write fails', async () => {
    state.createPen
      .mockResolvedValueOnce({ id: uuid(201) })
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(setupPremixedStack(owner, request(), NOW)).rejects.toThrow(
      'disk full'
    );
    expect(verbs()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(state.createStack).not.toHaveBeenCalled();
    expect(state.receipts.size).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller without medication write access before opening a transaction', async () => {
    state.assertWrite.mockRejectedValueOnce(
      Object.assign(
        new Error('Medication management permission is required.'),
        { statusCode: 403 }
      )
    );
    await expect(
      setupPremixedStack(owner, request(), NOW)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(state.assertWrite).toHaveBeenCalledWith(owner);
    expect(state.getClient).not.toHaveBeenCalled();
    expect(writes()).toBe(0);
  });

  it('looks medicines up only under the owner it is given', async () => {
    state.medicines = [{ id: uuid(7), name: 'Peptide A', is_active: true }];
    await setupPremixedStack(owner, request(), NOW);
    const lookups = state.calls.filter((c) =>
      c.sql.includes('FROM medications')
    );
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups.every((c) => c.params[0] === owner)).toBe(true);
    expect(state.getClient).toHaveBeenCalledWith(owner);
  });
});
