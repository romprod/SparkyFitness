import { describe, expect, it } from 'vitest';
import {
  medicationPrescriptionCreateSchema,
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionUpdateSchemaV2,
  medicationPrescriptionSchemaV2,
  medicationPrescriptionClientSchema,
  medicationPrescriptionListSchemaV2,
  medicationPrescriptionDeleteSchema,
  medicationPrescriptionQuerySchema,
  medicationPrescriptionSchema,
  medicationPrescriptionMutationResultSchema,
  medicationCoursePlanInputSchema,
  medicationCourseRevisionSchema,
  medicationPensInitializerSchema,
  medicationPensMutatorSchema,
} from '@workspace/shared';
import {
  medicationCourseFixture,
  medicationCoursePlanFixture,
} from './fixtures/medicationCourseFixture.ts';

const id = '40000000-0000-4000-8000-000000000001';
const med = '40000000-0000-4000-8000-000000000002';
const create = { operation_id: id, medication_id: med, currency: 'GBP' };
const update = { operation_id: id, expected_version: 1 };
const row = () => {
  const { operation_id: _operation, ...fields } =
    medicationPrescriptionCreateSchema.parse(create);
  return {
    ...fields,
    id,
    user_id: id,
    medication_name: 'Synthetic medication',
    version: 1,
    created_at: '2026-11-17T12:00:00Z',
    updated_at: '2026-11-17T12:00:00Z',
  };
};

