import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MedicationPlansPage from '@/pages/Medications/MedicationPlansPage';
import {
  courseFixture,
  courseRevision,
  courseMedication,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
import type { MedicationCourse } from '@workspace/shared';
import type { MedicationDetail } from '@/types/medications';

let mockWrite = true;
let mockCourses: MedicationCourse[] = [];
const mockStatus = jest.fn(),
  mockRefetch = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
  useMedicationCourses: () => ({
    scope: {
      key: 'owner',
      ready: true,
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
  useMedicationCourseActions: () => ({ status: mockStatus }),
  invalidateMedicationCourses: jest.fn(),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDate: (day: string) => day,
    timeFormat: 'HH:mm',
  }),
}));

const plan = (id: string, patch: Parameters<typeof courseRevision>[0]) =>
  courseFixture({
    id: `course-${id}`,
    current_revision_id: id,
    revisions: [
      courseRevision({
        id,
        course_id: `course-${id}`,
        name: `${id} plan`,
        ...patch,
      }),
    ],
  });
const med = {
  ...courseMedication,
  custom_fields: { half_life_hours: 144 },
} as MedicationDetail;
const onTimeline = jest.fn(),
  onManage = jest.fn();
function setup(medications: MedicationDetail[] = [med]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MedicationPlansPage
        medications={medications}
        onTimeline={onTimeline}
        onManage={onManage}
      />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mockWrite = true;
  mockStatus.mockReset();
  mockStatus.mockResolvedValue({});
  onTimeline.mockReset();
  onManage.mockReset();
  mockCourses = [
    plan('active', { end_date: '2026-12-13' }),
    plan('scheduled', { start_date: '2026-12-01' }),
    plan('paused', { status: 'paused' }),
    plan('ended', { end_date: '2026-11-15' }),
    plan('completed', { status: 'completed' }),
  ];
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000099',
  });
});

it('groups plans into the five buckets with counts and collapses completed', () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Plans' })).toBeInTheDocument();
  for (const name of [
    'Active · 1',
    'Scheduled · 1',
    'Paused · 1',
    'Past end date · 1',
    'Completed · 1',
  ])
    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getAllByTestId('plan-card')).toHaveLength(4);
  expect(screen.queryByText(/completed plan/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 completed' }));
  expect(screen.getByText(/completed plan/)).toBeInTheDocument();
  expect(screen.getAllByTestId('plan-card')).toHaveLength(5);
});

it('hides empty sections', () => {
  mockCourses = [plan('active', {})];
  setup();
  expect(screen.queryByRole('heading', { name: /Paused/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: /Scheduled/ })).toBeNull();
});

it('shows progress, half-life, schedule and revised-from-earlier', () => {
  mockCourses = [
    courseFixture({
      current_revision_id: 'r2',
      revisions: [
        courseRevision({ id: 'r1', revision_no: 1 }),
        courseRevision({
          id: 'r2',
          revision_no: 2,
          predecessor_id: 'r1',
          name: 'Revised plan',
          end_date: '2026-12-13',
        }),
      ],
    }),
  ];
  setup();
  expect(
    screen.getByText('Day 16 of 43 · ends 2026-12-13')
  ).toBeInTheDocument();
  expect(screen.getByText('revised from earlier')).toBeInTheDocument();
  expect(
    screen.getByText('Target 1 mg · Per administration · t½ 144 h')
  ).toBeInTheDocument();
  expect(screen.getByText(/Daily/)).toBeInTheDocument();
  expect(
    screen.getByText(/Example medication · Revised plan/)
  ).toBeInTheDocument();
  expect(screen.getAllByTestId('plan-card')).toHaveLength(1);
});

it('pauses through the shared dialog and the status API', async () => {
  mockCourses = [plan('active', {})];
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pause course' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Pause course' }));
  await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(1));
  expect(mockStatus.mock.calls[0]).toEqual([
    'course-active',
    { status: 'paused', expected_version: 1, operation_id: expect.any(String) },
  ]);
});

it('offers the right actions per bucket and never delete', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 completed' }));
  expect(screen.getAllByRole('button', { name: 'Pause course' })).toHaveLength(
    1
  );
  expect(screen.getAllByRole('button', { name: 'Resume course' })).toHaveLength(
    1
  );
  expect(
    screen.getAllByRole('button', { name: 'Complete course' })
  ).toHaveLength(3);
  expect(screen.getAllByRole('button', { name: 'Reopen course' })).toHaveLength(
    1
  );
  expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
});

it('hides actions without write access', () => {
  mockWrite = false;
  setup();
  for (const name of [
    'Pause course',
    'Resume course',
    'Complete course',
    'Manage plan →',
  ])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getAllByTestId('plan-card')).toHaveLength(4);
});

it('opens the timeline and manages a plan with the revision', () => {
  mockCourses = [plan('active', {})];
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
  expect(onTimeline).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Manage plan →' }));
  expect(onManage).toHaveBeenCalledWith(courseIds.med, 'active');
});

it('counts medicines on plain schedules and shows an empty state', () => {
  const plain = {
    ...courseMedication,
    id: 'plain-med',
    schedules: [{ id: 's', schedule_type_id: 'daily' }],
  } as unknown as MedicationDetail;
  setup([med, plain]);
  expect(
    screen.getByText(
      '1 medicine follows plain schedules, not versioned plans — see Cabinet.'
    )
  ).toBeInTheDocument();
});

it('shows only a message when there are no courses', () => {
  mockCourses = [];
  setup();
  expect(screen.getByText(/No versioned plans yet/)).toBeInTheDocument();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Timeline' })).toBeNull();
});
