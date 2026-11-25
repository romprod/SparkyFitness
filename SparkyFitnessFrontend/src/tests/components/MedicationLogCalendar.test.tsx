import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationLogCalendar from '@/pages/Medications/MedicationLogCalendar';
import { medicationCalendarMonday } from '@/pages/Medications/medicationCalendarDates';
import { calendarWeek } from '@/tests/fixtures/medicationLogWeek';
let mockScope = 'owner',
  mockReady = true;
const mockRead = jest.fn(),
  mockDetail = jest.fn();
jest.mock('@/pages/Medications/MedicationDailyLog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => day,
  }),
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: (start: string, enabled: boolean) => {
    mockRead(start, enabled);
    return {
      scope: { ready: mockReady, key: mockScope, isCurrent: () => true },
      query: { isError: false, isLoading: false },
      data: calendarWeek(),
    };
  },
}));
jest.mock('@/pages/Medications/MedicationWeekView', () => ({
  __esModule: true,
  default: () => <p>Static weekly lanes</p>,
}));
jest.mock('@/pages/Medications/MedicationMonthCalendar', () => ({
  __esModule: true,
  default: ({
    toolbar,
    onOpenDay,
    onSelectDate,
  }: {
    toolbar: React.ReactNode;
    onOpenDay: (day: string, medicationId: string) => void;
    onSelectDate: (day: string) => void;
  }) => (
    <>
      {toolbar}
      <button
        onClick={() => {
          onSelectDate('2026-11-18');
          onOpenDay('2026-11-18', 'chosen-med');
        }}
      >
        Month day
      </button>
    </>
  ),
}));
jest.mock('@/pages/Medications/MedicationCalendarDayDetail', () => ({
  __esModule: true,
  default: (props: {
    day: string;
    medicationId?: string;
    onSelectDate: (day: string) => void;
  }) => {
    mockDetail(props);
    return (
      <>
        <p>
          Day detail {props.day} filter {props.medicationId}
        </p>
        <button onClick={() => props.onSelectDate('2026-12-01')}>
          View outside actual
        </button>
      </>
    );
  },
}));
beforeEach(() => {
  mockScope = 'owner';
  mockReady = true;
  mockRead.mockClear();
  mockDetail.mockClear();
});
it('defaults to the Monday week, retains global date navigation and switches Month without a second planner', () => {
  const select = jest.fn();
  render(
    <MedicationLogCalendar
      medications={[]}
      selectedDate="2026-11-17"
      onSelectDate={select}
    />
  );
  expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(mockRead).toHaveBeenLastCalledWith('2026-11-16', true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(select).toHaveBeenCalledWith('2026-11-09');
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(select).toHaveBeenCalledWith('2026-11-23');
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(mockRead).toHaveBeenLastCalledWith('2026-11-16', false);
  expect(screen.queryByText('Static weekly lanes')).not.toBeInTheDocument();
});
it('opens Month detail with the selected medication filter, retaining it across actual-date navigation', () => {
  const select = jest.fn();
  render(
    <MedicationLogCalendar
      medications={[]}
      selectedDate="2026-11-17"
      onSelectDate={select}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Month day' }));
  expect(
    screen.getByText('Day detail 2026-11-18 filter chosen-med')
  ).toBeInTheDocument();
  expect(mockRead).toHaveBeenLastCalledWith('2026-11-16', true);
  fireEvent.click(screen.getByRole('button', { name: 'View outside actual' }));
  expect(select).toHaveBeenCalledWith('2026-12-01');
  expect(mockRead).toHaveBeenLastCalledWith('2026-11-30', true);
  expect(
    screen.getByText('Day detail 2026-12-01 filter chosen-med')
  ).toBeInTheDocument();
});
it('discards a previously opened detail when the active profile generation changes', () => {
  const props = {
    medications: [],
    selectedDate: '2026-11-17',
    onSelectDate: jest.fn(),
  };
  const view = render(<MedicationLogCalendar {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Month day' }));
  mockScope = 'other-owner';
  view.rerender(<MedicationLogCalendar {...props} />);
  expect(screen.queryByText(/Day detail 2026/)).not.toBeInTheDocument();
  expect(mockRead).toHaveBeenLastCalledWith('2026-11-16', false);
});
it.each([
  ['2026-11-17', '2026-11-16'],
  ['2026-03-29', '2026-03-23'],
  ['2026-01-01', '2025-12-29'],
  ['2026-02-31', '2026-11-16'],
  ['2011-12-30', '2011-12-26'],
])(
  'uses civil Monday navigation for %s without UTC/date overflow',
  (input, expected) => {
    expect(medicationCalendarMonday(input, '2026-11-17')).toBe(expected);
  }
);
