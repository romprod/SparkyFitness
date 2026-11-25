import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Save } from 'lucide-react';
import {
  BODY_COMP_REGIONS,
  CARB_PATTERNS,
  BODY_COMP_REPORT_FAILURES,
  CREATINE_STATUSES,
  bodyCompScanInputSchema,
  todayInZone,
  type BodyCompRegion,
  type BodyCompReportFailure,
  type BodyCompReportPrefill,
  type BodyCompScanInput,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useAddBodyCompScanMutation,
  useReadBodyCompReportMutation,
} from '@/hooks/Labs/useBodyCompScans';
import { useUploadHealthDocumentMutation } from '@/hooks/Labs/useHealthDocuments';
import { readFileAsBase64 } from '@/pages/Labs/labFormat';

type Answer = '' | 'yes' | 'no';
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const toNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);
const toAnswer = (answer: Answer): boolean | null =>
  answer === '' ? null : answer === 'yes';
const round1 = (n: number) => Math.round(n * 10) / 10;
const fromNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

/** A report PDF is read in memory by the server, which takes up to 10 MB. */
const REPORT_MAX_BYTES = 10 * 1024 * 1024;

type RegionPart = 'fat' | 'lean' | 'bmc' | 'pctYn' | 'pctAm' | 'bmd';
type RegionRow = Record<RegionPart, string>;
const EMPTY_REGION: RegionRow = {
  fat: '',
  lean: '',
  bmc: '',
  pctYn: '',
  pctAm: '',
  bmd: '',
};
const REGION_PARTS: readonly RegionPart[] = [
  'fat',
  'lean',
  'bmc',
  'pctYn',
  'pctAm',
  'bmd',
];

/** The reason a report could not be read, when the server refused it with one (a 422 and its code). */
function reportFailureOf(failure: unknown): BodyCompReportFailure | null {
  const { status, code } = (failure ?? {}) as {
    status?: number;
    code?: string;
  };
  return status === 422 &&
    (BODY_COMP_REPORT_FAILURES as readonly string[]).includes(code ?? '')
    ? (code as BodyCompReportFailure)
    : null;
}

