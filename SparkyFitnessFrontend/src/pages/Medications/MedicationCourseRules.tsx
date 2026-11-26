import { useTranslation } from 'react-i18next';
import type { MedicationCourseRuleInput } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/TimeInput';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function MedicationCourseRules({
  rules,
  onChange,
  disabled = false,
  lockTiming = false,
}: {
  rules: MedicationCourseRuleInput[];
  onChange: (rules: MedicationCourseRuleInput[]) => void;
  disabled?: boolean;
  /**
   * A stack schedule sets the timing (type, weekdays, interval, cycle, time and
   * anchor); the dose, meal hint, rule start and end stay editable.
   */
  lockTiming?: boolean;
}) {
  const { t } = useTranslation();
  const timingLocked = disabled || lockTiming;
  const change = (index: number, patch: Partial<MedicationCourseRuleInput>) =>
    onChange(
      rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    );
  return (
    <div className="space-y-3">
      <h4 className="font-medium">
        {t('medications.courses.rules', 'Schedule rules')}
      </h4>
      {rules.map((rule, index) => (
        <fieldset
          disabled={disabled}
          key={index}
          className="space-y-3 rounded-md border p-3"
        >
          <legend className="px-1 text-sm">
            {t('medications.courses.ruleNumber', 'Rule {{number}}', {
              number: index + 1,
            })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('medications.schedule.type', 'Schedule Type')}</Label>
              <Select
                disabled={timingLocked}
                value={rule.schedule_type_id}
                onValueChange={(value) =>
                  change(index, {
                    schedule_type_id:
                      value as MedicationCourseRuleInput['schedule_type_id'],
                    // As in Pitstop, an interval starts at 3 days and a cycle at 5 on / 2 off.
                    ...(value === 'every_n_days' && !rule.interval_days
                      ? { interval_days: 3 }
                      : {}),
                    ...(value === 'cyclic' && !rule.cycle_on_days
                      ? { cycle_on_days: 5, cycle_off_days: 2 }
                      : {}),
                  })
                }
              >
                <SelectTrigger
                  aria-label={t(
                    'medications.courses.ruleType',
                    'Rule {{number}} type',
                    { number: index + 1 }
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      'daily',
                      'weekly',
                      'specific_days',
                      'every_n_days',
                      'monthly',
                      'cyclic',
                      'taper',
                      'prn',
                    ] as const
                  ).map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(
                        `medications.scheduleTypes.${type}`,
                        {
                          daily: 'Every day',
                          weekly: 'Specific days of week',
                          specific_days: 'Specific days',
                          every_n_days: 'Every N days',
                          monthly: 'Monthly',
                          cyclic: 'Cyclic (On/Off)',
                          taper: 'Taper / titration',
                          prn: 'As needed (PRN)',
                        }[type]
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {rule.schedule_type_id !== 'prn' && (
              <div className="space-y-1">
                <Label>{t('medications.schedule.time', 'Time of Day')}</Label>
                <TimeInput
                  disabled={timingLocked}
                  aria-label={t(
                    'medications.courses.ruleTime',
                    'Rule {{number}} time',
                    { number: index + 1 }
                  )}
                  value={rule.time_of_day ?? ''}
                  onChange={(time) =>
                    change(index, { time_of_day: time || null })
                  }
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>
                {t('medications.courses.ruleDose', 'Optional dose override')}
              </Label>
              <Input
                aria-label={t(
                  'medications.courses.ruleDoseLabel',
                  'Rule {{number}} dose override',
                  { number: index + 1 }
                )}
                inputMode="decimal"
                value={rule.dose_amount ?? ''}
                onChange={(event) =>
                  change(index, { dose_amount: event.target.value || null })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>
                {t('medications.schedule.withMeal', 'Food Relation')}
              </Label>
              <Select
                disabled={disabled}
                value={rule.with_meal ?? 'none'}
                onValueChange={(value) =>
                  change(index, {
                    with_meal:
                      value === 'none'
                        ? null
                        : (value as MedicationCourseRuleInput['with_meal']),
                  })
                }
              >
                <SelectTrigger
                  aria-label={t(
                    'medications.courses.ruleMeal',
                    'Rule {{number}} food relation',
                    { number: index + 1 }
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      'none',
                      'before',
                      'with',
                      'after',
                      'away_from_meals',
                    ] as const
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(
                        `medications.courses.meal.${value}`,
                        {
                          none: 'No preference',
                          before: 'Before food',
                          with: 'With food',
                          after: 'After food',
                          away_from_meals: 'Away from meals',
                        }[value]
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(rule.schedule_type_id === 'weekly' ||
            rule.schedule_type_id === 'specific_days') && (
            <div className="flex flex-wrap gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                (day, dayIndex) => (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    disabled={timingLocked}
                    variant={
                      rule.days_of_week?.includes(dayIndex)
                        ? 'secondary'
                        : 'outline'
                    }
                    aria-pressed={
                      rule.days_of_week?.includes(dayIndex) ?? false
                    }
                    onClick={() =>
                      change(index, {
                        days_of_week: rule.days_of_week?.includes(dayIndex)
                          ? rule.days_of_week.filter((d) => d !== dayIndex)
                          : [...(rule.days_of_week ?? []), dayIndex],
                      })
                    }
                  >
                    {t(`common.daysShort.${day}`, day)}
                  </Button>
                )
              )}
            </div>
          )}
          {(
            [
              'interval_days',
              'day_of_month',
              'cycle_on_days',
              'cycle_off_days',
              'prn_max_per_day',
            ] as const
          )
            .filter(
              (field) =>
                ({
                  interval_days: rule.schedule_type_id === 'every_n_days',
                  day_of_month: rule.schedule_type_id === 'monthly',
                  cycle_on_days: rule.schedule_type_id === 'cyclic',
                  cycle_off_days: rule.schedule_type_id === 'cyclic',
                  prn_max_per_day: rule.schedule_type_id === 'prn',
                })[field]
            )
            .map((field) => (
              <div key={field} className="space-y-1">
                <Label>
                  {t(
                    `medications.courses.${field}`,
                    {
                      interval_days: 'Interval (days)',
                      day_of_month: 'Day of month',
                      cycle_on_days: 'On days',
                      cycle_off_days: 'Off days',
                      prn_max_per_day: 'Maximum per day (optional)',
                    }[field]
                  )}
                </Label>
                <Input
                  type="number"
                  step="1"
                  disabled={timingLocked}
                  min={field === 'cycle_off_days' ? '0' : '1'}
                  aria-label={t(
                    `medications.courses.${field}`,
                    {
                      interval_days: 'Interval (days)',
                      day_of_month: 'Day of month',
                      cycle_on_days: 'On days',
                      cycle_off_days: 'Off days',
                      prn_max_per_day: 'Maximum per day (optional)',
                    }[field]
                  )}
                  value={rule[field] ?? ''}
                  onChange={(event) =>
                    change(index, {
                      [field]:
                        event.target.value === ''
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </div>
            ))}
          {rule.schedule_type_id === 'prn' && (
            <Input
              aria-label={t(
                'medications.courses.prnReason',
                'As-needed reason'
              )}
              value={rule.prn_reason ?? ''}
              onChange={(event) =>
                change(index, { prn_reason: event.target.value || null })
              }
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(['start_date', 'end_date', 'anchor_date'] as const).map(
              (field) => (
                <div key={field} className="space-y-1">
                  <Label>
                    {t(
                      `medications.courses.rule.${field}`,
                      {
                        start_date: 'Rule start (optional)',
                        end_date: 'Rule end (optional)',
                        anchor_date: 'Rule anchor (optional)',
                      }[field]
                    )}
                  </Label>
                  <Input
                    type="date"
                    disabled={timingLocked && field === 'anchor_date'}
                    aria-label={t(
                      `medications.courses.rule.${field}`,
                      {
                        start_date: 'Rule start (optional)',
                        end_date: 'Rule end (optional)',
                        anchor_date: 'Rule anchor (optional)',
                      }[field]
                    )}
                    value={rule[field] ?? ''}
                    onChange={(event) =>
                      change(index, { [field]: event.target.value || null })
                    }
                  />
                </div>
              )
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={lockTiming}
            onClick={() => onChange(rules.filter((_, i) => i !== index))}
          >
            {t('medications.courses.removeRule', 'Remove rule')}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        disabled={timingLocked}
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rules, { schedule_type_id: 'daily', time_of_day: null }])
        }
      >
        {t('medications.courses.addRule', 'Add rule')}
      </Button>
    </div>
  );
}
