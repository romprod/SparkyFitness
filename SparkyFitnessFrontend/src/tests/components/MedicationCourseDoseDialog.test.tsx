import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationCourseExpectedSlot } from '@workspace/shared';
import type { MedicationDetail } from '@/types/medications';
import MedicationCourseDoseDialog from '@/pages/Medications/MedicationCourseDoseDialog';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Asia/Tokyo' }),
}));
jest.mock('@/components/ui/TimeInput', () => ({
  DateTimeInput: ({
    value,
    onChange,
    ...props
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
let mockCurrent = true;
const mockScope = {
  canWrite: true,
  ownerId: 'owner',
  isCurrent: () => mockCurrent,
};
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseScope: () => mockScope,
}));
const mockCreate = jest.fn();
jest.mock('@/hooks/useMedications', () => ({
  useCreateMedicationEntryMutation: () => ({
    mutate: mockCreate,
    isPending: false,
  }),
}));
jest.mock('@/pages/Medications/Glp1LogInjection', () => () => null);

const slot: MedicationCourseExpectedSlot = {
  course_id: 'course',
  medication_id: 'med',
  schedule_type_id: 'daily',
  course_revision_id: 'revision',
  course_rule_id: 'rule',
  course_step_id: null,
  course_slot_key: 'slot',
  course_expected_version: 7,
  scheduled_day: '2026-07-08',
  scheduled_for: null,
  time_of_day: null,
  per_dose_amount: '2.5',
  authored_dose: '2.5',
  dose_unit: 'mg',
  dose_basis: 'per_injection',
  phase_progress_known: true,
};
const med = {
  id: 'med',
  user_id: 'owner',
  name: 'Example',
  dose_amount: 99,
  dose_unit: 'tablet',
} as MedicationDetail;
const show = (onRefresh?: () => Promise<MedicationCourseExpectedSlot | null>) =>
  render(
    <MedicationCourseDoseDialog
      med={med}
      slot={slot}
      prepared={false}
      takenAt="2026-07-10T23:45:30.456Z"
      notes="note"
      onClose={jest.fn()}
      onLogged={jest.fn()}
      onRefresh={onRefresh}
    />
  );
const enterActual = () => {
  fireEvent.change(screen.getByLabelText('Actual amount'), {
    target: { value: '3' },
  });
  fireEvent.change(screen.getByLabelText('Actual unit'), {
    target: { value: 'mg' },
  });
};
beforeEach(() => {
  mockCreate.mockReset();
  mockCurrent = true;
  mockScope.canWrite = true;
});

it('shows the known planned target while requiring the actual amount and unit', () => {
  show();
  expect(screen.getByText('Planned dose: 2.5 mg')).toBeInTheDocument();
  expect(screen.getByLabelText('Actual amount')).toHaveValue('');
  expect(screen.getByLabelText('Actual unit')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Confirm actual dose' })
  ).toBeDisabled();
});
it('uses the explicitly edited actual wall clock day and preserves the scheduled null instant', () => {
  show();
  enterActual();
  fireEvent.change(screen.getByLabelText('Actual date and time'), {
    target: { value: '2026-07-09T01:15' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm actual dose' }));
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      taken_at: '2026-07-08T16:15:00.000Z',
      entry_date: '2026-07-09',
      scheduled_day: '2026-07-08',
      scheduled_for: null,
      course_expected_version: 7,
      course_revision_id: 'revision',
      dose_amount_snapshot: 3,
      dose_unit_snapshot: 'mg',
    }),
    expect.anything()
  );
  expect(mockCreate.mock.calls[0]![0]).not.toHaveProperty('schedule_id');
});
it('checks current identity again at submission', () => {
  show();
  enterActual();
  mockCurrent = false;
  fireEvent.click(screen.getByRole('button', { name: 'Confirm actual dose' }));
  expect(mockCreate).not.toHaveBeenCalled();
});
it.each(['0', '-1', 'NaN', 'Infinity', ''])(
  'does not submit invalid actual amount %s',
  (value) => {
    show();
    enterActual();
    fireEvent.change(screen.getByLabelText('Actual amount'), {
      target: { value },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm actual dose' })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  }
);

it('refreshes only on explicit request, keeps the actual draft and requires another confirmation', async () => {
  const refresh = jest.fn().mockResolvedValue({
    ...slot,
    course_expected_version: 8,
    per_dose_amount: '4',
  });
  mockCreate.mockImplementationOnce((_body, options) =>
    options.onError({ status: 409 })
  );
  show(refresh);
  enterActual();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm actual dose' }));
  expect(refresh).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh course' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm actual dose' })
    ).toBeEnabled()
  );
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Actual amount')).toHaveValue('3');
  expect(screen.getByText('Planned dose: 4 mg')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm actual dose' }));
  expect(mockCreate.mock.calls[1]![0]).toMatchObject({
    course_expected_version: 8,
    dose_amount_snapshot: 3,
  });
});

it('keeps a rounded-to-zero projected target unknown instead of using the medication default', () => {
  render(
    <MedicationCourseDoseDialog
      med={med}
      slot={{ ...slot, per_dose_amount: '0' }}
      prepared={false}
      takenAt="2026-07-10T23:45:30.456Z"
      notes={null}
      onClose={jest.fn()}
      onLogged={jest.fn()}
    />
  );
  expect(screen.getByText('Planned dose: Unknown')).toBeInTheDocument();
  expect(screen.getByLabelText('Actual amount')).toHaveValue('');
  expect(screen.queryByText('99 tablet')).not.toBeInTheDocument();
});

it.each(['1e-400', '1e400'])(
  'preserves the exact positive expected target %s without rewriting an actual number',
  (value) => {
    render(
      <MedicationCourseDoseDialog
        med={med}
        slot={{ ...slot, per_dose_amount: value }}
        prepared={false}
        takenAt="2026-07-10T23:45:30.456Z"
        notes={null}
        onClose={jest.fn()}
        onLogged={jest.fn()}
      />
    );
    expect(screen.getByText(`Planned dose: ${value} mg`)).toBeInTheDocument();
    expect(screen.getByLabelText('Actual amount')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Confirm actual dose' })
    ).toBeDisabled();
  }
);
