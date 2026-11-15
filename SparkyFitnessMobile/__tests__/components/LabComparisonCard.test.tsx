import { fireEvent, render } from '@testing-library/react-native';
import {
  buildLabComparison,
  type LabComparisonPanel,
  type LabComparisonResult,
  type LabMarkerResponse,
} from '@workspace/shared';
import LabComparisonCard from '../../src/components/labs/LabComparisonCard';

const mockRefetch = jest.fn();
let mockState: {
  comparison: ReturnType<typeof buildLabComparison>;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
};
jest.mock('../../src/hooks/useLabResults', () => ({
  useLabComparison: () => mockState,
}));
jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));
const marker: LabMarkerResponse = {
  id: 'example-marker',
  name: 'Example analyte',
  unit: 'mg/L',
  ref_range_low: 0,
  ref_range_high: 5,
  user_id: 'example-user',
  created_at: '',
  updated_at: '',
};
const result = (
  id: string,
  value: number,
  overrides: Partial<LabComparisonResult> = {}
): LabComparisonResult => ({
  id,
  marker_key: null,
  custom_marker_id: marker.id,
  entry_date: '2026-01-30',
  value_numeric: value,
  value_text: null,
  unit: 'mg/L',
  ref_range_low: 0,
  ref_range_high: 5,
  ...overrides,
});
const panel = (
  id: string,
  date: string | null,
  results: LabComparisonResult[]
): LabComparisonPanel => ({
  id,
  collected_on: date,
  lab_name: null,
  created_at: `${date ?? '2026-01-30'}T12:00:00Z`,
  results,
});
const setPanels = (panels: LabComparisonPanel[]) => {
  mockState.comparison = buildLabComparison(panels, [marker]);
};
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    comparison: { panels: [], rows: [] },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  };
});

test('shows a latest-report matrix with per-cell units and shared closer-to-range indicator', () => {
  setPanels([
    panel('prior', '2026-01-20', [result('old', 8)]),
    panel('latest', '2026-01-30', [result('new', 4)]),
  ]);
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Latest three panels')).toBeTruthy();
  expect(view.getByText('Example analyte')).toBeTruthy();
  expect(view.getByText('4 mg/L')).toBeTruthy();
  expect(view.getByText('8 mg/L')).toBeTruthy();
  expect(
    view.getByLabelText('Closer to reference range than prior panel')
  ).toBeTruthy();
  expect(view.getByText('High')).toBeTruthy();
});
test('preserves qualified raw text and heterogeneous units without fabricating a trend', () => {
  setPanels([
    panel('latest', '2026-01-30', [result('new', 3, { value_text: '<3' })]),
    panel('prior', '2026-01-20', [result('old', 8, { unit: 'mmol/L' })]),
  ]);
  const view = render(<LabComparisonCard />);
  expect(view.getByText('<3 mg/L')).toBeTruthy();
  expect(view.getByText('8 mmol/L')).toBeTruthy();
  expect(
    view.queryByLabelText('Closer to reference range than prior panel')
  ).toBeNull();
});
test('keeps collection dates distinct from edited result dates and unknown collection dates', () => {
  setPanels([
    panel('known', '2026-01-30', [
      result('edited-day', 4, { entry_date: '2026-01-31' }),
    ]),
    panel('unknown', null, [result('unknown-day', 5)]),
  ]);
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Collection date not recorded')).toBeTruthy();
  expect(view.getAllByText(/^Result date:/)).toHaveLength(2);
});
test('keeps an honest comparison empty state discoverable without saved panels', () => {
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Latest three panels')).toBeTruthy();
  expect(view.getByText('No lab panels available to compare.')).toBeTruthy();
});
test('exposes loading and failure states and retries only the comparison request', () => {
  mockState.isLoading = true;
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Loading panel comparison…')).toBeTruthy();
  mockState.isLoading = false;
  mockState.isError = true;
  view.rerender(<LabComparisonCard />);
  expect(view.getByText('Could not load the panel comparison.')).toBeTruthy();
  fireEvent.press(view.getByText('Retry'));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

test('shows historical reference metadata only when its effective range differs', () => {
  setPanels([
    panel('latest', '2026-01-30', [result('new', 4)]),
    panel('prior', '2026-01-20', [result('old', 8, { ref_range_high: 10 })]),
  ]);
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Reference: 0 - 10 mg/L')).toBeTruthy();
  expect(view.queryByText('Reference: 0 - 5 mg/L')).toBeNull();
  expect(
    view.getByLabelText('8 mg/L; reference range 0 - 10 mg/L')
  ).toBeTruthy();
});

test('makes an unavailable historical range visible and does not borrow latest bounds across units', () => {
  setPanels([
    panel('latest', '2026-01-30', [result('new', 4)]),
    panel('prior', '2026-01-20', [
      result('old', 8, {
        unit: 'mmol/L',
        ref_range_low: null,
        ref_range_high: null,
      }),
    ]),
  ]);
  const view = render(<LabComparisonCard />);
  expect(view.getByText('Range unavailable')).toBeTruthy();
  expect(view.getByText('8 mmol/L')).toBeTruthy();
});
