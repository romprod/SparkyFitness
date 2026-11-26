import { vi, beforeEach, describe, expect, it } from 'vitest';
import { buildMedicationTools } from '../ai/tools/medicationTools.js';
import medicationRepository from '../models/medicationRepository.js';
import medicationEntryRepository from '../models/medicationEntryRepository.js';
import * as packRepository from '../models/medicationPackRepository.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

vi.mock('../models/medicationRepository', () => ({
  default: {
    listMedications: vi.fn(),
    getMedicationById: vi.fn(),
    createMedication: vi.fn(),
    updateMedication: vi.fn(),
    deleteMedication: vi.fn(),
    addSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
}));
vi.mock('../models/medicationPackRepository', () => ({
  listPacks: vi.fn(),
  createPack: vi.fn(),
  updatePack: vi.fn(),
  deletePack: vi.fn(),
}));
vi.mock('../models/medicationEntryRepository', () => ({
  default: {
    createEntry: vi.fn(),
    listEntriesWithInjections: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));
vi.mock('../models/injectionRepository', () => ({
  default: {
    createInjection: vi.fn(),
    listInjections: vi.fn(),
  },
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = toolOpts;
const MED_ID = '123e4567-e89b-12d3-a456-426614174000';
const SCHEDULE_ID = '223e4567-e89b-12d3-a456-426614174000';
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

let tools: ReturnType<typeof buildMedicationTools>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = buildMedicationTools('user-1', 'UTC');
});

describe('sparky_manage_medications create/update/delete + schedules', () => {
  it('create_medication confirms with label and id', async () => {
    vi.mocked(medicationRepository.createMedication).mockResolvedValue({
      id: MED_ID,
      display_name: null,
      name: 'Sertraline',
      strength_value: 50,
      strength_unit: 'mg',
      is_active: true,
    });

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'create_medication',
        name: 'Sertraline',
        strength_value: 50,
        strength_unit: 'mg',
      },
      opts
    );

    expect(result).toBe(
      `✅ Medication **Sertraline** — 50mg created (ID: ${MED_ID}).`
    );
    expect(medicationRepository.createMedication).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Sertraline', strength_value: 50 })
    );
  });

  it('create_medication is inferred from name without an action', async () => {
    vi.mocked(medicationRepository.createMedication).mockResolvedValue({
      id: MED_ID,
      display_name: null,
      name: 'Omega',
      strength_value: null,
      strength_unit: null,
      is_active: true,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { name: 'Omega' },
      opts
    );

    expect(result).toBe(`✅ Medication **Omega** created (ID: ${MED_ID}).`);
  });

  it('create_medication rejects a missing name', async () => {
    const result = await tools.sparky_manage_medications.execute!(
      { action: 'create_medication' },
      opts
    );

    expect(result).toContain('Error [VALIDATION]');
    expect(medicationRepository.createMedication).not.toHaveBeenCalled();
  });

  it('update_medication confirms the updated label', async () => {
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue({
      id: MED_ID,
      display_name: null,
      name: 'Bupropion XL',
      strength_value: 300,
      strength_unit: 'mg',
      is_active: true,
    });

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_medication',
        medication_id: MED_ID,
        strength_value: 300,
      },
      opts
    );

    expect(result).toBe('✅ Medication **Bupropion XL** — 300mg updated.');
  });

  it('update_medication passes null through to clear a field', async () => {
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue({
      id: MED_ID,
      display_name: null,
      name: 'Bupropion XL',
      strength_value: 300,
      strength_unit: 'mg',
      is_active: true,
    });

    await tools.sparky_manage_medications.execute!(
      {
        action: 'update_medication',
        medication_id: MED_ID,
        reason_text: null,
      },
      opts
    );

    expect(medicationRepository.updateMedication).toHaveBeenCalledWith(
      'user-1',
      MED_ID,
      expect.objectContaining({ reason_text: null })
    );
  });

  it('update_medication returns NOT_FOUND when the med is missing', async () => {
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue(null);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'update_medication', medication_id: MED_ID, is_active: false },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('delete_medication confirms deletion', async () => {
    vi.mocked(medicationRepository.deleteMedication).mockResolvedValue(true);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'delete_medication', medication_id: MED_ID },
      opts
    );

    expect(result).toBe('✅ Medication deleted.');
  });

  it('delete_medication returns NOT_FOUND when nothing was deleted', async () => {
    vi.mocked(medicationRepository.deleteMedication).mockResolvedValue(false);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'delete_medication', medication_id: MED_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('delete_medication shows the in-use refusal as a validation message', async () => {
    vi.mocked(medicationRepository.deleteMedication).mockRejectedValue(
      Object.assign(
        new Error(
          'In use by 1 plan — delete those first, or mark it inactive.'
        ),
        { statusCode: 409 }
      )
    );

    const result = (await tools.sparky_manage_medications.execute!(
      { action: 'delete_medication', medication_id: MED_ID },
      opts
    )) as string;

    expect(result).toContain('VALIDATION');
    expect(result).toContain('In use by 1 plan');
  });

  it('add_schedule confirms with type, time, and id', async () => {
    vi.mocked(medicationRepository.addSchedule).mockResolvedValue({
      id: SCHEDULE_ID,
      schedule_type_id: 'daily',
      time_of_day: '13:00',
      dose_amount: null,
      active: true,
      prn_reason: null,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'add_schedule', medication_id: MED_ID, time_of_day: '13:00' },
      opts
    );

    expect(result).toBe(
      `✅ Schedule added (daily at 13:00, ID: ${SCHEDULE_ID}).`
    );
    expect(medicationRepository.addSchedule).toHaveBeenCalledWith(
      'user-1',
      MED_ID,
      expect.objectContaining({
        schedule_type_id: 'daily',
        time_of_day: '13:00',
      })
    );
  });

  it('add_schedule is inferred from time_of_day and defaults type to daily', async () => {
    vi.mocked(medicationRepository.addSchedule).mockResolvedValue({
      id: SCHEDULE_ID,
      schedule_type_id: 'daily',
      time_of_day: '18:00',
      dose_amount: null,
      active: true,
      prn_reason: null,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { medication_id: MED_ID, time_of_day: '18:00' },
      opts
    );

    expect(result).toBe(
      `✅ Schedule added (daily at 18:00, ID: ${SCHEDULE_ID}).`
    );
  });

  it('list_schedules renders each schedule for the medication', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      id: MED_ID,
      display_name: null,
      name: 'Sertraline',
      strength_value: 50,
      strength_unit: 'mg',
      is_active: true,
      dose_amount: null,
      dose_unit: null,
      is_glp1: false,
      reason_text: null,
      notes: null,
      schedules: [
        {
          id: SCHEDULE_ID,
          schedule_type_id: 'daily',
          time_of_day: '13:00',
          dose_amount: null,
          active: true,
          prn_reason: null,
        },
      ] as unknown as MedicationDetailScheduleShape,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_schedules', medication_id: MED_ID },
      opts
    );

    expect(result).toBe(
      '# Schedules for Sertraline\n\n' +
        `**13:00** (daily)\n  ID: ${SCHEDULE_ID}`
    );
  });

  it('list_schedules returns NOT_FOUND when the med is missing', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(null);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_schedules', medication_id: MED_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('delete_schedule confirms deletion', async () => {
    vi.mocked(medicationRepository.deleteSchedule).mockResolvedValue(true);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'delete_schedule', schedule_id: SCHEDULE_ID },
      opts
    );

    expect(result).toBe('✅ Schedule deleted.');
  });

  it('delete_schedule is inferred from schedule_id', async () => {
    vi.mocked(medicationRepository.deleteSchedule).mockResolvedValue(true);

    const result = await tools.sparky_manage_medications.execute!(
      { schedule_id: SCHEDULE_ID },
      opts
    );

    expect(result).toBe('✅ Schedule deleted.');
  });

  it('delete_schedule returns NOT_FOUND when nothing was deleted', async () => {
    vi.mocked(medicationRepository.deleteSchedule).mockResolvedValue(false);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'delete_schedule', schedule_id: SCHEDULE_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Schedule with ID '${SCHEDULE_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('returns DB_ERROR when the repository throws', async () => {
    vi.mocked(medicationRepository.createMedication).mockRejectedValue(
      new Error('boom')
    );

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'create_medication', name: 'Sertraline' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

type MedicationDetailScheduleShape = {
  time_of_day: string | null;
  active: boolean | null;
  dose_amount: number | null;
  prn_reason: string | null;
}[];

describe('sparky_manage_medications tablet and capsule packs', () => {
  const PACK_ID = '323e4567-e89b-12d3-a456-426614174000';
  const pack = (over: Record<string, unknown> = {}) => ({
    id: PACK_ID,
    medication_id: MED_ID,
    medication_name: 'Sertraline',
    label: null,
    unit_label: 'tablets',
    status: 'in_use',
    units_total: '60.000',
    units_used: '52.000',
    units_remaining: '8.000',
    overdrawn: false,
    doses_left: '4',
    observed_days_left: 4,
    planned_days_left: 4,
    planned_empty_date: '2026-11-22',
    low: true,
    expiry_date: '2027-03-01',
    expired: false,
    ...over,
  });
  const run = (args: Record<string, unknown>) =>
    tools.sparky_manage_medications.execute!(args as never, opts);

  it('list_packs shows units left, run-out and the low flag, and hides closed packs by default', async () => {
    vi.mocked(packRepository.listPacks).mockResolvedValue({
      today: '2026-11-18',
      packs: [
        pack(),
        pack({ id: 'x', status: 'finished', medication_id: 'other' }),
      ],
    } as never);
    const result = (await run({ action: 'list_packs' })) as string;
    expect(result).toContain('8 of 60 tablets left');
    expect(result).toContain('4 doses left');
    expect(result).toContain('runs out 2026-11-22 (~4 days)');
    expect(result).toContain('LOW');
    expect(result).toContain(`ID: ${PACK_ID}`);
    expect(result).not.toContain('finished');
    const all = (await run({
      action: 'list_packs',
      include_closed: true,
    })) as string;
    expect(all).toContain('finished');
    const filtered = (await run({
      action: 'list_packs',
      medication_id: MED_ID,
      include_closed: true,
    })) as string;
    expect(filtered).not.toContain('finished');
  });

  it('add_pack creates a pack for a named medication', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { id: MED_ID, name: 'Sertraline', display_name: null },
    ] as never);
    vi.mocked(packRepository.createPack).mockResolvedValue(PACK_ID);
    const result = await run({
      action: 'add_pack',
      medication_name: 'Sertraline',
      unit_label: 'tablets',
      units_total: 60,
      pack_status: 'in_use',
      expiry_date: '2027-03-01',
    });
    expect(result).toBe(`✅ Pack added (60 tablets, ID: ${PACK_ID}).`);
    expect(packRepository.createPack).toHaveBeenCalledWith('user-1', MED_ID, {
      unit_label: 'tablets',
      units_total: 60,
      status: 'in_use',
      expiry_date: '2027-03-01',
    });
  });

  it('update_pack marks a state change as deliberate and reports a missing pack', async () => {
    vi.mocked(packRepository.updatePack).mockResolvedValue(true);
    expect(
      await run({
        action: 'update_pack',
        pack_id: PACK_ID,
        pack_status: 'finished',
      })
    ).toBe('✅ Pack updated.');
    expect(packRepository.updatePack).toHaveBeenCalledWith('user-1', PACK_ID, {
      status: 'finished',
      lifecycle_intent: true,
    });
    vi.mocked(packRepository.updatePack).mockResolvedValue(false);
    expect(
      await run({ action: 'update_pack', pack_id: PACK_ID, notes: 'x' })
    ).toContain('NOT_FOUND');
  });

  it('delete_pack confirms, reports a missing pack and surfaces a rejected edit as validation', async () => {
    vi.mocked(packRepository.deletePack).mockResolvedValue(true);
    expect(await run({ action: 'delete_pack', pack_id: PACK_ID })).toContain(
      'Pack deleted'
    );
    vi.mocked(packRepository.deletePack).mockResolvedValue(false);
    expect(await run({ action: 'delete_pack', pack_id: PACK_ID })).toContain(
      'NOT_FOUND'
    );
    vi.mocked(packRepository.updatePack).mockRejectedValue(
      Object.assign(new Error('Add a pack as sealed or in use.'), {
        statusCode: 422,
      })
    );
    const result = (await run({
      action: 'update_pack',
      pack_id: PACK_ID,
      pack_status: 'sealed',
    })) as string;
    expect(result).toContain('VALIDATION');
    expect(result).toContain('Add a pack as sealed or in use.');
  });

  it('log passes an explicit pack or an opt-out through to the entry repository', async () => {
    vi.mocked(medicationEntryRepository.createEntry).mockResolvedValue({
      status: 'taken',
      med_name_snapshot: 'Sertraline',
      entry_date: '2026-11-18',
      dose_amount_snapshot: 2,
      dose_unit_snapshot: 'tablet',
    } as never);
    await run({
      action: 'log',
      medication_id: MED_ID,
      pack_id: PACK_ID,
      entry_date: '2026-11-18',
    });
    expect(medicationEntryRepository.createEntry).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ pack_id: PACK_ID })
    );
    await run({
      action: 'log',
      medication_id: MED_ID,
      deduct_pack: false,
      entry_date: '2026-11-18',
    });
    expect(medicationEntryRepository.createEntry).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ deduct_pack: false })
    );
  });
});
