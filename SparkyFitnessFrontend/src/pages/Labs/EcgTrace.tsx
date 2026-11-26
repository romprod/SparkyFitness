import { useTranslation } from 'react-i18next';
import { PAD_LEFT_MM, buildTraceModel, secondsLabel } from './ecgTraceModel';
import type { TraceWaveform } from './ecgTraceModel';

// Fixed, not the destructive token: that token is a dark red in dark mode and the faint grid vanishes.
const GRID_RED = 'hsl(0 84.2% 60.2%)';

/**
 * The ECG trace, redrawn from the imported report in the app's own colours. The viewBox is in
 * millimetres, so the drawing scales to any width but the ratio between time and voltage never
 * distorts. It is a faithful redraw: nothing here reads the trace, and the words beside it are
 * Garmin's.
 *
 * At true scale a ten-second strip is 250 mm wide, which is unreadable on a phone. The strips
 * therefore keep a floor width inside their own scroll box, so only the trace pans and never the
 * page, and every strip stays on the same scale and aligned with the others.
 */
export default function EcgTrace({
  waveform,
  mmPerSec,
  mmPerMv,
  id,
  label,
}: {
  waveform: TraceWaveform;
  /** Millimetres per second, as printed on the report. */
  mmPerSec?: number | null;
  /** Millimetres per millivolt, as printed on the report. */
  mmPerMv?: number | null;
  /** Unique within the page: the grid patterns are referenced by id. */
  id: string;
  label: string;
}) {
  const { t } = useTranslation();
  const model = buildTraceModel(waveform, mmPerSec, mmPerMv);
  if (!model) return null;
  const { speed, gain, halfMm, heightMm, widthMm } = model;
  const rowSecondsLabel =
    model.rowSeconds === 1
      ? t('labs.ecg.oneSecond', '1 second')
      : t('labs.ecg.nSeconds', '{{count}} seconds', {
          count: model.rowSeconds,
        });

  return (
    <div className="min-w-0 space-y-2">
      {/* Focusable so the arrow keys can pan it: a region only a pointer can reach is content a
          keyboard user cannot get to. */}
      <div
        className="-mx-1 overflow-x-auto overscroll-x-contain px-1"
        tabIndex={0}
        role="group"
        aria-label={t('labs.ecg.scrollable', '{{label}} (scrollable)', {
          label,
        })}
      >
        <div className="min-w-[40rem] space-y-3">
          {model.strips.map((strip, index) => {
            const gridId = `${id}-grid-${index}`;
            return (
              <figure key={strip.t0Ms} className="m-0">
                <svg
                  viewBox={`${-PAD_LEFT_MM} ${-halfMm} ${widthMm + PAD_LEFT_MM} ${heightMm}`}
                  className="block h-auto w-full"
                  role="img"
                  aria-label={t(
                    'labs.ecg.stripLabel',
                    '{{label}}, {{from}} to {{to}}',
                    {
                      label,
                      from: secondsLabel(strip.t0Ms),
                      to: secondsLabel(strip.endMs),
                    }
                  )}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    {/* ECG paper: 1 mm squares inside 5 mm squares. Red is the paper convention
                        for this grid, not a warning; it is drawn faint so the trace carries the
                        contrast. */}
                    <pattern
                      id={`${gridId}-sm`}
                      width="1"
                      height="1"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M1 0V1M0 1H1"
                        fill="none"
                        stroke={GRID_RED}
                        strokeOpacity="0.2"
                        strokeWidth="0.1"
                      />
                    </pattern>
                    <pattern
                      id={`${gridId}-lg`}
                      width="5"
                      height="5"
                      patternUnits="userSpaceOnUse"
                    >
                      <rect width="5" height="5" fill={`url(#${gridId}-sm)`} />
                      <path
                        d="M5 0V5M0 5H5"
                        fill="none"
                        stroke={GRID_RED}
                        strokeOpacity="0.4"
                        strokeWidth="0.22"
                      />
                    </pattern>
                  </defs>

                  <rect
                    x="0"
                    y={-halfMm}
                    width={widthMm}
                    height={heightMm}
                    fill={`url(#${gridId}-lg)`}
                  />

                  {/* 1 mV calibration bar, as a printed ECG draws it. */}
                  <path
                    d={`M${-PAD_LEFT_MM + 1} ${gain / 2} H${-PAD_LEFT_MM + 3} V${-gain / 2} H${-PAD_LEFT_MM + 5}`}
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth="1"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />

                  {/* A constant screen width: a millimetre-wide line would be under half a pixel
                      on a phone. The shape carries the meaning, not the ink's thickness. */}
                  <path
                    d={strip.path}
                    fill="none"
                    stroke="hsl(var(--foreground))"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <figcaption className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span>{secondsLabel(strip.t0Ms)}</span>
                  <span>{secondsLabel(strip.endMs)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground lg:hidden">
        {t(
          'labs.ecg.swipe',
          'Swipe a strip sideways for the rest of its {{span}}.',
          { span: rowSecondsLabel }
        )}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {t(
          'labs.ecg.scaleNote',
          "{{speed}} mm/s, {{gain}} mm/mV. One big square is {{sec}} s wide and {{mv}} mV tall, and the bracket at the left of each row is 1 mV. Drawn from the report; the shape is the report's, the size follows the screen.",
          {
            speed,
            gain,
            sec: (5 / speed).toFixed(2),
            mv: (5 / gain).toFixed(1),
          }
        )}
      </p>
    </div>
  );
}
