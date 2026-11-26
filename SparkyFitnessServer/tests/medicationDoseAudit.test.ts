import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { medicationDoseAuditSchema } from '@workspace/shared';

const root = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe('dose audit log', () => {
  // The database trigger is the only writer. A second write path in application
  // code would double every row, so nothing outside the migration names the table.
  it.each(['models', 'services', 'routes', 'ai'])(
    'no file in %s mentions medication_dose_audit',
    (dir) => {
      const files = sourceFiles(join(root, dir));
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.filter((file) =>
        readFileSync(file, 'utf8').includes('medication_dose_audit')
      );
      expect(offenders).toEqual([]);
    }
  );

  const row = {
    id: '00000000-0000-4000-a000-000000000001',
    user_id: '00000000-0000-4000-a000-000000000002',
    actor_user_id: null,
    entity_kind: 'injection',
    entity_id: '00000000-0000-4000-a000-000000000003',
    medication_id: null,
    action: 'edit',
    changed_at: '2026-11-26T12:00:00.000Z',
    old_values: { site: 'left' },
    new_values: { site: 'right' },
  };

  it('accepts a row as the database stores it', () => {
    expect(medicationDoseAuditSchema.parse(row)).toEqual(row);
    expect(
      medicationDoseAuditSchema.safeParse({
        ...row,
        action: 'create',
        entity_kind: 'entry',
        actor_user_id: row.user_id,
        changed_at: new Date(),
        old_values: null,
      }).success
    ).toBe(true);
  });

  it('rejects an unknown action, an unknown kind and a bad id', () => {
    expect(
      medicationDoseAuditSchema.safeParse({ ...row, action: 'update' }).success
    ).toBe(false);
    expect(
      medicationDoseAuditSchema.safeParse({ ...row, entity_kind: 'vial' })
        .success
    ).toBe(false);
    expect(
      medicationDoseAuditSchema.safeParse({ ...row, entity_id: 'not-a-uuid' })
        .success
    ).toBe(false);
  });
});
