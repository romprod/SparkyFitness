import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MedicationCycleBanner from '@/pages/Medications/MedicationCycleBanner';
import {
  courseFixture,
  courseRevision,
} from '@/tests/fixtures/medicationCourses';
import { cycleStateFixture } from '@/tests/fixtures/medicationCourseCycles';

let mockState: ReturnType<typeof cycleStateFixture> | undefined;
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseCycle: () => ({ data: mockState }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `Date ${day}` }),
}));

const planned = () =>
  courseFixture({
    medication_name_snapshot: 'Alpha',
    revisions: [
      courseRevision({
        course_cycle_on_weeks: 4,
        course_cycle_off_weeks: 2,
        course_cycle_anchor_date: '2026-11-01',
      }),
    ],
  });

describe('MedicationCycleBanner', () => {
  beforeEach(() => {
    mockState = undefined;
  });

  it('warns that a run ends soon', () => {
    mockState = cycleStateFixture({
      phase: 'on',
      today: '2026-11-25',
      planned_stop_date: '2026-11-28',
    });
    render(<MedicationCycleBanner courses={[planned()]} />);
    expect(screen.getByText('Alpha: cycle ends in 4 days')).toBeInTheDocument();
    expect(
      screen.getByText('Planned last dose Date 2026-11-28.')
    ).toBeInTheDocument();
  });

  it('says when a finished run is still active', () => {
    mockState = cycleStateFixture({
      phase: 'ended',
      today: '2026-11-30',
      planned_stop_date: '2026-11-28',
    });
    render(<MedicationCycleBanner courses={[planned()]} />);
    expect(screen.getByText('Alpha: planned run is over')).toBeInTheDocument();
  });

  it('calls the restart day', () => {
    mockState = cycleStateFixture({ phase: 'restart_due' });
    render(<MedicationCycleBanner courses={[planned()]} />);
    expect(screen.getByText('Alpha: back on today')).toBeInTheDocument();
  });

  it('stays quiet mid-cycle, on a distant break, or with no plan', () => {
    mockState = cycleStateFixture({
      phase: 'on',
      today: '2026-11-10',
      planned_stop_date: '2026-11-28',
    });
    const { rerender } = render(
      <MedicationCycleBanner courses={[planned()]} />
    );
    expect(screen.queryByRole('status')).toBeNull();
    mockState = cycleStateFixture({
      phase: 'off',
      today: '2026-11-30',
      next_restart_date: '2026-12-12',
    });
    rerender(<MedicationCycleBanner courses={[planned()]} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<MedicationCycleBanner courses={[courseFixture()]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores paused courses', () => {
    mockState = cycleStateFixture({ phase: 'restart_due' });
    const course = planned();
    course.revisions[0]!.status = 'paused';
    render(<MedicationCycleBanner courses={[course]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
