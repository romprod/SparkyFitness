import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
  nutrition: vi.fn(),
  labs: vi.fn(),
  actor: { authenticatedUserId: '00000000-0000-4000-a000-000000000001' },
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: state.getClient,
  dbContextStorage: { getStore: () => state.actor },
}));
vi.mock('../models/reportRepository.js', () => ({
  default: { getNutritionData: state.nutrition },
}));
vi.mock('../models/labResultRepository.js', () => ({
  listLatestLabPanels: state.labs,
}));
import {
  appointmentReportQuerySchema,
  getAppointmentReportData,
} from '../services/appointmentReportService.js';
const owner = '00000000-0000-4000-a000-000000000001';
const now = new Date('2026-03-29T23:30:00Z');
const rows = new Map<string, Record<string, unknown>[]>();
describe('private appointment data snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows.clear();
    state.actor.authenticatedUserId = owner;
    state.getClient.mockResolvedValue({
      query: state.query,
      release: state.release,
    });
    state.query.mockImplementation(async (sql: string) => ({
      rows: [...rows].find(([table]) => sql.includes(table))?.[1] ?? [],
    }));
    state.nutrition.mockResolvedValue([]);
    state.labs.mockResolvedValue({ panels: [] });
  });
  it.each([
    { from: '2026-02-30' },
    { from: '2026-04-01', to: '2026-03-01' },
    { timezone: 'Invalid/Zone' },
    { from: ['2026-01-01'] },
    { userId: owner },
  ])('rejects invalid or foreign query shape %j', (input) => {
    expect(appointmentReportQuerySchema.safeParse(input).success).toBe(false);
  });
  it('defaults relative to effective owner-local to and preserves calendar days across DST', async () => {
    rows.set('FROM user_preferences', [{ timezone: 'Europe/London' }]);
    expect((await getAppointmentReportData(owner, {}, now)).range).toEqual({
      from: '2025-12-30',
      to: '2026-03-30',
      timezone: 'Europe/London',
    });
    const result = await getAppointmentReportData(
      owner,
      { to: '2026-03-29', timezone: 'Europe/London' },
      now
    );
    expect(result.range).toEqual({
      from: '2025-12-29',
      to: '2026-03-29',
      timezone: 'Europe/London',
    });
    for (const [sql, args] of state.query.mock.calls)
      if (String(sql).includes('BETWEEN'))
        expect(args).toEqual([owner, expect.any(String), expect.any(String)]);
  });
  it('rejects delegated and stale-owner data reads before opening a connection', async () => {
    await expect(
      getAppointmentReportData(owner, {
        expected_owner_id: '00000000-0000-4000-a000-000000000002',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    state.actor.authenticatedUserId = 'other';
    await expect(getAppointmentReportData(owner, {})).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(state.getClient).not.toHaveBeenCalled();
  });
  it('labels managed revision facts separately and uses only saved injection scheduled instants', async () => {
    rows.set('FROM medication_courses c', [
      {
        course_id: 'course',
        medication_id: 'med',
        medication_name_snapshot: 'Synthetic managed medication',
        timezone: 'Europe/London',
        current_revision_id: 'new',
        id: 'old',
        revision_no: 1,
        name: 'Synthetic old plan',
        status: 'completed',
        deleted_at: null,
        start_date: '2026-01-01',
        end_date: '2026-03-28',
        closed_date: '2026-03-28',
        target_dose: '0.25',
        dose_unit: 'mg',
        dose_basis: 'per_injection',
      },
    ]);
    rows.set('FROM medication_course_rules', [
      {
        revision_id: 'old',
        schedule_type_id: 'daily',
        time_of_day: '08:00',
        days_of_week: null,
        start_date: null,
        end_date: null,
      },
    ]);
    rows.set('FROM medication_course_steps', [
      { revision_id: 'old', dose: '0.25', dose_unit: 'mg', duration_days: 28 },
    ]);
    rows.set('FROM medication_course_activity', [
      {
        revision_id: 'old',
        from_at: '2026-01-01T00:00:00Z',
        until_at: '2026-03-29T00:00:00Z',
      },
    ]);
    rows.set('FROM injection_entries', [
      {
        id: 'old-injection',
        medication_id: 'med',
        injected_at: '2026-03-29T08:12:00Z',
        entry_date: '2026-03-29',
        dose_mg: '0.25',
        scheduled_for: null,
      },
      {
        id: 'new-injection',
        medication_id: 'med',
        injected_at: '2026-03-29T08:12:00Z',
        entry_date: '2026-03-29',
        dose_mg: '0.25',
        scheduled_for: '2026-03-29T08:00:00Z',
      },
    ]);
    const data = await getAppointmentReportData(owner, {}, now);
    expect(data.managedPlans).toEqual([
      expect.objectContaining({
        revisionId: 'old',
        current: false,
        status: 'completed',
        name: 'Synthetic old plan',
        startDate: '2026-01-01',
        closedDate: '2026-03-28',
        steps: [{ doseAmount: '0.25', doseUnit: 'mg', durationDays: 28 }],
        schedules: [
          expect.objectContaining({
            active: false,
            startDate: '2026-01-01',
            endDate: '2026-03-28',
          }),
        ],
      }),
    ]);
    expect(data.doseLog).toHaveLength(2);
    expect(
      data.doseLog.find((dose) => dose.id === 'old-injection')
    ).toMatchObject({ scheduledFor: null, timingDeltaMinutes: null });
    expect(
      data.doseLog.find((dose) => dose.id === 'new-injection')
    ).toMatchObject({
      scheduledFor: '2026-03-29T08:00:00.000Z',
      timingDeltaMinutes: 12,
    });
  });
  it('merges independent full histories exactly once with snapshots, skipped status and explicit unknown/zero delivery', async () => {
    rows.set('FROM profiles', [{ name: 'Synthetic name' }]);
    rows.set('FROM medications ', [
      {
        id: 'med',
        name: 'Current renamed medication',
        dose_amount: '1',
        dose_unit: 'tablet',
        is_active: true,
      },
    ]);
    rows.set(
      'FROM medication_entries ',
      Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        medication_id: 'med',
        med_name_snapshot: i === 0 ? null : 'Recorded name',
        dose_amount_snapshot: '2',
        dose_unit_snapshot: 'tablet',
        status: i === 1 ? 'skipped' : 'taken',
        entry_date: '2026-03-29',
        taken_at: '2026-03-29T22:00:00Z',
      }))
    );
    rows.set('FROM injection_entries ', [
      {
        id: '0',
        medication_id: null,
        dose_mg: '0',
        volume_ml: null,
        dose_input_unit: null,
        entry_date: '2026-03-29',
      },
      {
        id: '1',
        medication_id: 'med',
        dose_mg: '0',
        volume_ml: '0',
        dose_input_unit: 'ml',
        administration_route: 'injection',
        entry_date: '2026-03-29',
      },
      {
        id: '2',
        medication_id: 'med',
        dose_mg: '1e-400',
        entry_date: '2026-03-29',
      },
    ]);
    const result = await getAppointmentReportData(
      owner,
      { from: '2026-03-29', to: '2026-03-29', timezone: 'Europe/London' },
      now
    );
    expect(result.doseLog).toHaveLength(24);
    expect(
      result.doseLog.find(
        (d) => d.sourceKind === 'medication_entry' && d.id === '0'
      )
    ).toMatchObject({ name: null, nameBasis: 'unknown' });
    expect(
      result.doseLog.find(
        (d) => d.sourceKind === 'medication_entry' && d.id === '1'
      )
    ).toMatchObject({
      name: 'Recorded name',
      status: 'skipped',
      administered: false,
      doseUnit: 'tablet',
    });
    expect(
      result.doseLog.find((d) => d.sourceKind === 'injection' && d.id === '0')
    ).toMatchObject({ name: null, deliveredMassMg: null, doseUnit: null });
    expect(
      result.doseLog.find((d) => d.sourceKind === 'injection' && d.id === '1')
    ).toMatchObject({
      deliveredMassMg: '0',
      doseUnit: 'mg',
      administrationRoute: 'injection',
      nameBasis: 'current_link',
    });
    expect(
      result.doseLog.find((d) => d.sourceKind === 'injection' && d.id === '2')
        ?.deliveredMassMg
    ).toBe('1e-400');
    expect(result.ownerDisplayName).toBe('Synthetic name');
    expect(JSON.stringify(result)).not.toMatch(/email|password|secret/);
  });
  it('preserves observed missing/zero facts and separate stable assay identities, per-result units and qualified text', async () => {
    state.nutrition.mockResolvedValue([
      { date: '2026-03-28', calories: 0, protein: null },
      { date: '2026-03-29', calories: null, protein: 0 },
    ]);
    rows.set('FROM water_intake_entries', [
      { entry_date: '2026-03-29', total_ml: 0 },
    ]);
    const common = {
      entry_date: '2020-01-01',
      custom_marker_id: null,
      ref_range_low: 1,
      ref_range_high: 2,
    };
    state.labs.mockResolvedValue({
      panels: [
        {
          id: 'panel',
          lab_name: 'Synthetic lab',
          collected_on: '2020-01-01',
          origin: 'manual',
          results: [
            {
              ...common,
              id: 'a',
              marker_key: 'crp',
              value_numeric: 3,
              value_text: '<3',
              unit: 'mg/L',
            },
            {
              ...common,
              id: 'b',
              marker_key: 'hs_crp',
              value_numeric: 0,
              value_text: null,
              unit: 'mg/dL',
            },
          ],
        },
      ],
    });
    const result = await getAppointmentReportData(
      owner,
      { from: '2026-03-29', to: '2026-03-29' },
      now
    );
    expect(result.wellness.nutrition).toEqual([
      { day: '2026-03-28', calories: 0, proteinGrams: null },
      { day: '2026-03-29', calories: null, proteinGrams: 0 },
    ]);
    expect(result.wellness.water).toEqual([
      { day: '2026-03-29', millilitres: 0 },
    ]);
    expect(result.labPanels[0]?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          markerId: 'builtin:crp',
          valueText: '<3',
          unit: 'mg/L',
          rangeFlag: 'unknown',
          method: null,
        }),
        expect.objectContaining({
          markerId: 'builtin:hs_crp',
          valueNumeric: 0,
          unit: 'mg/dL',
          rangeFlag: 'low',
        }),
      ])
    );
    expect(state.labs).toHaveBeenCalledWith(
      owner,
      owner,
      expect.objectContaining({ query: state.query })
    );
    expect(state.nutrition).toHaveBeenCalledWith(
      owner,
      '2026-03-29',
      '2026-03-29',
      [],
      expect.objectContaining({ query: state.query }),
      true
    );
    expect(state.query.mock.calls[0]).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    ]);
    expect(state.query.mock.calls.at(-1)).toEqual(['COMMIT']);
    expect(state.release).toHaveBeenCalledOnce();
  });
  it('rolls back and releases if a component read fails without logging content', async () => {
    state.nutrition.mockRejectedValue(new Error('synthetic failure'));
    await expect(getAppointmentReportData(owner, {})).rejects.toThrow(
      'synthetic failure'
    );
    expect(state.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(state.release).toHaveBeenCalledOnce();
  });
});
