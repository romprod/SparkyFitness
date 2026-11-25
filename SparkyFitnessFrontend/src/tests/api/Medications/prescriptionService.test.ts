import { ZodError } from 'zod';
import type { MedicationPrescription } from '@workspace/shared';
import { apiCall } from '@/api/api';
import * as service from '@/api/Medications/prescriptionService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
const root = '/v2/medication-prescriptions';
const row = (): MedicationPrescription => ({
  id: courseIds.legacy,
  user_id: courseIds.owner,
  medication_id: courseIds.med,
  medication_name: 'Example medication',
  source: 'Example source',
  prescriber: null,
  pharmacy: null,
  dose_instructions: null,
  cost: '0.00',
  currency: 'AUD',
  quantity: 0,
  refills_authorized: 0,
  refills_remaining: null,
  date_written: null,
  next_refill: null,
  expiration: null,
  lead_time_days: 0,
  status: 'active',
  version: 1,
  created_at: '2026-11-17T12:00:00Z',
  updated_at: '2026-11-17T12:00:00Z',
});
const createBody = {
  operation_id: courseIds.step,
  medication_id: courseIds.med,
  currency: 'GBP',
  source: ' Example source ',
  cost: '0.0000',
  quantity: '0',
};
const updateBody = {
  operation_id: courseIds.step,
  expected_version: 1,
  refills_remaining: 0,
};
const deleteBody = { operation_id: courseIds.step, expected_version: 1 };
const receipt = { id: courseIds.legacy, version: 2, deleted: false };
beforeEach(() => request.mockReset());
it('lists all owner prescriptions without filters, reordering or inferred zero/unknown counters', async () => {
  const response = {
    prescriptions: [
      row(),
      {
        ...row(),
        id: courseIds.revision2,
        status: 'cancelled',
        medication_id: null,
        medication_name: 'Retained known name',
      },
    ],
  };
  const signal = new AbortController().signal;
  request.mockResolvedValue(response);
  await expect(
    service.listMedicationPrescriptions(courseIds.owner, signal)
  ).resolves.toEqual(response);
  expect(request).toHaveBeenCalledWith(root, {
    method: 'GET',
    params: { expected_owner_id: courseIds.owner },
    signal,
    suppressErrorToast: true,
  });
});
it('reads one exact owner record with caller cancellation', async () => {
  const signal = new AbortController().signal;
  request.mockResolvedValue({ prescription: row() });
  await expect(
    service.getMedicationPrescription(courseIds.owner, courseIds.legacy, signal)
  ).resolves.toEqual({ prescription: row() });
  expect(request).toHaveBeenCalledWith(`${root}/${courseIds.legacy}`, {
    method: 'GET',
    params: { expected_owner_id: courseIds.owner },
    signal,
    suppressErrorToast: true,
  });
});
it('accepts minimal basic-create input without injecting unknown counters or normalising the original retry body', async () => {
  request.mockResolvedValue({ ...receipt, version: 1 });
  const body = {
    operation_id: courseIds.step,
    medication_id: courseIds.med,
    currency: 'GBP',
  };
  await service.createMedicationPrescription(courseIds.owner, body);
  expect(request.mock.calls[0]![1]!.body).toBe(body);
  expect(request.mock.calls[0]![1]!.body).toEqual(body);
});
it.each([
  {
    name: 'create',
    method: 'POST',
    path: root,
    body: createBody,
    run: () =>
      service.createMedicationPrescription(courseIds.owner, createBody),
    response: receipt,
  },
  {
    name: 'update',
    method: 'PUT',
    path: `${root}/${courseIds.legacy}`,
    body: updateBody,
    run: () =>
      service.updateMedicationPrescription(
        courseIds.owner,
        courseIds.legacy,
        updateBody
      ),
    response: receipt,
  },
  {
    name: 'delete',
    method: 'DELETE',
    path: `${root}/${courseIds.legacy}`,
    body: deleteBody,
    run: () =>
      service.deleteMedicationPrescription(
        courseIds.owner,
        courseIds.legacy,
        deleteBody
      ),
    response: { ...receipt, version: null, deleted: true },
  },
])(
  '$name binds expected owner and preserves exact operation/version/body, returning only the strict receipt',
  async ({ method, path, body, run, response }) => {
    request.mockResolvedValue(response);
    await expect(run()).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(path, {
      method,
      params: { expected_owner_id: courseIds.owner },
      body,
      suppressErrorToast: true,
    });
    expect(request.mock.calls[0]![1]!.body).toBe(body);
  }
);
it('preserves sparse update omission and explicit null clearing without a full replacement body', async () => {
  request.mockResolvedValue(receipt);
  const body = { ...deleteBody, pharmacy: null };
  await service.updateMedicationPrescription(
    courseIds.owner,
    courseIds.legacy,
    body
  );
  expect(request.mock.calls[0]![1]!.body).toEqual(body);
  expect(request.mock.calls[0]![1]!.body).not.toHaveProperty('prescriber');
  expect(request.mock.calls[0]![1]!.body).not.toHaveProperty('status');
  expect(request.mock.calls[0]![1]!.body).not.toHaveProperty('medication_id');
});
it('keeps exact create retry payload and operation identity rather than generating a new record attempt', async () => {
  request.mockResolvedValue(receipt);
  await service.createMedicationPrescription(courseIds.owner, createBody);
  await service.createMedicationPrescription(courseIds.owner, createBody);
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  expect(request.mock.calls[1]![1]!.body).toMatchObject({
    source: ' Example source ',
    cost: '0.0000',
    quantity: '0',
    operation_id: courseIds.step,
  });
});
it.each([
  { quantity: '1.5' },
  { quantity: '1day' },
  { refills_authorized: -1 },
  { lead_time_days: Infinity },
  { lead_time_days: 2147483648 },
  { cost: 'NaN' },
  { expiration: '2026-02-30' },
])('rejects invalid strict input %p before issuing a write', async (patch) => {
  await expect(
    service.createMedicationPrescription(courseIds.owner, {
      ...createBody,
      ...patch,
    })
  ).rejects.toBeInstanceOf(ZodError);
  expect(request).not.toHaveBeenCalled();
});
it.each([
  {
    name: 'list foreign owner',
    response: { prescriptions: [{ ...row(), user_id: courseIds.step }] },
    run: () => service.listMedicationPrescriptions(courseIds.owner),
  },
  {
    name: 'detail foreign owner',
    response: { prescription: { ...row(), user_id: courseIds.step } },
    run: () =>
      service.getMedicationPrescription(courseIds.owner, courseIds.legacy),
  },
  {
    name: 'detail wrong id',
    response: { prescription: { ...row(), id: courseIds.step } },
    run: () =>
      service.getMedicationPrescription(courseIds.owner, courseIds.legacy),
  },
  {
    name: 'update wrong receipt id',
    response: { ...receipt, id: courseIds.step },
    run: () =>
      service.updateMedicationPrescription(
        courseIds.owner,
        courseIds.legacy,
        updateBody
      ),
  },
  {
    name: 'delete wrong receipt id',
    response: { ...receipt, id: courseIds.step },
    run: () =>
      service.deleteMedicationPrescription(
        courseIds.owner,
        courseIds.legacy,
        deleteBody
      ),
  },
])('fails closed for $name', async ({ response, run }) => {
  request.mockResolvedValue(response);
  await expect(run()).rejects.toThrow('does not match');
});
it.each([
  {
    name: 'private storage envelope',
    response: {
      prescriptions: [{ ...row(), encrypted_prescriber: 'not-public' }],
    },
    run: () => service.listMedicationPrescriptions(courseIds.owner),
  },
  {
    name: 'unwrapped detail',
    response: row(),
    run: () =>
      service.getMedicationPrescription(courseIds.owner, courseIds.legacy),
  },
  {
    name: 'empty mutation receipt',
    response: undefined,
    run: () =>
      service.createMedicationPrescription(courseIds.owner, createBody),
  },
  {
    name: 'fractional normalized counter',
    response: { prescriptions: [{ ...row(), quantity: 1.5 }] },
    run: () => service.listMedicationPrescriptions(courseIds.owner),
  },
])(
  'rejects $name using real shared response schemas',
  async ({ response, run }) => {
    request.mockResolvedValue(response);
    await expect(run()).rejects.toBeInstanceOf(ZodError);
  }
);
it('propagates stale CAS failure once without retry, version changes or a replacement operation', async () => {
  const conflict = Object.assign(new Error('Stale version'), { status: 409 });
  request.mockRejectedValue(conflict);
  await expect(
    service.updateMedicationPrescription(
      courseIds.owner,
      courseIds.legacy,
      updateBody
    )
  ).rejects.toBe(conflict);
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves only explicit per-vial basis input and keeps unrelated sparse updates unconfirmed', async () => {
  request.mockResolvedValue(receipt);
  const confirmed = {
    operation_id: courseIds.step,
    medication_id: courseIds.med,
    currency: 'GBP',
    cost: '0.0000',
    cost_basis: 'per_vial' as const,
  };
  await service.createMedicationPrescription(courseIds.owner, confirmed);
  expect(request.mock.calls[0]![1]!.body).toBe(confirmed);
  const unrelated = { ...deleteBody, prescriber: 'Example clinician' };
  await service.updateMedicationPrescription(
    courseIds.owner,
    courseIds.legacy,
    unrelated
  );
  expect(request.mock.calls[1]![1]!.body).toBe(unrelated);
  expect(request.mock.calls[1]![1]!.body).not.toHaveProperty('cost_basis');
  expect(request.mock.calls[1]![1]!.body).not.toHaveProperty('cost');
});
it('accepts the optional confirmed basis response while retaining old unconfirmed marker omission', async () => {
  request.mockResolvedValueOnce({
    prescription: { ...row(), cost_basis: 'per_vial' },
  });
  await expect(
    service.getMedicationPrescription(courseIds.owner, courseIds.legacy)
  ).resolves.toEqual({ prescription: { ...row(), cost_basis: 'per_vial' } });
  request.mockResolvedValueOnce({ prescription: row() });
  expect(
    (await service.getMedicationPrescription(courseIds.owner, courseIds.legacy))
      .prescription
  ).not.toHaveProperty('cost_basis');
});
