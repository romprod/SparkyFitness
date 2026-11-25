import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { exactLabResultValue } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useLabMarkers, useLabPanels } from '@/hooks/Labs/useLabResults';
import {
  LAB_WINDOW_DAYS,
  buildNearestLabs,
  referenceText,
  type NearestLabRow,
} from './bodyCompNearestLabsModel';
import { labNumber } from './labFormat';
import { BORDERLINE_BADGE_CLASS } from './labOptimal';

function FlagBadge({ flag }: { flag: NearestLabRow['flag'] }) {
  const { t } = useTranslation();
  if (flag === 'borderline')
    return (
      <Badge variant="outline" className={BORDERLINE_BADGE_CLASS}>
        {t('labs.status.borderline', 'Borderline')}
      </Badge>
    );
  if (flag === 'low')
    return <Badge variant="destructive">{t('labs.status.low', 'Low')}</Badge>;
  if (flag === 'high')
    return <Badge variant="destructive">{t('labs.status.high', 'High')}</Badge>;
  return null;
}

/**
 * The lab panel nearest the latest scan (within 30 days), as Pitstop's Body page shows it: a fixed
 * subset in a fixed order, with how far the draw was from the scan always printed. Descriptive:
 * values beside the scan, not a reason for anything in it.
 */
export default function BodyCompNearestLabs({ scanDay }: { scanDay: string }) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const panels = useLabPanels();
  const markers = useLabMarkers();
  const labs = useMemo(
    () =>
      panels.data
        ? buildNearestLabs(panels.data.panels, markers.data ?? [], scanDay)
        : null,
    [panels.data, markers.data, scanDay]
  );
  if (panels.isLoading || panels.isError) return null;

  return (
    <section
      className="space-y-2 rounded-md border p-3"
      aria-label={t(
        'labs.bodyComp.nearestLabs.title',
        'Nearest bloodwork panel'
      )}
    >
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground">
          {t('labs.bodyComp.nearestLabs.title', 'Nearest bloodwork panel')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'labs.bodyComp.nearestLabs.window',
            'Within ± {{days}} days of the scan on {{date}}.',
            { days: LAB_WINDOW_DAYS, date: formatDate(scanDay) }
          )}
        </p>
      </div>
      {!labs ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'labs.bodyComp.nearestLabs.none',
            'No lab panel within 30 days of this scan.'
          )}
        </p>
      ) : (
        <>
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{formatDate(labs.panelDay)}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {labs.daysFromScan === 0
                ? t('labs.bodyComp.nearestLabs.scanDay', 'scan day')
                : labs.daysFromScan < 0
                  ? t(
                      'labs.bodyComp.nearestLabs.before',
                      '{{count}} days before the scan',
                      { count: Math.abs(labs.daysFromScan) }
                    )
                  : t(
                      'labs.bodyComp.nearestLabs.after',
                      '{{count}} days after the scan',
                      { count: labs.daysFromScan }
                    )}
              {labs.labName ? ` · ${labs.labName}` : ''}
            </p>
          </header>
          <ul className="divide-y">
            {labs.rows.map((row) => {
              const range = referenceText(row.referenceLow, row.referenceHigh);
              const exact = exactLabResultValue({
                value_numeric: row.value,
                value_text: row.valueText,
              });
              return (
                <li
                  key={row.label}
                  data-lab-row={row.label}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5"
                >
                  <span className="text-sm">{row.label}</span>
                  {row.status === 'present' ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {range && (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {t('labs.bodyComp.nearestLabs.ref', 'ref {{range}}', {
                            range,
                          })}
                        </span>
                      )}
                      <span className="text-sm tabular-nums">
                        {exact !== null
                          ? labNumber(exact)
                          : (row.valueText ?? '—')}
                        {row.unit && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {row.unit}
                          </span>
                        )}
                      </span>
                      <FlagBadge flag={row.flag} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {row.status === 'never_measured'
                        ? t('labs.bodyComp.nearestLabs.never', 'never measured')
                        : t(
                            'labs.bodyComp.nearestLabs.notInPanel',
                            'not measured in this panel'
                          )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {labs.notes && (
            <p className="whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {labs.notes}
            </p>
          )}
        </>
      )}
    </section>
  );
}