describe('basic owner-private prescription contracts', () => {
  it('keeps source create defaults and blank optional fields separate from zero', () => {
    const parsed = medicationPrescriptionCreateSchema.parse({
      ...create,
      prescriber: '  ',
      cost: '',
      quantity: '',
      refills_remaining: '0',
      lead_time_days: 0,
    });
    expect(parsed).toMatchObject({
      currency: 'GBP',
      status: 'active',
      prescriber: null,
      cost: null,
      quantity: null,
      refills_remaining: 0,
      lead_time_days: 0,
    });
  });

  it('preserves complete update omission, including status and currency', () => {
    expect(medicationPrescriptionUpdateSchema.parse(update)).toEqual(update);
    expect(
      medicationPrescriptionUpdateSchema.parse({
        ...update,
        pharmacy: '  ',
        currency: ' gbp ',
      })
    ).toEqual({ ...update, pharmacy: null, currency: 'gbp' });
  });

  it('refuses a create with a missing, blank or null currency and never invents one', () => {
    const { currency: _currency, ...without } = create;
    for (const body of [
      without,
      { ...create, currency: '' },
      { ...create, currency: '   ' },
      { ...create, currency: null },
    ]) {
      const result = medicationPrescriptionCreateSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'Currency is required.',
      ]);
      expect(result.error?.issues[0]?.path).toEqual(['currency']);
    }
  });

  it('lets an update omit currency but refuses to blank the stored one', () => {
    expect(medicationPrescriptionUpdateSchema.parse(update)).not.toHaveProperty(
      'currency'
    );
    for (const currency of ['', '  ', null])
      expect(
        medicationPrescriptionUpdateSchema.safeParse({ ...update, currency })
          .success
      ).toBe(false);
  });

  it('accepts strict nonnegative integer counts up to the actual storage bound', () => {
    expect(
      medicationPrescriptionCreateSchema.parse({
        ...create,
        quantity: '2147483647',
        refills_authorized: 0,
      }).quantity
    ).toBe(2147483647);
    for (const quantity of [
      -1,
      1.5,
      '1.5',
      '12junk',
      '1e2',
      Infinity,
      NaN,
      2147483648,
    ])
      expect(
        medicationPrescriptionCreateSchema.safeParse({ ...create, quantity })
          .success
      ).toBe(false);
  });

  it('retains exact finite cost strings without rounding or a quantity relationship rule', () => {
    const parsed = medicationPrescriptionCreateSchema.parse({
      ...create,
      cost: '0.1234567890123456789',
      refills_authorized: 0,
      refills_remaining: 8,
    });
    expect(parsed.cost).toBe('0.1234567890123456789');
    for (const cost of ['-1', 'NaN', 'Infinity', 'not money'])
      expect(
        medicationPrescriptionCreateSchema.safeParse({ ...create, cost })
          .success
      ).toBe(false);
    expect(
      medicationPrescriptionCreateSchema.parse({ ...create, cost: '0' }).cost
    ).toBe('0');
  });

  it('validates real civil dates without imposing excluded date ordering', () => {
    expect(
      medicationPrescriptionCreateSchema.safeParse({
        ...create,
        date_written: '2026-12-01',
        next_refill: '2026-11-01',
        expiration: '2026-10-01',
      }).success
    ).toBe(true);
    expect(
      medicationPrescriptionCreateSchema.parse({ ...create, date_written: ' ' })
        .date_written
    ).toBeNull();
    for (const date_written of [
      '2026-02-30',
      '17/11/2026',
      '2026-11-17T00:00:00Z',
    ])
      expect(
        medicationPrescriptionCreateSchema.safeParse({
          ...create,
          date_written,
        }).success
      ).toBe(false);
  });

  it('rejects PostgreSQL-unrepresentable year zero only in prescription dates', () => {
    for (const field of ['date_written', 'next_refill', 'expiration']) {
      expect(
        medicationPrescriptionCreateSchema.safeParse({
          ...create,
          [field]: '0000-01-01',
        }).success
      ).toBe(false);
      expect(
        medicationPrescriptionUpdateSchema.safeParse({
          ...update,
          [field]: '0000-01-01',
        }).success
      ).toBe(false);
      expect(
        medicationPrescriptionSchema.safeParse({
          ...row(),
          [field]: '0000-01-01',
        }).success
      ).toBe(false);
      for (const boundary of ['0001-01-01', '9999-12-31'])
        expect(
          medicationPrescriptionCreateSchema.safeParse({
            ...create,
            [field]: boundary,
          }).success
        ).toBe(true);
    }
  });

  it('keeps statuses explicit and exposes no wizard, ledger, attachment or list-filter fields', () => {
    expect(
      medicationPrescriptionCreateSchema.safeParse({
        ...create,
        status: 'cancelled',
      }).success
    ).toBe(true);
    for (const extra of [
      { status: 'archived' },
      { document_id: id },
      { refill_events: [] },
      { wizard: true },
    ])
      expect(
        medicationPrescriptionCreateSchema.safeParse({ ...create, ...extra })
          .success
      ).toBe(false);
    expect(
      medicationPrescriptionQuerySchema.parse({ expected_owner_id: id })
    ).toEqual({ expected_owner_id: id });
    expect(
      medicationPrescriptionQuerySchema.safeParse({ medication_id: med })
        .success
    ).toBe(false);
  });

  it('requires a valid create target while allowing an unchanged deleted target on update', () => {
    expect(
      medicationPrescriptionCreateSchema.safeParse({
        operation_id: id,
        medication_id: null,
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionUpdateSchema.parse({
        ...update,
        medication_id: null,
      }).medication_id
    ).toBeNull();
    // Identity equality is enforced against the locked existing row, not guessed by a stateless schema.
    expect(
      medicationPrescriptionSchema.parse({
        ...row(),
        medication_id: null,
        medication_name: 'Known deleted target',
      }).medication_name
    ).toBe('Known deleted target');
  });

  it('requires operation and version tokens without putting private fields in receipts', () => {
    expect(medicationPrescriptionDeleteSchema.parse(update)).toEqual(update);
    expect(
      medicationPrescriptionDeleteSchema.safeParse({ operation_id: id }).success
    ).toBe(false);
    expect(
      medicationPrescriptionMutationResultSchema.parse({
        id,
        version: null,
        deleted: true,
      })
    ).toEqual({ id, version: null, deleted: true });
    expect(
      medicationPrescriptionMutationResultSchema.safeParse({
        id,
        version: 1,
        deleted: false,
        prescriber: 'Private value',
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionSchema.safeParse({ ...row(), source_encrypted: {} })
        .success
    ).toBe(false);
  });

  it('never converts omitted pen or plan bindings into explicit null writes', () => {
    expect(
      medicationPensInitializerSchema.parse({ label: 'Existing label' })
    ).not.toHaveProperty('prescription_id');
    expect(
      medicationPensMutatorSchema.parse({ label: 'Existing label' })
    ).not.toHaveProperty('prescription_id');
    expect(
      medicationCoursePlanInputSchema.parse(medicationCoursePlanFixture())
    ).not.toHaveProperty('prescription_id');
    const revision = medicationCourseFixture().revisions[0]!;
    expect(medicationCourseRevisionSchema.parse(revision)).not.toHaveProperty(
      'prescription_id'
    );
    expect(
      medicationCourseRevisionSchema.parse({ ...revision, prescription_id: id })
        .prescription_id
    ).toBe(id);
    expect(
      medicationCoursePlanInputSchema.parse({
        ...medicationCoursePlanFixture(),
        prescription_id: null,
      }).prescription_id
    ).toBeNull();
  });
});

describe('prescriptions that cover several medicines: contracts', () => {
  const ids = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => '40000000-0000-4000-8000-' + String(100 + i).padStart(12, '0')
    );
  const base = { operation_id: id, currency: 'GBP' };
  it('keeps model 1 strict: it knows nothing of medication_ids', () => {
    expect(
      medicationPrescriptionCreateSchema.safeParse({
        ...base,
        medication_ids: ids(2),
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionUpdateSchema.safeParse({
        ...update,
        medication_ids: ids(2),
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionSchema.safeParse({ ...row(), medications: [] })
        .success
    ).toBe(false);
  });
  it('accepts exactly one of medication_id or medication_ids on create, at most 20 distinct', () => {
    const parse = (value: object) =>
      medicationPrescriptionCreateSchemaV2.safeParse({ ...base, ...value });
    expect(parse({ medication_id: med }).success).toBe(true);
    expect(parse({ medication_ids: ids(1) }).success).toBe(true);
    expect(parse({ medication_ids: ids(20) }).success).toBe(true);
    expect(parse({}).success).toBe(false);
    expect(parse({ medication_id: med, medication_ids: ids(2) }).success).toBe(
      false
    );
    expect(parse({ medication_ids: [] }).success).toBe(false);
    expect(parse({ medication_ids: ids(21) }).success).toBe(false);
    expect(parse({ medication_ids: [ids(1)[0], ids(1)[0]] }).success).toBe(
      false
    );
    expect(parse({ medication_ids: ['nope'] }).success).toBe(false);
    expect(parse({ medication_id: med, surprise: true }).success).toBe(false);
  });
  it('lets an update replace the set or echo medication_id, never both', () => {
    const parse = (value: object) =>
      medicationPrescriptionUpdateSchemaV2.safeParse({ ...update, ...value });
    expect(parse({}).success).toBe(true);
    expect(parse({ medication_ids: ids(2) }).success).toBe(true);
    expect(parse({ medication_id: med }).success).toBe(true);
    expect(parse({ medication_id: null }).success).toBe(true);
    expect(parse({ medication_id: med, medication_ids: ids(1) }).success).toBe(
      false
    );
    expect(parse({ medication_ids: ids(21) }).success).toBe(false);
  });
  it('parses a legacy body to the same JSON, key order included, through both schemas', () => {
    const body = {
      ...create,
      cost: '12.50',
      quantity: 3,
      source: ' Synthetic ',
    };
    expect(
      JSON.stringify(medicationPrescriptionCreateSchemaV2.parse(body))
    ).toBe(JSON.stringify(medicationPrescriptionCreateSchema.parse(body)));
    const patch = {
      ...update,
      medication_id: med,
      cost: '3',
      cost_basis: 'per_vial',
    };
    expect(
      JSON.stringify(medicationPrescriptionUpdateSchemaV2.parse(patch))
    ).toBe(JSON.stringify(medicationPrescriptionUpdateSchema.parse(patch)));
  });
  it('adds the covered medicines to the model 2 response only, and tolerates their absence for a client', () => {
    const covered = [
      { medication_id: med, medication_name: 'Synthetic one', position: 0 },
      { medication_id: null, medication_name: 'Synthetic gone', position: 1 },
    ];
    const v2 = { ...row(), medications: covered };
    expect(medicationPrescriptionSchemaV2.safeParse(v2).success).toBe(true);
    expect(medicationPrescriptionSchemaV2.safeParse(row()).success).toBe(false);
    expect(
      medicationPrescriptionSchemaV2.safeParse({ ...v2, medications: [] })
        .success
    ).toBe(false);
    expect(
      medicationPrescriptionSchemaV2.safeParse({
        ...v2,
        medications: [{ ...covered[0], extra: 1 }],
      }).success
    ).toBe(false);
    expect(medicationPrescriptionClientSchema.safeParse(row()).success).toBe(
      true
    );
    expect(medicationPrescriptionClientSchema.safeParse(v2).success).toBe(true);
    expect(
      medicationPrescriptionListSchemaV2.safeParse({ prescriptions: [v2] })
        .success
    ).toBe(true);
  });
  it('lets an old strict reader parse a multi-medicine prescription projected to model 1', () => {
    const { medications: _covered, ...legacyShape } = {
      ...row(),
      medication_name: 'Synthetic one + Synthetic two',
      medications: [],
    };
    expect(medicationPrescriptionSchema.safeParse(legacyShape).success).toBe(
      true
    );
  });
});
