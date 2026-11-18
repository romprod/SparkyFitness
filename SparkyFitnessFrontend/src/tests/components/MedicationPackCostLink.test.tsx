import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import type { MedicationPackCost } from '@workspace/shared';
import MedicationPackCostLink from '@/pages/Medications/MedicationPackCostLink';

let mockCosts: { data?: { packs: MedicationPackCost[] }; isError: boolean } = {
  isError: false,
};
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationPurchaseScope: () => ({
    ready: true,
    ownerId: 'owner',
    generation: 1,
  }),
  useMedicationPackCosts: () => mockCosts,
}));

const renderLink = (unitsUsed = '12') =>
  render(
    <MemoryRouter>
      <MedicationPackCostLink
        packId="pack-1"
        unitsTotal="60"
        unitsUsed={unitsUsed}
      />
    </MemoryRouter>
  );

it('shows the invoice cost per unit and for the units used, from the live pack', () => {
  mockCosts = {
    isError: false,
    data: {
      packs: [
        {
          pack_id: 'pack-1',
          is_costed: true,
          purchase_id: 'inv 1',
          currency: 'GBP',
          landed_pack: '33',
        },
      ],
    },
  };
  const { rerender } = renderLink('12');
  const link = screen.getByRole('link');
  expect(link).toHaveTextContent('GBP 0.550 each · GBP 6.60 used · Invoice');
  expect(link).toHaveAttribute(
    'href',
    '/medications?tab=costs&purchase=inv%201'
  );
  rerender(
    <MemoryRouter>
      <MedicationPackCostLink packId="pack-1" unitsTotal="60" unitsUsed="14" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link')).toHaveTextContent('GBP 7.70 used');
});

it('says uncosted for a pack with no invoice and renders nothing without data', () => {
  mockCosts = {
    isError: false,
    data: { packs: [{ pack_id: 'pack-1', is_costed: false }] },
  };
  const { unmount } = renderLink();
  expect(screen.getByRole('link')).toHaveTextContent('Uncosted');
  unmount();
  mockCosts = { isError: false };
  renderLink();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  mockCosts = { isError: true, data: { packs: [] } };
});
