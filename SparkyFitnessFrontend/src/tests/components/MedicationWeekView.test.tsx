import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationWeekView from '@/pages/Medications/MedicationWeekView';
import {
  calendarWeek,
  calendarSlot,
  calendarActual,
} from '@/tests/fixtures/medicationLogWeek';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDate: (day: string) => day,
    formatDateInUserTimezone: (value: string) => value.slice(11, 16),
    timeFormat: 'HH:mm',
  }),
}));
it('shows the actual recorded value once instead of a changed planned amount on the same day', () => {
  const actual = calendarActual(),
    slot = calendarSlot();
  render(
    <MedicationWeekView
      subtype="all"
      data={calendarWeek({
        actuals: [actual],
        planned_slots: [slot],
        fulfilled_slots: [{ planned_id: slot.id, actual }],
      })}
    />
  );
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByRole('img')).toHaveAccessibleName(/0\.5 mg/);
  expect(screen.getByRole('img')).not.toHaveAccessibleName(/0\.9 mg/);
  expect(screen.getByRole('img')).toHaveAccessibleName(
    /08:00 \(America\/New_York\)/
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('references cross-day fulfilment without a phantom actual glyph on the planned day', () => {
  const actual = calendarActual({ entry_date: '2026-11-24' }),
    slot = calendarSlot();
  render(
    <MedicationWeekView
      subtype="all"
      data={calendarWeek({
        planned_slots: [slot],
        fulfilled_slots: [{ planned_id: slot.id, actual }],
      })}
    />
  );
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByRole('img')).toHaveAccessibleName(
    /Planned slot; recorded taken: 0\.5 mg on 2026-11-24/
  );
  expect(screen.getByRole('img')).not.toHaveTextContent('✓');
});
it('keeps same-UUID injection and ordinary actuals distinct, with unknown quantity and time truthful', () => {
  const a = calendarActual({
      occurred_at: null,
      dose_amount: null,
      dose_unit: null,
    }),
    b = calendarActual({
      key: `injection:${a.id}`,
      source_kind: 'injection',
      dose_amount: '0',
      dose_unit: 'mg',
    });
  render(
    <MedicationWeekView
      subtype="all"
      data={calendarWeek({ actuals: [a, b] })}
    />
  );
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(
    screen.getByRole('img', { name: /Dose unknown/ })
  ).toHaveAccessibleName(/Time unknown/);
  expect(screen.getByRole('img', { name: /0 mg/ })).toBeInTheDocument();
  expect(screen.queryByText(/Off-schedule|Shifted/)).not.toBeInTheDocument();
  expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0');
});
it('retains multiple daily planned slots, future unknown doses, coverage caveats and orphan identity', () => {
  const orphan = calendarActual({
    medication_id: null,
    lane_id: 'orphan:entry:old',
    medication_name: null,
  });
  const data = calendarWeek({
    lanes: [
      ...calendarWeek().lanes,
      {
        id: orphan.lane_id,
        medication_id: null,
        name: '',
        is_supplement: null,
      },
    ],
    actuals: [orphan],
    planned_slots: [
      calendarSlot(),
      calendarSlot({
        id: 'slot-b',
        time_of_day: null,
        dose_amount: null,
        dose_qualification: 'future_phase_unknown',
      }),
    ],
    coverage: [
      {
        lane_id: calendarSlot().lane_id,
        course_id: null,
        timezone: 'America/New_York',
        day: '2026-11-17',
        coverage: 'partial',
      },
    ],
  });
  render(<MedicationWeekView subtype="all" data={data} />);
  expect(screen.getAllByRole('img')).toHaveLength(3);
  expect(
    screen.getByRole('img', { name: /Time not set/ })
  ).toHaveAccessibleName(/Dose unknown/);
  expect(screen.getByText('Unknown recorded medication')).toBeInTheDocument();
  expect(screen.getByText('partial')).toBeInTheDocument();
});

it('formats actual clocks in the captured response zone rather than mutable preference-zone formatters', () => {
  render(
    <MedicationWeekView
      subtype="all"
      data={calendarWeek({
        timezone: 'America/New_York',
        actuals: [calendarActual()],
      })}
    />
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    /04:00 \(America\/New_York\)/
  );
  expect(screen.getByRole('img')).not.toHaveAccessibleName(/09:00/);
});

it('opens a day from its column heading when asked to', () => {
  const onOpenDay = jest.fn();
  render(
    <MedicationWeekView
      data={calendarWeek({ actuals: [calendarActual()] })}
      subtype="all"
      onOpenDay={onOpenDay}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open 2026-11-17' }));
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-17', expect.anything());
});

describe('doses taken off the plan', () => {
  const offLabel = /Off schedule: no dose was planned for this/;
  it('marks an extra dose on a day with nothing planned, and says the plan is unchanged', () => {
    // Planned for the 20th; an unlinked dose is taken on the 17th.
    render(
      <MedicationWeekView
        subtype="all"
        data={calendarWeek({
          actuals: [calendarActual()],
          planned_slots: [
            calendarSlot({
              id: 'later',
              scheduled_day: '2026-11-20',
              status: 'planned',
            }),
          ],
        })}
      />
    );
    const mark = screen.getByRole('img', { name: offLabel });
    expect(mark).toHaveTextContent('!');
    expect(mark).not.toHaveTextContent('✓');
    expect(
      screen.getByText(/taken where no dose was planned for it/)
    ).toBeInTheDocument();
  });
  it('leaves a dose counted toward its own day’s planned dose as an ordinary tick', () => {
    const actual = calendarActual(),
      slot = calendarSlot();
    render(
      <MedicationWeekView
        subtype="all"
        data={calendarWeek({
          actuals: [actual],
          planned_slots: [slot],
          fulfilled_slots: [{ planned_id: slot.id, actual }],
        })}
      />
    );
    expect(screen.getByRole('img')).toHaveTextContent('✓');
    expect(
      screen.queryByRole('img', { name: offLabel })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/taken where no dose was planned for it/)
    ).not.toBeInTheDocument();
  });
  it('names the planned day a dose on another day was counted toward', () => {
    const actual = calendarActual({ entry_date: '2026-11-19' }),
      slot = calendarSlot({ scheduled_day: '2026-11-17' });
    render(
      <MedicationWeekView
        subtype="all"
        data={calendarWeek({
          actuals: [actual],
          planned_slots: [slot],
          fulfilled_slots: [{ planned_id: slot.id, actual }],
        })}
      />
    );
    expect(
      screen.getByRole('img', {
        name: /Off schedule: counted toward the dose planned for 2026-11-17/,
      })
    ).toHaveTextContent('!');
  });
  it('never marks an as-needed dose, or a medication with nothing planned that week', () => {
    render(
      <MedicationWeekView
        subtype="all"
        data={calendarWeek({
          actuals: [calendarActual({ status: 'prn_taken' })],
          planned_slots: [
            calendarSlot({ scheduled_day: '2026-11-20', status: 'planned' }),
          ],
        })}
      />
    );
    expect(
      screen.queryByRole('img', { name: offLabel })
    ).not.toBeInTheDocument();
    render(
      <MedicationWeekView
        subtype="all"
        data={calendarWeek({ actuals: [calendarActual()] })}
      />
    );
    expect(
      screen.queryByRole('img', { name: offLabel })
    ).not.toBeInTheDocument();
  });
  it('lists Off schedule in the legend', () => {
    render(<MedicationWeekView subtype="all" data={calendarWeek()} />);
    // Without translations loaded the legend shows each status key, as the others do.
    expect(screen.getByLabelText('Dose status legend')).toHaveTextContent(
      '!off_schedule'
    );
  });
});
