import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationCourseCycles from '@/pages/Medications/MedicationCourseCycles';
import { courseFixture } from '@/tests/fixtures/medicationCourses';
import { cycleStateFixture } from '@/tests/fixtures/medicationCourseCycles';
let mockState = cycleStateFixture(),
  mockCurrent = true,
  mockWrite = true,
  mockError = false,
  mockFetching = false;
const mockRead = jest.fn(),
  mockRefetch = jest.fn(),
  action = jest.fn(),
  refresh = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseCycle: (...args: unknown[]) => {
    mockRead(...args);
    return {
      scope: { canWrite: mockWrite, isCurrent: () => mockCurrent },
      data: mockState,
      query: {
        isError: mockError,
        isFetching: mockFetching,
        refetch: mockRefetch,
      },
    };
  },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `Date ${day}` }),
}));
function setup(tip = true, configured = true) {
  const course = courseFixture();
  const revision = course.revisions[0]!;
  if (configured)
    Object.assign(revision, {
      course_cycle_on_weeks: 1,
      course_cycle_off_weeks: 1,
      course_cycle_anchor_date: '2026-11-01',
    });
  return render(
    <MedicationCourseCycles
      course={course}
      revision={revision}
      tip={tip}
      canWrite={mockWrite}
      onAction={action}
      onRefresh={refresh}
    />
  );
}
beforeEach(() => {
  mockState = cycleStateFixture();
  mockCurrent = true;
  mockWrite = true;
  mockError = false;
  mockFetching = false;
  mockRead.mockClear();
  mockRefetch.mockClear();
  action.mockClear();
  refresh.mockClear();
});
it('adds no empty panel or cycle request without authored weekly metadata', () => {
  setup(true, false);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(mockRead).not.toHaveBeenCalled();
});
it('renders canonical planned dates and both server-allowed actions without requiring End first', () => {
  setup();
  expect(screen.getByText('Date 2026-11-07')).toBeInTheDocument();
  expect(screen.getByText('Date 2026-11-15')).toBeInTheDocument();
  expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Start next cycle' }));
  expect(action).toHaveBeenCalledWith('start');
  fireEvent.click(screen.getByRole('button', { name: 'End cycle' }));
  expect(action).toHaveBeenCalledWith('end');
});
it('does not infer Start eligibility from the calendar phase or absence of an off duration', () => {
  mockState = cycleStateFixture({
    phase: 'on',
    off_weeks: null,
    next_restart_date: null,
    end_cycle: { allowed: false, reasons: ['The end is not yet eligible.'] },
    start_next_cycle: { allowed: true, reasons: [] },
  });
  setup();
  expect(
    screen.getByRole('button', { name: 'Start next cycle' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'End cycle' })
  ).not.toBeInTheDocument();
  expect(screen.getByText('The end is not yet eligible.')).toBeInTheDocument();
});
it('keeps superseded weekly metadata read-only and never requests current-cycle state for the historical row', () => {
  setup(false);
  expect(mockRead).toHaveBeenCalledWith(expect.any(String), false);
  expect(screen.getByText(/Recorded weekly cycle anchor/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Start next cycle' })
  ).not.toBeInTheDocument();
});
it('shows read-only dates but no cycle writes without edit authority', () => {
  mockWrite = false;
  setup();
  expect(screen.getByText('Date 2026-11-07')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'End cycle' })
  ).not.toBeInTheDocument();
});
it('does not present stale or failed cached eligibility as an available action', () => {
  mockError = true;
  setup();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cycle dates are unavailable'
  );
  expect(
    screen.queryByRole('button', { name: 'Start next cycle' })
  ).not.toBeInTheDocument();
});
it('requires a course refresh when the cycle read belongs to another revision or version', () => {
  mockState = cycleStateFixture({ version: 2 });
  setup();
  expect(
    screen.queryByRole('button', { name: 'Start next cycle' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current data' }));
  expect(refresh).toHaveBeenCalled();
});
it('blocks a cached action while refetching or when live proof no longer matches', () => {
  mockFetching = true;
  const view = setup();
  expect(
    screen.getByRole('button', { name: 'Start next cycle' })
  ).toBeDisabled();
  view.unmount();
  mockFetching = false;
  mockCurrent = false;
  setup();
  expect(
    screen.queryByRole('button', { name: 'Start next cycle' })
  ).not.toBeInTheDocument();
});
