/**
 * The geometry of an ECG trace redrawn from an imported Garmin report. Pure: no React, no DOM.
 *
 * Everything is in millimetres on the report's own paper (25 mm/s and 10 mm/mV unless the report
 * says otherwise), so a big square is 0.2 s wide and 0.5 mV tall exactly as on the printed page.
 * Nothing here reads the trace; it only places it.
 */

export interface TraceStrip {
  t0Ms: number;
  dtMs: number;
  uv: (number | null)[];
}
export interface TraceWaveform {
  strips: TraceStrip[];
}

export const DEFAULT_MM_PER_SEC = 25;
export const DEFAULT_MM_PER_MV = 10;
/** Blank space at the left of a row for the 1 mV calibration bar. */
export const PAD_LEFT_MM = 7;
/** Amplitude window, in millimetres either side of the baseline. */
export const MIN_HALF_MM = 10;
export const MAX_HALF_MM = 40;

/** The printed paper speed and gain, or the ECG standard where the report did not print them. */
export function resolveScale(
  mmPerSec: number | null | undefined,
  mmPerMv: number | null | undefined
) {
  return {
    speed: mmPerSec && mmPerSec > 0 ? mmPerSec : DEFAULT_MM_PER_SEC,
    gain: mmPerMv && mmPerMv > 0 ? mmPerMv : DEFAULT_MM_PER_MV,
  };
}

export function secondsLabel(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}

/**
 * `M x y L x y …`, restarted at every hole so a stretch the report did not draw is a break in the
 * line rather than a straight segment that was never recorded.
 */
export function stripPath(
  uv: (number | null)[],
  dtMs: number,
  mmPerSec: number,
  mmPerMv: number,
  leadMm: number
): string {
  const xStep = (dtMs / 1000) * mmPerSec;
  let d = '';
  let pen = false;
  for (let i = 0; i < uv.length; i++) {
    const v = uv[i];
    if (v == null) {
      pen = false;
      continue;
    }
    const x = (leadMm + i * xStep).toFixed(2);
    const y = (-(v / 1000) * mmPerMv).toFixed(2);
    d += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
  }
  return d;
}

/**
 * Every strip on ONE time scale, so a big square means the same in all of them and a strip that
 * starts late starts late on the page too. The row is the longest strip rounded to a whole
 * second; a strip's lead-in is how far into its own row it began.
 */
export function rowGeometry(
  strips: { t0Ms: number; dtMs: number; uv: unknown[] }[],
  mmPerSec: number
) {
  const spans = strips.map((s) => Math.max(0, s.uv.length - 1) * s.dtMs);
  const rowMs = Math.max(1000, Math.round(Math.max(...spans) / 1000) * 1000);
  const leads = strips.map((s) => ((s.t0Ms % rowMs) + rowMs) % rowMs);
  const widthMm =
    (Math.max(...leads.map((lead, i) => lead + spans[i]!)) / 1000) * mmPerSec;
  return { leads, spans, widthMm: Math.max(1, widthMm) };
}

/** Half the drawing height: the peak plus a margin, to a whole big square, within the window. */
export function amplitudeHalfMm(peakMv: number, gain: number): number {
  return Math.min(
    MAX_HALF_MM,
    Math.max(MIN_HALF_MM, Math.ceil((peakMv * gain + 2) / 5) * 5)
  );
}

/** Everything the SVG needs, or null when the waveform has no drawn sample at all. */
export function buildTraceModel(
  waveform: TraceWaveform,
  mmPerSec: number | null | undefined,
  mmPerMv: number | null | undefined
) {
  const { speed, gain } = resolveScale(mmPerSec, mmPerMv);
  let peakUv = -1;
  for (const strip of waveform.strips)
    for (const v of strip.uv)
      if (v != null) peakUv = Math.max(peakUv, Math.abs(v));
  if (peakUv < 0) return null;

  const halfMm = amplitudeHalfMm(peakUv / 1000, gain);
  const row = rowGeometry(waveform.strips, speed);
  const rowSeconds = Math.round(row.widthMm / speed);
  return {
    speed,
    gain,
    halfMm,
    heightMm: halfMm * 2,
    widthMm: row.widthMm,
    rowSeconds,
    strips: waveform.strips.map((strip, index) => {
      const leadMm = (row.leads[index]! / 1000) * speed;
      return {
        t0Ms: strip.t0Ms,
        endMs: strip.t0Ms + row.spans[index]!,
        path: stripPath(strip.uv, strip.dtMs, speed, gain, leadMm),
      };
    }),
  };
}
