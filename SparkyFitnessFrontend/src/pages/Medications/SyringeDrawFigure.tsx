import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** Relative target fill only; the caption carries the syringe's computed marking. */
export default function SyringeDrawFigure({
  fillFraction,
  markingLabel,
  blocked,
}: {
  fillFraction: number;
  markingLabel: string;
  blocked: boolean;
}) {
  const { t } = useTranslation();
  const caption = t('medications.syringes.drawTo', 'Draw to {{marking}}', {
    marking: markingLabel,
  });
  return (
    <figure className="mx-auto w-full max-w-sm">
      <svg
        viewBox="0 0 320 80"
        role="img"
        aria-label={t(
          'medications.syringes.visualLabel',
          'Syringe target fill: draw to {{marking}}',
          { marking: markingLabel }
        )}
        className="h-auto w-full"
      >
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
          width={240 * fillFraction}
          height="32"
          rx="5"
          data-testid="syringe-target-fill"
          className={blocked ? 'fill-destructive/60' : 'fill-primary/50'}
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
