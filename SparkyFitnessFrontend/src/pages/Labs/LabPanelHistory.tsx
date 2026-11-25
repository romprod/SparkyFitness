import LabMarkerHelp from './LabMarkerHelp';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  labPanelMarkerOptions,
  type LabComparisonPanel,
  type LabMarkerLabels,
  type LabMarkerResponse,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteLabPanel } from '@/hooks/Labs/useLabResults';
import { formatLabRange, labResultText } from './labFormat';
import { BORDERLINE_BADGE_CLASS, labResultFlag } from './labOptimal';

interface Props {
  panels: LabComparisonPanel[];
  customMarkers: LabMarkerResponse[];
  labels: LabMarkerLabels;
  isLoading: boolean;
  isError: boolean;
}
const LabPanelHistory = ({
  panels,
  customMarkers,
  labels,
  isLoading,
  isError,
}: Props) => {
  const { t } = useTranslation();
  const names = useMemo(
    () =>
      new Map(
        labPanelMarkerOptions(customMarkers, labels).map((m) => [m.id, m.name])
      ),
    [customMarkers, labels]
  );
  const [deleting, setDeleting] = useState<LabComparisonPanel | null>(null);
  const remove = useDeleteLabPanel();
  return (
    <section aria-label={t('labs.panels.title', 'Lab panels')}>
      <details
        className="space-y-3"
        open={isError || (!isLoading && panels.length === 0) || undefined}
      >
        <summary className="mb-3 cursor-pointer select-none text-lg font-semibold">
          {t('labs.panels.title', 'Lab panels')}
          {!isLoading && !isError && panels.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {panels.length}
            </span>
          )}
        </summary>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive p-3 text-sm text-destructive-foreground"
          >
            {t('labs.panels.loadFailed', 'Could not load the lab panels.')}
          </p>
        ) : panels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'labs.panels.empty',
              'No lab panels yet. Add one above to start tracking your markers.'
            )}
          </p>
        ) : (
          panels.map((panel) => (
            <Card key={panel.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base">
                    {panel.collected_on ??
                      t(
                        'labs.comparison.unknownDate',
                        'Collection date not recorded'
                      )}
                  </CardTitle>
                  {panel.lab_name && (
                    <p className="break-words text-sm text-muted-foreground">
                      {panel.lab_name}
                    </p>
                  )}
                  <Badge variant="secondary">
                    {panel.origin === 'manual'
                      ? t('labs.panels.manual', 'Manual panel')
                      : t('labs.panels.imported', 'Imported report')}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  aria-label={t(
                    'labs.panels.deleteDate',
                    'Delete lab panel {{date}}',
                    {
                      date:
                        panel.collected_on ??
                        t(
                          'labs.comparison.unknownDate',
                          'Collection date not recorded'
                        ),
                    }
                  )}
                  onClick={() => setDeleting(panel)}
                >
                  {t('common.delete', 'Delete')}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y">
                  {panel.results.map((result) => {
                    const id = result.marker_key
                      ? `builtin:${result.marker_key}`
                      : `custom:${result.custom_marker_id}`;
                    const range = formatLabRange(
                      result.ref_range_low,
                      result.ref_range_high,
                      result.unit
                    );
                    const status = labResultFlag(result, {
                      ref_range_low: null,
                      ref_range_high: null,
                    });
                    return (
                      <li
                        key={result.id}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                      >
                        <span className="inline-flex items-center gap-1 text-sm font-medium">
                          <span>
                            {names.get(id) ?? t('labs.panels.marker', 'Marker')}
                          </span>
                          <LabMarkerHelp
                            name={
                              names.get(id) ?? t('labs.panels.marker', 'Marker')
                            }
                            markerKey={result.marker_key}
                          />
                        </span>
                        <div className="min-w-0 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="break-words text-sm">
                              {labResultText(result)}
                            </span>
                            {status !== 'unknown' && (
                              <Badge
                                variant={
                                  status === 'borderline'
                                    ? 'outline'
                                    : status === 'in_range'
                                      ? 'secondary'
                                      : 'destructive'
                                }
                                className={
                                  status === 'borderline'
                                    ? BORDERLINE_BADGE_CLASS
                                    : undefined
                                }
                              >
                                {status === 'high'
                                  ? t('labs.status.high', 'High')
                                  : status === 'low'
                                    ? t('labs.status.low', 'Low')
                                    : status === 'borderline'
                                      ? t(
                                          'labs.status.borderline',
                                          'Borderline'
                                        )
                                      : t('labs.status.inRange', 'In range')}
                              </Badge>
                            )}
                          </div>
                          {range && (
                            <p className="text-xs text-muted-foreground">
                              {t(
                                'labs.referenceRange',
                                'Reference range: {{range}}',
                                { range }
                              )}
                            </p>
                          )}
                          {result.entry_date !== panel.collected_on && (
                            <p className="text-xs text-muted-foreground">
                              {t(
                                'labs.comparison.resultDate',
                                'Result date: {{date}}',
                                { date: result.entry_date }
                              )}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {panel.notes && (
                  <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-sm">
                    {panel.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </details>
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('labs.panels.deleteTitle', 'Delete lab panel')}
        description={t(
          'labs.panels.deleteMessage',
          'Delete this panel and all of its results? This cannot be undone.'
        )}
        variant="destructive"
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
};
export default LabPanelHistory;
