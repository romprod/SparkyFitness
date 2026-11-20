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
