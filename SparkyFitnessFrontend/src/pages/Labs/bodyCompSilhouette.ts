import type { BodyCompRegion } from '@workspace/shared';

/**
 * Front-view silhouette geometry (180 by 320 viewBox), from Pitstop's body-silhouette. Only
 * outlines: nothing here is the scan image. The subject's LEFT is drawn on the VIEWER'S LEFT.
 */
export const SILHOUETTE_VIEWBOX = '0 0 180 320';
export const HEAD_ELLIPSE = { cx: 90, cy: 26, rx: 15, ry: 18 } as const;

const NECK = 'M82,42 L98,42 L100,55 L80,55 Z';
const TORSO =
  'M80,53 C66,54 58,60 52,70 C40,74 33,82 34,92 C36,104 42,118 48,128 C53,138 57,148 58,156 L122,156 C123,148 127,138 132,128 C138,118 144,104 146,92 C147,82 140,74 128,70 C122,60 114,54 100,53 C93,52 87,52 80,53 Z';
const LEFT_ARM =
  'M44,76 C36,96 34,128 40,158 C42,166 48,168 53,164 C56,150 54,118 54,92 C53,82 49,76 44,76 Z';
const RIGHT_ARM =
  'M136,76 C144,96 146,128 140,158 C138,166 132,168 127,164 C124,150 126,118 126,92 C127,82 131,76 136,76 Z';
const PELVIS =
  'M58,154 L122,154 C128,165 126,184 120,194 L60,194 C54,184 52,165 58,154 Z';
const LEFT_LEG =
  'M60,192 L89,192 C91,238 86,282 80,309 C77,316 66,316 63,309 C55,282 53,236 60,192 Z';
const RIGHT_LEG =
  'M91,192 L120,192 C127,236 125,282 117,309 C114,316 103,316 100,309 C94,282 89,238 91,192 Z';

/** The six drawn regions: the head is an ellipse, the trunk is neck, torso and pelvis together. */
export const FIGURE_SHAPES = {
  head: { ellipse: HEAD_ELLIPSE, paths: [] as string[] },
  trunk: { ellipse: null, paths: [NECK, TORSO, PELVIS] },
  l_arm: { ellipse: null, paths: [LEFT_ARM] },
  r_arm: { ellipse: null, paths: [RIGHT_ARM] },
  l_leg: { ellipse: null, paths: [LEFT_LEG] },
  r_leg: { ellipse: null, paths: [RIGHT_LEG] },
} as const;

/** Where each region's printed % fat is written. */
export const FIGURE_LABEL_POS: Record<
  keyof typeof FIGURE_SHAPES,
  { x: number; y: number }
> = {
  head: { x: 90, y: 29 },
  trunk: { x: 90, y: 118 },
  l_arm: { x: 44, y: 122 },
  r_arm: { x: 136, y: 122 },
  l_leg: { x: 74, y: 252 },
  r_leg: { x: 106, y: 252 },
};

export type DrawnRegion = keyof typeof FIGURE_SHAPES;
export const isDrawnRegion = (region: BodyCompRegion): region is DrawnRegion =>
  region in FIGURE_SHAPES;
