import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MedicationCourseTimeline from '@/pages/Medications/MedicationCourseTimeline';
import {
  courseFixture,
  courseMedication,
} from '@/tests/fixtures/medicationCourses';
const course = courseFixture();
const row = {
  course_id: course.id,
  revision_id: course.revisions[0]!.id,
  revision_no: 1,
  name: 'Named plan',
  medication_id: courseMedication.id,
  medication_name: 'Synthetic medication',
  timezone: 'America/New_York',
  local_today: '2026-11-16',
  status: 'active',
  bucket: 'active',
  is_current_tip: true,
  medication_active: true,
  version: 1,
  start_date: '2026-11-01',
  end_date: null as string | null,
  closed_date: null,
  open_end: true,
  overlap_eligible: true,
  segments: [
    {
      kind: 'authored_window',
      from: '2026-11-01',
      to: '2027-02-27',
      offset: 21,
      days: 119,
    },
    {
      kind: 'planned_on',
      from: '2026-11-01',
      to: '2026-11-07',
      offset: 21,
      days: 7,
    },
    {
      kind: 'projected_on',
      from: '2026-12-01',
      to: '2026-12-07',
      offset: 51,
      days: 7,
    },
  ],
  limitations: [] as string[],
};
let mockRows: Array<
  Omit<typeof row, 'medication_id'> & { medication_id: string | null }
> = [row];
let mockReady = true,
  mockCurrent = true,
  mockWrite = true,
  mockError = false;
let mockKey = 'self:owner:1';
const mockRefetch = jest.fn();
const mockHistory = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseTimeline: () => ({
    scope: {
      key: mockKey,
      ready: mockReady,
      isCurrent: () => mockCurrent,
      canWrite: mockWrite,
    },
    query: { isLoading: false, isError: mockError, refetch: mockRefetch },
    data: mockReady
      ? {
          today: '2026-11-17',
          timezone: 'Europe/London',
          window: {
            start_date: '2026-10-11',
            end_date: '2027-02-27',
            days: 140,
          },
          today_offset: 37,
          week_ticks: [
            { day: '2026-10-11', offset: 0 },
            { day: '2026-10-18', offset: 7 },
          ],
          rows: mockRows,
          overlap: [{ day: '2026-11-17', planned_on: 2, projected_on: 1 }],
        }
      : undefined,
  }),
  useMedicationCourseHistory: (id: string) => {
    mockHistory(id);
    return { data: { course }, isError: false };
  },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => day }),
}));
jest.mock('@/pages/Medications/MedicationCourseHistory', () => ({
  __esModule: true,
  default: ({ revision }: { revision: { id: string } }) => (
    <p>Exact history {revision.id}</p>
  ),
}));
const props = () => ({
  medications: [courseMedication],
  onClose: jest.fn(),
  onManage: jest.fn(),
});
beforeEach(() => {
  mockRows = [row];
  mockReady = true;
  mockCurrent = true;
  mockWrite = true;
  mockError = false;
  mockKey = 'self:owner:1';
  mockHistory.mockClear();
});
it('shows all-profile scope, server ranges, saved calendars and separately qualified overlap without doses', () => {
  render(<MedicationCourseTimeline {...props()} />);
  expect(
    screen.getByRole('heading', { name: 'Plan timeline' })
  ).toBeInTheDocument();
  expect(
    screen.getByText('Shows plans across all medications in this profile.')
  ).toBeInTheDocument();
  expect(screen.getByText(/America\/New_York.*Local today/)).toHaveTextContent(
    '2026-11-16'
  );
  expect(screen.getByText(/not simultaneous instants/)).toBeInTheDocument();
  expect(screen.getByText('Active plan overlap')).toBeInTheDocument();
  fireEvent.click(screen.getByText('View overlap counts by date'));
  const table = screen.getByRole('table');
  expect(
    within(table).getByRole('columnheader', {
      name: 'Hypothetical Projected On',
    })
  ).toBeInTheDocument();
  expect(within(table).getByText('2')).toBeInTheDocument();
  expect(
    screen.getByRole('region', {
      name: 'Plan timeline; scroll horizontally for all 20 weeks',
    })
  ).toHaveAttribute('tabindex', '0');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});
