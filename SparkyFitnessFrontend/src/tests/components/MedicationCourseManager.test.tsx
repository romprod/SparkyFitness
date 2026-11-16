import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MedicationCourseManager from '@/pages/Medications/MedicationCourseManager';
import {
  courseFixture,
  courseRevision,
  courseMedication,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
let mockCourses = [courseFixture()];
let mockWrite = true;
let mockReady = true;
const mockStatus = jest.fn(),
  mockRemove = jest.fn(),
  mockRefetch = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
  useMedicationCourses: () => ({
    scope: {
      key: 'owner',
      ready: mockReady,
      canWrite: mockWrite,
      isCurrent: () => true,
    },
    query: { isLoading: false, isError: false, refetch: mockRefetch },
    data: {
      courses: mockCourses,
      today: '2026-11-16',
      timezone: 'Europe/London',
    },
  }),
  useMedicationCourseActions: () => ({
    status: mockStatus,
    remove: mockRemove,
  }),
  invalidateMedicationCourses: jest.fn(),
}));
jest.mock('@/pages/Medications/MedicationCourseEditor', () => () => (
  <p>Course editor</p>
));
jest.mock('@/pages/Medications/MedicationCourseHistory', () => () => (
  <p>Revision history</p>
));
function setup() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MedicationCourseManager med={courseMedication} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mockCourses = [courseFixture()];
  mockWrite = true;
  mockReady = true;
  mockStatus.mockReset();
  mockRemove.mockReset();
  mockStatus.mockResolvedValue({});
  mockRemove.mockResolvedValue({});
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000099',
  });
});
it('shows the exact five lifecycle sections and hides empty sections', () => {
  mockCourses = [
    courseFixture({
      revisions: [
        courseRevision({ id: 'active', name: 'Active plan' }),
        courseRevision({
          id: 'scheduled',
          name: 'Future plan',
          start_date: '2026-12-01',
        }),
        courseRevision({ id: 'paused', name: 'Paused plan', status: 'paused' }),
        courseRevision({
          id: 'ended',
          name: 'Ended plan',
          end_date: '2026-11-15',
        }),
        courseRevision({
          id: 'completed',
          name: 'Completed plan',
          status: 'completed',
        }),
      ],
    }),
  ];
  setup();
  for (const name of [
    'Active',
    'Scheduled',
    'Paused',
    'Past end date',
    'Completed',
  ])
    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
});
it('keeps superseded fields/status frozen while allowing explicit deletion and details', () => {
  const old = courseRevision({ name: 'Earlier plan', status: 'completed' });
  const tip = courseRevision({
    id: courseIds.revision2,
    revision_no: 2,
    predecessor_id: old.id,
    name: 'Current plan',
  });
  mockCourses = [
    courseFixture({ current_revision_id: tip.id, revisions: [old, tip] }),
  ];
  setup();
  const older = within(
    screen.getByRole('article', { name: 'Earlier plan — Revision 1' })
  );
  expect(
    older.queryByRole('button', { name: 'Edit current course' })
  ).not.toBeInTheDocument();
  expect(
    older.queryByRole('button', { name: 'Reopen course' })
  ).not.toBeInTheDocument();
  expect(older.getByRole('button', { name: 'Delete revision' })).toBeEnabled();
  expect(
    older.getByRole('button', { name: 'Details and recorded doses' })
  ).toBeEnabled();
});
it('retains older history with no active tip after current revision deletion', () => {
  mockCourses = [
    courseFixture({
      current_revision_id: null,
      revisions: [
        courseRevision({ name: 'Earlier plan', status: 'completed' }),
        courseRevision({
          id: courseIds.revision2,
          revision_no: 2,
          deleted_at: '2026-11-16T12:00:00Z',
        }),
      ],
    }),
  ];
  setup();
  expect(screen.getByText(/There is no active tip/)).toBeInTheDocument();
  expect(
    screen.getByRole('article', { name: 'Earlier plan — Revision 1' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Reopen course' })
  ).not.toBeInTheDocument();
});
it('read-only report viewers retain history but have no new mutation controls', () => {
  mockWrite = false;
  setup();
  expect(
    screen.getByRole('button', { name: 'Details and recorded doses' })
  ).toBeEnabled();
  for (const name of [
    'Create course',
    'Edit current course',
    'Pause course',
    'Delete revision',
  ])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
it('sends only explicit lifecycle fields/version/operation, no dose or physical adjustments', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pause course' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Pause course' }));
  await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(1));
  expect(mockStatus.mock.calls[0]).toEqual([
    courseIds.course,
    { status: 'paused', expected_version: 1, operation_id: expect.any(String) },
  ]);
  expect(mockRemove).not.toHaveBeenCalled();
});
it('confirms deletion with preserved actuals/stock and the selected revision identity', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Delete revision' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Recorded doses are preserved/)).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Delete revision' }));
  await waitFor(() =>
    expect(mockRemove).toHaveBeenCalledWith(
      courseIds.course,
      courseIds.revision,
      { expected_version: 1, operation_id: expect.any(String) }
    )
  );
});
