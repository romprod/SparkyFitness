import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationCourseAttributionPicker from '@/pages/Medications/MedicationCourseAttributionPicker';
import {
  courseFixture,
  courseRevision,
  courseIds,
} from '@/tests/fixtures/medicationCourses';
const mockChange = jest.fn();
let mockWrite = true;
let mockCurrent = true;
const old = courseRevision({ status: 'completed' }),
  tip = courseRevision({
    id: courseIds.revision2,
    revision_no: 2,
    name: 'Current plan',
  });
const course = courseFixture({
  current_revision_id: tip.id,
  revisions: [old, tip],
});
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourses: () => ({
    scope: {
      ready: true,
      canWrite: mockWrite,
      ownerId: courseIds.owner,
      isCurrent: () => mockCurrent,
    },
    data: { courses: [course] },
    query: {
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(async () => ({ data: { courses: [course] } })),
    },
  }),
}));
beforeEach(() => {
  mockChange.mockReset();
  mockWrite = true;
  mockCurrent = true;
});
it('does not remap saved historical attribution merely because another revision is current', () => {
  render(
    <MedicationCourseAttributionPicker
      medicationId={courseIds.med}
      initial={{
        course_revision_id: old.id,
        course_rule_id: courseIds.rule,
        course_slot_key: 'old-slot',
        scheduled_day: '2026-11-01',
      }}
      value={null}
      onChange={mockChange}
    />
  );
  expect(
    screen.getByRole('combobox', { name: 'Plan association' })
  ).toHaveTextContent('Revision 1');
  expect(mockChange).not.toHaveBeenCalled();
});
it('requires explicit valid revision selection and clears only prior association metadata, not actual values', async () => {
  render(
    <MedicationCourseAttributionPicker
      medicationId={courseIds.med}
      onChange={mockChange}
    />
  );
  fireEvent.pointerDown(
    screen.getByRole('combobox', { name: 'Plan association' }),
    { button: 0, ctrlKey: false }
  );
  fireEvent.click(await screen.findByRole('option', { name: /Current plan/ }));
  expect(mockChange).toHaveBeenCalledWith({
    course_revision_id: tip.id,
    course_rule_id: null,
    course_step_id: null,
    course_slot_key: null,
    scheduled_day: null,
    scheduled_for: null,
    course_expected_version: 1,
  });
});
it('does not turn a choices refresh into a metadata-only association write', async () => {
  render(
    <MedicationCourseAttributionPicker
      medicationId={courseIds.med}
      initial={{ course_revision_id: old.id }}
      value={null}
      onChange={mockChange}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh plan choices' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh plan choices' })
    ).toBeEnabled()
  );
  expect(mockChange).not.toHaveBeenCalled();
});
it('disables mutation choices for read-only report viewers', () => {
  mockWrite = false;
  render(
    <MedicationCourseAttributionPicker
      medicationId={courseIds.med}
      onChange={mockChange}
    />
  );
  expect(
    screen.getByRole('combobox', { name: 'Plan association' })
  ).toBeDisabled();
});
