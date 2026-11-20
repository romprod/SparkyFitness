import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationCalendarDayDetail from '@/pages/Medications/MedicationCalendarDayDetail';
import {
  calendarWeek,
  calendarActual,
  calendarSlot,
  calendarIds,
} from '@/tests/fixtures/medicationLogWeek';
import { courseMedication } from '@/tests/fixtures/medicationCourses';
import type { MedicationInjectionRead } from '@workspace/shared';
let mockCurrent = true,
  mockWrite = true,
  mockDiaryWrite = false;
let mockRead: MedicationInjectionRead | undefined;
const mockCreate = jest.fn(),
  mockUpdate = jest.fn(),
  mockUpdateInjection = jest.fn(),
  mockDelete = jest.fn(),
  mockDeleteInjection = jest.fn(),
  mockReadHook = jest.fn(),
  mockFullEditor = jest.fn();
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    hasWritePermission: (key: string) =>
      key === 'diary' ? mockDiaryWrite : mockWrite,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => day,
    formatDateInUserTimezone: (value: string) => value,
    timeFormat: 'HH:mm',
  }),
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationCalendarInjection: (id: string, open: boolean) => {
    mockReadHook(id, open);
    return { data: mockRead, query: { isError: false } };
  },
}));
jest.mock('@/hooks/useMedications', () => ({
  useCreateMedicationEntryMutation: () => ({
    mutate: mockCreate,
    isPending: false,
    isError: false,
  }),
  useUpdateMedicationEntryMutation: () => ({
    mutate: mockUpdate,
    isPending: false,
  }),
  useUpdateInjectionEntryMutation: () => ({
    mutate: mockUpdateInjection,
    isPending: false,
  }),
  useDeleteMedicationEntryMutation: () => ({
    mutate: mockDelete,
    isPending: false,
  }),
  useDeleteInjectionEntryMutation: () => ({
    mutate: mockDeleteInjection,
    isPending: false,
  }),
}));
jest.mock('@/pages/Medications/Glp1RecentInjections', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockFullEditor(props);
    return <p>Existing full reviewed editor</p>;
  },
}));
function props(data = calendarWeek({ actuals: [calendarActual()] })) {
  return {
    day: '2026-11-17',
    data,
    subtype: 'all' as const,
    medications: [{ ...courseMedication, id: calendarIds.med }],
    onClose: jest.fn(),
    onSelectDate: jest.fn(),
    result: {
      scope: {
        ready: true,
        key: 'scope',
        actorId: 'actor',
        ownerId: 'owner',
        generation: 1,
        canWrite: true,
        isCurrent: () => mockCurrent,
      },
      data,
      query: { isLoading: false, isError: false, isFetching: false },
    } as unknown as ReturnType<
      typeof import('@/hooks/Medications/useMedicationLogWeek').useMedicationLogWeek
    >,
  };
}
function renderDetail(p = props()) {
  return render(<MedicationCalendarDayDetail {...p} />);
}
beforeEach(() => {
  mockCurrent = true;
  mockWrite = true;
  mockDiaryWrite = false;
  mockRead = undefined;
  [
    mockUpdate,
    mockUpdateInjection,
    mockDelete,
    mockDeleteInjection,
    mockReadHook,
    mockFullEditor,
  ].forEach((fn) => fn.mockReset());
});
it('keeps planned rows readonly and confirms Delete against the exact actual source kind', () => {
  const actual = calendarActual({
    source_kind: 'injection',
    key: `injection:${calendarIds.actual}`,
  });
  const p = props(
    calendarWeek({ planned_slots: [calendarSlot()], actuals: [actual] })
  );
  renderDetail(p);
  const plannedHeading = screen.getByRole('heading', { name: 'Planned' });
  expect(plannedHeading.nextElementSibling?.querySelector('button')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(mockDeleteInjection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockDeleteInjection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(mockDeleteInjection).toHaveBeenCalledWith(
    actual.id,
    expect.any(Object)
  );
  expect(mockDelete).not.toHaveBeenCalled();
});
it('ordinary notes-only edit leaves recorded quantity and exact original timestamp/day untouched', () => {
  renderDetail();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Updated recorded note' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0]).toEqual({
    id: calendarIds.actual,
    body: { notes: 'Updated recorded note' },
  });
  expect(mockUpdateInjection).not.toHaveBeenCalled();
});
it('loads exact injection only after Edit and adapts numeric text without losing exact dose metadata', () => {
  const actual = calendarActual({
    source_kind: 'injection',
    key: `injection:${calendarIds.actual}`,
  });
  renderDetail(props(calendarWeek({ actuals: [actual] })));
  expect(mockReadHook).not.toHaveBeenCalled();
  mockRead = {
    id: actual.id,
    user_id: 'owner',
    medication_id: calendarIds.med,
    pen_id: null,
    injected_at: actual.occurred_at,
    entry_date: actual.entry_date,
    site: null,
    dose_mg: '0.1234567890123456789',
    dose_mg_exact: '0.1234567890123456789',
    notes: 'Exact note',
    administration_route: 'nasal',
  } as MedicationInjectionRead;
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(mockReadHook).toHaveBeenCalledWith(actual.id, true);
  expect(mockFullEditor).toHaveBeenCalledWith(
    expect.objectContaining({
      editorOnly: true,
      initialInjection: expect.objectContaining({
        dose_mg: Number('0.1234567890123456789'),
        dose_mg_exact: '0.1234567890123456789',
        administration_route: 'nasal',
      }),
    })
  );
});
it('retains the Month medication filter and carries cross-day references to the actual date', () => {
  const slot = calendarSlot(),
    actual = calendarActual({ entry_date: '2026-11-24', status: 'skipped' });
  const other = calendarActual({
    id: 'other',
    key: 'entry:other',
    lane_id: 'medication:other',
    medication_id: 'other',
    medication_name: 'Different medication',
  });
  const p = {
    ...props(
      calendarWeek({
        lanes: [
          ...calendarWeek().lanes,
          {
            id: 'medication:other',
            medication_id: 'other',
            name: 'Different medication',
            is_supplement: false,
          },
        ],
        planned_slots: [slot],
        actuals: [other],
        fulfilled_slots: [{ planned_id: slot.id, actual }],
      })
    ),
    medicationId: calendarIds.med,
  };
  renderDetail(p);
  expect(screen.queryByText('Different medication')).not.toBeInTheDocument();
  expect(screen.getByText(/recorded skipped/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View recorded date' }));
  expect(p.onSelectDate).toHaveBeenCalledWith('2026-11-24');
});
it('removes action controls for readonly users and closes an already-open edit when permission is revoked', () => {
  const p = props();
  const view = renderDetail(p);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  mockWrite = false;
  view.rerender(<MedicationCalendarDayDetail {...p} />);
  expect(
    screen.queryByRole('button', { name: 'Save' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit' })
  ).not.toBeInTheDocument();
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('allows only supported metadata editing when the exact injection has no medication/time', () => {
  const actual = calendarActual({
    source_kind: 'injection',
    key: `injection:${calendarIds.actual}`,
  });
  mockRead = {
    id: actual.id,
    user_id: 'owner',
    medication_id: null,
    injected_at: null,
    entry_date: actual.entry_date,
    site: null,
    notes: null,
    administration_route: null,
  } as MedicationInjectionRead;
  renderDetail(props(calendarWeek({ actuals: [actual] })));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(mockFullEditor).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Known metadata' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdateInjection.mock.calls[0][0]).toEqual({
    id: actual.id,
    body: { notes: 'Known metadata' },
  });
});

it('keeps actual day-detail clocks consistent with the response timezone label', () => {
  renderDetail(
    props(
      calendarWeek({
        timezone: 'America/New_York',
        actuals: [calendarActual()],
      })
    )
  );
  expect(screen.getByText('04:00 (America/New_York)')).toBeInTheDocument();
});

describe('adding a dose for a past day', () => {
  const pick = (label: string, option: string) => {
    fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: option }));
  };

  it('records the chosen medication on that day at a time that is not now', () => {
    const med = {
      ...courseMedication,
      id: calendarIds.med,
      display_name: 'Sertraline',
      type_id: 'tablet',
      is_active: true,
      is_glp1: false,
      schedules: [{ id: 's1', time_of_day: '21:00' }],
    };
    const p = props(calendarWeek({ actuals: [] }));
    renderDetail({
      ...p,
      medications: [med] as unknown as typeof p.medications,
    });
    expect(
      screen.getByRole('region', { name: 'Add a dose for this day' })
    ).toBeInTheDocument();
    pick('Medication or supplement', 'Sertraline');
    fireEvent.click(screen.getByRole('button', { name: 'Record dose' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      medication_id: calendarIds.med,
      status: 'taken',
      entry_date: '2026-11-17',
      taken_at: '2026-11-17T21:00:00.000Z',
    });
  });

  it('is not offered for a future day or without write access', () => {
    const p = props(calendarWeek({ actuals: [] }));
    const { unmount } = renderDetail({ ...p, day: '2026-11-18' });
    expect(
      screen.queryByRole('region', { name: 'Add a dose for this day' })
    ).toBeNull();
    unmount();
    mockWrite = false;
    renderDetail(p);
    expect(
      screen.queryByRole('region', { name: 'Add a dose for this day' })
    ).toBeNull();
  });
});
