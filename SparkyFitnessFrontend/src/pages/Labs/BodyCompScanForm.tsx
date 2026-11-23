import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import {
  BODY_COMP_REGIONS,
  CARB_PATTERNS,
  CREATINE_STATUSES,
  bodyCompScanInputSchema,
  todayInZone,
  type BodyCompRegion,
  type BodyCompScanInput,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAddBodyCompScanMutation } from '@/hooks/Labs/useBodyCompScans';

type Answer = '' | 'yes' | 'no';
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const toNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);
const toAnswer = (answer: Answer): boolean | null =>
  answer === '' ? null : answer === 'yes';
const round1 = (n: number) => Math.round(n * 10) / 10;

const REGION_FALLBACK: Record<BodyCompRegion, string> = {
  l_arm: 'Left arm',
  r_arm: 'Right arm',
  trunk: 'Trunk',
  l_leg: 'Left leg',
  r_leg: 'Right leg',
  head: 'Head',
  android: 'Android zone',
  gynoid: 'Gynoid zone',
};

/**
 * Entry of a DEXA whole-body scan as the report printed it, in grams. The total mass and the
 * percentage fat are worked out when left blank, and so are each region's total and percentage.
 * Every pre-scan condition can be left unknown: a condition that is not recorded is shown as such
 * when two scans are compared, never assumed.
 */
