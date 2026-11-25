import type { ChangeTier } from '@workspace/shared';

/** The words and badge styles the DEXA card gives each tier of change against noise. */
export const TIER_FALLBACK: Record<ChangeTier, string> = {
  within_noise: 'Within measurement noise',
  indeterminate: 'Possible change',
  exceeds_lsc: 'Beyond measurement noise',
};
export const TIER_VARIANT: Record<
  ChangeTier,
  'secondary' | 'outline' | 'default'
> = {
  within_noise: 'secondary',
  indeterminate: 'outline',
  exceeds_lsc: 'default',
};
/**
 * The same three tiers as an SVG fill: grey inside the noise, amber for a possible change and the
 * theme's primary colour beyond it. Never green or red: a change is not a verdict either way.
 */
export const TIER_FILL: Record<ChangeTier, string> = {
  within_noise: 'hsl(var(--muted-foreground))',
  indeterminate: '#f59e0b',
  exceeds_lsc: 'hsl(var(--primary))',
};
