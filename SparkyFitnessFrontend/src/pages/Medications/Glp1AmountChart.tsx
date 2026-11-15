import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Syringe } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMedicationInjections, useSerumCurve } from '@/hooks/useMedications';
import {
  absorptionRate,
  resolveGlp1Profile,
  serumLevelAt,
} from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { Medication } from '@/types/medications';
import { legacyModelAvailability } from './modelAvailability';

type PkAxisMode = 'date' | 'day';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function Glp1AmountChart({ med }: { med: Medication }) {
  const { t } = useTranslation();
  const { formatDateInUserTimezone } = usePreferences();
  const [axisMode, setAxisMode] = useState<PkAxisMode>('date');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    const timer = window.setInterval(updateNow, 60_000);
    window.addEventListener('focus', updateNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateNow);
    };
  }, []);
  const medId = med.id;
  const glp1Drug = (
    med.custom_fields as { glp1_drug?: string } | null | undefined
  )?.glp1_drug;
  const isOralGlp1 =
    glp1Drug === 'oral_semaglutide' ||
    (glp1Drug === 'custom' &&
      (med.custom_fields as { custom_is_oral?: boolean } | null | undefined)
        ?.custom_is_oral === true);
  // Injection-specific UI (body map, pens, shot log) only applies to injectable meds.
  // Oral/liquid GLP-1 (e.g. Rybelsus) still gets the PK curve, titration & fasting timer.
  const isInjectable = med.type_id === 'injection';
  const gradientId = useId();

  const curveQ = useSerumCurve(medId);
  const injectionsQ = useMedicationInjections(medId);

  const availability =
    curveQ.data?.modelAvailability ??
    (curveQ.data
      ? legacyModelAvailability(med, curveQ.data, injectionsQ.data?.length)
      : null);
  const canDisplayModel =
    !curveQ.isError && availability?.status === 'available';
  const legacyNeedsHistory =
    !!curveQ.data &&
    !curveQ.data.modelAvailability &&
    curveQ.data.curve.length === 0 &&
    availability?.reason !== 'unresolved_profile';
  const legacyHistoryError = legacyNeedsHistory && injectionsQ.isError;
  const legacyHistoryPending =
    legacyNeedsHistory &&
    (!injectionsQ.data || injectionsQ.isPending || injectionsQ.isFetching);
  const medicationName = med.display_name || med.name;
  const invalidFields =
    curveQ.data?.modelAvailability?.reason === 'invalid_parameters'
      ? (curveQ.data.modelAvailability.invalidParameters ?? [])
      : [];
  const invalidFieldNames = invalidFields
    .map((field) =>
      field === 'halfLifeDays'
        ? t('medications.glp1.modelHalfLife', 'Half-life')
        : t('medications.glp1.modelTimeToPeak', 'Time to peak')
    )
    .join(', ');

  const anchorDate = curveQ.data?.anchorDate ?? null;
  // Day 0 is the earliest injection. Without that anchor the curve can only be
  // expressed as offsets, so the date axis is unavailable rather than guessed at.
  const anchorMs = useMemo(() => {
    if (!anchorDate) return null;
    const ms = new Date(anchorDate).getTime();
    return Number.isNaN(ms) ? null : ms;
  }, [anchorDate]);
  const canShowDates = anchorMs !== null;
  const effectiveAxisMode: PkAxisMode = canShowDates ? axisMode : 'day';

  // Match the server's latest-60-injection window and profile. Do not combine
  // a newly fetched injection list with an older curve while queries refresh.
  const amountModel = useMemo(() => {
    const response = curveQ.data;
    if (
      !isInjectable ||
      isOralGlp1 ||
      !response ||
      anchorMs === null ||
      !injectionsQ.data
    )
      return null;
    const fields = med.custom_fields;
    const profile =
      resolveGlp1Profile(med.name) ??
      (glp1Drug ? resolveGlp1Profile(glp1Drug) : undefined) ??
      (glp1Drug === 'custom'
        ? {
            halfLifeDays: Number(fields?.['custom_half_life_days']) || 7,
            tMaxDays: Number(fields?.['custom_t_max_days']) || 1.5,
          }
        : undefined);
    if (
      !profile ||
      !(profile.halfLifeDays > 0) ||
      !Number.isFinite(profile.halfLifeDays)
    )
      return null;
    const injections = [...injectionsQ.data]
      .sort((a, b) => Date.parse(b.injected_at) - Date.parse(a.injected_at))
      .slice(0, 60)
      .reverse();
    const doses = injections.map((injection) => ({
      day: (Date.parse(injection.injected_at) - anchorMs) / DAY_MS,
      doseMg: injection.dose_mg == null ? 1 : Number(injection.dose_mg),
    }));
    if (
      doses.length !== response.doseDays.length ||
      doses[0]?.day !== 0 ||
      doses.some(
        (dose, index) =>
          !Number.isFinite(dose.day) ||
          !Number.isFinite(dose.doseMg) ||
          dose.doseMg < 0 ||
          Number(dose.day.toFixed(2)) !== response.doseDays[index]
      )
    )
      return null;
    // Dose edits can retain the same dates; check model values too before
    // combining independently cached responses (allow API day rounding).
    if (
      response.curve.some(
        (point) =>
          Math.abs(serumLevelAt(point.day, doses, profile) - point.level) >
          0.001 * Math.max(1, point.level)
      )
    )
      return null;
    const ka = absorptionRate(profile.halfLifeDays, profile.tMaxDays);
    return (day: number) => {
      const amountMg = serumLevelAt(day, doses, profile);
      const siteMg = doses.reduce(
        (sum, dose) =>
          day < dose.day
            ? sum
            : sum + dose.doseMg * Math.exp(-ka * (day - dose.day)),
        0
      );
      return { amountMg, siteMg, totalMg: amountMg + siteMg };
    };
  }, [
    curveQ.data,
    injectionsQ.data,
    anchorMs,
    isInjectable,
    isOralGlp1,
    med.name,
    med.custom_fields,
    glp1Drug,
  ]);

  const chartData = useMemo(() => {
    const samples = curveQ.data?.curve ?? [];
    const days = new Set(
      samples.map((p) =>
        amountModel ? Math.round(p.day * 1440) / 1440 : p.day
      )
    );
    // Include each exact injection instant and its left limit: total amount
    // jumps at dosing, rather than appearing to rise before an injection.
    if (amountModel && anchorMs !== null && samples.length > 0) {
      for (const injection of injectionsQ.data ?? []) {
        const day = (Date.parse(injection.injected_at) - anchorMs) / DAY_MS;
        if (day >= samples[0]!.day && day <= samples.at(-1)!.day) {
          days.add(day);
          if (day > samples[0]!.day) days.add(day - 1 / DAY_MS);
        }
      }
    }
    return [...days]
      .sort((a, b) => a - b)
      .map((day) => ({
        day,
        // Samples round to minutes; exact injection instants retain their precision.
        ts:
          anchorMs === null
            ? null
            : anchorMs +
              (amountModel ? day * DAY_MS : Math.round(day * 24 * 60) * 60_000),
        ...(amountModel
          ? amountModel(day)
          : {
              amountMg: samples.find((p) => p.day === day)!.level,
            }),
      }));
  }, [curveQ.data?.curve, anchorMs, amountModel, injectionsQ.data]);

  const nowDay = anchorMs === null ? null : (nowMs - anchorMs) / DAY_MS;
  const firstDay = chartData[0]?.day;
  const lastDay = chartData.at(-1)?.day;
  const dailyTicks = useMemo(() => {
    if (firstDay === undefined || lastDay === undefined) return [];
    const start = Math.ceil(firstDay);
    return Array.from(
      { length: Math.max(0, Math.floor(lastDay) - start + 1) },
      (_, index) => {
        const day = start + index;
        return effectiveAxisMode === 'date' && anchorMs !== null
          ? anchorMs + day * DAY_MS
          : day;
      }
    );
  }, [firstDay, lastDay, effectiveAxisMode, anchorMs]);
  const showNow =
    nowDay !== null &&
    firstDay !== undefined &&
    lastDay !== undefined &&
    nowDay >= firstDay &&
    nowDay <= lastDay;
  const nowLabelOnLeft =
    nowDay !== null &&
    firstDay !== undefined &&
    lastDay !== undefined &&
    nowDay > (firstDay + lastDay) / 2;

  // The API's current fraction uses the same sampled peak as these raw levels.
  // Recover its dose-equivalent amount without changing the underlying PK model.
  const peakMg = Math.max(0, ...(curveQ.data?.curve ?? []).map((p) => p.level));
  const currentAmounts =
    amountModel && nowDay !== null ? amountModel(nowDay) : null;
  const currentAmountMg =
    curveQ.data?.currentLevelFraction != null && peakMg > 0
      ? (currentAmounts?.amountMg ?? curveQ.data.currentLevelFraction * peakMg)
      : null;

  const formatAxisDate = (ms: number) =>
    formatDateInUserTimezone(new Date(ms), 'MMM dd');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base font-semibold">
          <span>
            {t(
              'medications.glp1.pkAmountTitle',
              'Modelled absorbed amount — {{drugName}}',
              {
                drugName: canDisplayModel
                  ? (curveQ.data?.drugName ?? curveQ.data?.drugId ?? med.name)
                  : medicationName,
              }
            )}
          </span>
          <span className="flex items-center gap-2">
            {/* Only offer the switch when there is an anchor date to switch to. */}
            {canDisplayModel && canShowDates && chartData.length > 0 && (
              <span className="flex items-center gap-1">
                <Button
                  variant={axisMode === 'date' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setAxisMode('date')}
                  aria-pressed={axisMode === 'date'}
                  className={`rounded-full px-3 h-7 transition-all ${
                    axisMode === 'date'
                      ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="text-xs font-semibold">
                    {t('medications.glp1.pkAxisDates', 'Dates')}
                  </span>
                </Button>
                <Button
                  variant={axisMode === 'day' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setAxisMode('day')}
                  aria-pressed={axisMode === 'day'}
                  className={`rounded-full px-3 h-7 transition-all ${
                    axisMode === 'day'
                      ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="text-xs font-semibold">
                    {t('medications.glp1.pkAxisDays', 'Days')}
                  </span>
                </Button>
              </span>
            )}
            {canDisplayModel && currentAmountMg != null && (
              <Badge variant="secondary">
                {t('medications.glp1.amountNow', '~{{amount}} mg now', {
                  amount: currentAmountMg.toFixed(2),
                })}
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {canDisplayModel && currentAmounts && (
          <dl className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
            {[
              {
                label: t(
                  'medications.glp1.modeledAmount',
                  'Modelled absorbed amount'
                ),
                value: currentAmounts.amountMg,
                color: 'text-blue-500',
              },
              {
                label: t(
                  'medications.glp1.siteAmount',
                  'Modelled at injection sites'
                ),
                value: currentAmounts.siteMg,
                color: 'text-violet-500',
              },
              {
                label: t(
                  'medications.glp1.totalAmount',
                  'Modelled total remaining'
                ),
                value: currentAmounts.totalMg,
                color: 'text-emerald-500',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border p-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={`font-semibold ${color}`}>
                  {value > 0 && value < 0.005 ? '<0.01' : value.toFixed(2)} mg
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!canDisplayModel || chartData.length === 0 ? (
          <div
            role="status"
            className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm text-foreground"
          >
            {curveQ.isError ? (
              <p>
                {t(
                  'medications.glp1.modelLoadError',
                  'Could not load the model for {{medication}}. Try again later.',
                  { medication: medicationName }
                )}
              </p>
            ) : legacyHistoryError ? (
              <p>
                {t(
                  'medications.glp1.modelHistoryLoadError',
                  'Could not load logged doses for this model. Try again later.'
                )}
              </p>
            ) : !curveQ.data || legacyHistoryPending ? (
              <p>
                {t(
                  'medications.glp1.modelLoading',
                  'Loading the model for {{medication}}…',
                  { medication: medicationName }
                )}
              </p>
            ) : availability?.status === 'no_logged_history' ? (
              <p>
                {t(
                  'medications.glp1.modelNoHistory',
                  'No logged doses are available to this model yet.',
                  { medication: medicationName }
                )}
              </p>
            ) : (
              <>
                <p className="font-medium">
                  {t('medications.glp1.modelUnavailable', 'Model unavailable')}
                </p>
                <p>
                  {invalidFieldNames
                    ? t(
                        'medications.glp1.modelInvalidParameters',
                        'Check {{fields}}: each value must be a number greater than zero.',
                        { fields: invalidFieldNames }
                      )
                    : availability?.reason === 'unresolved_profile'
                      ? t(
                          'medications.glp1.modelParametersUnavailable',
                          '{{medication}} has no available model parameters.',
                          { medication: medicationName }
                        )
                      : t(
                          'medications.glp1.modelEmpty',
                          'No modelled curve is available for {{medication}}.',
                          { medication: medicationName }
                        )}
                </p>
                <p className="text-muted-foreground">
                  {t(
                    'medications.glp1.modelSettingsHint',
                    'Review the medication’s GLP-1 model settings in Medications → Cabinet.'
                  )}
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div
                style={{
                  minWidth: Math.max(320, dailyTicks.length * 42 + 88),
                }}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient
                        id={gradientId}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#3b82f6"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor="#3b82f6"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis
                      dataKey={effectiveAxisMode === 'date' ? 'ts' : 'day'}
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      ticks={dailyTicks}
                      interval={0}
                      tickFormatter={(value) =>
                        effectiveAxisMode === 'date'
                          ? formatAxisDate(value)
                          : `D${Math.round(value)}`
                      }
                      fontSize={11}
                    />
                    <YAxis
                      domain={[0, 'auto']}
                      unit=" mg"
                      tickFormatter={(value) => Number(value).toFixed(2)}
                      fontSize={11}
                      width={68}
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
                      formatter={(value, name) => [
                        `${Number(value) > 0 && Number(value) < 0.005 ? '<0.01' : Number(value).toFixed(2)} mg`,
                        name === 'siteMg'
                          ? t(
                              'medications.glp1.siteAmount',
                              'Modelled at injection sites'
                            )
                          : name === 'totalMg'
                            ? t(
                                'medications.glp1.totalAmount',
                                'Modelled total remaining'
                              )
                            : t(
                                'medications.glp1.modeledAmount',
                                'Modelled absorbed amount'
                              ),
                      ]}
                      labelFormatter={(label) => {
                        // Recharts types this as ReactNode; the axis is numeric, so
                        // coerce and fall back to the raw label if it ever isn't.
                        const value = Number(label);
                        if (Number.isNaN(value)) return label;
                        const timestamp =
                          effectiveAxisMode === 'date'
                            ? value
                            : anchorMs === null
                              ? null
                              : anchorMs + Math.round(value * 24 * 60) * 60_000;
                        return timestamp !== null
                          ? formatDateInUserTimezone(
                              new Date(timestamp),
                              'dd MMM yyyy, HH:mm'
                            )
                          : t('medications.glp1.pkDayLabel', 'Day {{day}}', {
                              day: value.toFixed(2),
                            });
                      }}
                    />
                    {/* Injection markers (each logged shot). The x value must be in the
                      same units as the axis, or every marker lands in the wrong place. */}
                    {(curveQ.data?.doseDays ?? []).map((d, i) => (
                      <ReferenceLine
                        key={`dose-${i}`}
                        x={
                          effectiveAxisMode === 'date' && anchorMs !== null
                            ? anchorMs + d * DAY_MS
                            : d
                        }
                        stroke="#9ca3af"
                        strokeDasharray="2 2"
                        label={
                          i === 0
                            ? (props: {
                                viewBox?: { x?: number; y?: number };
                              }) => (
                                <Syringe
                                  x={(props.viewBox?.x ?? 0) - 6}
                                  y={(props.viewBox?.y ?? 0) + 2}
                                  width={12}
                                  height={12}
                                  stroke="#3b82f6"
                                />
                              )
                            : undefined
                        }
                      />
                    ))}
                    <Area
                      type="linear"
                      isAnimationActive={false}
                      dataKey="amountMg"
                      stroke="#3b82f6"
                      fill={`url(#${gradientId})`}
                    />
                    {amountModel && (
                      <Area
                        type="linear"
                        dataKey="siteMg"
                        stroke="#8b5cf6"
                        fill="none"
                        isAnimationActive={false}
                      />
                    )}
                    {amountModel && (
                      <Area
                        type="linear"
                        dataKey="totalMg"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="none"
                        isAnimationActive={false}
                      />
                    )}
                    {showNow && (
                      <ReferenceLine
                        x={effectiveAxisMode === 'date' ? nowMs : nowDay!}
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        label={{
                          value: `${t('medications.glp1.pkNow', 'Now')} · ${formatDateInUserTimezone(new Date(nowMs), 'dd MMM, HH:mm')}`,
                          position: nowLabelOnLeft
                            ? 'insideTopRight'
                            : 'insideTopLeft',
                          fill: '#f59e0b',
                          fontSize: 11,
                        }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                amountModel
                  ? 'medications.glp1.totalAmountDisclaimer'
                  : 'medications.glp1.amountDisclaimer',
                amountModel
                  ? 'Modelled total remaining = absorbed amount + amount at injection sites, assuming full absorption and no local loss. Uses the latest 60 logged injections. Not a measured amount or blood concentration.'
                  : 'Dose-equivalent estimate from your logged injections, assuming full absorption. Not a measured amount or blood concentration.'
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
