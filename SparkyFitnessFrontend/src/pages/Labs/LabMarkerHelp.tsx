import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { LAB_MARKER_DESCRIPTIONS } from './labMarkerDescriptions';

interface Props {
  name: string;
  /** Only an explicit built-in catalogue identity enables a medical definition. */
  markerKey?: string | null;
}

/** Separate from selection buttons so touch help never selects or edits a result. */
export default function LabMarkerHelp({ name, markerKey }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pointerOpen = useRef<boolean | null>(null);
  const definition =
    markerKey && Object.hasOwn(LAB_MARKER_DESCRIPTIONS, markerKey)
      ? LAB_MARKER_DESCRIPTIONS[markerKey]
      : undefined;
  const description = definition
    ? t(`labs.markerHelp.descriptions.${markerKey}`, definition.description)
    : t(
        'labs.markerHelp.custom',
        'No verified explanation is available for this marker. Check the test description on your laboratory report.'
      );
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('labs.markerHelp.about', 'About {{name}}', { name })}
            onPointerDownCapture={() => {
              // Capture before Radix's trigger/outside handlers dismiss the tooltip.
              pointerOpen.current = open;
            }}
            onPointerCancel={() => {
              pointerOpen.current = null;
            }}
            onKeyDown={() => {
              pointerOpen.current = null;
            }}
            onClick={(event) => {
              // Radix normally dismisses on click; keep a touch-accessible toggle.
              event.preventDefault();
              event.stopPropagation();
              const wasOpen = pointerOpen.current;
              pointerOpen.current = null;
              setOpen((current) => !(wasOpen ?? current));
            }}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="top"
            collisionPadding={12}
            className="max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal break-words text-left text-sm leading-relaxed"
          >
            {description}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
}
