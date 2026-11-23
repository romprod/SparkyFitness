import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildLabComparison,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabSex,
} from '@workspace/shared';
import { Card, CardContent } from '@/components/ui/card';
import { summariseLatestPanel } from './labTrendData';

interface LabOverviewProps {
  panels: Parameters<typeof buildLabComparison>[0];
  customMarkers: LabMarkerResponse[];
  labels: LabMarkerLabels;
  sex: LabSex | null;
}

const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "N of M in range" for the newest panel, with how many moved toward their range. */
const LabOverview = ({
  panels,
  customMarkers,
  labels,
  sex,
}: LabOverviewProps) => {
  const { t } = useTranslation();
  const summary = useMemo(
    () =>
      summariseLatestPanel(
        buildLabComparison(panels, customMarkers, labels, sex).rows
      ),
    [panels, customMarkers, labels, sex]
  );
  if (summary.judged === 0) return null;

  const share = summary.inRange / summary.judged;
  return (
    <Card className="border-l-4 border-l-primary">
      <CardContent className="flex items-center gap-3 p-4">
        <svg
          width="38"
          height="38"
          viewBox="0 0 38 38"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle
            cx="19"
            cy="19"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-muted-foreground/20"
            strokeWidth="3.5"
          />
          <circle
            cx="19"
            cy="19"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-green-500"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - share)}
            transform="rotate(-90 19 19)"
          />
        </svg>
        <div className="min-w-0">
          <div
            className="font-mono text-sm tabular-nums"
            data-testid="lab-overview-in-range"
          >
            {t('labs.overview.inRange', '{{inRange}} of {{total}} in range', {
              inRange: summary.inRange,
              total: summary.judged,
            })}
          </div>
          <div className="mt-0.5 font-mono text-xs tabular-nums text-green-600 dark:text-green-400">
            {t('labs.overview.improving', {
              count: summary.improving,
              defaultValue_one: '{{count}} marker improving vs prior panel',
              defaultValue_other: '{{count}} markers improving vs prior panel',
            })}
          </div>
          {summary.noRange > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('labs.overview.noRange', {
                count: summary.noRange,
                defaultValue_one:
                  '{{count}} result without a reference range is not counted',
                defaultValue_other:
                  '{{count}} results without a reference range are not counted',
              })}
            </div>
          )}
        </div>
        {summary.improving > 0 && (
          <span className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs uppercase text-green-600 ring-1 ring-green-500/40 dark:text-green-400">
            {t('labs.overview.trend', 'Trend')} ▲
          </span>
        )}
      </CardContent>
    </Card>
  );
};

export default LabOverview;
