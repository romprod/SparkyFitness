import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  addDays,
  buildPkOverlay,
  medicationWeekStart,
  resolveMedicationPkProfile,
  type PkOverlayDose,
  type PkProfile,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationInjectionsFor } from '@/hooks/useMedications';
import { useMedicationLogWeek } from '@/hooks/Medications/useMedicationLogWeek';

type WindowDays = 7 | 14 | 30;
const WINDOWS: readonly WindowDays[] = [7, 14, 30];
const DAY_MS = 86_400_000;
/** Okabe-Ito colours: distinct for colour-blind readers, and readable in light and dark themes. */
const PALETTE = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#E69F00',
  '#56B4E9',
];

const mgOf = (amount: string | null, unit: string | null): number | null => {
  const value = Number(amount);
  if (amount === null || !Number.isFinite(value) || !(value > 0)) return null;
  const u = unit?.trim().toLowerCase();
  if (u === 'mg') return value;
  if (u === 'mcg' || u === 'ug' || u === 'µg' || u === 'μg')
    return value / 1000;
  return null;
};

/**
 * Modeled levels of every injectable with a known half-life on one chart, as Pitstop's overlay
 * does: each scaled to its own peak, solid for doses taken and dashed ahead of now, where planned
 * doses are added. It is an estimate from published half-lives, never a measured level.
 */