/** What the review of a read report shows: the confidence, the checks that failed and what was not found. */
interface ReportReview {
  ok: boolean;
  confidence: number;
  failed: { name: string; detail: string }[];
  missing: string[];
}

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
  const readReport = useReadBodyCompReportMutation();
  const uploadDocument = useUploadHealthDocumentMutation();
  const [day, setDay] = useState(() => todayInZone(timezone));
  const [sex, setSex] = useState('');
  const [text, setText] = useState<Record<string, string>>({});
  const [prep, setPrep] = useState<Record<string, Answer>>({});
  const [regions, setRegions] = useState<
    Partial<Record<BodyCompRegion, RegionRow>>
  >({});
  // The report PDF the form was filled from, and whether to keep it with the scan.
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [keepReport, setKeepReport] = useState(true);
  const [review, setReview] = useState<ReportReview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // The scan is saved but its report PDF was not stored: the form stays, closed to a second save.
  const [stored, setStored] = useState<{ id: string; problem: string } | null>(
    null
  );
  const [creatine, setCreatine] = useState('');
  const [carbs, setCarbs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const field = (key: string) => text[key] ?? '';
  const setField = (key: string, value: string) =>
    setText((current) => ({ ...current, [key]: value }));
  const answer = (key: string): Answer => prep[key] ?? '';
  const regionValue = (name: BodyCompRegion): RegionRow =>
    regions[name] ?? EMPTY_REGION;
  const setRegion = (name: BodyCompRegion, part: RegionPart, value: string) =>
    setRegions((current) => ({
      ...current,
      [name]: { ...regionValue(name), [part]: value },
    }));
  const regionLabel = (name: BodyCompRegion) =>
    t(`labs.bodyComp.region.${name}`, REGION_FALLBACK[name]);

  const regionPartLabel = (part: RegionPart) =>
    ({
      fat: t('labs.bodyComp.regionFat', 'Fat (g)'),
      lean: t('labs.bodyComp.regionLean', 'Lean (g)'),
      bmc: t('labs.bodyComp.regionBmc', 'Bone mineral (g)'),
      pctYn: t('labs.bodyComp.regionPctYn', '% fat YN percentile'),
      pctAm: t('labs.bodyComp.regionPctAm', '% fat AM percentile'),
      bmd: t('labs.bodyComp.regionBmd', 'BMD (g/cm²)'),
    })[part];

  const failureText = (reason: BodyCompReportFailure) =>
    ({
      no_text_layer: t(
        'labs.bodyComp.import.noTextLayer',
        'This PDF has no text to read, so it is probably a scan or a photo. Enter the values by hand from the printed report.'
      ),
      not_hologic: t(
        'labs.bodyComp.import.notHologic',
        'This does not look like a Hologic whole-body report, so nothing was filled in.'
      ),
      unreadable: t(
        'labs.bodyComp.import.unreadable',
        'This PDF could not be opened. Try the original file from the clinic.'
      ),
      too_many_pages: t(
        'labs.bodyComp.import.tooManyPages',
        'This PDF has too many pages to be one body composition report. Send just the report.'
      ),
    })[reason];

  /** Puts what the report printed into the form. Every field stays editable; nothing is saved. */
  function fillFrom(prefill: BodyCompReportPrefill) {
    if (prefill.scanned_day) setDay(prefill.scanned_day);
    if (prefill.sex) setSex(prefill.sex);
    setText((current) => ({
      ...current,
      deviceLabel: prefill.device_label ?? '',
      deviceSerial: prefill.device_serial ?? '',
      softwareVersion: prefill.software_version ?? '',
      scanMode: prefill.scan_mode ?? '',
      referencePopulation: prefill.reference_population ?? '',
      ageYears: fromNumber(prefill.age_years),
      heightCm: fromNumber(prefill.height_cm),
      clinicWeightKg: fromNumber(prefill.clinic_weight_kg),
      totalFatG: fromNumber(prefill.total_fat_g),
      totalLeanG: fromNumber(prefill.total_lean_g),
      totalBmcG: fromNumber(prefill.total_bmc_g),
      totalMassG: fromNumber(prefill.total_mass_g),
      pctFat: fromNumber(prefill.pct_fat),
      vatMassG: fromNumber(prefill.vat_mass_g),
      vatVolumeCm3: fromNumber(prefill.vat_volume_cm3),
      vatAreaCm2: fromNumber(prefill.vat_area_cm2),
      totalBmd: fromNumber(prefill.total_bmd_gcm2),
      bmdTScore: fromNumber(prefill.bmd_t_score),
      bmdZScore: fromNumber(prefill.bmd_z_score),
      bmdCvPct: fromNumber(prefill.bmd_cv_pct),
      pctFatYn: fromNumber(prefill.pct_fat_yn),
      pctFatAm: fromNumber(prefill.pct_fat_am),
      fmiYn: fromNumber(prefill.fmi_yn),
      fmiAm: fromNumber(prefill.fmi_am),
      lmiYn: fromNumber(prefill.lmi_yn),
      lmiAm: fromNumber(prefill.lmi_am),
      almiYn: fromNumber(prefill.almi_yn),
      almiAm: fromNumber(prefill.almi_am),
    }));
    const next: Partial<Record<BodyCompRegion, RegionRow>> = {};
    for (const row of prefill.regions ?? [])
      next[row.region] = {
        fat: fromNumber(row.fat_g),
        lean: fromNumber(row.lean_g),
        bmc: fromNumber(row.bmc_g),
        pctYn: fromNumber(row.pct_fat_yn),
        pctAm: fromNumber(row.pct_fat_am),
        bmd: fromNumber(row.bmd_gcm2),
      };
    setRegions(next);
  }

  async function readReportFile(changed: React.ChangeEvent<HTMLInputElement>) {
    const file = changed.target.files?.[0];
    changed.target.value = '';
    if (!file) return;
    setImportError(null);
    if (file.size > REPORT_MAX_BYTES) {
      setImportError(
        t('labs.bodyComp.import.tooBig', 'The file is larger than 10 MB.')
      );
      return;
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setImportError(t('labs.bodyComp.import.notPdf', 'Choose a PDF file.'));
      return;
    }
    try {
      const result = await readReport.mutateAsync(await readFileAsBase64(file));
      fillFrom(result.prefill);
      setReportFile(file);
      setKeepReport(true);
      setReportOpen(true);
      setError(null);
      setReview({
        ok: result.ok,
        confidence: result.confidence,
        failed: result.checks.filter((c) => !c.pass),
        missing: result.missing,
      });
    } catch (failure) {
      // The form is left as it was.
      const reason = reportFailureOf(failure);
      setImportError(
        reason
          ? failureText(reason)
          : t(
              'labs.bodyComp.import.failed',
              'The report could not be read: {{reason}}',
              {
                reason:
                  failure instanceof Error && failure.message
                    ? failure.message
                    : t('labs.bodyComp.import.tryAgain', 'please try again.'),
              }
            )
      );
    }
  }

  /** Stores the report PDF as a health document linked to the saved scan. */
  async function storeReport(scanId: string): Promise<boolean> {
    if (!reportFile) return true;
    try {
      await uploadDocument.mutateAsync({
        file: reportFile,
        fields: {
          kind: 'dexa_report',
          document_day: day,
          body_comp_scan_id: scanId,
        },
      });
      return true;
    } catch (failure) {
      setStored({
        id: scanId,
        problem:
          failure instanceof Error && failure.message
            ? failure.message
            : t(
                'labs.bodyComp.import.storeFailed',
                'Could not store the file. Please try again.'
              ),
      });
      return false;
    }
  }

  async function retryStoring() {
    if (!stored) return;
    setStored(null);
    if (await storeReport(stored.id)) onSaved();
  }

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
      ['bmdTScore', t('labs.bodyComp.bmdTScore', 'T-score')],
      ['bmdZScore', t('labs.bodyComp.bmdZScore', 'Z-score')],
      ['bmdCvPct', t('labs.bodyComp.bmdCv', 'Site CV %')],
      ['pctFatYn', t('labs.bodyComp.pctFatYn', '% fat YN percentile')],
      ['pctFatAm', t('labs.bodyComp.pctFatAm', '% fat AM percentile')],
      ['fmiYn', t('labs.bodyComp.fmiYn', 'FMI YN percentile')],
      ['fmiAm', t('labs.bodyComp.fmiAm', 'FMI AM percentile')],
      ['lmiYn', t('labs.bodyComp.lmiYn', 'LMI YN percentile')],
      ['lmiAm', t('labs.bodyComp.lmiAm', 'LMI AM percentile')],
      ['almiYn', t('labs.bodyComp.almiYn', 'ALMI YN percentile')],
      ['almiAm', t('labs.bodyComp.almiAm', 'ALMI AM percentile')],
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
      const filled = REGION_PARTS.filter((part) => row[part].trim() !== '');
      if (filled.length === 0) continue;
      if (
        row.fat.trim() === '' ||
        row.lean.trim() === '' ||
        filled.some((part) => !Number.isFinite(Number(row[part])))
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
        ...(row.pctYn.trim() !== '' && { pct_fat_yn: Number(row.pctYn) }),
        ...(row.pctAm.trim() !== '' && { pct_fat_am: Number(row.pctAm) }),
        ...(row.bmd.trim() !== '' && { bmd_gcm2: Number(row.bmd) }),
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
      scan_mode: optional(field('scanMode')),
      reference_population: optional(field('referencePopulation')),
      bmd_t_score: toNumber(field('bmdTScore')),
      bmd_z_score: toNumber(field('bmdZScore')),
      bmd_cv_pct: toNumber(field('bmdCvPct')),
      pct_fat_yn: toNumber(field('pctFatYn')),
      pct_fat_am: toNumber(field('pctFatAm')),
      fmi_yn: toNumber(field('fmiYn')),
      fmi_am: toNumber(field('fmiAm')),
      lmi_yn: toNumber(field('lmiYn')),
      lmi_am: toNumber(field('lmiAm')),
      almi_yn: toNumber(field('almiYn')),
      almi_am: toNumber(field('almiAm')),
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
      const { id } = await add.mutateAsync(input);
      if (reportFile && keepReport) {
        // The scan is saved; a report that cannot be stored is said so beside it, not lost.
        if (!(await storeReport(id))) return;
      }
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
        t('labs.bodyComp.import.title', 'Read a Hologic report (PDF)'),
        null,
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="dexa-report-file">
              {t(
                'labs.bodyComp.import.file',
                'Hologic report (PDF, up to 10 MB)'
              )}
            </Label>
            <Input
              id="dexa-report-file"
              type="file"
              accept="application/pdf,.pdf"
              disabled={readReport.isPending || stored !== null}
              onChange={readReportFile}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'labs.bodyComp.import.hint',
                'Values are read from its text layer and shown here for review; nothing is saved until you confirm.'
              )}
            </p>
          </div>
          {readReport.isPending && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('labs.bodyComp.import.reading', 'Reading the report…')}
            </p>
          )}
          {importError && (
            <p role="alert" className="text-sm text-destructive">
              {importError}
            </p>
          )}
          {review && (
            <div
              role="status"
              aria-label={t('labs.bodyComp.import.review', 'Report review')}
              className="space-y-1 rounded-md bg-muted/40 p-2 text-xs"
            >
              <p className="font-medium">
                <FileText className="mr-1 inline h-3.5 w-3.5" />
                {t(
                  'labs.bodyComp.import.confidence',
                  'Read · {{percent}} % confidence',
                  { percent: Math.round(review.confidence * 100) }
                )}
              </p>
              <p className="text-muted-foreground">
                {review.ok
                  ? t(
                      'labs.bodyComp.import.pass',
                      'Every required row was found and every check matched. Review the values below against the printed report before saving.'
                    )
                  : t(
                      'labs.bodyComp.import.fail',
                      'The report was not read in full. Check each value below against the printed report before saving.'
                    )}{' '}
                {t(
                  'labs.bodyComp.import.confidenceNote',
                  'Confidence = rows found × checks passed.'
                )}
              </p>
              {review.failed.length > 0 && (
                <div>
                  <p className="font-medium">
                    {t(
                      'labs.bodyComp.import.failedChecks',
                      'Checks that did not match'
                    )}
                  </p>
                  <ul className="list-disc pl-4">
                    {review.failed.map((check) => (
                      <li key={check.name}>
                        {check.name}: {check.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {review.missing.length > 0 && (
                <p>
                  <span className="font-medium">
                    {t(
                      'labs.bodyComp.import.missing',
                      'Not found in the report:'
                    )}
                  </span>{' '}
                  {review.missing.join(', ')}
                </p>
              )}
            </div>
          )}
          {reportFile && (
            <div className="flex items-center gap-2">
              <input
                id="dexa-keep-report"
                type="checkbox"
                className="h-4 w-4"
                checked={keepReport}
                disabled={stored !== null}
                onChange={(e) => setKeepReport(e.target.checked)}
              />
              <Label htmlFor="dexa-keep-report" className="font-normal">
                {t(
                  'labs.bodyComp.import.keep',
                  'Keep the report PDF with this scan'
                )}
              </Label>
            </div>
          )}
        </div>
      )}

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

      <details
        className="rounded-md border p-2"
        open={reportOpen}
        onToggle={(e) => setReportOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium">
          {t('labs.bodyComp.sectionReport', 'Report percentiles and bone')}
        </summary>
        <div className="mt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              'labs.bodyComp.reportHint',
              'As the report prints them: the reference population is what the scores are taken against, percentiles are a position in that population and not a target, and the site CV % only if the clinic prints its own.'
            )}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {textField('scanMode', t('labs.bodyComp.scanMode', 'Scan mode'))}
            {textField(
              'referencePopulation',
              t('labs.bodyComp.referencePopulation', 'Reference population')
            )}
            {numberField('bmdTScore', t('labs.bodyComp.bmdTScore', 'T-score'))}
            {numberField('bmdZScore', t('labs.bodyComp.bmdZScore', 'Z-score'))}
            {numberField('bmdCvPct', t('labs.bodyComp.bmdCv', 'Site CV %'))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {numberField(
              'pctFatYn',
              t('labs.bodyComp.pctFatYn', '% fat YN percentile')
            )}
            {numberField(
              'pctFatAm',
              t('labs.bodyComp.pctFatAm', '% fat AM percentile')
            )}
            {numberField(
              'fmiYn',
              t('labs.bodyComp.fmiYn', 'FMI YN percentile')
            )}
            {numberField(
              'fmiAm',
              t('labs.bodyComp.fmiAm', 'FMI AM percentile')
            )}
            {numberField(
              'lmiYn',
              t('labs.bodyComp.lmiYn', 'LMI YN percentile')
            )}
            {numberField(
              'lmiAm',
              t('labs.bodyComp.lmiAm', 'LMI AM percentile')
            )}
            {numberField(
              'almiYn',
              t('labs.bodyComp.almiYn', 'ALMI YN percentile')
            )}
            {numberField(
              'almiAm',
              t('labs.bodyComp.almiAm', 'ALMI AM percentile')
            )}
          </div>
        </div>
      </details>

      {section(
        t('labs.bodyComp.sectionRegions', 'Regions (optional)'),
        t(
          'labs.bodyComp.regionsHint',
          'Grams as printed, with the region’s percentiles and bone density if the report prints them. With all six body regions the report can be checked against itself, and arm and leg lean mass gives appendicular lean mass. Leave a region blank to skip it.'
        ),
        <div className="space-y-2 overflow-x-auto">
          <div className="hidden min-w-[44rem] grid-cols-[8rem_repeat(6,minmax(0,1fr))] gap-2 text-xs text-muted-foreground sm:grid">
            <span />
            {REGION_PARTS.map((part) => (
              <span key={part}>{regionPartLabel(part)}</span>
            ))}
          </div>
          {BODY_COMP_REGIONS.map((name) => (
            <div
              key={name}
              className="grid grid-cols-3 items-center gap-2 sm:min-w-[44rem] sm:grid-cols-[8rem_repeat(6,minmax(0,1fr))]"
            >
              <span className="col-span-3 text-sm sm:col-span-1">
                {regionLabel(name)}
              </span>
              {REGION_PARTS.map((part) => (
                <Input
                  key={part}
                  inputMode="decimal"
                  aria-label={`${regionLabel(name)} ${regionPartLabel(part)}`}
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
      {stored && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>
            {t(
              'labs.bodyComp.import.partial',
              'Scan saved. The report PDF was not stored: {{reason}}',
              { reason: stored.problem }
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={uploadDocument.isPending}
              onClick={retryStoring}
            >
              {t('labs.bodyComp.import.retry', 'Try storing it again')}
            </Button>
            <Button type="button" variant="outline" onClick={onSaved}>
              {t('labs.bodyComp.import.done', 'Done')}
            </Button>
          </div>
        </div>
      )}
      <Button type="submit" disabled={add.isPending || stored !== null}>
        <Save className="mr-2 h-4 w-4" />
        {t('labs.bodyComp.save', 'Save scan')}
      </Button>
    </form>
  );
}
