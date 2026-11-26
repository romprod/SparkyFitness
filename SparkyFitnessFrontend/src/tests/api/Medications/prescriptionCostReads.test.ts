import { ZodError } from 'zod';
import type {
  MedicationPrescriptionCostAnalytics,
  MedicationPrescriptionVialCosts,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import {
  getMedicationCostAnalytics,
  getMedicationVialCosts,
  getMedicationCostAnalyticsWithPrescriptionEstimates,
  getMedicationVialCostsWithPrescriptionEstimates,
} from '@/api/Medications/purchaseService';
import { emptyCostBreakdown } from '@/tests/fixtures/medicationCostBreakdown';
import { courseIds } from '@/tests/fixtures/medicationCourses';
jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
const report = (): MedicationPrescriptionCostAnalytics => ({
  ...emptyCostBreakdown,
  waste: { ...emptyCostBreakdown.waste, rows: [] },
  window: { key: '12', from_date: '2025-11-17', to_date: '2026-11-17' },
  cost_basis: 'with_prescription_estimates',
  accounted: [
    {
      currency: 'GBP',
      invoice_cash: '0',
      prescription_estimate: '0',
      accounted_total: '0',
      estimated_vials: 1,
      undated_vials: 1,
    },
  ],
  rows: [],
});
const vials = (): MedicationPrescriptionVialCosts => ({
  cost_basis: 'with_prescription_estimates',
  vials: [
    {
      pen_id: courseIds.rule,
      is_costed: true,
      cost_source: 'prescription',
      unit_cost: '0.0000',
      currency: 'NZD',
      purchase_id: null,
      purchase_item_id: null,
      prescription_id: courseIds.legacy,
      estimate_basis: 'per_vial',
      prescription_date_written: null,
    },
    {
      pen_id: courseIds.step,
      is_costed: true,
      cost_source: 'invoice',
      unit_cost: '-2.25',
      currency: 'GBP',
      purchase_id: courseIds.course,
      purchase_item_id: courseIds.revision,
      prescription_id: null,
      estimate_basis: null,
      prescription_date_written: null,
    },
  ],
});
beforeEach(() => request.mockReset());
it('opts analytics into the expanded owner/window contract on the existing canonical endpoint with signal', async () => {
  const result = report(),
    signal = new AbortController().signal;
  request.mockResolvedValue(result);
  await expect(
    getMedicationCostAnalyticsWithPrescriptionEstimates(
      courseIds.owner,
      '12',
      signal
    )
  ).resolves.toEqual(result);
  expect(request).toHaveBeenCalledWith('/v2/medication-purchases/analytics', {
    method: 'GET',
    params: {
      expected_owner_id: courseIds.owner,
      window: '12',
      cost_basis: 'with_prescription_estimates',
    },
    signal,
    suppressErrorToast: true,
  });
});
it('opts vial prices in and preserves known free estimates, invoice credits, currency and exact selected provenance', async () => {
  const result = vials(),
    signal = new AbortController().signal;
  request.mockResolvedValue(result);
  await expect(
    getMedicationVialCostsWithPrescriptionEstimates(courseIds.owner, signal)
  ).resolves.toEqual(result);
  expect(request).toHaveBeenCalledWith('/v2/medication-purchases/vial-costs', {
    method: 'GET',
    // Lets a share of a prescription total say so instead of reading as a per-vial price.
    headers: { 'X-Prescription-Model-Version': '2' },
    params: {
      expected_owner_id: courseIds.owner,
      cost_basis: 'with_prescription_estimates',
    },
    signal,
    suppressErrorToast: true,
  });
});
it.each(['missing', 'invoice_only'] as const)(
  'rejects analytics with %s mode echo without an old invoice-only retry',
  async (mode) => {
    const { cost_basis: _mode, accounted: _accounted, ...legacy } = report();
    request.mockResolvedValue(
      mode === 'missing' ? legacy : { ...report(), cost_basis: mode }
    );
    await expect(
      getMedicationCostAnalyticsWithPrescriptionEstimates(courseIds.owner, '12')
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it.each(['missing', 'invoice_only'] as const)(
  'rejects vial reads with %s mode echo without a fallback',
  async (mode) => {
    request.mockResolvedValue(
      mode === 'missing' ? { vials: [] } : { ...vials(), cost_basis: mode }
    );
    await expect(
      getMedicationVialCostsWithPrescriptionEstimates(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it('keeps the existing default service calls invoice-only with no new opt-in parameter', async () => {
  const { cost_basis: _mode, accounted: _accounted, ...legacy } = report();
  request.mockResolvedValueOnce(legacy).mockResolvedValueOnce({ vials: [] });
  await expect(
    getMedicationCostAnalytics(courseIds.owner, '12')
  ).resolves.toEqual(legacy);
  await expect(getMedicationVialCosts(courseIds.owner)).resolves.toEqual({
    vials: [],
  });
  expect(request.mock.calls[0]![1]!.params).toEqual({
    expected_owner_id: courseIds.owner,
    window: '12',
  });
  expect(request.mock.calls[1]![1]!.params).toEqual({
    expected_owner_id: courseIds.owner,
  });
});
it('rejects inconsistent double-source vial provenance rather than combining invoice and prescription prices', async () => {
  const result = vials();
  result.vials[0]!.purchase_id = courseIds.course;
  request.mockResolvedValue(result);
  await expect(
    getMedicationVialCostsWithPrescriptionEstimates(courseIds.owner)
  ).rejects.toBeInstanceOf(ZodError);
});
it('requires accounted buckets in opted analytics rather than inventing cash or estimates', async () => {
  request.mockResolvedValue({ ...report(), accounted: undefined });
  await expect(
    getMedicationCostAnalyticsWithPrescriptionEstimates(courseIds.owner, '12')
  ).rejects.toBeInstanceOf(ZodError);
});
it('retains unknown vial value/provenance as null rather than free', async () => {
  const result: MedicationPrescriptionVialCosts = {
    cost_basis: 'with_prescription_estimates',
    vials: [
      {
        pen_id: courseIds.step,
        is_costed: false,
        cost_source: null,
        unit_cost: null,
        currency: null,
        purchase_id: null,
        purchase_item_id: null,
        prescription_id: null,
        estimate_basis: null,
        prescription_date_written: null,
      },
    ],
  };
  request.mockResolvedValue(result);
  await expect(
    getMedicationVialCostsWithPrescriptionEstimates(courseIds.owner)
  ).resolves.toEqual(result);
});
it('propagates unavailable-mode errors without retrying another request shape', async () => {
  const error = Object.assign(new Error('Mode unavailable'), { status: 400 });
  request.mockRejectedValue(error);
  await expect(
    getMedicationCostAnalyticsWithPrescriptionEstimates(courseIds.owner, '12')
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});
it('reads a share of a prescription total as such', async () => {
  const result = vials();
  result.vials[0] = {
    ...result.vials[0]!,
    unit_cost: '33.333333333333333333333333333333333333333',
    estimate_basis: 'per_prescription',
  };
  request.mockResolvedValue(result);
  await expect(
    getMedicationVialCostsWithPrescriptionEstimates(courseIds.owner)
  ).resolves.toEqual(result);
});
