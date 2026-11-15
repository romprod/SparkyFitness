import { Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { MedicationPen } from '@workspace/shared';
import PreparationCorrection from '../../src/components/glp1/PreparationCorrection';
import { apiFetch } from '../../src/services/api/apiClient';
import {
  createTestQueryClient,
  createQueryWrapper,
} from '../hooks/queryTestUtils';
jest.mock('../../src/services/api/apiClient', () => ({ apiFetch: jest.fn() }));
jest.mock('../../src/utils/ids', () => ({
  newUuid: () => '11111111-1111-4111-8111-111111111111',
}));
jest.mock('../../src/components/glp1/PreparationFields', () => ({
  ...jest.requireActual('../../src/components/glp1/PreparationFields'),
  __esModule: true,
  default: () => null,
}));

test('lost commit response followed by actual pen invalidation/refetch keeps the exact idempotent retry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const pen = {
    id: 'vial',
    preparation: {
      id: 'prep',
      revision: 3,
      mode: 'reconstituted',
      mass_value: 10,
      mass_unit: 'mg',
      mass_mg: 10,
      concentration_mg_ml: 5,
      final_volume_ml: 2,
      prepared_date: '2026-11-15',
      created_at: '',
    },
  } as MedicationPen;
  let serverPen = pen;
  const review = {
    expected_revision: 3,
    review_hash: 'hash',
    before: {
      concentration_mg_ml: '5',
      final_volume_ml: '2',
      remaining_mg: '5',
      remaining_ml: '1',
    },
    after: {
      concentration_mg_ml: '5',
      final_volume_ml: '2',
      remaining_mg: '5',
      remaining_ml: '1',
    },
    affected_dose_count: 1,
    overdrawn_mg: null,
    overdraw_warning: false,
    stock_unknown: false,
    can_confirm: true,
    blocking_reason: null,
  };
  const commits: unknown[] = [];
  const close = jest.fn();
  jest.mocked(apiFetch).mockImplementation(async (options) => {
    if (options.endpoint.endsWith('preparation-review')) return review;
    commits.push(options.body);
    if (commits.length === 1) {
      serverPen = { ...pen, preparation: { ...pen.preparation!, revision: 4 } };
      throw new Error('response lost');
    }
    return { correction_id: 'correction', revision: 4, review };
  });
  const client = createTestQueryClient();
  const key = ['medications', 'pens', 'vial'];
  const Host = () => {
    const { data } = useQuery({
      queryKey: key,
      queryFn: async () => serverPen,
      initialData: pen,
    });
    return <PreparationCorrection pen={data} onClose={close} />;
  };
  const view = render(<Host />, { wrapper: createQueryWrapper(client) });
  fireEvent.press(view.getByText('Next'));
  fireEvent.press(view.getByText('Review preparation'));
  await waitFor(() =>
    expect(view.getByText('Confirm preparation correction')).toBeTruthy()
  );
  fireEvent.press(view.getByText('Confirm preparation correction'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  await act(async () => {
    await client.invalidateQueries({ queryKey: key });
  });
  expect(client.getQueryData<MedicationPen>(key)?.preparation?.revision).toBe(
    4
  );
  fireEvent.press(view.getByText('Confirm preparation correction'));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(commits).toHaveLength(2);
  expect(commits[1]).toEqual(commits[0]);
  expect(commits[1]).toEqual(
    expect.objectContaining({
      expected_revision: 3,
      review_hash: 'hash',
      operation_id: expect.any(String),
    })
  );
  view.unmount();
  client.clear();
  alert.mockRestore();
});
