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
          unit_cost: '0',
          cost_source: 'invoice',
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

it('says a price is a share of a prescription total rather than a per-vial price', () => {
  mockCosts.mockReturnValue({
    data: {
      cost_basis: 'with_prescription_estimates',
      vials: [
        {
          pen_id: 'vial',
          is_costed: true,
          cost_source: 'prescription',
          unit_cost: '30',
          currency: 'GBP',
          purchase_id: null,
          prescription_id: 'rx',
          estimate_basis: 'per_prescription',
        },
      ],
    },
  });
  render(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link')).toHaveTextContent(
    'GBP 30.00 · Share of a prescription total · no shipping'
  );
});

it('shows a confirmed zero prescription estimate without an invoice and never fabricates currency', () => {
  mockCosts.mockReturnValue({
    data: {
      cost_basis: 'with_prescription_estimates',
      vials: [
        {
          pen_id: 'vial',
          is_costed: true,
          cost_source: 'prescription',
          unit_cost: '0',
          currency: 'GBP',
          purchase_id: null,
          prescription_id: 'rx',
          estimate_basis: 'per_vial',
        },
      ],
    },
  });
  const view = render(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link')).toHaveTextContent(
    'GBP 0.00 · Prescription estimate · no shipping'
  );
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    '/medications?tab=costs'
  );
  mockCosts.mockReturnValue({
    data: {
      cost_basis: 'with_prescription_estimates',
      vials: [
        {
          pen_id: 'vial',
          is_costed: true,
          cost_source: 'invoice',
          unit_cost: '-2',
          currency: null,
          purchase_id: 'invoice',
        },
      ],
    },
  });
  view.rerender(
    <MemoryRouter>
      <MedicationVialCostLink penId="vial" />
    </MemoryRouter>
  );
  expect(screen.getByRole('link')).toHaveTextContent(
    'Currency unavailable · Invoice'
  );
  expect(screen.getByRole('link')).not.toHaveTextContent(
    'Prescription estimate'
  );
  expect(screen.getByRole('link')).not.toHaveTextContent('AUD');
});
