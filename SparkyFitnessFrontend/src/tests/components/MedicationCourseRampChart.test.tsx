import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  courseCurrentPhase,
  coursePhaseTargets,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import MedicationCourseRampChart from '@/pages/Medications/MedicationCourseRampChart';
import { buildRampPlan } from '@/pages/Medications/medicationCourseRampPlan';

// The chart needs real layout in jsdom; the component's own logic is what is tested, so the
// chart's data, phase labels and markers are exposed as plain markup.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({
    data,
    children,
  }: {
    data: unknown[];
    children: React.ReactNode;
  }) => (
    <div data-testid="ramp-chart" data-rows={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({
    dataKey,
    strokeDasharray,
  }: {
    dataKey: string;
    strokeDasharray?: string;
  }) => (
    <i
      data-testid="ramp-line"
      data-key={dataKey}
      data-dashed={strokeDasharray ? 'yes' : 'no'}
    />
  ),
  ReferenceArea: ({ label }: { label: { value: string } }) => (
    <i data-testid="ramp-phase">{label.value}</i>
  ),
  ReferenceLine: ({ x }: { x: number }) => (
    <i data-testid="ramp-today" data-x={x} />
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

type Steps = MedicationCoursePlanInput['steps'];
const step = (dose: string, days: number | null): Steps[number] => ({
  dose,
  dose_unit: 'mg',
  duration_days: days,
  notes: null,
});
// The owner's ramp: 1 mg for 6 days, 2 mg for 18 days, then 4 mg open-ended.
const ramp: Steps = [step('1', 6), step('2', 18), step('4', null)];
const every6: MedicationCoursePlanInput['rules'] = [
  { schedule_type_id: 'every_n_days', interval_days: 6, time_of_day: null },
];
const props = {
  steps: ramp,
  rules: every6,
  doseBasis: 'per_injection' as const,
  startDate: '2026-11-16' as string | null,
  endDate: null as string | null,
  today: '2026-11-20',
};

it('counts doses per phase with the planner rule for an every-6-days schedule', () => {
  render(<MedicationCourseRampChart {...props} />);
  expect(screen.getAllByTestId('ramp-phase').map((n) => n.textContent)).toEqual(
    ['1 dose', '3 doses', 'maintenance']
  );
  expect(
    screen.getByText('1 mg × 1, 2 mg × 3, then 4 mg ongoing')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', {
      name: 'Planned dose per administration over time',
    })
  ).toHaveAccessibleDescription('1 mg × 1, 2 mg × 3, then 4 mg ongoing');
  expect(
    screen.getByText(/Doses per phase = weeks × 1.17 doses a week/)
  ).toBeInTheDocument();
});

it('uses the same counts as the shared planner functions', () => {
  const plan = buildRampPlan({
    ...props,
    steps: ramp,
    startDate: '2026-11-16',
    endDate: null,
  });
  if (!plan.ok) throw new Error('expected a plan');
  expect(plan.phases.map((phase) => phase.doses)).toEqual(
    coursePhaseTargets(
      ramp.map((row, step_index) => ({ ...row, step_index })),
      7 / 6
    )
  );
  expect(plan.phases.map((phase) => phase.doses)).toEqual([1, 3, null]);
  // And the live resolver agrees: after 1 dose it is in phase 2, after 4 in maintenance.
  const revision = {
    rules: every6,
    steps: ramp.map((row, step_index) => ({
      ...row,
      step_index,
      id: `s${step_index}`,
    })),
    start_date: '2026-11-16',
    end_date: null,
    dose_basis: 'per_injection',
    dose_unit: 'mg',
    target_dose: null,
  } as unknown as Parameters<typeof courseCurrentPhase>[0]['revision'];
  const at = (n: number) =>
    courseCurrentPhase({ revision, deliveredCount: n }).current_step_index;
  expect([at(0), at(1), at(3), at(4)]).toEqual([0, 1, 1, 2]);
});

it('draws the open-ended phase dashed and the solid steps from the start', () => {
  render(<MedicationCourseRampChart {...props} />);
  expect(
    screen
      .getAllByTestId('ramp-line')
      .map((n) => [n.dataset['key'], n.dataset['dashed']])
  ).toEqual([
    ['dose', 'no'],
    ['maint', 'yes'],
  ]);
  const rows = JSON.parse(screen.getByTestId('ramp-chart').dataset['rows']!);
  expect(rows[0]).toMatchObject({ x: 0, dose: 1 });
  expect(rows[1]).toMatchObject({ x: 6, dose: 2 });
  expect(rows[2]).toMatchObject({ x: 24, dose: 4, maint: 4 });
});

it('shows a Today marker when the plan has started and has not ended', () => {
  const { rerender } = render(<MedicationCourseRampChart {...props} />);
  expect(screen.getByTestId('ramp-today')).toHaveAttribute('data-x', '4');
  rerender(<MedicationCourseRampChart {...props} startDate="2026-12-01" />);
  expect(screen.queryByTestId('ramp-today')).not.toBeInTheDocument();
  rerender(<MedicationCourseRampChart {...props} endDate="2026-11-18" />);
  expect(screen.queryByTestId('ramp-today')).not.toBeInTheDocument();
  rerender(
    <MedicationCourseRampChart
      {...props}
      steps={[step('1', 6), step('2', 18)]}
      today="2026-12-20"
    />
  );
  expect(screen.queryByTestId('ramp-today')).not.toBeInTheDocument();
});

it('plots the per-administration amount for a per-week basis', () => {
  render(
    <MedicationCourseRampChart
      {...props}
      doseBasis="per_week"
      steps={[step('1', 14), step('2', null)]}
      rules={[
        {
          schedule_type_id: 'specific_days',
          days_of_week: [1, 4],
          time_of_day: null,
        },
      ]}
    />
  );
  expect(screen.getAllByTestId('ramp-phase').map((n) => n.textContent)).toEqual(
    ['4 doses', 'maintenance']
  );
  expect(screen.getByText('0.5 mg × 4, then 1 mg ongoing')).toBeInTheDocument();
});

it('shows the editor message instead of a chart for a per-week basis with no frequency', () => {
  render(
    <MedicationCourseRampChart
      {...props}
      doseBasis="per_week"
      rules={[{ schedule_type_id: 'prn', time_of_day: null }]}
    />
  );
  expect(screen.queryByTestId('ramp-chart')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Set a weekly schedule first. Per-week dosing needs a known injection frequency.'
  );
});

it('says why when the schedule gives the planner no steady frequency', () => {
  render(
    <MedicationCourseRampChart
      {...props}
      rules={[{ schedule_type_id: 'prn', time_of_day: null }]}
    />
  );
  expect(screen.queryByTestId('ramp-chart')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Sparky counts doses per phase from a steady schedule'
  );
});

it('waits for a dose in every phase and uses weeks when there is no start date', () => {
  const { rerender } = render(
    <MedicationCourseRampChart {...props} steps={[step('', 6)]} />
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Enter a dose and a whole number of days'
  );
  rerender(<MedicationCourseRampChart {...props} startDate={null} />);
  expect(screen.getByText(/counts weeks from the start/)).toBeInTheDocument();
  expect(screen.queryByTestId('ramp-today')).not.toBeInTheDocument();
});

it('warns that phases after an open-ended phase are never reached', () => {
  render(
    <MedicationCourseRampChart
      {...props}
      steps={[step('1', null), step('2', 7)]}
    />
  );
  expect(screen.getAllByTestId('ramp-phase')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('never reached');
});
