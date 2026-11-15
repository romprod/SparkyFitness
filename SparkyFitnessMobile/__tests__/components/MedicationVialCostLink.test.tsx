import { fireEvent, render } from '@testing-library/react-native';
import type { MedicationVialCost } from '@workspace/shared';
import MedicationVialCostLink from '../../src/components/medications/MedicationVialCostLink';
let mockOwner: string | null = 'owner',
  mockError = false;
let mockCosts: MedicationVialCost[] = [];
const mockQuery = jest.fn();
jest.mock('../../src/hooks/useMedicationPurchases', () => ({
  useMedicationCostsAccess: () => ({
    ownerId: mockOwner,
    isCurrent: () => !!mockOwner,
  }),
  useMedicationVialCosts: (owner: string | null) => {
    mockQuery(owner);
    return { data: { vials: mockCosts }, isLoading: false, isError: mockError };
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'owner';
  mockError = false;
  mockCosts = [];
});
test('known zero cost links its invoice and is distinct from an uncosted vial', () => {
  mockCosts = [
    {
      pen_id: 'vial',
      is_costed: true,
      purchase_id: 'invoice',
      currency: 'AUD',
      landed_unit: '0',
    },
  ];
  const open = jest.fn();
  const view = render(<MedicationVialCostLink vialId="vial" onOpen={open} />);
  fireEvent.press(view.getByText('Invoice · AUD 0.00 per vial'));
  expect(open).toHaveBeenCalledWith('invoice');
  view.unmount();
  mockCosts = [{ pen_id: 'vial', is_costed: false }];
  const other = render(<MedicationVialCostLink vialId="vial" onOpen={open} />);
  expect(other.getByText('Uncosted · view Costs')).toBeTruthy();
  expect(other.queryByText(/0.00/)).toBeNull();
});
test('read error does not mislabel a vial as uncosted', () => {
  mockError = true;
  const view = render(
    <MedicationVialCostLink vialId="vial" onOpen={jest.fn()} />
  );
  expect(view.getByText('Invoice cost unavailable')).toBeTruthy();
  expect(view.queryByText(/Uncosted/)).toBeNull();
});
test('foreign scope hides cached cost and disables the financial query', () => {
  mockOwner = null;
  mockCosts = [
    {
      pen_id: 'vial',
      is_costed: true,
      purchase_id: 'invoice',
      currency: 'AUD',
      landed_unit: '123',
    },
  ];
  const view = render(
    <MedicationVialCostLink vialId="vial" onOpen={jest.fn()} />
  );
  expect(view.toJSON()).toBeNull();
  expect(mockQuery).toHaveBeenCalledWith(null);
});
