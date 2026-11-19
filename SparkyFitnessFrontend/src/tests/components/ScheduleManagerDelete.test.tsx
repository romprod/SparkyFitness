import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleManager from '@/pages/Medications/ScheduleManager';
import type { MedicationDetail, MedicationSchedule } from '@/types/medications';

const mockDelete = jest.fn();
jest.mock('@/hooks/useMedications', () => ({
  useAddScheduleMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScheduleMutation: () => ({ mutate: mockDelete, isPending: false }),
}));
jest.mock('@/pages/Medications/MedicationCourseManager', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London', timeFormat: 'HH:mm' }),
}));

const rule: MedicationSchedule = {
  id: 'rule',
  medication_id: 'med',
  schedule_type_id: 'daily',
  time_of_day: '09:00',
  dose_amount: null,
  days_of_week: null,
  interval_days: null,
  day_of_month: null,
  cycle_on_days: null,
  cycle_off_days: null,
  prn_reason: null,
  prn_max_per_day: null,
  with_meal: null,
  start_date: null,
  end_date: null,
  active: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const med = {
  id: 'med',
  name: 'Example',
  type_id: 'injection',
  is_active: true,
  schedules: [rule],
} as unknown as MedicationDetail;

beforeEach(() => mockDelete.mockClear());

it('asks before deleting a schedule rule and only deletes once confirmed', () => {
  render(<ScheduleManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete schedule rule' }));
  expect(mockDelete).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {
    name: 'Delete this schedule rule?',
  });
  expect(dialog).toHaveTextContent('Doses already logged are not affected.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith('rule');
});

it('keeps the schedule rule when the confirmation is cancelled', () => {
  render(<ScheduleManager med={med} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete schedule rule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
