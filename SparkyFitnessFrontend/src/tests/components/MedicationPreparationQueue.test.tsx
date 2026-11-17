import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationPreparationQueue, {
  MedicationPreparationQueueEntry,
} from '@/pages/Medications/MedicationPreparationQueue';
import {
  dashboardFixture,
  dashboardPen,
  queueItem,
} from '@/tests/fixtures/medicationInventoryDashboard';
import { courseMedication } from '@/tests/fixtures/medicationCourses';
import type { ComponentProps } from 'react';
import type MedicationPreparationWizard from '@/pages/Medications/MedicationPreparationWizard';
let mockDashboard = dashboardFixture();
let mockReady = true,
  mockWrite = true,
  mockCurrent = true,
  mockError = false,
  mockFresh = true,
  mockFetching = false,
  mockStockError = false;
let mockStock = { row: queueItem(), pen: dashboardPen() };
const mockStockQuery = jest.fn();
const mockWizard = jest.fn();
const mockRefetch = jest.fn();
const mockScope = () => ({
  ready: mockReady,
  canWrite: mockWrite,
  key: 'actor:profile:generation',
  isCurrent: () => mockCurrent,
});
jest.mock('@/hooks/Medications/useMedicationStockDashboard', () => ({
  useMedicationStockDashboard: () => ({
    scope: mockScope(),
    data: mockDashboard,
    query: { isError: mockError, refetch: mockRefetch },
  }),
  usePreparationQueueStock: (...args: unknown[]) => {
    mockStockQuery(...args);
    return {
      scope: mockScope(),
      data: mockStock,
      query: {
        isError: mockStockError,
        isFetching: mockFetching,
        isFetchedAfterMount: mockFresh,
        refetch: mockRefetch,
      },
    };
  },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `Formatted ${day}` }),
}));
jest.mock('@/pages/Medications/MedicationPreparationWizard', () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof MedicationPreparationWizard>) => {
    mockWizard(props);
    return (
      <div data-testid="inline-wizard">
        <button onClick={props.onClose}>Close inline preparation</button>
      </div>
    );
  },
}));
const meds = [{ ...courseMedication, type_id: 'injection' }];
beforeEach(() => {
  mockDashboard = dashboardFixture();
  mockReady = true;
  mockWrite = true;
  mockCurrent = true;
  mockError = false;
  mockFresh = true;
  mockFetching = false;
  mockStockError = false;
  mockStock = { row: queueItem(), pen: dashboardPen() };
  mockStockQuery.mockClear();
  mockWizard.mockClear();
  mockRefetch.mockClear();
});
function expand() {
  const details = screen.getByText(/^Prepare ›$/).closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  return details;
}
it('keeps eligible records closed initially and does not fetch or construct a wizard on listing', () => {
  render(<MedicationPreparationQueue meds={meds} />);
  expect(screen.getByText('Needs preparation')).toBeInTheDocument();
  expect(
    screen.getByText(/^Prepare ›$/).closest('details')
  ).not.toHaveAttribute('open');
  expect(mockStockQuery).not.toHaveBeenCalled();
  expect(mockWizard).not.toHaveBeenCalled();
});
it('opens only after a fresh exact-ID read and passes the actual record and proof into the inline wizard', () => {
  mockFresh = false;
  const view = render(<MedicationPreparationQueue meds={meds} />);
  expand();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking this existing vial'
  );
  expect(mockWizard).not.toHaveBeenCalled();
  mockFresh = true;
  view.rerender(<MedicationPreparationQueue meds={meds} />);
  expect(mockStockQuery).toHaveBeenLastCalledWith(
    mockStock.row.medication_id,
    mockStock.row.stock_id,
    true
  );
  expect(mockWizard.mock.calls.at(-1)![0]).toMatchObject({
    inline: true,
    pen: mockStock.pen,
    med: meds[0],
    queueContext: { state: mockStock.row.preparation_queue_state },
  });
  expect(mockWizard.mock.calls.at(-1)![0].queueContext.isCurrent()).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Close inline preparation' })
  );
  expect(screen.queryByTestId('inline-wizard')).not.toBeInTheDocument();
});
it('stops save authority during a background refetch without constructing a cached wizard before the first fresh read', () => {
  const view = render(<MedicationPreparationQueue meds={meds} />);
  expand();
  mockFetching = true;
  view.rerender(<MedicationPreparationQueue meds={meds} />);
  expect(screen.getByTestId('inline-wizard')).toBeInTheDocument();
  expect(mockWizard.mock.calls.at(-1)![0].queueContext.isCurrent()).toBe(false);
});
it('shows expired eligible stock and exact label metadata rather than silently filtering or deriving preparation inputs', () => {
  mockDashboard.preparation_queue = [
    queueItem({
      expired: true,
      expiry_date: '2026-10-01',
      label_mass_mg: '8.1234567890123456789',
    }),
  ];
  render(<MedicationPreparationQueue meds={meds} />);
  expect(screen.getByText('Expired')).toBeInTheDocument();
  expect(screen.getByText(/Formatted 2026-10-01/)).toBeInTheDocument();
  expect(screen.getByText(/Vial label amount/)).toHaveTextContent(
    '8.1234567890123456789'
  );
  expect(mockWizard).not.toHaveBeenCalled();
});
it('allows read-only inspection without any preparation action or exact-stock request', () => {
  mockWrite = false;
  render(<MedicationPreparationQueue meds={meds} />);
  expect(screen.getByText('Needs preparation')).toBeInTheDocument();
  expect(screen.queryByText(/^Prepare ›$/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/requires medication edit access/)
  ).toBeInTheDocument();
  expect(mockStockQuery).not.toHaveBeenCalled();
});
it('hides an empty queue and all stale queue facts without current authority', () => {
  mockDashboard.preparation_queue = [];
  const view = render(<MedicationPreparationQueue meds={meds} />);
  expect(screen.queryByText('Needs preparation')).not.toBeInTheDocument();
  mockDashboard = dashboardFixture();
  mockCurrent = false;
  view.rerender(<MedicationPreparationQueue meds={meds} />);
  expect(screen.queryByText('Needs preparation')).not.toBeInTheDocument();
});
it('does not construct a wizard on failed revalidation, stale cached data or missing medication identity', () => {
  mockStockError = true;
  const view = render(<MedicationPreparationQueue meds={meds} />);
  expand();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'could not be revalidated'
  );
  expect(mockWizard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefetch).toHaveBeenCalled();
  view.unmount();
  mockStockError = false;
  render(<MedicationPreparationQueue meds={[]} />);
  expand();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Medication details are unavailable'
  );
  expect(mockWizard).not.toHaveBeenCalled();
});
it('reports queue read failure rather than making stale records preparable', () => {
  mockError = true;
  render(<MedicationPreparationQueue meds={meds} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No preparation eligibility is assumed'
  );
  expect(screen.queryByText(/^Prepare ›$/)).not.toBeInTheDocument();
});

