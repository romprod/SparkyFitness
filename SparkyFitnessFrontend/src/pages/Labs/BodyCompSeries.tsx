import { useTranslation } from 'react-i18next';
import {
  DEFAULT_BODY_COMP_PRECISION,
  type BodyCompScan,
  type LifeEvent,
  type MetabolicTest,
} from '@workspace/shared';
import type { ScaleBackground } from './bodyCompScaleModel';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  bandEndTime,
  buildSeriesPanels,
  lifeEventShades,
  msDay,
  panelAxisRange,
  seriesTimeRange,
  showSeriesLine,
  type SeriesPanel,
  type SeriesShade,
} from './bodyCompSeriesModel';

const W = 600;
const H = 130;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

const MUTED = 'hsl(var(--muted-foreground))';
/** Illness amber, travel teal, any other window grey; faint, because a window is context, not a signal. */
const EVENT_FILL: Record<LifeEvent['kind'], string> = {
  illness: '#f59e0b',
  travel: '#14b8a6',
  other: MUTED,
};

const PANEL_TITLE: Record<SeriesPanel['key'], string> = {
  fat: 'Fat mass',
  lean: 'Lean mass',
  pctFat: 'Body fat',
  alm: 'Appendicular lean (ALM)',
  vat: 'Visceral fat (VAT)',
  bmd: 'Total BMD',
  rmr: 'Resting metabolic rate',
  weight: 'Weight',
  biaRaw: 'Body fat (scale)',
};

