import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MedicationCourseHistory from '@/pages/Medications/MedicationCourseHistory';
import {
  courseFixture,
  courseRevision,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
const old = courseRevision({ status: 'completed' }),
  course = courseFixture({
    current_revision_id: courseIds.revision2,
    revisions: [
      old,
      courseRevision({ id: courseIds.revision2, revision_no: 2 }),
    ],
  });
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timeFormat: 'HH:mm' }),
}));
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseHistory: () => ({
    isLoading: false,
    isError: false,
    data: {
      from_date: '2026-10-01',
      to_date: '2026-11-16',
      actuals: [
        {
          id: 'old',
          source_kind: 'injection',
          course_revision_id: courseIds.revision,
          entry_date: '2026-10-01',
          occurred_at: '2026-10-01T12:00:45.678Z',
          dose_mg_exact: '0.1234567890123456789',
          volume_ml: '0.2',
          status: 'taken',
          site: 'Recorded site',
          notes: 'Earlier revision only',
        },
        {
          id: 'new',
          source_kind: 'injection',
          course_revision_id: courseIds.revision2,
          entry_date: '2026-11-16',
          occurred_at: '2026-11-16T12:00:00Z',
          dose_mg_exact: '5',
          status: 'taken',
          notes: 'New revision dose',
        },
        {
          id: 'legacy',
          source_kind: 'entry',
          course_revision_id: null,
          notes: 'Unassigned legacy record',
        },
      ],
    },
  }),
}));
it('shows only explicitly attributed old actuals and preserves exact recorded quantities/time before baseline', () => {
  render(
    <MedicationCourseHistory
      course={course}
      revision={old}
      onClose={() => {}}
    />
  );
  expect(screen.getByText('Earlier revision only')).toBeInTheDocument();
  expect(screen.getByText('0.1234567890123456789 mg')).toBeInTheDocument();
  expect(screen.getByText('2026-10-01T12:00:45.678Z')).toBeInTheDocument();
  expect(screen.queryByText('New revision dose')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Unassigned legacy record')
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Earlier managed adherence is unavailable/)
  ).toBeInTheDocument();
  expect(screen.getByText('Europe/London')).toBeInTheDocument();
});
