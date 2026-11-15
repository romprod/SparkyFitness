import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { MedicationPurchaseView } from '@workspace/shared';
import MedicationCostsScreen from '../../src/screens/MedicationCostsScreen';
import { ApiError } from '../../src/services/api/errors';
import type { RootStackScreenProps } from '../../src/types/navigation';
let mockOwner: string | null = 'owner',
  mockCurrent = true;
let mockRows: MedicationPurchaseView[] = [];
const mockRemove = jest.fn();
const mockAnalytics = jest.fn();
const mockLedgerQuery = jest.fn();
jest.mock('../../src/hooks/useMedicationPurchases', () => ({
  useMedicationCostsAccess: () => ({
    ownerId: mockOwner,
    scopeKey: 'scope',
    isCurrent: () => mockCurrent,
    isLoading: false,
    isError: false,
  }),
  useMedicationCostAnalytics: (owner: string, window: string) => {
    mockAnalytics(owner, window);
    return {
      data: {
        window: { key: window, from_date: '2026-01-01', to_date: '2026-11-15' },
        rows: [],
      },
      isFetching: false,
      isError: false,
    };
  },
  useMedicationPurchases: (...args: unknown[]) => {
    mockLedgerQuery(...args);
    return {
      data: { purchases: mockRows },
      isLoading: false,
      isError: false,
    };
  },
  useMedicationPurchaseMutations: () => ({
    remove: { mutate: mockRemove, isPending: false },
  }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
const purchase = (currency: string, total: string): MedicationPurchaseView => ({
  id: currency,
  revision: 3,
  created_at: '',
  vendor: 'Synthetic supplier',
  reference: 'same reference allowed',
  ordered_date: '2026-11-15',
  received_date: null,
  currency,
  shipping_cost: '0',
  tax_cost: '0',
  other_fees: '0',
  discount: '0',
  allocation_method: 'value',
  notes: null,
  items: [],
  totals: {
    lines: [],
    subtotal: total,
    overhead: '0',
    total,
    unallocated: '0',
    effective_method: 'value',
  },
  vials_expected: 1,
  vials_linked: 0,
});
const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as RootStackScreenProps<'MedicationCosts'>['navigation'];
const setup = () =>
  render(
    <MedicationCostsScreen
      navigation={navigation}
      route={{ key: 'costs', name: 'MedicationCosts', params: undefined }}
    />
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'owner';
  mockCurrent = true;
  mockRows = [];
});
test('ledger displays each invoice currency independently, including literal non-ISO currency', () => {
  mockRows = [
    purchase('AUD', '1.21'),
    purchase('USD', '2.34'),
    purchase('Credits', '5'),
  ];
  const view = setup();
  expect(view.getByText('AUD 1.21')).toBeTruthy();
  expect(view.getByText('USD 2.34')).toBeTruthy();
  expect(view.getByText('Credits 5.00')).toBeTruthy();
  expect(view.queryByText(/Grand total/)).toBeNull();
  fireEvent.press(view.getAllByText('Edit')[1]!);
  expect(navigation.navigate).toHaveBeenCalledWith('MedicationPurchaseForm', {
    purchaseId: 'USD',
  });
});
test('empty ledger opens consumable-capable invoice modal without needing a medication', () => {
  const view = setup();
  expect(view.getByText('No invoices yet')).toBeTruthy();
  fireEvent.press(view.getByText('Add invoice'));
  expect(navigation.navigate).toHaveBeenCalledWith(
    'MedicationPurchaseForm',
    {}
  );
});
test('delete binds the confirmed owner and revision and a409 requires checking refreshed data', () => {
  mockRows = [purchase('AUD', '0')];
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = setup();
  fireEvent.press(view.getByText('Delete'));
  expect(alert.mock.calls[0]![1]).toMatch(/vials and dose history are kept/);
  act(() => alert.mock.calls[0]![2]![1]!.onPress!());
  expect(mockRemove.mock.calls[0][0]).toEqual({
    id: 'AUD',
    body: { expected_owner_id: 'owner', expected_revision: 3 },
  });
  act(() => {
    mockRemove.mock.calls[0][1].onError(new ApiError('stale', 409));
    mockRemove.mock.calls[0][1].onSettled();
  });
  expect(view.getByText(/^This invoice changed/)).toBeTruthy();
  alert.mockRestore();
});
test('account change after delete confirmation prevents the old financial action', () => {
  mockRows = [purchase('AUD', '1')];
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = setup();
  fireEvent.press(view.getByText('Delete'));
  mockCurrent = false;
  act(() => alert.mock.calls[0]![2]![1]!.onPress!());
  expect(mockRemove).not.toHaveBeenCalled();
  alert.mockRestore();
});
test('foreign context never renders cached financial rows or Add invoice', () => {
  mockOwner = null;
  mockRows = [purchase('AUD', '123.45')];
  const view = setup();
  expect(view.queryByText('AUD 123.45')).toBeNull();
  expect(view.queryByText('Add invoice')).toBeNull();
  expect(
    view.getByText('Costs are available only for your own account.')
  ).toBeTruthy();
});

test('report window changes leave the invoice ledger unfiltered', () => {
  mockRows = [purchase('AUD', '1.21')];
  const view = setup();
  expect(mockAnalytics).toHaveBeenLastCalledWith('owner', '12');
  fireEvent.press(view.getByText('3 months'));
  expect(mockAnalytics).toHaveBeenLastCalledWith('owner', '3');
  expect(view.getByText('AUD 1.21')).toBeTruthy();
  expect(
    mockLedgerQuery.mock.calls.every(
      (call) => call.length === 1 && call[0] === 'owner'
    )
  ).toBe(true);
});
