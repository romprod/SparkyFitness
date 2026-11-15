import { fireEvent, render } from '@testing-library/react-native';
import type {
  MedicationCostAnalytics,
  MedicationCostAnalyticsRow,
} from '@workspace/shared';
import MedicationCostReport from '../../src/components/medications/MedicationCostReport';
const mockQuery = jest.fn(),
  mockRefetch = jest.fn();
let mockFetching = false,
  mockError = false;
let mockData: MedicationCostAnalytics;
jest.mock('../../src/hooks/useMedicationPurchases', () => ({
  useMedicationCostAnalytics: (owner: string, window: string) => {
    mockQuery(owner, window);
    return {
      data: mockData,
      isFetching: mockFetching,
      isError: mockError,
      refetch: mockRefetch,
    };
  },
}));
const row = (
  patch: Partial<MedicationCostAnalyticsRow> = {}
): MedicationCostAnalyticsRow => ({
  medication_id: 'medication',
  medication_name: 'Example medication',
  spend: '9007199254740993.125',
  spend_currency: 'AUD',
  spend_present: true,
  spend_mixed_currency: false,
  cost_per_dose: '0.1234567890123456789',
  cost_per_mg: '-1.234567890123456789',
  usage_currency: 'USD',
  usage_mixed_currency: false,
  costed_doses: 2,
  uncosted_doses: 1,
  ...patch,
});
const report = (
  rows: MedicationCostAnalyticsRow[],
  key: MedicationCostAnalytics['window']['key'] = '12'
): MedicationCostAnalytics => ({
  window: { key, from_date: '2026-01-01', to_date: '2026-11-15' },
  rows,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockFetching = false;
  mockError = false;
  mockData = report([row()]);
});
test('default12-month report renders exact spend and source rates with separate spend/usage currencies', () => {
  const view = render(<MedicationCostReport ownerId="owner" />);
  expect(mockQuery).toHaveBeenLastCalledWith('owner', '12');
  expect(view.getByText('Example medication')).toBeTruthy();
  expect(view.getByText('AUD 9007199254740993.13')).toBeTruthy();
  expect(view.getByText('USD 0.123')).toBeTruthy();
  expect(view.getByText('USD -1.23')).toBeTruthy();
  expect(view.getByText('2 costed doses · 1 uncosted')).toBeTruthy();
  expect(
    view.getByText(/Rates use current invoice prices and vial label amounts/)
  ).toBeTruthy();
});
test('unknown spend/rates remain unavailable while known zero and negative values remain monetary values', () => {
  mockData = report([
    row({
      spend: null,
      spend_present: false,
      spend_currency: null,
      cost_per_dose: null,
      cost_per_mg: null,
      usage_currency: null,
    }),
  ]);
  const view = render(<MedicationCostReport ownerId="owner" />);
  expect(view.getAllByText('—')).toHaveLength(3);
  mockData = report([
    row({
      spend: '0',
      cost_per_dose: '0',
      cost_per_mg: '-0.5',
      spend_currency: 'Credits',
      usage_currency: 'Credits',
    }),
  ]);
  view.rerender(<MedicationCostReport ownerId="owner" />);
  expect(view.getAllByText('Credits 0.00')).toHaveLength(2);
  expect(view.getByText('Credits -0.500')).toBeTruthy();
  expect(view.queryByText('—')).toBeNull();
});
test('mixed spend suppresses only spend and mixed usage suppresses only rates, preserving counts', () => {
  mockData = report([row({ spend_mixed_currency: true })]);
  const view = render(<MedicationCostReport ownerId="owner" />);
  expect(view.getByText('—')).toBeTruthy();
  expect(view.getByText('USD 0.123')).toBeTruthy();
  expect(view.getByText(/^Spend is unavailable/)).toBeTruthy();
  expect(view.queryByText(/^Dose and mg rates are unavailable/)).toBeNull();
  mockData = report([row({ usage_mixed_currency: true, spend: '0' })]);
  view.rerender(<MedicationCostReport ownerId="owner" />);
  expect(view.getByText('AUD 0.00')).toBeTruthy();
  expect(view.getAllByText('—')).toHaveLength(2);
  expect(view.getByText(/^Dose and mg rates are unavailable/)).toBeTruthy();
  expect(view.getByText('2 costed doses · 1 uncosted')).toBeTruthy();
  expect(view.queryByText(/^Spend is unavailable/)).toBeNull();
});
test('changing window never shows cached old-window rows, and pending/error states remove stale values', () => {
  const view = render(<MedicationCostReport ownerId="owner" />);
  fireEvent.press(view.getByText('3 months'));
  expect(mockQuery).toHaveBeenLastCalledWith('owner', '3');
  expect(view.queryByText('Example medication')).toBeNull();
  expect(view.getByText('Loading medication cost report…')).toBeTruthy();
  mockData = report(
    [row({ medication_name: 'Current window medication' })],
    '3'
  );
  view.rerender(<MedicationCostReport ownerId="owner" />);
  expect(view.getByText('Current window medication')).toBeTruthy();
  mockFetching = true;
  view.rerender(<MedicationCostReport ownerId="owner" />);
  expect(view.queryByText('Current window medication')).toBeNull();
  mockFetching = false;
  mockError = true;
  view.rerender(<MedicationCostReport ownerId="owner" />);
  expect(view.queryByText('AUD 9007199254740993.13')).toBeNull();
  fireEvent.press(view.getByText('Retry'));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
test('empty window is an honest report state', () => {
  mockData = report([]);
  const view = render(<MedicationCostReport ownerId="owner" />);
  expect(
    view.getByText('Nothing bought or dosed in this window.')
  ).toBeTruthy();
});
