import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type {
  MedicationCourse,
  MedicationCourseCycleState,
} from '@workspace/shared';
import MedicationPlanDayTile from '@/pages/Medications/MedicationPlanDayTile';
import {
  hasAnyPlan,
  pickRunningPlan,
  planDayReadout,
} from '@/pages/Medications/medicationPlanDay';
import {
  courseFixture,
  courseRevision,
  courseMedication,
} from '@/tests/fixtures/medicationCourses';
import type { MedicationDetail } from '@/types/medications';

const TODAY = '2026-11-25';
let mockCourses: MedicationCourse[] = [];
let mockCycle: Partial<MedicationCourseCycleState> | undefined;
let mockReady = true;
let mockLoading = false;
let mockError = false;
const mockCycleHook = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourses: () => ({
    scope: { key: 'owner', ready: mockReady, isCurrent: () => true },
    query: { isLoading: mockLoading, isError: mockError },
    data: mockLoading
      ? undefined
      : { courses: mockCourses, today: TODAY, timezone: 'Europe/London' },
  }),
  useMedicationCourseCycle: (id: string, enabled: boolean) => {
    mockCycleHook(id, enabled);
    return { data: enabled ? mockCycle : undefined };
  },
}));

const med = (id: string): MedicationDetail => ({ ...courseMedication, id });
const plan = (
  id: string,
  medId: string,
  name: string,
  patch: Parameters<typeof courseRevision>[0] = {}
) =>
  courseFixture({
    id: `course-${id}`,
    medication_id: medId,
    medication_name_snapshot: name,
    current_revision_id: `rev-${id}`,
    revisions: [
      courseRevision({
        id: `rev-${id}`,
        course_id: `course-${id}`,
        start_date: '2026-11-20',
        ...patch,
      }),
    ],
  });
const renderTile = (ids = ['m1', 'm2', 'm3']) =>
  render(<MedicationPlanDayTile medications={ids.map(med)} />);

beforeEach(() => {
  mockCourses = [];
  mockCycle = undefined;
  mockReady = true;
  mockLoading = false;
  mockError = false;
  mockCycleHook.mockClear();
});

