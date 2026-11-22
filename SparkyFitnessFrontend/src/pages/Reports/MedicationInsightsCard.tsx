import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import {
  computeDoseInsights,
  type DoseInsight,
  type DoseSplitKind,
  type WeightTrendWindow,
} from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationInsightStreams } from '@/hooks/Medications/useMedicationInsights';

/**
 * Descriptive comparisons over the last 90 days, as Pitstop's Insights card shows them: sleep,
 * resting heart rate and Body Battery on dose days against other days, the weight trend, the
 * most-logged symptoms and when they came after a dose, and adherence beside weight. Each shows
 * its sample sizes, one with too few points is left out, and none claims a cause.
 */
export default function MedicationInsightsCard() {
  const { t } = useTranslation();
  const { weightUnit, convertWeight } = usePreferences();
  const { data, isError, isLoading } = useMedicationInsightStreams();
  // Weights are kept in kilograms; they are compared in the unit the person reads.
  const unit = weightUnit === 'st_lbs' ? 'lbs' : weightUnit;

  const insights = useMemo(
    () =>
      data
        ? computeDoseInsights({
            today: data.today,
            doses: data.doses,
            wearable: data.wearable,
            weights: data.weights_kg.map((point) => ({
              day: point.day,
              value: convertWeight(point.value, 'kg', unit),
            })),
            weight_unit: unit,
            symptoms: data.symptoms,
            adherence_pct: data.adherence_pct,
          })
        : [],
    [data, unit, convertWeight]
  );

  const trend = (window: WeightTrendWindow, weightLabel: string) => {
    const values = {
      days: window.days,
      amount: Math.abs(window.delta),
      unit: weightLabel,
      samples: window.samples,
    };
    if (window.delta > 0)
      return t(
        'medications.doseInsights.weightUp',
        '{{days}}d: up {{amount}} {{unit}} (n={{samples}})',
        values
      );
    if (window.delta < 0)
      return t(
        'medications.doseInsights.weightDown',
        '{{days}}d: down {{amount}} {{unit}} (n={{samples}})',
        values
      );
    return t(
      'medications.doseInsights.weightFlat',
      '{{days}}d: no change ({{unit}}) (n={{samples}})',
      values
    );
  };

  const splitTitle = (kind: DoseSplitKind) =>
    kind === 'sleep_dose'
      ? t(
          'medications.doseInsights.sleepTitle',
          'Sleep on dose days vs other days'
        )
      : kind === 'resting_hr_dose'
        ? t(
            'medications.doseInsights.restingHrTitle',
            'Resting heart rate on dose days vs other days'
          )
        : t(
            'medications.doseInsights.bodyBatteryTitle',
            'Body Battery (daily high) on dose days vs other days'
          );

  const describe = (
    insight: DoseInsight
  ): { title: string; detail: string; samples?: string } => {
    switch (insight.kind) {
      case 'sleep_dose':
      case 'resting_hr_dose':
      case 'body_battery_dose': {
        const values = { onDose: insight.on_dose, other: insight.other };
        const detail =
          insight.kind === 'sleep_dose'
            ? t(
                'medications.doseInsights.sleepDetail',
                'Avg sleep: {{onDose}}h on dose days vs {{other}}h on other days.',
                values
              )
            : insight.kind === 'resting_hr_dose'
              ? t(
                  'medications.doseInsights.restingHrDetail',
                  'Avg resting HR: {{onDose}} bpm on dose days vs {{other}} bpm on other days.',
                  values
                )
              : t(
                  'medications.doseInsights.bodyBatteryDetail',
                  'Avg Body Battery high: {{onDose}} on dose days vs {{other}} on other days.',
                  values
                );
        return {
          title: splitTitle(insight.kind),
          detail,
          samples: t(
            'medications.doseInsights.samples',
            'n={{onDose}} vs n={{other}}',
            {
              onDose: insight.samples.on_dose,
              other: insight.samples.other,
            }
          ),
        };
      }
      case 'weight_trend':
        return {
          title: t('medications.doseInsights.weightTitle', 'Weight trend'),
          detail: insight.windows
            .map((window) => trend(window, insight.unit))
            .join('  ·  '),
        };
      case 'symptom_frequency':
        return {
          title: t(
            'medications.doseInsights.symptomsTitle',
            'Most-logged symptoms'
          ),
          detail: insight.top
            .map((symptom) => {
              const days = t(
                'medications.doseInsights.days',
                '{{count}} days',
                {
                  count: symptom.days,
                }
              );
              return symptom.mostly
                ? t(
                    'medications.doseInsights.symptomMostly',
                    '{{name}} — {{days}} (mostly {{severity}})',
                    {
                      name: symptom.name,
                      days,
                      severity: symptom.mostly,
                    }
                  )
                : t(
                    'medications.doseInsights.symptomDays',
                    '{{name}} — {{days}}',
                    {
                      name: symptom.name,
                      days,
                    }
                  );
            })
            .join('; '),
        };
      case 'symptom_timing':
        return {
          title: t(
            'medications.doseInsights.timingTitle',
            'Symptom timing after a dose'
          ),
          detail: t(
            'medications.doseInsights.timingDetail',
            'Of {{total}} symptom days with a prior dose: {{within}} within 24h, {{middle}} at 24–72h, {{later}} after 72h.',
            {
              total: insight.total,
              within: insight.within_24h,
              middle: insight.from_24h_to_72h,
              later: insight.after_72h,
            }
          ),
        };
      case 'adherence_weight':
        return {
          title: t(
            'medications.doseInsights.adherenceTitle',
            'Adherence alongside weight'
          ),
          detail: t(
            'medications.doseInsights.adherenceDetail',
            'Adherence {{percent}}% over the window. Weight {{weight}}. Shown side by side — not a cause-and-effect claim.',
            {
              percent: insight.adherence_pct,
              weight: trend(insight.weight, insight.unit),
            }
          ),
        };
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4" />
          {t('medications.doseInsights.title', 'Insights')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            'medications.doseInsights.disclaimer',
            'Observational — not medical advice; correlation ≠ causation.'
          )}{' '}
          {t(
            'medications.doseInsights.window',
            'Based on the last 90 days; a comparison with fewer than 5 days on either side is left out.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('medications.doseInsights.loading', 'Loading insights…')}
          </p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            {t('medications.doseInsights.error', 'Could not load insights.')}
          </p>
        ) : insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.doseInsights.empty',
              'Not enough data yet for insights.'
            )}
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.map((insight) => {
              const { title, detail, samples } = describe(insight);
              return (
                <li
                  key={insight.kind}
                  className="border-t pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {detail}
                  </p>
                  {samples && (
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {samples}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
