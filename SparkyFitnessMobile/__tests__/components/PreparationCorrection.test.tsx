import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type {
  MedicationPen,
  MedicationPreparationReview,
} from '@workspace/shared';
import PreparationCorrection from '../../src/components/glp1/PreparationCorrection';
import { ApiError } from '../../src/services/api/errors';

const mockReview = jest.fn();
const mockCorrect = jest.fn();
jest.mock('../../src/hooks/usePreparationCorrection', () => ({
  usePreparationReview: () => ({ mutate: mockReview, isPending: false }),
  usePreparationCorrection: () => ({ mutate: mockCorrect, isPending: false }),
}));
jest.mock('../../src/utils/ids', () => ({
  newUuid: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
}));
jest.mock('../../src/components/glp1/PreparationFields', () => ({
  ...jest.requireActual('../../src/components/glp1/PreparationFields'),
  __esModule: true,
  default: () => null,
}));
const pen = {
  id: 'vial',
  preparation: {
    id: 'prep',
    revision: 3,
    mode: 'premixed',
    mass_value: 2,
    mass_unit: 'mg',
    mass_mg: 2,
    concentration_mg_ml: 1,
    final_volume_ml: 2,
    prepared_date: '2026-11-15',
    created_at: '',
    exact: {
      mass_value: '2.000000000000000002',
      mass_mg: '2.000000000000000002',
      concentration_mg_ml: '1.000000000000000001',
      final_volume_ml: '2',
    },
  },
} as MedicationPen;
const review: MedicationPreparationReview = {
  expected_revision: 3,
  review_hash: 'hash',
  before: {
    concentration_mg_ml: '1',
    final_volume_ml: '2',
    remaining_mg: '1',
    remaining_ml: '1',
  },
  after: {
    concentration_mg_ml: '2',
    final_volume_ml: '2',
    remaining_mg: '2',
    remaining_ml: '1',
  },
  affected_dose_count: 2,
  overdrawn_mg: null,
  overdraw_warning: false,
  stock_unknown: false,
  can_confirm: true,
  blocking_reason: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockReview.mockImplementation((_input, callbacks) =>
    callbacks.onSuccess(review)
  );
});
function setup() {
  const close = jest.fn();
  const view = render(<PreparationCorrection pen={pen} onClose={close} />);
  fireEvent.press(view.getByText('Next'));
  fireEvent.press(view.getByText('Review preparation'));
  return { view, close };
}
test('review seeds exact saved inputs and confirm binds revision, hash and operation without dose writes', () => {
  const { view } = setup();
  expect(mockReview.mock.calls[0][0]).toEqual({
    expected_revision: 3,
    preparation: {
      mode: 'premixed',
      label_concentration_value: '1.000000000000000001',
      label_concentration_unit: 'mg/ml',
      final_volume_ml: '2',
      prepared_date: '2026-11-15',
      diluent: null,
    },
  });
  fireEvent.press(view.getByText('Confirm preparation correction'));
  expect(mockCorrect.mock.calls[0][0]).toEqual({
    ...mockReview.mock.calls[0][0],
    review_hash: 'hash',
    operation_id: expect.any(String),
  });
});
test('incomplete physical history blocks confirm but overdraw remains a warning', () => {
  mockReview.mockImplementation((_input, callbacks) =>
    callbacks.onSuccess({
      ...review,
      can_confirm: false,
      blocking_reason: 'INCOMPLETE_PHYSICAL_HISTORY',
    })
  );
  const first = setup();
  fireEvent.press(first.view.getByText('Confirm preparation correction'));
  expect(mockCorrect).not.toHaveBeenCalled();
  first.view.unmount();
  mockReview.mockImplementation((_input, callbacks) =>
    callbacks.onSuccess({
      ...review,
      overdraw_warning: true,
      overdrawn_mg: '1',
    })
  );
  const second = setup();
  expect(
    second.view.getByText('Logged use exceeds the recorded vial content.')
  ).toBeTruthy();
  fireEvent.press(second.view.getByText('Confirm preparation correction'));
  expect(mockCorrect).toHaveBeenCalledTimes(1);
});
test('transient commit retry reuses its operation while stale review requires a fresh review', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { view, close } = setup();
  mockCorrect.mockImplementationOnce((_input, callbacks) => {
    callbacks.onError(new Error('offline'));
    callbacks.onSettled();
  });
  fireEvent.press(view.getByText('Confirm preparation correction'));
  const operation = mockCorrect.mock.calls[0][0].operation_id;
  view.rerender(
    <PreparationCorrection
      pen={{ ...pen, preparation: { ...pen.preparation!, revision: 4 } }}
      onClose={close}
    />
  );
  fireEvent.press(view.getByText('Confirm preparation correction'));
  expect(mockCorrect.mock.calls[1][0].operation_id).toBe(operation);
  act(() => {
    mockCorrect.mock.calls[1][1].onError(new ApiError('stale', 409));
    mockCorrect.mock.calls[1][1].onSettled();
  });
  expect(view.queryByText('Confirm preparation correction')).toBeNull();
  expect(view.getByText('Review preparation')).toBeTruthy();
  alert.mockRestore();
});