describe('MedicationPlanDayTile', () => {
  it('shows the plain plan day with the medicine name', () => {
    mockCourses = [plan('a', 'm1', 'Retatrutide')];
    renderTile();
    expect(screen.getByText('Day 6')).toBeInTheDocument();
    expect(screen.getByText('Plan day')).toBeInTheDocument();
    expect(screen.getByText('Retatrutide')).toBeInTheDocument();
    expect(screen.getByText('Cycle')).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Cycle: Day 6, Plan day, Retatrutide',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/On plan/)).not.toBeInTheDocument();
  });

  it('follows the most recently started running plan', () => {
    mockCourses = [
      plan('a', 'm1', 'Old', { start_date: '2026-11-01' }),
      plan('b', 'm2', 'Newer', { start_date: '2026-11-23' }),
    ];
    renderTile();
    expect(screen.getByText('Day 3')).toBeInTheDocument();
    expect(screen.getByText('Newer')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('ignores paused, scheduled, ended and completed plans', () => {
    mockCourses = [
      plan('a', 'm1', 'Paused', { status: 'paused' }),
      plan('b', 'm1', 'Scheduled', { start_date: '2026-12-01' }),
      plan('c', 'm1', 'Ended', { end_date: '2026-11-24' }),
      plan('d', 'm1', 'Completed', { status: 'completed' }),
      plan('e', 'm2', 'Running', { start_date: '2026-11-10' }),
    ];
    renderTile();
    expect(screen.getByText('Day 16')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('ignores a medicine that is filtered out', () => {
    mockCourses = [
      plan('a', 'm1', 'Hidden', { start_date: '2026-11-24' }),
      plan('b', 'm2', 'Shown', { start_date: '2026-11-10' }),
    ];
    renderTile(['m2']);
    expect(screen.getByText('Shown')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('shows the on phase with a chip', () => {
    mockCourses = [plan('a', 'm1', 'Reta', { course_cycle_on_weeks: 4 })];
    mockCycle = {
      phase: 'on',
      anchor_date: '2026-11-22',
      on_weeks: 4,
      off_weeks: 2,
    };
    renderTile();
    expect(screen.getByText('Day 4')).toBeInTheDocument();
    expect(screen.getByText('On · 28-day phase')).toBeInTheDocument();
    expect(screen.getByText('▲ On plan')).toBeInTheDocument();
    expect(mockCycleHook).toHaveBeenCalledWith('course-a', true);
  });

  it('shows the off phase without a chip', () => {
    mockCourses = [plan('a', 'm1', 'Reta', { course_cycle_on_weeks: 4 })];
    mockCycle = {
      phase: 'off',
      planned_stop_date: '2026-11-22',
      on_weeks: 4,
      off_weeks: 2,
    };
    renderTile();
    expect(screen.getByText('Day 3')).toBeInTheDocument();
    expect(screen.getByText('Off · 14-day phase')).toBeInTheDocument();
    expect(screen.queryByText(/On plan/)).not.toBeInTheDocument();
  });

  it('shows plain Off when off_weeks is null', () => {
    mockCourses = [plan('a', 'm1', 'Reta', { course_cycle_on_weeks: 4 })];
    mockCycle = {
      phase: 'off',
      planned_stop_date: '2026-11-22',
      on_weeks: 4,
      off_weeks: null,
    };
    renderTile();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('falls back to the plan day when cycle data is missing', () => {
    mockCourses = [plan('a', 'm1', 'Reta', { course_cycle_on_weeks: 4 })];
    mockCycle = undefined;
    renderTile();
    expect(screen.getByText('Day 6')).toBeInTheDocument();
    expect(screen.getByText('Plan day')).toBeInTheDocument();
  });

  it('does not query the cycle for a plain plan', () => {
    mockCourses = [plan('a', 'm1', 'Reta')];
    renderTile();
    expect(mockCycleHook).toHaveBeenCalledWith('course-a', false);
  });

  it('renders nothing when there are no plans, or the query is not ready', () => {
    const { container, rerender } = renderTile();
    expect(container).toBeEmptyDOMElement();
    mockCourses = [plan('a', 'm9', 'Other')];
    rerender(<MedicationPlanDayTile medications={[med('m1')]} />);
    expect(container).toBeEmptyDOMElement();
    mockCourses = [plan('a', 'm1', 'Reta')];
    mockLoading = true;
    rerender(<MedicationPlanDayTile medications={[med('m1')]} />);
    expect(container).toBeEmptyDOMElement();
    mockLoading = false;
    mockError = true;
    rerender(<MedicationPlanDayTile medications={[med('m1')]} />);
    expect(container).toBeEmptyDOMElement();
    mockError = false;
    mockReady = false;
    rerender(<MedicationPlanDayTile medications={[med('m1')]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows No active plan when plans exist but none is running', () => {
    mockCourses = [plan('a', 'm1', 'Paused', { status: 'paused' })];
    renderTile();
    expect(screen.getByText('No active plan')).toBeInTheDocument();
    expect(screen.getByText('Cycle')).toBeInTheDocument();
  });
});

describe('medicationPlanDay', () => {
  const ids = new Set(['m1', 'm2']);

  it('breaks start-date ties by name, then course id', () => {
    const courses = [
      plan('z', 'm1', 'Beta'),
      plan('y', 'm2', 'Alpha'),
      plan('x', 'm2', 'Alpha'),
    ];
    expect(pickRunningPlan(courses, TODAY, ids)?.course.id).toBe('course-x');
  });

  it('excludes deleted courses and deleted tips', () => {
    const deleted = {
      ...plan('a', 'm1', 'A'),
      deleted_at: '2026-11-02T00:00:00Z',
    };
    const tombstoned = plan('b', 'm1', 'B', {
      deleted_at: '2026-11-02T00:00:00Z',
    });
    expect(pickRunningPlan([deleted, tombstoned], TODAY, ids)).toBeNull();
    expect(hasAnyPlan([deleted, tombstoned], ids)).toBe(false);
  });

  it('hasAnyPlan counts non-running plans of visible medicines only', () => {
    const paused = plan('a', 'm1', 'A', { status: 'paused' });
    expect(hasAnyPlan([paused], ids)).toBe(true);
    expect(hasAnyPlan([paused], new Set(['m2']))).toBe(false);
  });

  it('computes readouts and guards day < 1', () => {
    const rev = { start_date: '2026-11-20' };
    expect(planDayReadout(rev, TODAY, null)).toEqual({ kind: 'plan', day: 6 });
    expect(
      planDayReadout(rev, TODAY, {
        phase: 'on',
        anchor_date: '2026-11-25',
        on_weeks: 2,
        off_weeks: 1,
        planned_stop_date: null,
      })
    ).toEqual({ kind: 'on', day: 1, phaseDays: 14 });
    expect(
      planDayReadout(rev, TODAY, {
        phase: 'off',
        planned_stop_date: '2026-11-25',
        on_weeks: 2,
        off_weeks: 1,
        anchor_date: null,
      })
    ).toEqual({ kind: 'plan', day: 6 });
    expect(
      planDayReadout({ start_date: '2026-11-26' }, TODAY, null)
    ).toBeNull();
  });
});
