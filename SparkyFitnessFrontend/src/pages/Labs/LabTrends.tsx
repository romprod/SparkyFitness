import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type LabComparisonPanel,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabSex,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildLabTrends, type LabTrend } from './labTrendData';
import { formatLabValue, labNumber } from './labFormat';

/** Cards shown before "Show all": a long history can have dozens of markers. */
export const LAB_TRENDS_INITIAL = 6;

interface LabTrendsProps {
  panels: LabComparisonPanel[];
  customMarkers: LabMarkerResponse[];
  labels: LabMarkerLabels;
  sex: LabSex | null;
}

const outOfRange = (status: string) => status === 'low' || status === 'high';

const TrendCard = ({ trend }: { trend: LabTrend }) => {
  const { t } = useTranslation();
  const flagged = outOfRange(trend.latest.status);
  return (
    <Card data-testid="lab-trend-card">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold">{trend.name}</p>
          <p
            className={`shrink-0 text-sm tabular-nums ${
              flagged ? 'font-semibold text-destructive' : ''
            }`}
          >
            {formatLabValue(trend.latest.value, trend.unit)}
            {flagged && (
              <span className="ml-1 text-xs">
                (
                {trend.latest.status === 'high'
                  ? t('labs.status.high', 'High')
                  : t('labs.status.low', 'Low')}
                )
              </span>
            )}
          </p>
        </div>
        <div
          className="h-28 w-full"
          role="img"
          aria-label={t('labs.trends.chartLabel', {
            name: trend.name,
            count: trend.points.length,
            defaultValue: '{{name}} trend, {{count}} readings',
          })}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trend.points}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                tickMargin={4}
              />
              <YAxis
                width={36}
                tick={{ fontSize: 10 }}
                domain={['auto', 'auto']}
                tickFormatter={labNumber}
              />
              {(trend.low !== null || trend.high !== null) && (
                <ReferenceArea
                  y1={trend.low ?? undefined}
                  y2={trend.high ?? undefined}
                  fill="currentColor"
                  fillOpacity={0.08}
                  ifOverflow="extendDomain"
                />
              )}
              <Tooltip
                formatter={(value) => [
                  formatLabValue(Number(value), trend.unit),
                  t('labs.value', 'Result'),
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

/** Every marker with two or more readings as a small card; markers out of range come first. */
const LabTrends = ({ panels, customMarkers, labels, sex }: LabTrendsProps) => {
  const { t } = useTranslation();
  const trends = useMemo(
    () => buildLabTrends(panels, customMarkers, labels, sex),
    [panels, customMarkers, labels, sex]
  );
  const [showAll, setShowAll] = useState(false);
  if (trends.length === 0) return null;

  const shown = showAll ? trends : trends.slice(0, LAB_TRENDS_INITIAL);
  return (
    <section
      className="space-y-3"
      aria-label={t('labs.trends.title', 'Trends')}
    >
      <h2 className="text-lg font-semibold">
        {t('labs.trends.title', 'Trends')}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {shown.map((trend) => (
          <TrendCard key={trend.id} trend={trend} />
        ))}
      </div>
      {trends.length > LAB_TRENDS_INITIAL && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? t('labs.trends.showFewer', 'Show fewer')
            : t('labs.trends.showAll', 'Show all {{count}} trends', {
                count: trends.length,
              })}
        </Button>
      )}
    </section>
  );
};

export default LabTrends;
