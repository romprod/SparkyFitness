import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationLogCalendar from '@/pages/Medications/MedicationLogCalendar';
import {
  calendarWeek,
  calendarActual,
  calendarIds,
} from '@/tests/fixtures/medicationLogWeek';
import { courseMedication } from '@/tests/fixtures/medicationCourses';
let mockScope = 'owner';
jest.mock('@/pages/Medications/MedicationDailyLog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    firstDayOfWeek: 1,
    formatDate: (day: string) => day,
    timeFormat: 'HH:mm',
  }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ hasWritePermission: () => true }),
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: () => ({
    scope: { ready: true, key: mockScope, isCurrent: () => true },
    query: { isLoading: false, isError: false, isFetching: false },
    data: calendarWeek({ actuals: [calendarActual()] }),
  }),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: [] }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: () => ({ data: [] }),
  useCreateMedicationEntryMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useUpdateMedicationEntryMutation: () => ({ mutate: jest.fn() }),
  useUpdateInjectionEntryMutation: () => ({ mutate: jest.fn() }),
  useDeleteMedicationEntryMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useDeleteInjectionEntryMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));
const props = {
  medications: [{ ...courseMedication, id: calendarIds.med }],
  selectedDate: '2026-11-17',
  onSelectDate: jest.fn(),
};
async function openDay() {
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  const day = screen.getByRole('button', { name: '17' });
  day.focus();
  fireEvent.keyDown(day, { key: 'Enter', code: 'Enter' });
  // JSDOM does not synthesize the native click default of Enter on a button.
  fireEvent.click(day);
  await screen.findByRole('dialog', { name: 'Day detail · 2026-11-17' });
  return day;
}
beforeEach(() => {
  mockScope = 'owner';
  props.onSelectDate.mockReset();
});
it('returns focus to the invoking Month day after Escape without stealing it during nested confirmation', async () => {
  render(<MedicationLogCalendar {...props} />);
  const day = await openDay();
  expect(props.onSelectDate).toHaveBeenCalledWith('2026-11-17');
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('dialog', { name: 'Delete recorded dose?' });
  await waitFor(() => expect(document.activeElement).not.toBe(day));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const detail = await screen.findByRole('dialog', {
    name: 'Day detail · 2026-11-17',
  });
  expect(document.activeElement).not.toBe(day);
  fireEvent.keyDown(detail, { key: 'Escape', code: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  await waitFor(() => expect(document.activeElement).toBe(day));
});
it('does not return focus to the previous profile day when the detail is discarded', async () => {
  const view = render(<MedicationLogCalendar {...props} />);
  const day = await openDay();
  mockScope = 'other-profile';
  view.rerender(<MedicationLogCalendar {...props} />);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  expect(document.activeElement).not.toBe(day);
});