it('navigates Manage only to the exact current owned medication and revision', () => {
  const p = props();
  render(<MedicationCourseTimeline {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage plan' }));
  expect(p.onManage).toHaveBeenCalledWith(row);
});
it('keeps orphan, historical and read-only rows viewable without Manage', () => {
  mockRows = [
    { ...row, medication_id: null },
    { ...row, revision_id: 'old', is_current_tip: false },
  ];
  mockWrite = false;
  render(<MedicationCourseTimeline {...props()} />);
  expect(screen.getAllByRole('button', { name: 'View plan' })).toHaveLength(2);
  expect(
    screen.queryByRole('button', { name: 'Manage plan' })
  ).not.toBeInTheDocument();
});
it('opens exact existing readonly history rather than guessing a current revision', () => {
  render(<MedicationCourseTimeline {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'View plan' }));
  expect(mockHistory).toHaveBeenCalledWith(row.course_id);
  expect(
    screen.getByText(`Exact history ${row.revision_id}`)
  ).toBeInTheDocument();
});
it('does not render retained rows on read error or invalid proof', () => {
  mockError = true;
  const p = props();
  const view = render(<MedicationCourseTimeline {...p} />);
  expect(
    screen.queryByRole('button', { name: 'View plan' })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
  mockCurrent = false;
  view.rerender(<MedicationCourseTimeline {...p} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('closes and discards the dialog on profile generation change', () => {
  const p = props();
  const view = render(<MedicationCourseTimeline {...p} />);
  mockKey = 'self:other:2';
  view.rerender(<MedicationCourseTimeline {...p} />);
  expect(p.onClose).toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows unknown boundaries without inventing dates, and an honest empty window', () => {
  mockRows = [{ ...row, segments: [], limitations: ['unknown_start'] }];
  const p = props();
  const view = render(<MedicationCourseTimeline {...p} />);
  expect(
    screen.getByText(/Some plan boundaries or cycle windows are unknown/)
  ).toBeInTheDocument();
  expect(screen.queryByText(/Authored window: 2026/)).not.toBeInTheDocument();
  mockRows = [];
  view.rerender(<MedicationCourseTimeline {...p} />);
  expect(
    screen.getByText('No known plan windows overlap this 20-week display.')
  ).toBeInTheDocument();
});
it('keeps separate named medication rows across the selected medication scope', () => {
  mockRows = [
    row,
    {
      ...row,
      revision_id: 'other-revision',
      medication_id: 'other-med',
      medication_name: 'Another medication',
      name: 'Second plan',
      timezone: 'Asia/Tokyo',
    },
  ];
  render(<MedicationCourseTimeline {...props()} />);
  expect(
    screen.getByText('Synthetic medication · Named plan')
  ).toBeInTheDocument();
  expect(
    screen.getByText('Another medication · Second plan')
  ).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Manage plan' })).toHaveLength(
    1
  );
});
it('shows how far through each plan it is, from its own dates', () => {
  mockRows = [
    { ...row, revision_id: 'r-open', name: 'Open plan' },
    {
      ...row,
      revision_id: 'r-ends',
      name: 'Ending plan',
      start_date: '2026-11-10',
      end_date: '2027-02-08',
    },
    {
      ...row,
      revision_id: 'r-later',
      name: 'Later plan',
      start_date: '2026-11-20',
    },
    {
      ...row,
      revision_id: 'r-done',
      name: 'Past plan',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    },
  ];
  render(<MedicationCourseTimeline {...props()} />);
  expect(screen.getByText('Day 16 · no end date')).toBeInTheDocument();
  expect(screen.getByText('Day 7 of 91 · ends 2027-02-08')).toBeInTheDocument();
  expect(screen.getByText('Starts in 4 days · 2026-11-20')).toBeInTheDocument();
  expect(screen.getByText('Ended 2026-10-31')).toBeInTheDocument();
});
