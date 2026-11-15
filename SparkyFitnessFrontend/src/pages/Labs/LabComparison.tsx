import LabMarkerHelp from './LabMarkerHelp';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  buildLabComparison,
  sameLabUnit,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabSex,
} from '@workspace/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatLabRange, labResultText } from './labFormat';

interface LabComparisonProps {
  panels: Parameters<typeof buildLabComparison>[0];
  customMarkers: LabMarkerResponse[];
  labels: LabMarkerLabels;
  sex: LabSex | null;
  isLoading?: boolean;
  isError?: boolean;
}

/** Read-only comparison of the latest three saved reports. */
const LabComparison = ({
  panels,
  customMarkers,
  labels,
  sex,
  isLoading = false,
  isError = false,
}: LabComparisonProps) => {
  const { t } = useTranslation();
  const comparison = useMemo(
    () => buildLabComparison(panels, customMarkers, labels, sex),
    [panels, customMarkers, labels, sex]
  );

  const positionLabel = (index: number) =>
    index === 0
      ? t('labs.latest', 'Latest')
      : index === 1
        ? t('labs.comparison.prior', 'Prior')
        : t('labs.comparison.base', 'Earlier');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t('labs.comparison.title', 'Latest three panels')}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t(
              'labs.comparison.loadFailed',
              'Could not load the panel comparison.'
            )}
          </p>
        ) : comparison.panels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('labs.comparison.empty', 'No lab panels yet.')}
          </p>
        ) : (
          <>
            <div
              role="region"
              tabIndex={0}
              aria-label={t('labs.comparison.title', 'Latest three panels')}
              className="overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="w-full min-w-[36rem] caption-bottom text-sm">
                <TableCaption className="sr-only">
                  {t(
                    'labs.comparison.caption',
                    'Up to three saved panels, newest first. Arrows show a smaller distance outside the reference range than the prior panel.'
                  )}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      scope="col"
                      className="sticky left-0 z-20 bg-card"
                    >
                      {t('labs.comparison.marker', 'Marker')}
                    </TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">
                      {t('labs.unit', 'Unit')}
                    </TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">
                      {t('labs.comparison.reference', 'Latest reference range')}
                    </TableHead>
                    {comparison.panels.map((panel, index) => (
                      <TableHead
                        scope="col"
                        key={panel.id}
                        className={index === 0 ? 'bg-muted/50' : undefined}
                      >
                        <div>{positionLabel(index)}</div>
                        <div className="text-xs font-normal">
                          {t(
                            'labs.comparison.collectionDate',
                            'Panel collection date'
                          )}
                        </div>
                        <div className="whitespace-nowrap">
                          {panel.collected_on ??
                            t(
                              'labs.comparison.unknownDate',
                              'Collection date not recorded'
                            )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableHead
                        scope="row"
                        className="sticky left-0 z-10 bg-card font-medium text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{row.name}</span>
                          <LabMarkerHelp
                            name={row.name}
                            markerKey={
                              row.id.startsWith('builtin:')
                                ? row.id.slice(8)
                                : null
                            }
                          />
                        </span>
                      </TableHead>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {row.unit || '—'}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                        {formatLabRange(row.range.low, row.range.high, '') ??
                          '—'}
                      </TableCell>
                      {row.cells.map((cell, index) => (
                        <TableCell
                          key={comparison.panels[index]?.id ?? index}
                          className={index === 0 ? 'bg-muted/50' : undefined}
                          title={
                            cell.result
                              ? (formatLabRange(
                                  cell.range.low,
                                  cell.range.high,
                                  cell.unit
                                ) ??
                                t(
                                  'labs.comparison.rangeUnavailable',
                                  'Range unavailable'
                                ))
                              : undefined
                          }
                        >
                          {cell.result ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <span>
                                  {labResultText({
                                    ...cell.result,
                                    unit: cell.unit,
                                  })}
                                </span>
                                {(cell.status === 'high' ||
                                  cell.status === 'low') && (
                                  <Badge
                                    variant="destructive"
                                    className="px-1 py-0 text-xs font-medium"
                                  >
                                    (
                                    {cell.status === 'high'
                                      ? t('labs.status.high', 'High')
                                      : t('labs.status.low', 'Low')}
                                    )
                                  </Badge>
                                )}
                                {cell.improved && (
                                  <span className="inline-flex items-center">
                                    {cell.improved === 'up' ? (
                                      <ArrowUp
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                      />
                                    ) : (
                                      <ArrowDown
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                      />
                                    )}
                                    <span className="sr-only">
                                      {t(
                                        'labs.comparison.closer',
                                        'Closer to the reference range than the prior panel'
                                      )}
                                    </span>
                                  </span>
                                )}
                              </div>
                              <div
                                className={`whitespace-normal text-xs text-muted-foreground md:whitespace-nowrap ${cell.range.low === row.range.low && cell.range.high === row.range.high && sameLabUnit(cell.unit, row.unit, cell.result.marker_key) ? 'md:sr-only' : ''}`}
                              >
                                {cell.range.low === null &&
                                cell.range.high === null
                                  ? t(
                                      'labs.comparison.rangeUnavailable',
                                      'Range unavailable'
                                    )
                                  : t(
                                      'labs.referenceRange',
                                      'Reference range: {{range}}',
                                      {
                                        range:
                                          formatLabRange(
                                            cell.range.low,
                                            cell.range.high,
                                            cell.unit
                                          ) ?? '—',
                                      }
                                    )}
                              </div>
                              {cell.result.entry_date !==
                                comparison.panels[index]?.collected_on && (
                                <div className="text-xs text-muted-foreground">
                                  {t(
                                    'labs.comparison.resultDate',
                                    'Result date: {{date}}',
                                    { date: cell.result.entry_date }
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span
                              aria-label={t('labs.noResults', 'No results')}
                            >
                              —
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {t(
                'labs.comparison.caption',
                'Up to three saved panels, newest first. Arrows show a smaller distance outside the reference range than the prior panel.'
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default LabComparison;