export default function MedicationLevelsOverlay({
  medications,
  today,
}: {
  medications: Medication[];
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const { timezone } = usePreferences();
  const [windowDays, setWindowDays] = useState<WindowDays>(14);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Every active injectable is either drawn (it has a half-life) or listed as having no curve.
  // One flagged as GLP-1 takes its figures from the drug it was set up with, so it is not asked for one.
  const { modeled, unmodelled } = useMemo(() => {
    const drawn: { med: Medication; profile: PkProfile }[] = [];
    const missing: Medication[] = [];
    for (const med of medications) {
      if (
        med.is_active === false ||
        med.is_supplement ||
        med.type_id !== 'injection'
      )
        continue;
      const profile = resolveMedicationPkProfile({
        name: med.name,
        custom_fields: med.custom_fields as Record<string, unknown> | null,
      });
      if (profile) drawn.push({ med, profile });
      else if (!med.is_glp1) missing.push(med);
    }
    return { modeled: drawn, unmodelled: missing };
  }, [medications]);
  const injections = useMedicationInjectionsFor(modeled.map((m) => m.med.id));
  // Planned doses ahead come from the weekly plan the calendar uses, read only as far as the window.
  const first = medicationWeekStart(today);
  const weeksNeeded = windowDays <= 7 ? 2 : windowDays <= 14 ? 3 : 5;
  const enabled = modeled.length > 0;
  const w0 = useMedicationLogWeek(first, enabled);
  const w1 = useMedicationLogWeek(
    addDays(first, 7),
    enabled && weeksNeeded > 1
  );
  const w2 = useMedicationLogWeek(
    addDays(first, 14),
    enabled && weeksNeeded > 2
  );
  const w3 = useMedicationLogWeek(
    addDays(first, 21),
    enabled && weeksNeeded > 3
  );
  const w4 = useMedicationLogWeek(
    addDays(first, 28),
    enabled && weeksNeeded > 4
  );
  const plannedSlots = [w0, w1, w2, w3, w4].flatMap(
    (week) => week.data?.planned_slots ?? []
  );

  // Cheap to compute (a few hundred points per medication), so it follows every render.
  const lines = buildPkOverlay({
    now,
    window_days: windowDays,
    series: modeled.map(({ med, profile }) => ({
      id: med.id,
      name: med.display_name || med.name,
      profile,
      taken: (injections.data[med.id] ?? []).flatMap(
        (injection): PkOverlayDose[] => {
          const dose = Number(injection.dose_mg);
          return injection.injected_at && Number.isFinite(dose)
            ? [{ at: injection.injected_at, dose_mg: dose }]
            : [];
        }
      ),
      planned: plannedSlots.flatMap((slot): PkOverlayDose[] => {
        const dose = mgOf(slot.dose_amount, slot.dose_unit);
        return slot.medication_id === med.id &&
          (slot.status === 'planned' || slot.status === 'pending') &&
          slot.scheduled_for &&
          dose !== null
          ? [{ at: slot.scheduled_for, dose_mg: dose }]
          : [];
      }),
    })),
  });
  const noCurve =
    unmodelled.length > 0 ? (
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.levels.noCurve',
          'No curve for {{names}}: add its half-life when editing the medication to draw it.',
          {
            names: unmodelled
              .map((med) => med.display_name || med.name)
              .join(', '),
          }
        )}
      </p>
    ) : null;
  if (lines.length === 0) {
    if (!noCurve) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            {t('medications.levels.title', 'Modeled levels')}
          </CardTitle>
        </CardHeader>
        <CardContent>{noCurve}</CardContent>
      </Card>
    );
  }

  const nowMs = now.getTime();
  const colour = new Map(
    lines.map((line, index) => [line.id, PALETTE[index % PALETTE.length]!])
  );
  const rows = new Map<number, Record<string, number>>();
  for (const line of lines)
    for (const [key, points] of [
      [`${line.id}_taken`, line.historical],
      [`${line.id}_ahead`, line.forecast],
    ] as const)
      for (const point of points) {
        const row = rows.get(point.t) ?? { t: point.t };
        row[key] = Number((point.level * 100).toFixed(1));
        rows.set(point.t, row);
      }
  const data = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((time) => rows.get(time)!);
  const dayLabel = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'short',
      timeZone: timezone,
    }).format(new Date(ms));
  const ticks = Array.from(
    { length: 5 },
    (_, i) => nowMs + ((i - 2) * windowDays * DAY_MS) / 2
  );
  const includesPlanned = lines.some((line) => line.includes_planned);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            {t('medications.levels.title', 'Modeled levels')}
          </CardTitle>
          <div
            className="flex gap-1"
            role="group"
            aria-label={t('medications.levels.window', 'Time window')}
          >
            {WINDOWS.map((days) => (
              <Button
                key={days}
                size="sm"
                variant={windowDays === days ? 'default' : 'outline'}
                aria-pressed={windowDays === days}
                onClick={() => setWindowDays(days)}
              >
                {t('medications.levels.days', '{{count}} days', {
                  count: days,
                })}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="h-48 w-full"
          role="img"
          aria-label={t(
            'medications.levels.chartLabel',
            'Modeled levels of {{names}} over {{count}} days either side of today, each as a percentage of its own peak',
            {
              names: lines.map((line) => line.name).join(', '),
              count: windowDays,
            }
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[
                  nowMs - windowDays * DAY_MS,
                  nowMs + windowDays * DAY_MS,
                ]}
                ticks={ticks}
                tickFormatter={dayLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tickFormatter={(value: number) => `${value}%`}
                width={40}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(value) => dayLabel(Number(value))}
                formatter={(value, name) => [
                  `${value}%`,
                  lines.find((line) => String(name).startsWith(line.id))
                    ?.name ?? String(name),
                ]}
              />
              <ReferenceLine
                x={nowMs}
                stroke="currentColor"
                strokeOpacity={0.6}
                label={{
                  value: t('medications.levels.now', 'Now'),
                  position: 'insideTopRight',
                  fontSize: 11,
                }}
              />
              {lines.map((line) => (
                <Line
                  key={`${line.id}_taken`}
                  dataKey={`${line.id}_taken`}
                  stroke={colour.get(line.id)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
              {lines.map((line) => (
                <Line
                  key={`${line.id}_ahead`}
                  dataKey={`${line.id}_ahead`}
                  stroke={colour.get(line.id)}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-4 rounded-sm"
                style={{ backgroundColor: colour.get(line.id) }}
              />
              <span className="font-medium">{line.name}</span>
              <span className="text-muted-foreground">
                {t('medications.levels.nowLevel', '{{percent}}% of peak now', {
                  percent: Math.round(line.now_level * 100),
                })}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.levels.note',
            'A model from published half-lives, not a measured blood level. Each medication is scaled to its own peak in this window, so lines compare timing, not amounts. Solid: doses taken. Dashed: ahead of now, {{ahead}}.',
            {
              ahead: includesPlanned
                ? t(
                    'medications.levels.aheadPlanned',
                    'from doses taken plus doses planned'
                  )
                : t(
                    'medications.levels.aheadTaken',
                    'from doses already taken'
                  ),
            }
          )}
        </p>
        {noCurve}
      </CardContent>
    </Card>
  );
}
