import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MedicationCourseRuleInput } from '@workspace/shared';
import MedicationCourseRules from '@/pages/Medications/MedicationCourseRules';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timeFormat: '24h' }),
}));
const rule = (patch: Partial<MedicationCourseRuleInput> = {}) =>
  ({
    schedule_type_id: 'daily',
    time_of_day: '09:00',
    ...patch,
  }) as MedicationCourseRuleInput;

function pick(option: string, rules = [rule()]) {
  const onChange = jest.fn();
  render(<MedicationCourseRules rules={rules} onChange={onChange} />);
  fireEvent.keyDown(screen.getByLabelText('Rule 1 type'), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
  return onChange;
}

describe('schedule rule starting values, as in Pitstop', () => {
  it('starts an every-N-days rule at 3 days', () => {
    const onChange = pick('Every N days');
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      schedule_type_id: 'every_n_days',
      interval_days: 3,
    });
  });

  it('starts an on/off cycle at 5 days on and 2 off', () => {
    const onChange = pick('Cyclic (On/Off)');
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      schedule_type_id: 'cyclic',
      cycle_on_days: 5,
      cycle_off_days: 2,
    });
  });

  it('keeps a figure that is already there', () => {
    const onChange = pick('Every N days', [rule({ interval_days: 10 })]);
    expect(onChange.mock.calls[0][0][0].interval_days).toBe(10);
  });
});

describe('timing set by a stack schedule', () => {
  const locked = (patch: Partial<MedicationCourseRuleInput> = {}) => {
    const onChange = jest.fn();
    render(
      <MedicationCourseRules
        lockTiming
        onChange={onChange}
        rules={[
          rule({
            schedule_type_id: 'specific_days',
            days_of_week: [1, 4],
            time_of_day: '20:00',
            ...patch,
          }),
        ]}
      />
    );
    return onChange;
  };

  it('locks the type, weekdays, time and rule changes but not the dose', () => {
    const onChange = locked();
    expect(screen.getByLabelText('Rule 1 type')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mon' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove rule' })).toBeDisabled();
    const dose = screen.getByLabelText('Rule 1 dose override');
    expect(dose).toBeEnabled();
    fireEvent.change(dose, { target: { value: '2' } });
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      dose_amount: '2',
      schedule_type_id: 'specific_days',
      days_of_week: [1, 4],
    });
  });

  it('locks the interval and anchor, but leaves the rule end and food relation', () => {
    locked({
      schedule_type_id: 'every_n_days',
      interval_days: 3,
      anchor_date: '2026-12-01',
    });
    expect(screen.getByLabelText('Interval (days)')).toBeDisabled();
    expect(screen.getByLabelText('Rule anchor (optional)')).toBeDisabled();
    expect(screen.getByLabelText('Rule end (optional)')).toBeEnabled();
    expect(screen.getByLabelText('Rule 1 food relation')).toBeEnabled();
  });

  it('leaves everything editable without lockTiming', () => {
    render(<MedicationCourseRules rules={[rule()]} onChange={jest.fn()} />);
    expect(screen.getByLabelText('Rule 1 type')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
  });
});
