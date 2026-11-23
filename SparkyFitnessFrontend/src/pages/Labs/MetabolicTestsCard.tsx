import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Plus, Trash2 } from 'lucide-react';
import {
  analyseMetabolicTest,
  type MetabolicTest,
  type MetabolicTestPrep,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useDeleteMetabolicTestMutation,
  useMetabolicTests,
} from '@/hooks/Labs/useMetabolicTests';
import MetabolicTestForm from './MetabolicTestForm';
import LinkedDocuments from './LinkedDocuments';

/**
 * Measured resting metabolic rate beside the usual prediction equations, as Pitstop's RMR panel
 * shows it. Descriptive only: the clinic's own predicted figure and activity factor are shown as
 * printed, every equation is recomputed, and no target or goal is set from any of it.
 */
export default function MetabolicTestsCard() {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { data, isError, isLoading } = useMetabolicTests();
  const remove = useDeleteMetabolicTestMutation();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<MetabolicTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tests = data ?? [];
  const latest = tests[0];

  const methodLabel = (method: MetabolicTest['method']) =>
    method === 'ic_vo2_only'
      ? t('labs.metabolic.methodVo2Only', 'Indirect calorimetry · VO2 only')
      : method === 'ic_vo2_vco2'
        ? t('labs.metabolic.methodVo2Vco2', 'Indirect calorimetry · VO2 + VCO2')
        : t('labs.metabolic.methodOther', 'Other');
  const answerWord = (value: boolean | null) =>
    value === null
      ? t('labs.metabolic.unknownLower', 'unknown')
      : value
        ? t('labs.metabolic.yesLower', 'yes')
        : t('labs.metabolic.noLower', 'no');
  const hoursOf = (prep: MetabolicTestPrep) =>
    prep.fasted === true && prep.fasting_hours !== null
      ? ` (${prep.fasting_hours} h)`
      : '';
  const restedText = (prep: MetabolicTestPrep) =>
    prep.rested === true && prep.rest_min_before_test !== null
      ? t('labs.metabolic.minutes', '{{min}} min', {
          min: prep.rest_min_before_test,
        })
      : answerWord(prep.rested);

  const panel = (test: MetabolicTest) => {
    const analysis = analyseMetabolicTest(test);
    const reference = [...analysis.ladder].sort(
      (a, b) => Number(b.primary) - Number(a.primary)
    );
    const { prep } = test;
    return (
      <div className="space-y-3">
        <header className="flex flex-wrap items-baseline gap-2">
          <p className="text-2xl font-semibold tabular-nums">
            {test.measured_rmr_kcal.toFixed(0)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {t('labs.metabolic.kcalPerDay', 'kcal/d')}
            </span>
          </p>
          <Badge variant="secondary">{methodLabel(test.method)}</Badge>
          {analysis.conditionsUnknown && (
            <Badge variant="outline">
              {t(
                'labs.metabolic.conditionsUnknown',
                'test conditions not recorded'
              )}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDate(test.tested_day)}
            {test.device_label ? ` · ${test.device_label}` : ''}
            {test.facility ? ` · ${test.facility}` : ''}
          </span>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('labs.metabolic.noiseBand', 'Noise band')}
            </dt>
            <dd className="tabular-nums">
              {t('labs.metabolic.noiseBandValue', '± {{kcal}} kcal (LSC)', {
                kcal: analysis.noiseBand.toFixed(0),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('labs.metabolic.vo2', 'VO2')}
            </dt>
            <dd className="tabular-nums">
              {analysis.vo2
                ? `${t('labs.metabolic.mlPerMin', '{{ml}} mL/min', {
                    ml: analysis.vo2.mlPerMin.toFixed(0),
                  })}${
                    analysis.vo2.mets !== null
                      ? ` · ${t('labs.metabolic.mets', '{{mets}} MET', {
                          mets: analysis.vo2.mets.toFixed(2),
                        })}`
                      : ''
                  }`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('labs.metabolic.rqKcal', 'RQ · kcal/L O2')}
            </dt>
            <dd className="tabular-nums">
              {test.rq ?? '—'} · {test.kcal_per_litre_o2 ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('labs.metabolic.steadyState', 'Steady state')}
            </dt>
            <dd className="tabular-nums">
              {test.duration_min !== null
                ? t('labs.metabolic.minutes', '{{min}} min', {
                    min: test.duration_min,
                  })
                : '—'}
              {test.steady_state_cv_pct !== null
                ? ` · ${t('labs.metabolic.cv', 'CV {{cv}} %', {
                    cv: test.steady_state_cv_pct.toFixed(1),
                  })}`
                : ''}
            </dd>
          </div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 font-medium">
                  {t('labs.metabolic.equation', 'Equation')}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t('labs.metabolic.basis', 'Basis')}
                </th>
                <th className="py-1 pr-2 text-right font-medium">
                  {t('labs.metabolic.predicted', 'Predicted')}
                </th>
                <th className="py-1 text-right font-medium">
                  {t('labs.metabolic.ratio', 'Measured ÷ predicted')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {reference.map((row) => (
                <tr
                  key={row.key}
                  className={row.primary ? 'font-semibold' : undefined}
                >
                  <td className="py-1.5 pr-2">
                    {row.label}
                    {row.primary && (
                      <Badge variant="outline" className="ml-1 font-medium">
                        {t('labs.metabolic.reference', 'reference')}
                      </Badge>
                    )}
                    {row.key === 'mifflin' && (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {row.note}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.basis === 'ffm'
                      ? t('labs.metabolic.basisFfm', 'FFM')
                      : t('labs.metabolic.basisWeight', 'weight')}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {row.predictedKcal === null
                      ? '—'
                      : row.predictedKcal.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right">
                    {row.ratio === null ? '—' : row.ratio.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('labs.metabolic.perKgFfm', 'per kg fat-free mass')}
            </dt>
            <dd className="tabular-nums">
              {analysis.perKg.perKgFfm === null
                ? '—'
                : t('labs.metabolic.kcalPerKg', '{{value}} kcal/kg', {
                    value: analysis.perKg.perKgFfm.toFixed(1),
                  })}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t(
                'labs.metabolic.perKgBody',
                'per kg body mass (test-day weight {{kg}} kg)',
                { kg: test.weight_kg.toFixed(1) }
              )}
            </dt>
            <dd className="tabular-nums">
              {analysis.perKg.perKgBodyMass === null
                ? '—'
                : t('labs.metabolic.kcalPerKg', '{{value}} kcal/kg', {
                    value: analysis.perKg.perKgBodyMass.toFixed(1),
                  })}
            </dd>
          </div>
        </dl>

        <p className="text-[11px] text-muted-foreground">
          {test.fat_free_mass_kg === null
            ? t(
                'labs.metabolic.noFfm',
                'No fat-free mass entered: the equations that need it are not shown.'
              )
            : t(
                'labs.metabolic.ffmNote',
                'Fat-free mass {{kg}} kg, as entered.',
                {
                  kg: test.fat_free_mass_kg,
                }
              )}{' '}
          {t(
            'labs.metabolic.conditionsLine',
            'Conditions: fasted {{fasted}}, no caffeine {{caffeine}}, no training the prior day {{training}}, active travel {{travel}}, rested {{rested}}, awake and still {{still}}, illness-free for 14 days {{illness}}.',
            {
              fasted: `${answerWord(prep.fasted)}${hoursOf(prep)}`,
              caffeine: answerWord(prep.no_caffeine),
              training: answerWord(prep.no_training_prior_day),
              travel: answerWord(prep.active_travel),
              rested: restedText(prep),
              still: answerWord(prep.awake_quiet),
              illness: answerWord(prep.illness_free_14d),
            }
          )}
        </p>

        {test.reported_predicted_kcal !== null && (
          <p className="text-xs text-muted-foreground">
            {test.reported_prediction_equation
              ? t(
                  'labs.metabolic.printedLineEquation',
                  'Clinic-printed prediction: {{kcal}} kcal ({{equation}}).',
                  {
                    kcal: test.reported_predicted_kcal.toFixed(0),
                    equation: test.reported_prediction_equation,
                  }
                )
              : t(
                  'labs.metabolic.printedLine',
                  'Clinic-printed prediction: {{kcal}} kcal.',
                  { kcal: test.reported_predicted_kcal.toFixed(0) }
                )}
          </p>
        )}
        {analysis.activityProjection !== null && (
          <p className="text-xs text-muted-foreground">
            {t(
              'labs.metabolic.projection',
              '{{rmr}} × {{factor}}{{label}} = {{kcal}} kcal: arithmetic on the clinic’s activity-factor assumption, not a target.',
              {
                rmr: test.measured_rmr_kcal.toFixed(0),
                factor: test.reported_activity_factor,
                label: test.reported_activity_label
                  ? ` ${test.reported_activity_label}`
                  : '',
                kcal: analysis.activityProjection,
              }
            )}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4" />
              {t('labs.metabolic.title', 'Resting metabolic rate')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                'labs.metabolic.intro',
                'Measured by a clinic with indirect calorimetry and set beside the usual prediction equations. Descriptive only: no target or goal is set from it.'
              )}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={adding}
            onClick={() => setAdding((open) => !open)}
          >
            {!adding && <Plus className="mr-1 h-4 w-4" />}
            {adding
              ? t('labs.metabolic.close', 'Close')
              : t('labs.metabolic.add', 'Add RMR test')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && <MetabolicTestForm onSaved={() => setAdding(false)} />}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('labs.metabolic.loading', 'Loading…')}
          </p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            {t('labs.metabolic.loadFailed', 'Could not load the RMR tests.')}
          </p>
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'labs.metabolic.empty',
              'No RMR test recorded. Add one when a clinic measures it.'
            )}
          </p>
        ) : (
          <>
            {panel(latest)}
            {tests.length > 1 && (
              <div className="border-t pt-3">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('labs.metabolic.allTests', 'All RMR tests')}
                </p>
                <ul className="divide-y text-sm">
                  {tests.map((test) => (
                    <li
                      key={test.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1"
                    >
                      <span className="flex flex-wrap items-center gap-2 tabular-nums">
                        <span>{formatDate(test.tested_day)}</span>
                        <span>
                          {t('labs.metabolic.kcalDay', '{{kcal}} kcal/d', {
                            kcal: test.measured_rmr_kcal.toFixed(0),
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {methodLabel(test.method)}
                          {test.device_label ? ` · ${test.device_label}` : ''}
                        </span>
                        {test.id === latest.id && (
                          <Badge variant="outline">
                            {t('labs.metabolic.shownAbove', 'shown above')}
                          </Badge>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(test)}
                        aria-label={t(
                          'labs.metabolic.deleteLabel',
                          'Delete RMR test {{date}}',
                          { date: formatDate(test.tested_day) }
                        )}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t('labs.metabolic.delete', 'Delete')}
                      </Button>
                      <div className="basis-full">
                        <LinkedDocuments metabolicTestId={test.id} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tests.length === 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(latest)}
                aria-label={t(
                  'labs.metabolic.deleteLabel',
                  'Delete RMR test {{date}}',
                  { date: formatDate(latest.tested_day) }
                )}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('labs.metabolic.delete', 'Delete')}
              </Button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('labs.metabolic.deleteTitle', 'Delete this RMR test?')}
        description={t(
          'labs.metabolic.deleteDescription',
          'The test and what was recorded with it will be removed. This cannot be undone.'
        )}
        variant="destructive"
        confirmLabel={t('labs.metabolic.delete', 'Delete')}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          setError(null);
          if (target)
            remove.mutate(target.id, {
              onError: (failure) =>
                setError(
                  failure instanceof Error
                    ? failure.message
                    : t(
                        'labs.metabolic.deleteFailed',
                        'Could not delete the RMR test.'
                      )
                ),
            });
        }}
      />
    </Card>
  );
}
