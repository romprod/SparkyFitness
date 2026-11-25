import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, type MedicationCoursePlanInput } from '@workspace/shared';

import {
  buildRampPlan,
  type RampPhase,
  type Rules,
  type Steps,
} from './medicationCourseRampPlan';

const COLOUR = '#3b82f6';
const NOW_COLOUR = '#f59e0b';

interface Row {
  x: number;
  dose?: number;
  maint?: number;
  phase: number;
}

export default function MedicationCourseRampChart({
  steps,
  rules,
  doseBasis,
  startDate,
  endDate,
  today,
}: {
  steps: Steps;
  rules: Rules;
  doseBasis: MedicationCoursePlanInput['dose_basis'];
  startDate: string | null;
  endDate: string | null;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const summaryId = useId();
  const plan = useMemo(
    () => buildRampPlan({ steps, rules, doseBasis, startDate, endDate, today }),
    [steps, rules, doseBasis, startDate, endDate, today]
  );
  if (steps.length === 0) return null;

  const heading = (
    <h5 className="text-sm font-medium">
      {t('medications.courses.rampTitle', 'Dose ramp preview')}
    </h5>
  );
  if (!plan.ok) {
    const message = {
      incomplete: t(
        'medications.courses.rampIncomplete',
        'Enter a dose and a whole number of days for every phase to preview the ramp.'
      ),
      per_week_needs_schedule: t(
        'medications.courses.perWeekNeedsSchedule',
        'Set a weekly schedule first. Per-week dosing needs a known injection frequency.'
      ),
      no_frequency: t(
        'medications.courses.rampNeedsRhythm',
        'Sparky counts doses per phase from a steady schedule (daily, weekdays or every N days). Set one to preview the ramp.'
      ),
    }[plan.reason];
    return (
      <div className="space-y-1 rounded-md border p-3">
        {heading}
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      </div>
    );
  }

  const { phases, maintenance, finiteDays, endDay, todayDay } = plan;
  const last = phases.at(-1)!;
  const unit = phases[0]!.unit;
  const mixedUnits = phases.some((phase) => phase.unit !== unit);

  const rows = new Map<number, Row>();
  const put = (x: number, patch: Partial<Row>, phase: number) =>
    rows.set(x, { ...(rows.get(x) ?? { x, phase }), ...patch });
  phases.forEach((phase, index) => {
    if (phase.days === null) return;
    put(phase.startDay, { dose: Number(phase.dose) }, phase.number);
    if (index === phases.length - 1)
      put(finiteDays, { dose: Number(phase.dose) }, phase.number);
  });
  if (maintenance) {
    // The riser into maintenance is the last solid point; the dashed line starts there.
    put(
      finiteDays,
      { dose: Number(last.dose), maint: Number(last.dose) },
      last.number
    );
    put(endDay, { maint: Number(last.dose) }, last.number);
  }
  const data = [...rows.values()].sort((a, b) => a.x - b.x);

  const dateOf = (offset: number, withYear: boolean) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${addDays(startDate!, offset)}T00:00:00Z`));
  const weekOf = (offset: number) => String(Math.round((offset / 7) * 10) / 10);
  const tick = (offset: number) =>
    startDate
      ? dateOf(offset, false)
      : t('medications.courses.rampWeekTick', 'Wk {{week}}', {
          week: weekOf(offset),
        });
  const ticks = [
    ...new Set([
      ...phases.filter((p) => p.days !== null).map((p) => p.startDay),
      finiteDays,
    ]),
  ];

  const doseLabel = (count: number) =>
    count === 1
      ? t('medications.courses.rampOneDose', '1 dose')
      : t('medications.courses.rampDoses', '{{count}} doses', { count });
  const phaseLabel = (phase: RampPhase) =>
    phase.doses === null
      ? t('medications.courses.rampMaintenance', 'maintenance')
      : doseLabel(phase.doses);
  const withUnit = (phase: RampPhase) =>
    `${phase.dose}${phase.unit ? ` ${phase.unit}` : ''}`;

  const summary = phases
    .map((phase) =>
      phase.doses === null
        ? t('medications.courses.rampSummaryOngoing', 'then {{dose}} ongoing', {
            dose: withUnit(phase),
          })
        : t('medications.courses.rampSummaryPhase', '{{dose}} × {{count}}', {
            dose: withUnit(phase),
            count: phase.doses,
          })
    )
    .join(', ');
  const perWeekText = String(Math.round(plan.perWeek * 100) / 100);

  return (
    <div className="space-y-2 rounded-md border p-3">
      {heading}
      <div
        className="h-48 w-full"
        role="img"
        aria-label={t(
          'medications.courses.rampChartLabel',
          'Planned dose per administration over time'
        )}
        aria-describedby={summaryId}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, endDay]}
              ticks={ticks}
              tickFormatter={tick}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              domain={[0, 'auto']}
              width={mixedUnits ? 40 : 56}
              unit={mixedUnits || !unit ? '' : ` ${unit}`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.75rem',
                padding: '10px 14px',
                boxShadow: '0 8px 24px rgb(0 0 0 / 25%)',
              }}
              labelStyle={{
                color: 'hsl(var(--popover-foreground))',
                fontSize: 12,
                marginBottom: 6,
              }}
              itemStyle={{
                color: 'hsl(var(--popover-foreground))',
                fontSize: 13,
                padding: 0,
              }}
              labelFormatter={(value) => {
                const offset = Number(value);
                return startDate
                  ? dateOf(offset, true)
                  : t('medications.courses.rampWeekLabel', 'Week {{week}}', {
                      week: weekOf(offset),
                    });
              }}
              formatter={(value, _name, item) => {
                const phase = phases.find(
                  (p) => p.number === (item.payload as Row | undefined)?.phase
                )!;
                return [
                  `${value}${phase.unit ? ` ${phase.unit}` : ''}`,
                  t(
                    'medications.courses.rampTooltipPhase',
                    'Phase {{number}} · {{label}}',
                    { number: phase.number, label: phaseLabel(phase) }
                  ),
                ];
              }}
            />
            {phases.map((phase) => (
              <ReferenceArea
                key={phase.number}
                x1={phase.startDay}
                x2={phase.days === null ? endDay : phase.startDay + phase.days}
                fill="currentColor"
                fillOpacity={phase.number % 2 === 0 ? 0.06 : 0}
                label={{
                  value: phaseLabel(phase),
                  position: 'insideTop',
                  fontSize: 11,
                  fill: 'currentColor',
                }}
              />
            ))}
            {todayDay !== null && (
              <ReferenceLine
                x={todayDay}
                stroke={NOW_COLOUR}
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{
                  value: t('medications.courses.rampToday', 'Today'),
                  position:
                    todayDay > endDay / 2 ? 'insideTopRight' : 'insideTopLeft',
                  fill: NOW_COLOUR,
                  fontSize: 11,
                }}
              />
            )}
            <Line
              type="stepAfter"
              dataKey="dose"
              stroke={COLOUR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            {maintenance && (
              <Line
                type="linear"
                dataKey="maint"
                stroke={COLOUR}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                tooltipType="none"
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p id={summaryId} className="text-sm">
        {summary}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.courses.rampExplainer',
          'Doses per phase = weeks × {{perWeek}} doses a week, rounded. Sparky moves to the next phase once that many doses are logged to the course.',
          { perWeek: perWeekText }
        )}{' '}
        {startDate
          ? ''
          : t(
              'medications.courses.rampNoStart',
              'No start date yet, so the axis counts weeks from the start.'
            )}
      </p>
      {plan.unreachable > 0 && (
        <p className="text-xs text-destructive" role="status">
          {t(
            'medications.courses.rampUnreachable',
            'Phases after an open-ended phase are never reached.'
          )}
        </p>
      )}
    </div>
  );
}
