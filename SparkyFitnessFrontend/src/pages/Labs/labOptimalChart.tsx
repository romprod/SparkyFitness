import { ReferenceArea, ReferenceLine } from 'recharts';
import { labOptimalBand } from './labOptimal';

/** Whether a chart in this unit has an optimal band to draw. */
export const hasOptimalBand = (
  markerKey: string | null | undefined,
  unit: string
): boolean => labOptimalBand(markerKey, unit) !== null;

/**
 * Recharts reads its children by type, so these are returned as elements, not
 * wrapped in a component. A two-sided band is a green tint; a one-sided band
 * is a dashed guide line.
 */
export const optimalBandElements = (
  markerKey: string | null | undefined,
  unit: string,
  label: string
) => {
  const band = labOptimalBand(markerKey, unit);
  if (!band) return [];
  if (band.low !== null && band.high !== null)
    return [
      <ReferenceArea
        key="optimal-band"
        y1={band.low}
        y2={band.high}
        fill="#22c55e"
        fillOpacity={0.15}
        stroke="none"
        ifOverflow="extendDomain"
        aria-label={label}
      />,
    ];
  const y = band.low ?? band.high;
  if (y === null) return [];
  return [
    <ReferenceLine
      key="optimal-line"
      y={y}
      stroke="#22c55e"
      strokeDasharray="4 3"
      ifOverflow="extendDomain"
      aria-label={label}
    />,
  ];
};
