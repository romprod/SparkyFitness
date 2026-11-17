import type { PoolClient } from 'pg';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  course: vi.fn(),
  actuals: vi.fn(),
  phase: vi.fn(),
}));
vi.mock('../models/medicationCourseRepository.js', () => ({
  loadCourseOwnerContext: mocks.context,
  loadMedicationCourse: mocks.course,
  loadCourseActuals: mocks.actuals,
  loadCoursePhaseActuals: mocks.phase,
  deliveredCourseInputs: (rows: Array<{ id: string; source_kind: string }>) =>
    rows.map((r) => ({ ...r, id: `${r.source_kind}:${r.id}` })),
}));
import { loadMedicationCalendarSnapshot } from '../models/medicationCalendarRepository.js';
const query = vi.fn();
const client = { query } as unknown as PoolClient;
const base = {
  id: 'actual',
  source_kind: 'injection',
  medication_id: null,
  medication_name: 'Saved synthetic',
  status: 'taken',
  entry_date: '2026-11-17',
  occurred_at: '2026-11-17',
  dose_amount: '0',
  dose_unit: 'mg',
  dose_mg_exact: '0',
  schedule_id: null,
  course_origin: null,
  course_revision_id: null,
  course_rule_id: null,
  course_step_id: null,
  course_slot_key: null,
  scheduled_day: null,
  scheduled_for: null,
  notes: null,
  site: null,
  volume_ml: null,
  syringe_units: null,
  dose_input_unit: null,
  pen_id: null,
  syringe_id: null,
  preparation_id: null,
  administration_route: null,
};
describe('calendar native recorded facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      today: '2026-11-17',
      timezone: 'Pacific/Kiritimati',
    });
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('UNION ALL') ? [{ ...base }] : [],
    }));
  });
  it('keeps orphan saved identity and date-only clock unknown, and rejects legacy zero mass sentinel', async () => {
    const result = await loadMedicationCalendarSnapshot(
      client,
      'owner',
      new Date('2026-11-16T23:30Z')
    );
    expect(result).toMatchObject({
      today: '2026-11-17',
      timezone: 'Pacific/Kiritimati',
    });
    expect(result.actuals[0]).toMatchObject({
      medication_id: null,
      medication_name: 'Saved synthetic',
      occurred_at: null,
      dose_amount: null,
      dose_unit: null,
      dose_mg_exact: null,
    });
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/^SELECT/);
      expect(sql).not.toMatch(/FOR UPDATE|INSERT|UPDATE |DELETE /);
      expect(params).toEqual(['owner']);
    }
  });
  it('retains explicit zero physical mass and snapshot native dose without current-medication dose fallback', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('UNION ALL')
        ? [
            {
              ...base,
              volume_ml: '0',
              dose_input_unit: 'mg',
              occurred_at: new Date('2026-11-17T04:00Z'),
            },
            {
              ...base,
              id: 'ordinary',
              source_kind: 'entry',
              dose_amount: '250',
              dose_unit: 'mcg',
              dose_mg_exact: null,
            },
          ]
        : [],
    }));
    const result = await loadMedicationCalendarSnapshot(
      client,
      'owner',
      new Date('2026-11-17T12:00Z')
    );
    expect(result.actuals[0]).toMatchObject({
      dose_amount: '0',
      dose_mg_exact: '0',
      occurred_at: '2026-11-17T04:00:00.000Z',
    });
    expect(result.actuals[1]).toMatchObject({
      dose_amount: '250',
      dose_unit: 'mcg',
    });
  });
  it('loads managed and phase-only history separately through the same client, prefixing source IDs once', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT id FROM medication_courses')
        ? [{ id: 'course' }]
        : [],
    }));
    mocks.course.mockResolvedValue({
      id: 'course',
      current_revision_id: null,
      revisions: [],
    });
    mocks.actuals.mockResolvedValue([
      { id: 'shared', source_kind: 'entry', course_revision_id: 'old' },
    ]);
    mocks.phase.mockResolvedValue([
      {
        id: 'shared',
        source_kind: 'injection',
        course_revision_id: null,
        phase_family_id: 'origin',
      },
    ]);
    const result = await loadMedicationCalendarSnapshot(
      client,
      'owner',
      new Date('2026-11-17T12:00Z')
    );
    expect(result.courses[0]?.current_revision_id).toBeNull();
    expect(result.managed_actuals[0]?.id).toBe('entry:shared');
    expect(result.phase_actuals[0]?.id).toBe('injection:shared');
    expect(mocks.actuals).toHaveBeenCalledExactlyOnceWith(
      client,
      'owner',
      'course'
    );
    expect(mocks.phase).toHaveBeenCalledExactlyOnceWith(
      client,
      'owner',
      'course'
    );
    expect(result.actuals).toEqual([]);
  });
  it('shows known native volume when mass is unknown without inventing a concentration', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('UNION ALL')
        ? [{ ...base, volume_ml: '0.125', dose_input_unit: null }]
        : [],
    }));
    const result = await loadMedicationCalendarSnapshot(
      client,
      'owner',
      new Date('2026-11-17T12:00Z')
    );
    expect(result.actuals[0]).toMatchObject({
      dose_amount: '0.125',
      dose_unit: 'ml',
      dose_mg_exact: null,
    });
    expect(result.actuals[0]).not.toHaveProperty('volume_ml');
  });
});
