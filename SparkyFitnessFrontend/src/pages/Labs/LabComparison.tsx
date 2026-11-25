import LabMarkerHelp from './LabMarkerHelp';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  buildLabComparison,
  exactLabResultValue,
  sameLabUnit,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabSex,
} from '@workspace/shared';
import { Skeleton } from '@/components/ui/skeleton';
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
import { labOptimalFlag } from './labOptimal';

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
      <CardHeader className="pb-2">
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
              <table className="w-full min-w-[28rem] caption-bottom text-sm">
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
                      className="sticky left-0 z-20 h-9 bg-card px-2 text-xs uppercase tracking-wide"
                    >
                      {t('labs.comparison.marker', 'Marker')}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="hidden h-9 px-2 text-xs uppercase tracking-wide md:table-cell"
                    >
                      {t('labs.unit', 'Unit')}
                    </TableHead>
                    <TableHead
                      scope="col"
                      title={t(
                        'labs.comparison.reference',
                        'Latest reference range'
                      )}
                      className="hidden h-9 px-2 text-xs uppercase tracking-wide md:table-cell"
                    >
                      {t('labs.comparison.referenceShort', 'Ref')}
                    </TableHead>
                    {comparison.panels.map((panel, index) => (
                      <TableHead
                        scope="col"
                        key={panel.id}
                        className={`h-9 whitespace-nowrap px-2 text-xs tracking-wide ${
                          index === 0 ? 'bg-muted/50 text-primary' : ''
                        }`}
                      >
                        <span className="sr-only">
                          {positionLabel(index)}:{' '}
                        </span>
                        {panel.collected_on ??
                          t(
                            'labs.comparison.unknownDate',
                            'Collection date not recorded'
                          )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableHead
                        scope="row"
                        className="sticky left-0 z-10 h-auto bg-card px-2 py-2 font-medium text-foreground"
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
                        {formatLabRange(
                          row.range.low,
                          row.range.high,
                          row.unit
                        ) && (
                          <span className="block text-xs font-normal text-muted-foreground md:hidden">
                            {formatLabRange(
                              row.range.low,
                              row.range.high,
                              row.unit
                            )}
                          </span>
                        )}
                      </TableHead>
                      <TableCell className="hidden px-2 py-2 text-xs text-muted-foreground md:table-cell">
                        {row.unit || '—'}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap px-2 py-2 text-xs text-muted-foreground md:table-cell">
                        {formatLabRange(row.range.low, row.range.high, '') ??
                          '—'}
                      </TableCell>
                      {row.cells.map((cell, index) => {
                        const flagged =
                          cell.status === 'high' || cell.status === 'low';
                        const borderline =
                          cell.result !== null &&
                          labOptimalFlag(
                            cell.result.marker_key,
                            cell.unit,
                            exactLabResultValue(cell.result),
                            cell.status
                          ) === 'borderline';
                        const sameUnitAsRow = sameLabUnit(
                          cell.unit,
                          row.unit,
                          cell.result?.marker_key
                        );
                        return (
                          <TableCell
                            key={comparison.panels[index]?.id ?? index}
                            className={`px-2 py-2 ${
                              index === 0 ? 'bg-muted/50' : ''
                            }`}
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
                              <div className="space-y-0.5">
                                <div className="flex flex-wrap items-center gap-x-1">
                                  <span
                                    className={`tabular-nums ${
                                      flagged
                                        ? 'font-semibold text-destructive'
                                        : ''
                                    }`}
                                  >
                                    {labResultText({
                                      ...cell.result,
                                      unit: '',
                                    })}
                                    {cell.unit && (
                                      <span
                                        className={`font-normal text-muted-foreground ${
                                          sameUnitAsRow ? 'md:sr-only' : ''
                                        }`}
                                      >
                                        {' '}
                                        {cell.unit}
                                      </span>
                                    )}
                                  </span>
                                  {flagged && (
                                    <span className="text-[10px] font-bold text-destructive">
                                      <span aria-hidden="true">
                                        ({cell.status === 'high' ? 'H' : 'L'})
                                      </span>
                                      <span className="sr-only">
                                        (
                                        {cell.status === 'high'
                                          ? t('labs.status.high', 'High')
                                          : t('labs.status.low', 'Low')}
                                        )
                                      </span>
                                    </span>
                                  )}
                                  {borderline && (
                                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                      <span aria-hidden="true">(B)</span>
                                      <span className="sr-only">
                                        (
                                        {t(
                                          'labs.status.borderline',
                                          'Borderline'
                                        )}
                                        )
                                      </span>
                                    </span>
                                  )}
                                  {cell.improved && (
                                    <span className="inline-flex items-center text-green-600 dark:text-green-400">
                                      {cell.improved === 'up' ? (
                                        <ArrowUp
                                          aria-hidden="true"
                                          className="h-3.5 w-3.5"
                                        />
                                      ) : (
                                        <ArrowDown
                                          aria-hidden="true"
                                          className="h-3.5 w-3.5"
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
                                  className={`whitespace-nowrap text-xs text-muted-foreground ${cell.range.low === row.range.low && cell.range.high === row.range.high && sameUnitAsRow ? 'sr-only' : ''}`}
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
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
            <p
              aria-hidden="true"
              className="mt-3 font-mono text-xs text-muted-foreground"
            >
              {comparison.panels
                .map(
                  (panel, index) =>
                    `${positionLabel(index)} ${
                      panel.collected_on ??
                      t(
                        'labs.comparison.unknownDate',
                        'Collection date not recorded'
                      )
                    }`
                )
                .join(' · ')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'labs.comparison.arrowsNote',
                'Arrows mark a reading closer to its reference range than the prior panel’s.'
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default LabComparison;
