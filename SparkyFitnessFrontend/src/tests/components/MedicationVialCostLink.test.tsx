import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import MedicationVialCostLink from '@/pages/Medications/MedicationVialCostLink';
let mockReady = true;
const mockCosts = jest.fn();
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationPurchaseScope: () => ({ ready: mockReady, ownerId: 'owner' }),
  useMedicationVialCosts: () => mockCosts(),
}));
beforeEach(() => {
  mockReady = true;
  mockCosts.mockReset();
});
it('distinguishes a recorded zero-cost vial from uncosted stock', () => {
  mockCosts.mockReturnValue({
    data: {
      vials: [
        {
          pen_id: 'vial',
          is_costed: true,
          purchase_id: 'invoice',
          currency: 'AUD',
          landed_unit: '0',
        },
      ],
    },
  });
  const { rerender } = render(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: /AUD 0\.00/ })).toHaveAttribute(
    'href',
    '/medications?tab=costs&purchase=invoice'
  );
  mockCosts.mockReturnValue({ data: { vials: [] } });
  rerender(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: 'Uncosted' })).toHaveAttribute(
    'href',
    '/medications?tab=costs'
  );
});
it('never requests private vial cost data for a delegated context', () => {
  mockReady = false;
  render(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(mockCosts).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
