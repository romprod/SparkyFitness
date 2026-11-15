import type { MedicationDeviceType } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** Relative target fill only; the caption carries the syringe's computed marking. */
export default function SyringeDrawFigure({
  fillFraction,
  markingLabel,
  blocked,
  deviceType = 'syringe',
}: {
  fillFraction: number;
  markingLabel: string;
  blocked: boolean;
  deviceType?: MedicationDeviceType;
}) {
  const { t } = useTranslation();
  const caption =
    deviceType === 'pen'
      ? t('medications.devices.dialTo', 'Dial to {{marking}}', {
          marking: markingLabel,
        })
      : deviceType === 'pump'
        ? t('medications.devices.spray', 'Spray {{marking}}', {
            marking: markingLabel,
          })
        : t('medications.syringes.drawTo', 'Draw to {{marking}}', {
            marking: markingLabel,
          });
  const fraction = Number.isFinite(fillFraction)
    ? Math.max(0, Math.min(fillFraction, 1))
    : 0;
  const fillClass = blocked ? 'fill-destructive/60' : 'fill-primary/50';
  const visualLabel =
    deviceType === 'pen'
      ? t('medications.devices.penVisualLabel', 'Pen dialled to {{marking}}', {
          marking: markingLabel,
        })
      : deviceType === 'pump'
        ? t('medications.devices.pumpVisualLabel', 'Nasal pump: {{marking}}', {
            marking: markingLabel,
          })
        : t(
            'medications.syringes.visualLabel',
            'Syringe target fill: draw to {{marking}}',
            { marking: markingLabel }
          );
  return (
    <figure className="mx-auto w-full max-w-sm">
      <svg
        viewBox="0 0 320 80"
        role="img"
        aria-label={visualLabel}
        className="h-auto w-full"
      >
        {deviceType === 'pen' ? (
          <g data-testid="pen-graphic">
            <rect
              x="8"
              y="25"
              width="24"
              height="30"
              rx="5"
              className="fill-muted stroke-muted-foreground"
            />
            <rect
              x="34"
              y="23"
              width="224"
              height="34"
              rx="9"
              className="fill-muted stroke-muted-foreground"
            />
            <rect
              x="40"
              y="48"
              width="212"
              height="5"
              rx="2"
              className="fill-background"
            />
            <rect
              x="40"
              y="48"
              width={212 * fraction}
              height="5"
              rx="2"
              data-testid="pen-target-fill"
              className={fillClass}
            />
            <rect
              x="94"
              y="28"
              width="104"
              height="17"
              rx="3"
              className="fill-background stroke-primary"
            />
            <text
              x="146"
              y="40"
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground tabular-nums"
            >
              {markingLabel}
            </text>
            <rect
              x="258"
              y="27"
              width="32"
              height="26"
              rx="5"
              className="fill-muted stroke-muted-foreground"
            />
            {[266, 274, 282].map((x) => (
              <line
                key={x}
                x1={x}
                x2={x}
                y1="31"
                y2="49"
                className="stroke-muted-foreground/60"
              />
            ))}
            <path
              d="M290 40H312"
              className="stroke-muted-foreground"
              strokeWidth="2"
            />
          </g>
        ) : deviceType === 'pump' ? (
          <g data-testid="pump-graphic">
            <rect
              x="76"
              y="17"
              width="116"
              height="46"
              rx="9"
              className="fill-muted stroke-muted-foreground"
            />
            <rect
              x="192"
              y="33"
              width="18"
              height="14"
              rx="2"
              className="fill-muted stroke-muted-foreground"
            />
            <path
              d="M210 40H228M232 32L246 25M232 40H248M232 48L246 55"
              className="stroke-muted-foreground"
              fill="none"
              strokeWidth="2"
            />
            <rect
              x="81"
              y="28"
              width="106"
              height="24"
              rx="3"
              className="fill-background stroke-primary"
            />
            <text
              x="134"
              y="43"
              textAnchor="middle"
              fontSize="10"
              className="fill-foreground tabular-nums"
            >
              {markingLabel}
            </text>
          </g>
        ) : (
          <>
            <path
              d="M12 18V62M12 40H32M272 30H290V50H272M290 40H312"
              className="fill-none stroke-muted-foreground"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="32"
              y="24"
              width="240"
              height="32"
              rx="5"
              className="fill-muted"
            />
            <rect
              x="32"
              y="24"
              width={240 * fraction}
              height="32"
              rx="5"
              data-testid="syringe-target-fill"
              className={fillClass}
            />
            <rect
              x="32"
              y="24"
              width="240"
              height="32"
              rx="5"
              className="fill-none stroke-muted-foreground"
              strokeWidth="1.5"
            />
            {[0, 0.25, 0.5, 0.75, 1].map((position) => (
              <line
                key={position}
                x1={32 + 240 * position}
                x2={32 + 240 * position}
                y1="18"
                y2="62"
                className="stroke-muted-foreground/60"
                strokeWidth="1"
              />
            ))}
          </>
        )}
      </svg>
      <figcaption className="break-words text-center text-sm font-medium tabular-nums">
        {blocked ? (
          <Badge
            variant="destructive"
            className="max-w-full whitespace-normal break-words text-sm"
          >
            {caption}
          </Badge>
        ) : (
          caption
        )}
      </figcaption>
    </figure>
  );
}
