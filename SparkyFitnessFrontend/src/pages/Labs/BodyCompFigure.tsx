import { useTranslation } from 'react-i18next';
import type { BodyCompRegion } from '@workspace/shared';
import {
  fatFillColor,
  FIGURE_REGIONS,
  type BodyFigureModel,
  type FigureCell,
  type FigureRegion,
} from './bodyCompFigureModel';
import {
  FIGURE_LABEL_POS,
  FIGURE_SHAPES,
  SILHOUETTE_VIEWBOX,
} from './bodyCompSilhouette';
import { signed } from './bodyCompFormat';
import { TIER_FILL } from './bodyCompTier';

export type FigureMode = 'levels' | 'change';

const MUTED = 'hsl(var(--muted-foreground))';
const INK = 'hsl(var(--foreground))';

/**
 * A drawn outline of the body, not the scan image. Each printed region is filled by its fat
 * percentage (levels) or tinted by how far that moved since the previous scan (change); a region
 * the report did not print is left unlit. The subject's left is on the viewer's left. The region
 * table beside it is the keyboard path to every region.
 */
export default function BodyCompFigure({
  model,
  mode,
  active,
  onHover,
  onSelect,
  regionLabel,
}: {
  model: BodyFigureModel;
  mode: FigureMode;
  active: BodyCompRegion | null;
  onHover: (region: BodyCompRegion | null) => void;
  onSelect: (region: BodyCompRegion) => void;
  regionLabel: (region: BodyCompRegion) => string;
}) {
  const { t } = useTranslation();
  const byRegion = new Map<BodyCompRegion, FigureCell>(
    model.regions.map((cell) => [cell.region, cell])
  );
  const fillFor = (cell: FigureCell | undefined) => {
    if (!cell) return { fill: 'none', opacity: 1 };
    if (mode === 'change')
      return cell.delta
        ? { fill: TIER_FILL[cell.delta.tier], opacity: 0.6 }
        : { fill: MUTED, opacity: 0.12 };
    return { fill: fatFillColor(cell.pctFat), opacity: 0.85 };
  };
  const labelFor = (cell: FigureCell) =>
    mode === 'change'
      ? cell.delta
        ? signed(cell.delta.fatPts, 1)
        : '—'
      : cell.pctFat.toFixed(1);

  return (
    <svg
      viewBox={SILHOUETTE_VIEWBOX}
      className="mx-auto h-auto w-full max-w-[200px]"
      role="img"
      data-mode={mode}
      aria-label={
        mode === 'change'
          ? t(
              'labs.bodyComp.figure.ariaChange',
              'Body outline: change in fat percentage per region since the previous scan. Use the table for keyboard access to each region.'
            )
          : t(
              'labs.bodyComp.figure.ariaLevels',
              'Body outline: fat percentage per region. Use the table for keyboard access to each region.'
            )
      }
    >
      {FIGURE_REGIONS.map((region: FigureRegion) => {
        const cell = byRegion.get(region);
        const { fill, opacity } = fillFor(cell);
        const shape = FIGURE_SHAPES[region];
        const isActive = active === region;
        const dim = active !== null && !isActive;
        const title = cell
          ? mode === 'change' && cell.delta
            ? t(
                'labs.bodyComp.figure.regionChangeTitle',
                '{{region}}: {{pts}} points of fat since the previous scan',
                {
                  region: regionLabel(region),
                  pts: signed(cell.delta.fatPts, 1),
                }
              )
            : t(
                'labs.bodyComp.figure.regionTitle',
                '{{region}}: {{pct}} % fat',
                { region: regionLabel(region), pct: cell.pctFat.toFixed(1) }
              )
          : t(
              'labs.bodyComp.figure.regionMissing',
              '{{region}}: not printed on this report',
              { region: regionLabel(region) }
            );
        const paint = {
          fill,
          fillOpacity: opacity,
          stroke: INK,
          strokeOpacity: cell ? (isActive ? 1 : 0.4) : 0.35,
          strokeWidth: isActive ? 2 : 1,
          strokeDasharray: cell ? undefined : '3 3',
        };
        return (
          <g
            key={region}
            data-region={region}
            data-lit={cell ? 'true' : 'false'}
            data-active={isActive || undefined}
            opacity={dim ? 0.45 : 1}
            onMouseEnter={() => onHover(region)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(region)}
            style={{ cursor: 'pointer' }}
          >
            <title>{title}</title>
            {shape.ellipse && <ellipse {...shape.ellipse} {...paint} />}
            {shape.paths.map((d) => (
              <path key={d} d={d} {...paint} />
            ))}
            {cell && (
              <text
                data-figure-label={region}
                x={FIGURE_LABEL_POS[region].x}
                y={FIGURE_LABEL_POS[region].y}
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
                fill={INK}
                stroke="hsl(var(--card))"
                strokeWidth="2.5"
                paintOrder="stroke"
                pointerEvents="none"
              >
                {labelFor(cell)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
