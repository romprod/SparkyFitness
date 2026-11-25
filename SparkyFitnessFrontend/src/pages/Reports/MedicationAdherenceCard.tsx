import { useTranslation } from 'react-i18next';
import type { AdherenceFigure } from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useMedicationAdherenceWindow } from '@/hooks/Medications/useMedicationInsights';

/**
 * Adherence over the last 90 days: doses taken out of taken plus missed, overall and, when more
 * than one injectable medicine is listed, for each. Skipped and not-yet-due doses are left out.
 */
export default function MedicationAdherenceCard() {
  const { t } = useTranslation();
  const { data, isError, isLoading } = useMedicationAdherenceWindow();

  const counts = (figure: AdherenceFigure) => {
    const base = t(
      'medications.reports.adherence90.counts',
      '{{taken}} taken · {{missed}} missed',
      { taken: figure.taken, missed: figure.missed }
    );
    if (figure.days_of_data <= 0) return base;
    const days =
      figure.days_of_data === 1
        ? t(
            'medications.reports.adherence90.daysOne',
            '{{count}} day of data',
            { count: figure.days_of_data }
          )
        : t(
            'medications.reports.adherence90.daysOther',
            '{{count}} days of data',
            { count: figure.days_of_data }
          );
    return `${base} · ${days}`;
  };

  const figureBlock = (label: string, figure: AdherenceFigure) => (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {figure.pct === null ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'medications.reports.adherence90.unavailable',
            'Adherence available once scheduling history accrues.'
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {figure.pct}%
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {counts(figure)}
          </p>
        </>
      )}
    </div>
  );

  const medications = data
    ? [...data.medications].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          {t('medications.reports.adherence90.title', 'Adherence (90 days)')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            'medications.reports.adherence90.description',
            'Doses taken out of taken plus missed, for injectable medicines on a plan. Skipped doses and doses not yet due are left out.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('medications.reports.adherence90.loading', 'Loading adherence…')}
          </p>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.reports.adherence90.error',
              'Could not load adherence.'
            )}
          </p>
        ) : (
          <div className="space-y-3">
            {figureBlock(
              t('medications.reports.adherence90.overall', 'Overall adherence'),
              data.overall
            )}
            {medications.length > 1 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {medications.map((medication) => (
                  <div key={medication.medication_id}>
                    {figureBlock(
                      t(
                        'medications.reports.adherence90.medicine',
                        '{{name}} adherence',
                        { name: medication.name }
                      ),
                      medication
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
