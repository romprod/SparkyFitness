import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { medicationChangeAuditSchema } from '@workspace/shared';

const root = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe('medication change audit log', () => {
  // The database triggers are the only writers. A second write path in application
  // code would double every row, so nothing outside the migration names the table.
  it.each(['models', 'services', 'routes', 'ai'])(
    'no file in %s mentions medication_change_audit',
    (dir) => {
      const files = sourceFiles(join(root, dir));
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.filter((file) =>
        readFileSync(file, 'utf8').includes('medication_change_audit')
      );
      expect(offenders).toEqual([]);
    }
  );

  const row = {
    id: '00000000-0000-4000-a000-000000000001',
    user_id: '00000000-0000-4000-a000-000000000002',
    actor_user_id: null,
    entity_kind: 'purchase_item',
    entity_id: '00000000-0000-4000-a000-000000000003',
    parent_id: '00000000-0000-4000-a000-000000000004',
    medication_id: null,
    action: 'edit',
    changed_at: '2026-11-28T12:00:00.000Z',
    old_values: { quantity: '1' },
    new_values: { quantity: '2' },
    tx_id: '12345',
  };

  it('accepts a row as the database stores it', () => {
    expect(medicationChangeAuditSchema.parse(row)).toEqual(row);
    for (const kind of [
      'vial',
      'purchase',
      'prescription',
      'prescription_medicine',
    ])
      expect(
        medicationChangeAuditSchema.safeParse({
          ...row,
          entity_kind: kind,
          action: 'create',
          parent_id: null,
          actor_user_id: row.user_id,
          changed_at: new Date(),
          old_values: null,
        }).success
      ).toBe(true);
  });

  it('rejects an unknown action, an unknown kind, a bad id and a dose kind', () => {
    expect(
      medicationChangeAuditSchema.safeParse({ ...row, action: 'update' })
        .success
    ).toBe(false);
    expect(
      medicationChangeAuditSchema.safeParse({
        ...row,
        entity_kind: 'injection',
      }).success
    ).toBe(false);
    expect(
      medicationChangeAuditSchema.safeParse({ ...row, entity_id: 'not-a-uuid' })
        .success
    ).toBe(false);
    expect(
      medicationChangeAuditSchema.safeParse({ ...row, tx_id: undefined })
        .success
    ).toBe(false);
  });
});
