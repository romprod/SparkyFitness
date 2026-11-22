import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import {
  METABOLIC_TEST_METHODS,
  VO2_ONLY_KCAL_PER_LITRE,
  metabolicTestInputSchema,
  todayInZone,
  type MetabolicTestInput,
  type MetabolicTestMethod,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAddMetabolicTestMutation } from '@/hooks/Labs/useMetabolicTests';

type Answer = '' | 'yes' | 'no';
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const toNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);
const toAnswer = (answer: Answer): boolean | null =>
  answer === '' ? null : answer === 'yes';

/**
 * Entry of a measured RMR test: what the clinic printed, the values it fed its equation, and the
 * conditions of the test. Unknown is a valid answer for every condition; the panel marks any that
 * are not recorded. The clinic's own predicted figure and activity factor are stored as printed.
 */
export default function MetabolicTestForm({
  onSaved,
}: {
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const add = useAddMetabolicTestMutation();
  const [method, setMethod] = useState<MetabolicTestMethod>('ic_vo2_only');
  const [sex, setSex] = useState('');
  const [day, setDay] = useState(() => todayInZone(timezone));
  const [text, setText] = useState<Record<string, string>>({
    kcalPerLitreO2: String(VO2_ONLY_KCAL_PER_LITRE),
  });
  const [prep, setPrep] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<string | null>(null);
  const field = (key: string) => text[key] ?? '';
  const setField = (key: string, value: string) =>
    setText((current) => ({ ...current, [key]: value }));
  const answer = (key: string): Answer => prep[key] ?? '';

  const onMethod = (next: MetabolicTestMethod) => {
    setMethod(next);
    // A VO2-only device assumes an RQ; fill the usual figure only if the field was left empty.
    if (next === 'ic_vo2_only' && !field('kcalPerLitreO2').trim())
      setField('kcalPerLitreO2', String(VO2_ONLY_KCAL_PER_LITRE));
  };

  async function submit(submitted: React.FormEvent) {
    submitted.preventDefault();
    setError(null);
    const numbers: [string, string][] = [
      [
        'measuredRmrKcal',
        t('labs.metabolic.measuredRmr', 'Measured RMR (kcal/day)'),
      ],
      ['kcalPerLitreO2', t('labs.metabolic.kcalPerLitre', 'kcal per litre O2')],
      ['vo2MlMin', t('labs.metabolic.vo2Field', 'VO2 (mL/min)')],
      ['vco2MlMin', t('labs.metabolic.vco2Field', 'VCO2 (mL/min)')],
      ['rq', t('labs.metabolic.rq', 'RQ')],
      ['durationMin', t('labs.metabolic.duration', 'Duration (min)')],
      ['steadyStateCvPct', t('labs.metabolic.steadyCv', 'Steady-state CV %')],
      ['ageYears', t('labs.metabolic.age', 'Age (years)')],
      ['heightCm', t('labs.metabolic.height', 'Height (cm)')],
      ['weightKg', t('labs.metabolic.weight', 'Weight (kg)')],
      ['fatFreeMassKg', t('labs.metabolic.fatFreeMass', 'Fat-free mass (kg)')],
      [
        'reportedPredictedKcal',
        t('labs.metabolic.printedPredicted', 'Predicted RMR (kcal)'),
      ],
      [
        'reportedActivityFactor',
        t('labs.metabolic.printedFactor', 'Activity factor'),
      ],
      ['fastingHours', t('labs.metabolic.fastingHours', 'Hours fasted')],
      ['restMin', t('labs.metabolic.restMinutes', 'Minutes rested')],
      ['roomTempC', t('labs.metabolic.roomTemp', 'Room temperature (°C)')],
    ];
    for (const [key, label] of numbers) {
      if (field(key).trim() !== '' && !Number.isFinite(Number(field(key)))) {
        setError(
          t('labs.metabolic.notANumber', '{{field}} must be a number.', {
            field: label,
          })
        );
        return;
      }
    }
    for (const key of ['measuredRmrKcal', 'ageYears', 'heightCm', 'weightKg']) {
      if (field(key).trim() === '') {
        setError(
          t('labs.metabolic.required', '{{field}} is required.', {
            field: numbers.find(([k]) => k === key)?.[1] ?? key,
          })
        );
        return;
      }
    }
    if (!sex) {
      setError(t('labs.metabolic.chooseSex', 'Choose male or female.'));
      return;
    }
    const optional = (value: string) => value.trim() || null;
    const input: MetabolicTestInput = {
      tested_day: day,
      method,
      device_label: optional(field('deviceLabel')),
      facility: optional(field('facility')),
      measured_rmr_kcal: toNumber(field('measuredRmrKcal')) as number,
      kcal_per_litre_o2: toNumber(field('kcalPerLitreO2')),
      vo2_ml_min: toNumber(field('vo2MlMin')),
      vco2_ml_min: toNumber(field('vco2MlMin')),
      rq: toNumber(field('rq')),
      duration_min: toNumber(field('durationMin')),
      steady_state_cv_pct: toNumber(field('steadyStateCvPct')),
      sex: sex as 'male' | 'female',
      age_years: toNumber(field('ageYears')) as number,
      height_cm: toNumber(field('heightCm')) as number,
      weight_kg: toNumber(field('weightKg')) as number,
      fat_free_mass_kg: toNumber(field('fatFreeMassKg')),
      reported_predicted_kcal: toNumber(field('reportedPredictedKcal')),
      reported_prediction_equation: optional(field('reportedEquation')),
      reported_activity_factor: toNumber(field('reportedActivityFactor')),
      reported_activity_label: optional(field('reportedActivityLabel')),
      prep: {
        fasted: toAnswer(answer('fasted')),
        fasting_hours:
          answer('fasted') === 'yes' ? toNumber(field('fastingHours')) : null,
        no_caffeine: toAnswer(answer('noCaffeine')),
        no_training_prior_day: toAnswer(answer('noTraining')),
        active_travel: toAnswer(answer('activeTravel')),
        rested: toAnswer(answer('rested')),
        rest_min_before_test:
          answer('rested') === 'yes' ? toNumber(field('restMin')) : null,
        illness_free_14d: toAnswer(answer('illnessFree')),
        awake_quiet: toAnswer(answer('awakeQuiet')),
      },
      room_temp_c: toNumber(field('roomTempC')),
      notes: optional(field('notes')),
    };
    const parsed = metabolicTestInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path.length
          ? `${String(issue.path[issue.path.length - 1]).replace(/_/g, ' ')}: ${issue.message}`
          : (issue?.message ??
              t('labs.metabolic.invalid', 'Check the values and try again.'))
      );
      return;
    }
    try {
      await add.mutateAsync(input);
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t(
              'labs.metabolic.saveFailed',
              'Could not save the RMR test. Please try again.'
            )
      );
    }
  }

  const numberField = (
    key: string,
    label: string,
    options: { required?: boolean; placeholder?: string } = {}
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`rmr-${key}`}>
        {label}
        {options.required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={`rmr-${key}`}
        inputMode="decimal"
        value={field(key)}
        placeholder={options.placeholder}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );
  const textField = (key: string, label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`rmr-${key}`}>{label}</Label>
      <Input
        id={`rmr-${key}`}
        value={field(key)}
        placeholder={placeholder}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );
  const choice = (key: string, label: string, help: string) => (
    <div className="space-y-1">
      <Label htmlFor={`rmr-prep-${key}`}>{label}</Label>
      <select
        id={`rmr-prep-${key}`}
        className={SELECT_CLASS}
        value={answer(key)}
        onChange={(e) =>
          setPrep((current) => ({
            ...current,
            [key]: e.target.value as Answer,
          }))
        }
      >
        <option value="">{t('labs.metabolic.unknown', 'Unknown')}</option>
        <option value="yes">{t('labs.metabolic.yes', 'Yes')}</option>
        <option value="no">{t('labs.metabolic.no', 'No')}</option>
      </select>
      <p className="text-[11px] text-muted-foreground">{help}</p>
    </div>
  );
  const section = (
    title: string,
    hint: string | null,
    body: React.ReactNode
  ) => (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {body}
    </section>
  );

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-md border p-4"
      aria-label={t('labs.metabolic.formLabel', 'Add a measured RMR test')}
    >
      {section(
        t('labs.metabolic.sectionTest', 'Test'),
        null,
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rmr-day">
              {t('labs.metabolic.testDay', 'Test date')}
              <span className="text-destructive"> *</span>
            </Label>
            <Input
              id="rmr-day"
              type="date"
              required
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rmr-method">
              {t('labs.metabolic.method', 'Method')}
              <span className="text-destructive"> *</span>
            </Label>
            <select
              id="rmr-method"
              className={SELECT_CLASS}
              value={method}
              onChange={(e) => onMethod(e.target.value as MetabolicTestMethod)}
            >
              {METABOLIC_TEST_METHODS.map((value) => (
                <option key={value} value={value}>
                  {value === 'ic_vo2_only'
                    ? t(
                        'labs.metabolic.methodVo2Only',
                        'Indirect calorimetry · VO2 only'
                      )
                    : value === 'ic_vo2_vco2'
                      ? t(
                          'labs.metabolic.methodVo2Vco2',
                          'Indirect calorimetry · VO2 + VCO2'
                        )
                      : t('labs.metabolic.methodOther', 'Other')}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {t(
                'labs.metabolic.methodHint',
                'A VO2-only device assumes an RQ; 4.81 kcal/L is about RQ 0.79.'
              )}
            </p>
          </div>
          {numberField(
            'kcalPerLitreO2',
            t('labs.metabolic.kcalPerLitre', 'kcal per litre O2')
          )}
          {textField(
            'deviceLabel',
            t('labs.metabolic.device', 'Device'),
            t('labs.metabolic.devicePlaceholder', 'as labelled by the clinic')
          )}
          {textField('facility', t('labs.metabolic.facility', 'Facility'))}
        </div>
      )}

      {section(
        t('labs.metabolic.sectionMeasured', 'Measured'),
        t(
          'labs.metabolic.measuredHint',
          'The number the clinic printed, plus anything else on the sheet.'
        ),
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {numberField(
            'measuredRmrKcal',
            t('labs.metabolic.measuredRmr', 'Measured RMR (kcal/day)'),
            { required: true }
          )}
          {numberField(
            'vo2MlMin',
            t('labs.metabolic.vo2Field', 'VO2 (mL/min)')
          )}
          {numberField(
            'vco2MlMin',
            t('labs.metabolic.vco2Field', 'VCO2 (mL/min)')
          )}
          {numberField('rq', t('labs.metabolic.rq', 'RQ'))}
          {numberField(
            'durationMin',
            t('labs.metabolic.duration', 'Duration (min)')
          )}
          {numberField(
            'steadyStateCvPct',
            t('labs.metabolic.steadyCv', 'Steady-state CV %')
          )}
        </div>
      )}

      {section(
        t('labs.metabolic.sectionSubject', 'Subject'),
        t(
          'labs.metabolic.subjectHint',
          'The values the clinic fed its prediction equation.'
        ),
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="rmr-sex">
              {t('labs.metabolic.sex', 'Sex')}
              <span className="text-destructive"> *</span>
            </Label>
            <select
              id="rmr-sex"
              className={SELECT_CLASS}
              value={sex}
              onChange={(e) => setSex(e.target.value)}
            >
              <option value="">{t('labs.metabolic.choose', 'Choose')}</option>
              <option value="male">{t('labs.metabolic.male', 'Male')}</option>
              <option value="female">
                {t('labs.metabolic.female', 'Female')}
              </option>
            </select>
          </div>
          {numberField('ageYears', t('labs.metabolic.age', 'Age (years)'), {
            required: true,
          })}
          {numberField('heightCm', t('labs.metabolic.height', 'Height (cm)'), {
            required: true,
          })}
          {numberField('weightKg', t('labs.metabolic.weight', 'Weight (kg)'), {
            required: true,
          })}
          {numberField(
            'fatFreeMassKg',
            t('labs.metabolic.fatFreeMass', 'Fat-free mass (kg)')
          )}
        </div>
      )}
      <p className="-mt-3 text-[11px] text-muted-foreground">
        {t(
          'labs.metabolic.fatFreeMassHint',
          'Fat-free mass is optional, from a body scan; the equations that use it are shown only when it is entered.'
        )}
      </p>

      {section(
        t('labs.metabolic.sectionPrinted', 'Clinic-printed prediction'),
        t(
          'labs.metabolic.printedHint',
          'Stored as printed. Every equation is recomputed and no target is derived from these.'
        ),
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField(
            'reportedPredictedKcal',
            t('labs.metabolic.printedPredicted', 'Predicted RMR (kcal)')
          )}
          {textField(
            'reportedEquation',
            t('labs.metabolic.printedEquation', 'Equation label'),
            t(
              'labs.metabolic.printedEquationPlaceholder',
              'e.g. Mifflin-St Jeor'
            )
          )}
          {numberField(
            'reportedActivityFactor',
            t('labs.metabolic.printedFactor', 'Activity factor')
          )}
          {textField(
            'reportedActivityLabel',
            t('labs.metabolic.printedFactorLabel', 'Activity label'),
            t('labs.metabolic.printedFactorPlaceholder', 'e.g. Moderate')
          )}
        </div>
      )}

      {section(
        t('labs.metabolic.sectionConditions', 'Conditions'),
        t(
          'labs.metabolic.conditionsHint',
          'Unknown is a valid answer; the panel marks conditions that are not recorded.'
        ),
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {choice(
            'fasted',
            t('labs.metabolic.condFasted', 'Fasted'),
            t(
              'labs.metabolic.condFastedHelp',
              'No food before the visit (aim for 12 hours).'
            )
          )}
          {answer('fasted') === 'yes' &&
            numberField(
              'fastingHours',
              t('labs.metabolic.fastingHours', 'Hours fasted')
            )}
          {choice(
            'noCaffeine',
            t('labs.metabolic.condCaffeine', 'No caffeine'),
            t(
              'labs.metabolic.condCaffeineHelp',
              'None on the morning of the visit.'
            )
          )}
          {choice(
            'noTraining',
            t(
              'labs.metabolic.condTraining',
              'No training in the prior 24 hours'
            ),
            t(
              'labs.metabolic.condTrainingHelp',
              'A rest day before the visit; exercise shifts water and glycogen.'
            )
          )}
          {choice(
            'activeTravel',
            t('labs.metabolic.condTravel', 'Active travel to the clinic'),
            t(
              'labs.metabolic.condTravelHelp',
              'Cycled or walked there. Yes is a confound: recorded, not judged.'
            )
          )}
          {choice(
            'illnessFree',
            t('labs.metabolic.condIllness', 'Illness-free for 14 days'),
            t(
              'labs.metabolic.condIllnessHelp',
              'No fever, infection or gut illness in the last two weeks.'
            )
          )}
          {choice(
            'rested',
            t(
              'labs.metabolic.condRested',
              'Rested 15 minutes or more before the test'
            ),
            t(
              'labs.metabolic.condRestedHelp',
              'Seated or lying quietly before the mask went on.'
            )
          )}
          {answer('rested') === 'yes' &&
            numberField(
              'restMin',
              t('labs.metabolic.restMinutes', 'Minutes rested')
            )}
          {choice(
            'awakeQuiet',
            t('labs.metabolic.condAwake', 'Awake and still'),
            t(
              'labs.metabolic.condAwakeHelp',
              'No talking, reading or dozing during the measurement.'
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {numberField(
          'roomTempC',
          t('labs.metabolic.roomTemp', 'Room temperature (°C)')
        )}
        <div className="space-y-1">
          <Label htmlFor="rmr-notes">
            {t('labs.metabolic.notes', 'Notes')}
          </Label>
          <Textarea
            id="rmr-notes"
            rows={2}
            value={field('notes')}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={add.isPending}>
          <Save className="mr-1 h-4 w-4" />
          {add.isPending
            ? t('labs.metabolic.saving', 'Saving…')
            : t('labs.metabolic.save', 'Save RMR test')}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