it('waits for a new validation when a previously opened row is closed and reopened with cached data', () => {
  const view = render(<MedicationPreparationQueue meds={meds} />);
  expand();
  expect(screen.getByTestId('inline-wizard')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Close inline preparation' })
  );
  mockFresh = false;
  mockWizard.mockClear();
  view.rerender(<MedicationPreparationQueue meds={meds} />);
  expand();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking this existing vial'
  );
  expect(mockWizard).not.toHaveBeenCalled();
});
it('reuses the same existing-stock flow for a non-GLP nasal medication', () => {
  const row = queueItem({ route: 'nasal' });
  mockDashboard.preparation_queue = [row];
  mockStock = { row, pen: dashboardPen() };
  render(
    <MedicationPreparationQueue
      meds={[{ ...courseMedication, type_id: 'nasal_spray' }]}
    />
  );
  expand();
  expect(screen.getByTestId('inline-wizard')).toBeInTheDocument();
  expect(mockWizard.mock.calls.at(-1)![0]).toMatchObject({
    med: { type_id: 'nasal_spray', is_glp1: false },
    pen: { id: row.stock_id },
    queueContext: { state: row.preparation_queue_state },
  });
});
it('does not mount preparation with stale medication route details', () => {
  render(
    <MedicationPreparationQueue
      meds={[{ ...courseMedication, type_id: 'tablet' }]}
    />
  );
  expand();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Medication details are unavailable'
  );
  expect(mockWizard).not.toHaveBeenCalled();
});

it('compact stock cards keep their own preparation body closed and footer accessible independently', () => {
  const { container } = render(
    <>
      <MedicationPreparationQueueEntry
        compact
        row={queueItem()}
        med={meds[0]}
        canWrite
        footer={<button>Edit exact vial</button>}
      />
      <MedicationPreparationQueueEntry
        compact
        row={queueItem({ stock_id: 'another' })}
        med={meds[0]}
        canWrite
        footer={<button>Edit another vial</button>}
      />
    </>
  );
  const cards = container.querySelectorAll('details');
  expect(cards).toHaveLength(2);
  expect(cards[0]).not.toHaveAttribute('open');
  expect(cards[1]).not.toHaveAttribute('open');
  expect(
    screen.getByRole('button', { name: 'Edit exact vial' }).closest('details')
  ).toBeNull();
  cards[0]!.open = true;
  fireEvent(cards[0]!, new Event('toggle'));
  expect(screen.getAllByTestId('inline-wizard')).toHaveLength(1);
  expect(cards[1]).not.toHaveAttribute('open');
  expect(mockWizard.mock.calls.at(-1)![0]).toMatchObject({
    inline: true,
    pen: mockStock.pen,
    queueContext: { state: mockStock.row.preparation_queue_state },
  });
});