function PanelSvg({
  panel,
  tMin,
  tMax,
  scanCount,
  forwardLabel,
  shades,
}: {
  panel: SeriesPanel;
  tMin: number;
  tMax: number;
  scanCount: number;
  forwardLabel: boolean;
  shades: SeriesShade[];
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const title = t(
    `labs.bodyComp.series.panel.${panel.key}`,
    PANEL_TITLE[panel.key]
  );
  const left = PAD.left;
  const right = W - PAD.right;
  const top = PAD.top;
  const bottom = H - PAD.bottom;
  const xOf = (time: number) =>
    tMax === tMin
      ? (left + right) / 2
      : left + ((time - tMin) / (tMax - tMin)) * (right - left);
  const { lo, hi } = panelAxisRange(panel);
  const yOf = (value: number) =>
    top + (1 - (value - lo) / (hi - lo)) * (bottom - top);
  const pts = panel.points;
  const bg = panel.bg;
  const latest = pts[pts.length - 1];
  if (!latest && bg.length === 0) return null;
  const clipId = `dexa-series-clip-${panel.key}`;
  const hasBand = pts.some((p) => p.band !== null);
  const hasPractical = pts.some((p) => p.band?.practical != null);
  const linePath = pts
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`
    )
    .join(' ');

  const bgPath = bg
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`
    )
    .join(' ');
  const bgLabel =
    panel.bgKind === 'weight'
      ? t(
          'labs.bodyComp.series.bgWeight',
          'Garmin scale, cleaned (7-day median, > 3 kg outliers excluded)'
        )
      : panel.bgKind === 'bia'
        ? t(
            'labs.bodyComp.series.bgBia',
            'Garmin scale, offset to latest DEXA — estimate, not a measurement'
          )
        : panel.bgKind === 'biaRaw'
          ? t(
              'labs.bodyComp.series.bgBiaRaw',
              'Garmin scale, uncalibrated bioimpedance — not a DEXA measurement'
            )
          : null;

  return (
    <div className="rounded-md border p-3" data-series-panel={panel.key}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {latest && (
          <p className="text-sm tabular-nums">
            {latest.v.toFixed(panel.digits)}
            <span className="ml-1 text-xs text-muted-foreground">
              {panel.unit}
            </span>
          </p>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t(
          'labs.bodyComp.series.panelAria',
          '{{title}}, {{count}} point(s) with noise bands',
          { title, count: pts.length }
        )}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={right - left} height={bottom - top} />
          </clipPath>
        </defs>
        {/* Windows sit under the bands and are clipped to the plot. */}
        {shades.map((shade) => {
          const x0 = Math.max(left, xOf(shade.t0));
          const x1 = Math.min(right, xOf(shade.t1));
          if (x1 <= x0) return null;
          return (
            <rect
              key={`ev-${panel.key}-${shade.key}`}
              data-shade={shade.kind}
              x={x0}
              y={top}
              width={x1 - x0}
              height={bottom - top}
              fill={EVENT_FILL[shade.kind]}
              fillOpacity="0.12"
              clipPath={`url(#${clipId})`}
            >
              <title>{shade.title}</title>
            </rect>
          );
        })}
        {/* Bands before the background and the points, so they lie under them. */}
        {pts.map((pt, i) => {
          if (!pt.band) return null;
          const x = xOf(pt.t);
          const width = Math.max(0, xOf(bandEndTime(pts, i)) - x);
          const rect = (half: number, opacity: string, kind: string) => (
            <rect
              data-band={kind}
              x={x}
              y={yOf(pt.v + half)}
              width={width}
              height={Math.max(0, yOf(pt.v - half) - yOf(pt.v + half))}
              fill={MUTED}
              fillOpacity={opacity}
            />
          );
          return (
            <g key={`band-${panel.key}-${pt.day}`}>
              {pt.band.practical !== null &&
                rect(pt.band.practical, '0.10', 'practical')}
              {rect(pt.band.technical, '0.22', 'technical')}
            </g>
          );
        })}
        {/* A faint dashed scale series, clipped to the plot; never a measurement. */}
        {bg.length >= 2 && (
          <path
            data-series-bg={panel.bgKind}
            d={bgPath}
            clipPath={`url(#${clipId})`}
            fill="none"
            stroke={MUTED}
            strokeWidth="1"
            strokeDasharray="3 3"
            strokeOpacity="0.5"
          />
        )}
        {bg.length === 1 && bg[0] && (
          <circle
            data-series-bg={panel.bgKind}
            cx={xOf(bg[0].t)}
            cy={yOf(bg[0].v)}
            r="2"
            clipPath={`url(#${clipId})`}
            fill={MUTED}
            fillOpacity="0.5"
          />
        )}
        <line
          x1={left}
          y1={bottom}
          x2={right}
          y2={bottom}
          stroke={MUTED}
          strokeWidth="0.5"
          strokeOpacity="0.4"
        />
        {showSeriesLine(scanCount, pts.length) && (
          <path
            data-series-line
            d={linePath}
            fill="none"
            stroke={MUTED}
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.7"
          />
        )}
        {pts.map((pt) => (
          <circle
            key={`pt-${panel.key}-${pt.day}`}
            data-series-point
            cx={xOf(pt.t)}
            cy={yOf(pt.v)}
            r="4"
            fill="hsl(var(--foreground))"
            stroke="hsl(var(--card))"
            strokeWidth="1"
          />
        ))}
        <text
          x={left - 4}
          y={top + 3}
          fontSize="9"
          fill={MUTED}
          textAnchor="end"
        >
          {hi.toFixed(panel.digits)}
        </text>
        <text
          x={left - 4}
          y={bottom}
          fontSize="9"
          fill={MUTED}
          textAnchor="end"
        >
          {lo.toFixed(panel.digits)}
        </text>
        <text x={left} y={H - 6} fontSize="9" fill={MUTED}>
          {formatDate(msDay(tMin))}
        </text>
        <text x={right} y={H - 6} fontSize="9" fill={MUTED} textAnchor="end">
          {formatDate(msDay(tMax))}
        </text>
        {forwardLabel && latest?.band && (
          <text
            x={Math.min(right - 2, xOf(latest.t) + 6)}
            y={Math.max(top + 9, yOf(latest.v + latest.band.technical) - 3)}
            fontSize="8"
            fill={MUTED}
          >
            {t('labs.bodyComp.series.forwardLabel', '± LSC forward')}
          </text>
        )}
      </svg>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {pts.length === 0
          ? t('labs.bodyComp.series.captionNoPoint', 'No scan point yet.')
          : hasBand
            ? hasPractical
              ? t(
                  'labs.bodyComp.series.captionBoth',
                  'Dark band ± technical LSC, light band ± practical LSC.'
                )
              : t(
                  'labs.bodyComp.series.captionTechnical',
                  'Dark band ± technical LSC.'
                )
            : t(
                'labs.bodyComp.series.captionNoBand',
                'Clinic scale weight at each scan; no noise band is defined for weight.'
              )}
        {bgLabel
          ? ` ${t('labs.bodyComp.series.dashed', 'Dashed: {{label}}.', { label: bgLabel })}`
          : ''}
        {panel.excludedCount > 0
          ? ` ${t('labs.bodyComp.series.excluded', {
              count: panel.excludedCount,
              defaultValue_one: '{{count}} scale reading excluded.',
              defaultValue_other: '{{count}} scale readings excluded.',
            })}`
          : ''}
      </p>
    </div>
  );
}

/**
 * The scans as small multiples with noise bands, as Pitstop's Body page draws them. Descriptive
 * only: a point is a measurement, a band is how much two readings of the same body can differ.
 * With no scan only the scale background is drawn; left out when there is nothing at all.
 */
export default function BodyCompSeries({
  scans,
  tests,
  lifeEvents,
  scale = null,
}: {
  scans: readonly BodyCompScan[];
  tests: readonly MetabolicTest[];
  lifeEvents: readonly LifeEvent[];
  /** Faint scale series behind the scans; left out when absent, loading or failed. */
  scale?: ScaleBackground | null;
}) {
  const { t } = useTranslation();
  const panels = buildSeriesPanels(
    scans,
    tests,
    DEFAULT_BODY_COMP_PRECISION,
    scale
  );
  if (panels.length === 0) return null;
  const { tMin, tMax } = seriesTimeRange(panels, scans);
  const shades = lifeEventShades(lifeEvents, tMin, tMax);
  const n = scans.length;
  return (
    <section
      className="space-y-2"
      aria-label={t(
        'labs.bodyComp.series.title',
        'Scan series with noise bands'
      )}
    >
      <h3 className="text-xs font-semibold text-muted-foreground">
        {t('labs.bodyComp.series.title', 'Scan series with noise bands')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {n === 1
          ? `${t(
              'labs.bodyComp.series.forward',
              'A future change would need to exceed this band to count'
            )}. `
          : ''}
        {t(
          'labs.bodyComp.series.bands',
          "Bands: default LSC (device class, not this clinic's precision)."
        )}
        {n < 3
          ? ` ${t(
              'labs.bodyComp.series.noLine',
              'No line joins points until three scans exist.'
            )}`
          : ''}
        {shades.length > 0
          ? ` ${t(
              'labs.bodyComp.series.legend',
              'Shaded windows: illness (amber), travel (teal), other (grey).'
            )}`
          : ''}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {panels.map((panel) => (
          <PanelSvg
            key={panel.key}
            panel={panel}
            tMin={tMin}
            tMax={tMax}
            scanCount={n}
            forwardLabel={n === 1}
            shades={shades}
          />
        ))}
      </div>
    </section>
  );
}