export default function BodyCompScanForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const add = useAddBodyCompScanMutation();
  const [day, setDay] = useState(() => todayInZone(timezone));
  const [sex, setSex] = useState('');
  const [text, setText] = useState<Record<string, string>>({});
  const [prep, setPrep] = useState<Record<string, Answer>>({});
  const [regions, setRegions] = useState<
    Partial<Record<BodyCompRegion, { fat: string; lean: string; bmc: string }>>
  >({});
  const [creatine, setCreatine] = useState('');
  const [carbs, setCarbs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const field = (key: string) => text[key] ?? '';
  const setField = (key: string, value: string) =>
    setText((current) => ({ ...current, [key]: value }));
  const answer = (key: string): Answer => prep[key] ?? '';
  const regionValue = (name: BodyCompRegion) =>
    regions[name] ?? { fat: '', lean: '', bmc: '' };
  const setRegion = (
    name: BodyCompRegion,
    part: 'fat' | 'lean' | 'bmc',
    value: string
  ) =>
    setRegions((current) => ({
      ...current,
      [name]: { ...regionValue(name), [part]: value },
    }));
  const regionLabel = (name: BodyCompRegion) =>
    t(`labs.bodyComp.region.${name}`, REGION_FALLBACK[name]);

  async function submit(submitted: React.FormEvent) {
    submitted.preventDefault();
    setError(null);
    const numbers: [string, string][] = [
      ['ageYears', t('labs.bodyComp.age', 'Age (years)')],
      ['heightCm', t('labs.bodyComp.height', 'Height (cm)')],
      ['clinicWeightKg', t('labs.bodyComp.clinicWeight', 'Clinic weight (kg)')],
      ['totalFatG', t('labs.bodyComp.totalFat', 'Fat mass (g)')],
      ['totalLeanG', t('labs.bodyComp.totalLean', 'Lean mass (g)')],
      ['totalBmcG', t('labs.bodyComp.totalBmc', 'Bone mineral (g)')],
      ['totalMassG', t('labs.bodyComp.totalMass', 'Total mass (g)')],
      ['pctFat', t('labs.bodyComp.pctFat', 'Body fat (%)')],
      ['vatMassG', t('labs.bodyComp.vatMass', 'Visceral fat mass (g)')],
      [
        'vatVolumeCm3',
        t('labs.bodyComp.vatVolume', 'Visceral fat volume (cm³)'),
      ],
      ['vatAreaCm2', t('labs.bodyComp.vatArea', 'Visceral fat area (cm²)')],
      ['totalBmd', t('labs.bodyComp.bmd', 'Bone density (g/cm²)')],
      ['fastingHours', t('labs.bodyComp.fastingHours', 'Hours fasted')],
    ];
    for (const [key, label] of numbers) {
      if (field(key).trim() !== '' && !Number.isFinite(Number(field(key)))) {
        setError(
          t('labs.bodyComp.notANumber', '{{field}} must be a number.', {
            field: label,
          })
        );
        return;
      }
    }
    for (const key of [
      'ageYears',
      'heightCm',
      'totalFatG',
      'totalLeanG',
      'totalBmcG',
    ]) {
      if (field(key).trim() === '') {
        setError(
          t('labs.bodyComp.required', '{{field}} is required.', {
            field: numbers.find(([k]) => k === key)?.[1] ?? key,
          })
        );
        return;
      }
    }
    if (!sex) {
      setError(t('labs.bodyComp.chooseSex', 'Choose male or female.'));
      return;
    }

    const regionRows: NonNullable<BodyCompScanInput['regions']> = [];
    for (const name of BODY_COMP_REGIONS) {
      const row = regionValue(name);
      const filled = [row.fat, row.lean, row.bmc].filter(
        (v) => v.trim() !== ''
      );
      if (filled.length === 0) continue;
      if (
        row.fat.trim() === '' ||
        row.lean.trim() === '' ||
        [row.fat, row.lean, row.bmc].some(
          (v) => v.trim() !== '' && !Number.isFinite(Number(v))
        )
      ) {
        setError(
          t(
            'labs.bodyComp.regionIncomplete',
            '{{region}}: enter fat and lean as numbers, or clear the row.',
            { region: regionLabel(name) }
          )
        );
        return;
      }
      const fat = Number(row.fat);
      const lean = Number(row.lean);
      const bmc = row.bmc.trim() === '' ? null : Number(row.bmc);
      const total = fat + lean + (bmc ?? 0);
      if (!(total > 0)) {
        setError(
          t(
            'labs.bodyComp.regionEmpty',
            '{{region}}: the region has no mass.',
            { region: regionLabel(name) }
          )
        );
        return;
      }
      regionRows.push({
        region: name,
        fat_g: fat,
        lean_g: lean,
        bmc_g: bmc,
        total_g: total,
        pct_fat: round1((fat / total) * 100),
      });
    }

    const optional = (value: string) => value.trim() || null;
    const input: BodyCompScanInput = {
      scanned_day: day,
      device_label: optional(field('deviceLabel')),
      device_serial: optional(field('deviceSerial')),
      software_version: optional(field('softwareVersion')),
      facility: optional(field('facility')),
      sex: sex as 'male' | 'female',
      age_years: toNumber(field('ageYears')) as number,
      height_cm: toNumber(field('heightCm')) as number,
      clinic_weight_kg: toNumber(field('clinicWeightKg')),
      total_fat_g: toNumber(field('totalFatG')) as number,
      total_lean_g: toNumber(field('totalLeanG')) as number,
      total_bmc_g: toNumber(field('totalBmcG')) as number,
      total_mass_g: toNumber(field('totalMassG')),
      pct_fat: toNumber(field('pctFat')),
      vat_mass_g: toNumber(field('vatMassG')),
      vat_volume_cm3: toNumber(field('vatVolumeCm3')),
      vat_area_cm2: toNumber(field('vatAreaCm2')),
      total_bmd_gcm2: toNumber(field('totalBmd')),
      prep: {
        fasted: toAnswer(answer('fasted')),
        fasting_hours:
          answer('fasted') === 'yes' ? toNumber(field('fastingHours')) : null,
        no_caffeine: toAnswer(answer('noCaffeine')),
        no_training_prior_day: toAnswer(answer('noTraining')),
        active_travel: toAnswer(answer('activeTravel')),
        euhydrated_voided: toAnswer(answer('euhydrated')),
        illness_free_14d: toAnswer(answer('illnessFree')),
      },
      creatine_status: (creatine ||
        null) as BodyCompScanInput['creatine_status'],
      carb_pattern_48h: (carbs ||
        null) as BodyCompScanInput['carb_pattern_48h'],
      regions: regionRows,
      notes: optional(field('notes')),
    };
    const parsed = bodyCompScanInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path.length
          ? `${String(issue.path[issue.path.length - 1]).replace(/_/g, ' ')}: ${issue.message}`
          : (issue?.message ??
              t('labs.bodyComp.invalid', 'Check the values and try again.'))
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
              'labs.bodyComp.saveFailed',
              'Could not save the scan. Please try again.'
            )
      );
    }
  }

  const numberField = (
    key: string,
    label: string,
    options: { required?: boolean } = {}
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`dexa-${key}`}>
        {label}
        {options.required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={`dexa-${key}`}
        inputMode="decimal"
        value={field(key)}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );
  const textField = (key: string, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`dexa-${key}`}>{label}</Label>
      <Input
        id={`dexa-${key}`}
        value={field(key)}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );
  const choice = (key: string, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`dexa-prep-${key}`}>{label}</Label>
      <select
        id={`dexa-prep-${key}`}
        className={SELECT_CLASS}
        value={answer(key)}
        onChange={(e) =>
          setPrep((current) => ({
            ...current,
            [key]: e.target.value as Answer,
          }))
        }
      >
        <option value="">{t('labs.bodyComp.unknown', 'Unknown')}</option>
        <option value="yes">{t('labs.bodyComp.yes', 'Yes')}</option>
        <option value="no">{t('labs.bodyComp.no', 'No')}</option>
      </select>
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
      aria-label={t('labs.bodyComp.formLabel', 'Add a DEXA scan')}
    >
      {section(
        t('labs.bodyComp.sectionScan', 'Scan'),
        null,
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dexa-day">
              {t('labs.bodyComp.scanDay', 'Scan date')}
              <span className="text-destructive"> *</span>
            </Label>
            <Input
              id="dexa-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          {textField('facility', t('labs.bodyComp.facility', 'Clinic'))}
          {textField(
            'deviceLabel',
            t('labs.bodyComp.device', 'Scanner (make and model)')
          )}
          {textField(
            'deviceSerial',
            t('labs.bodyComp.serial', 'Scanner serial number')
          )}
          {textField(
            'softwareVersion',
            t('labs.bodyComp.software', 'Analysis software version')
          )}
        </div>
      )}
      <p className="-mt-3 text-[11px] text-muted-foreground">
        {t(
          'labs.bodyComp.scannerHint',
          'The serial number and software version decide whether two scans can be compared at all, so enter them if the report prints them.'
        )}
      </p>

      {section(
        t('labs.bodyComp.sectionSubject', 'Subject'),
        null,
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="dexa-sex">
              {t('labs.bodyComp.sex', 'Sex')}
              <span className="text-destructive"> *</span>
            </Label>
            <select
              id="dexa-sex"
              className={SELECT_CLASS}
              value={sex}
              onChange={(e) => setSex(e.target.value)}
            >
              <option value="">{t('labs.bodyComp.choose', 'Choose')}</option>
              <option value="male">{t('labs.bodyComp.male', 'Male')}</option>
              <option value="female">
                {t('labs.bodyComp.female', 'Female')}
              </option>
            </select>
          </div>
          {numberField('ageYears', t('labs.bodyComp.age', 'Age (years)'), {
            required: true,
          })}
          {numberField('heightCm', t('labs.bodyComp.height', 'Height (cm)'), {
            required: true,
          })}
          {numberField(
            'clinicWeightKg',
            t('labs.bodyComp.clinicWeight', 'Clinic weight (kg)')
          )}
        </div>
      )}

      {section(
        t('labs.bodyComp.sectionTotals', 'Whole body'),
        t(
          'labs.bodyComp.totalsHint',
          'In grams, as printed. Total mass and body fat are worked out from fat, lean and bone mineral when left blank. Lean is lean soft tissue without bone.'
        ),
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField(
            'totalFatG',
            t('labs.bodyComp.totalFat', 'Fat mass (g)'),
            {
              required: true,
            }
          )}
          {numberField(
            'totalLeanG',
            t('labs.bodyComp.totalLean', 'Lean mass (g)'),
            { required: true }
          )}
          {numberField(
            'totalBmcG',
            t('labs.bodyComp.totalBmc', 'Bone mineral (g)'),
            { required: true }
          )}
          {numberField(
            'totalMassG',
            t('labs.bodyComp.totalMass', 'Total mass (g)')
          )}
          {numberField('pctFat', t('labs.bodyComp.pctFat', 'Body fat (%)'))}
          {numberField(
            'vatMassG',
            t('labs.bodyComp.vatMass', 'Visceral fat mass (g)')
          )}
          {numberField(
            'vatVolumeCm3',
            t('labs.bodyComp.vatVolume', 'Visceral fat volume (cm³)')
          )}
          {numberField(
            'vatAreaCm2',
            t('labs.bodyComp.vatArea', 'Visceral fat area (cm²)')
          )}
          {numberField(
            'totalBmd',
            t('labs.bodyComp.bmd', 'Bone density (g/cm²)')
          )}
        </div>
      )}

      {section(
        t('labs.bodyComp.sectionRegions', 'Regions (optional)'),
        t(
          'labs.bodyComp.regionsHint',
          'Grams as printed. With all six body regions the report can be checked against itself, and arm and leg lean mass gives appendicular lean mass. Leave a region blank to skip it.'
        ),
        <div className="space-y-2">
          <div className="hidden grid-cols-[8rem_1fr_1fr_1fr] gap-2 text-xs text-muted-foreground sm:grid">
            <span />
            <span>{t('labs.bodyComp.regionFat', 'Fat (g)')}</span>
            <span>{t('labs.bodyComp.regionLean', 'Lean (g)')}</span>
            <span>{t('labs.bodyComp.regionBmc', 'Bone mineral (g)')}</span>
          </div>
          {BODY_COMP_REGIONS.map((name) => (
            <div
              key={name}
              className="grid grid-cols-3 items-center gap-2 sm:grid-cols-[8rem_1fr_1fr_1fr]"
            >
              <span className="col-span-3 text-sm sm:col-span-1">
                {regionLabel(name)}
              </span>
              {(['fat', 'lean', 'bmc'] as const).map((part) => (
                <Input
                  key={part}
                  inputMode="decimal"
                  aria-label={`${regionLabel(name)} ${
                    part === 'fat'
                      ? t('labs.bodyComp.regionFat', 'Fat (g)')
                      : part === 'lean'
                        ? t('labs.bodyComp.regionLean', 'Lean (g)')
                        : t('labs.bodyComp.regionBmc', 'Bone mineral (g)')
                  }`}
                  value={regionValue(name)[part]}
                  onChange={(e) => setRegion(name, part, e.target.value)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {section(
        t('labs.bodyComp.sectionPrep', 'Conditions'),
        t(
          'labs.bodyComp.prepHint',
          'Leave any you do not know as Unknown. Scans taken under different conditions are compared with less weight.'
        ),
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {choice('fasted', t('labs.bodyComp.fasted', 'Fasted'))}
          {answer('fasted') === 'yes' &&
            numberField(
              'fastingHours',
              t('labs.bodyComp.fastingHours', 'Hours fasted')
            )}
          {choice('noCaffeine', t('labs.bodyComp.noCaffeine', 'No caffeine'))}
          {choice(
            'noTraining',
            t('labs.bodyComp.noTraining', 'No hard training the day before')
          )}
          {choice(
            'activeTravel',
            t('labs.bodyComp.activeTravel', 'Cycled or ran to the clinic')
          )}
          {choice(
            'euhydrated',
            t('labs.bodyComp.euhydrated', 'Normally hydrated, bladder emptied')
          )}
          {choice(
            'illnessFree',
            t('labs.bodyComp.illnessFree', 'No illness in the last 14 days')
          )}
          <div className="space-y-1">
            <Label htmlFor="dexa-creatine">
              {t('labs.bodyComp.creatine', 'Creatine')}
            </Label>
            <select
              id="dexa-creatine"
              className={SELECT_CLASS}
              value={creatine}
              onChange={(e) => setCreatine(e.target.value)}
            >
              <option value="">{t('labs.bodyComp.unknown', 'Unknown')}</option>
              {CREATINE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`labs.bodyComp.creatineStatus.${status}`, status)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dexa-carbs">
              {t('labs.bodyComp.carbs', 'Carbohydrate, last 48 hours')}
            </Label>
            <select
              id="dexa-carbs"
              className={SELECT_CLASS}
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
            >
              <option value="">{t('labs.bodyComp.unknown', 'Unknown')}</option>
              {CARB_PATTERNS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {t(`labs.bodyComp.carbPattern.${pattern}`, pattern)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="dexa-notes">{t('labs.bodyComp.notes', 'Notes')}</Label>
        <Textarea
          id="dexa-notes"
          rows={2}
          value={field('notes')}
          onChange={(e) => setField('notes', e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={add.isPending}>
        <Save className="mr-2 h-4 w-4" />
        {t('labs.bodyComp.save', 'Save scan')}
      </Button>
    </form>
  );
}
