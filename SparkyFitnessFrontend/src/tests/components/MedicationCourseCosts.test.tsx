import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationCourseCosts from '@/pages/Medications/MedicationCourseCosts';
import type {
  MedicationCourseCostRow,
  MedicationCourseCosts as CourseCosts,
} from '@workspace/shared';

const mockCosts = jest.fn();
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationCourseCosts: (...args: unknown[]) => mockCosts(...args),
}));
const actual = (
  patch: Partial<MedicationCourseCostRow['actual']> = {}
): MedicationCourseCostRow['actual'] => ({
  cost: '30.00',
  currency: 'GBP',
  mixed_currency: false,
  delivered_mg: '3',
  costed_doses: 2,
  uncosted_doses: 1,
  cost_per_dose: '15',
  cost_per_mg: '10',
  ...patch,
});
const row = (
  patch: Partial<MedicationCourseCostRow> = {}
): MedicationCourseCostRow => ({
  course_id: 'c1',
  medication_id: 'm1',
  medication_name: 'Synthetic peptide',
  name: 'Synthetic course',
  status: 'active',
  start_date: '2026-11-01',
  end_date: null,
  actual: actual(),
  remaining: {
    planned_mg: '2.5',
    planned_doses: 2,
    basis: 'course_end',
    through: '2026-12-31',
    rate_per_mg: '10',
    rate_source: 'course_actual',
    currency: 'GBP',
    estimate: '25.00',
    unavailable_reason: null,
  },
  projected_total: '55.00',
  projected_currency: 'GBP',
  ...patch,
});
const data = (
  rows: MedicationCourseCostRow[] = [row()],
  unattributed = actual({
    cost: null,
    currency: null,
    costed_doses: 0,
    uncosted_doses: 0,
    cost_per_dose: null,
    cost_per_mg: null,
    delivered_mg: '0',
  })
): CourseCosts => ({ as_of: '2026-11-18T00:00:00.000Z', rows, unattributed });
const ready = (value: CourseCosts | undefined = data()) =>
  mockCosts.mockReturnValue({
    data: value,
    isFetching: false,
    isError: false,
    refetch: jest.fn(),
  });
beforeEach(() => mockCosts.mockReset());

it('shows spent, per dose, remaining estimate with its basis and the projected total', () => {
  ready();
  render(<MedicationCourseCosts ownerId="owner" />);
  expect(
    screen.getAllByRole('columnheader').map((cell) => cell.textContent)
  ).toEqual([
    'Course',
    'Spent so far',
    'Per dose',
    'Remaining plan (estimate)',
    'Projected total',
  ]);
  expect(screen.getByText('Synthetic course')).toBeInTheDocument();
  expect(screen.getByText('GBP 30.00')).toBeInTheDocument();
  expect(screen.getByText('GBP 15.00')).toBeInTheDocument();
  expect(screen.getByText('GBP 25.00')).toBeInTheDocument();
  expect(
    screen.getByText(
      '2 planned doses at GBP 10.00/mg (this course), to course end'
    )
  ).toBeInTheDocument();
  expect(screen.getByText('GBP 55.00')).toBeInTheDocument();
  expect(screen.getByText('2 costed doses · 1 uncosted')).toBeInTheDocument();
});

it('discloses a horizon-limited estimate rather than implying it covers the whole course', () => {
  ready(
    data([
      row({
        remaining: {
          ...row().remaining,
          basis: 'horizon',
          through: '2027-11-18',
          rate_source: 'medication_actual',
        },
      }),
    ])
  );
  render(<MedicationCourseCosts ownerId="owner" />);
  expect(
    screen.getByText(
      '2 planned doses at GBP 10.00/mg (this medication), through 2027-11-18 only'
    )
  ).toBeInTheDocument();
});

it('never invents an estimate or total when pricing is unavailable', () => {
  ready(
    data([
      row({
        remaining: {
          planned_mg: null,
          planned_doses: 1,
          basis: 'course_end',
          through: null,
          rate_per_mg: null,
          rate_source: null,
          currency: null,
          estimate: null,
          unavailable_reason: 'non_mass_dose',
        },
        projected_total: null,
        projected_currency: null,
      }),
    ])
  );
  render(<MedicationCourseCosts ownerId="owner" />);
  expect(
    screen.getByText('Planned doses are not set in mass units')
  ).toBeInTheDocument();
  const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell');
  expect(cells[4]).toHaveTextContent('—');
});

it('hides mixed-currency spend and keeps the reason available to screen readers', () => {
  ready(
    data([
      row({
        actual: actual({
          mixed_currency: true,
          cost: null,
          currency: null,
          cost_per_dose: null,
          cost_per_mg: null,
        }),
        projected_total: null,
        projected_currency: null,
      }),
    ])
  );
  render(<MedicationCourseCosts ownerId="owner" />);
  expect(
    screen.getByText(
      'Unavailable: this course has costs in different currencies.'
    )
  ).toHaveClass('sr-only');
  expect(screen.queryByText('GBP 30.00')).not.toBeInTheDocument();
});

it('shows doses that are not linked to a course so totals reconcile', () => {
  ready(
    data([], actual({ cost: '40.00', costed_doses: 1, uncosted_doses: 0 }))
  );
  render(<MedicationCourseCosts ownerId="owner" />);
  expect(screen.getByText('Not linked to a course')).toBeInTheDocument();
  expect(screen.getByText('GBP 40.00')).toBeInTheDocument();
});

it('shows the empty state, a loading status and a retryable failure', () => {
  ready(data([]));
  const { rerender } = render(<MedicationCourseCosts ownerId="owner" />);
  expect(
    screen.getByText('No courses or logged doses to cost yet.')
  ).toBeInTheDocument();
  mockCosts.mockReturnValue({
    data: undefined,
    isFetching: true,
    isError: false,
    refetch: jest.fn(),
  });
  rerender(<MedicationCourseCosts ownerId="owner" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading course costs…');
  const refetch = jest.fn();
  mockCosts.mockReturnValue({
    data: undefined,
    isFetching: false,
    isError: true,
    refetch,
  });
  rerender(<MedicationCourseCosts ownerId="owner" />);
  expect(screen.getByText('Could not load course costs.')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Retry' }).click();
  expect(refetch).toHaveBeenCalled();
});
