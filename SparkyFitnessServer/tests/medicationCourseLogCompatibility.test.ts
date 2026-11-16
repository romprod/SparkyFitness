import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreateMedicationEntryBodySchema,
  UpdateMedicationEntryBodySchema,
  CreateInjectionBodySchema,
  UpdateInjectionBodySchema,
} from '../schemas/medicationSchemas.js';
const medication_id = randomUUID(),
  course_revision_id = randomUUID(),
  course_rule_id = randomUUID();
describe('additive course log API compatibility', () => {
  it('keeps legacy ordinary logs and accepted scheduled timestamp strings unchanged', () => {
    const old = {
      medication_id,
      schedule_id: randomUUID(),
      scheduled_for: '2026-11-16 08:00:00',
      status: 'taken',
    };
    expect(CreateMedicationEntryBodySchema.parse(old)).toEqual(old);
    expect(
      UpdateMedicationEntryBodySchema.parse({
        scheduled_for: old.scheduled_for,
      })
    ).toEqual({ scheduled_for: old.scheduled_for });
    expect(
      CreateInjectionBodySchema.parse({ medication_id, dose_mg: 1 })
    ).toEqual({ medication_id, dose_mg: 1 });
  });
  it('accepts explicit attribution additively without changing raw calculated draw input or actual units', () => {
    const explicit = {
      medication_id,
      course_revision_id,
      course_rule_id,
      course_slot_key: 'synthetic-slot',
      scheduled_day: '2026-11-16',
      scheduled_for: '2026-11-16T08:00:00Z',
      course_expected_version: 2,
    };
    expect(CreateMedicationEntryBodySchema.parse(explicit)).toEqual(explicit);
    expect(
      CreateInjectionBodySchema.parse({ ...explicit, dose_mg: 0.123456789 })
    ).toMatchObject({ dose_mg: 0.123456789, course_revision_id });
  });
  it('rejects detached references and invented injection scheduled timestamps', () => {
    expect(
      CreateMedicationEntryBodySchema.safeParse({
        medication_id,
        course_rule_id,
      }).success
    ).toBe(false);
    expect(
      CreateInjectionBodySchema.safeParse({
        medication_id,
        course_revision_id,
        scheduled_for: '2026-11-16T08:00:00Z',
      }).success
    ).toBe(false);
    expect(
      UpdateInjectionBodySchema.safeParse({
        scheduled_for: '2026-11-16T08:00:00Z',
      }).success
    ).toBe(true);
    expect(
      CreateInjectionBodySchema.safeParse({
        medication_id,
        course_revision_id,
        course_rule_id,
        course_slot_key: 'slot',
        scheduled_day: '2026-02-30',
      }).success
    ).toBe(false);
  });
  it('rejects forged retained origin/name snapshots and conflicting legacy/managed references', () => {
    expect(
      CreateMedicationEntryBodySchema.safeParse({
        medication_id,
        course_origin: true,
      }).success
    ).toBe(false);
    expect(
      CreateInjectionBodySchema.safeParse({
        medication_id,
        medication_name_snapshot: 'Forged name',
      }).success
    ).toBe(false);
    expect(
      UpdateInjectionBodySchema.safeParse({ course_origin: null }).success
    ).toBe(false);
    expect(
      CreateMedicationEntryBodySchema.safeParse({
        medication_id,
        course_revision_id,
        schedule_id: randomUUID(),
      }).success
    ).toBe(false);
  });
});
