import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, ScanLine, Trash2 } from 'lucide-react';
import {
  BODY_COMP_REGIONS,
  bodyCompChecks,
  bodyCompIndices,
  bodyCompIntervalExposure,
  compareBodyCompScans,
  distributionRatios,
  limbAsymmetry,
  nextBodyCompScanWindow,
  todayInZone,
  type BodyCompDeltaKey,
  type BodyCompPrep,
  type BodyCompScan,
  type ChangeTier,
  type DoseHistoryEntry,
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
  useBodyCompScans,
  useDeleteBodyCompScanMutation,
} from '@/hooks/Labs/useBodyCompScans';
import { useMetabolicTests } from '@/hooks/Labs/useMetabolicTests';
import { useLifeEvents } from '@/hooks/Medications/useLifeEvents';
import { useMedicationBlends } from '@/hooks/Medications/useMedicationBlends';
import { useMedicationEntries } from '@/hooks/useMedications';
import BodyCompScanForm from './BodyCompScanForm';
import BodyCompFigureCard from './BodyCompFigureCard';
import BodyCompNearestLabs from './BodyCompNearestLabs';
import BodyCompReportFields from './BodyCompReportFields';
import BodyCompSeries from './BodyCompSeries';
import { regionReportColumns } from './bodyCompReportFieldsModel';
import { num } from './bodyCompFormat';
import { TIER_FALLBACK, TIER_VARIANT } from './bodyCompTier';
import LinkedDocuments from './LinkedDocuments';

const kg = (grams: number) => (grams / 1000).toFixed(1);
const one = (n: number) => n.toFixed(1);
const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

const REGION_FALLBACK: Record<string, string> = {
  l_arm: 'Left arm',
  r_arm: 'Right arm',
  trunk: 'Trunk',
  l_leg: 'Left leg',
  r_leg: 'Right leg',
  head: 'Head',
  android: 'Android zone',
  gynoid: 'Gynoid zone',
};
const DELTA_FALLBACK: Record<BodyCompDeltaKey, string> = {
  fat_mass: 'Fat mass',
  lean_mass: 'Lean mass (without bone)',
  pct_fat: 'Body fat',
  alm: 'Appendicular lean mass',
  vat: 'Visceral fat',
};

/**
 * What was taken between two scans, from the dose log: every compound with a taken dose in the
 * window, with equal weight. It is the regimen during the interval, not an attribution of any
 * change to any compound.
 */
function IntervalExposure({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const entries = useMedicationEntries({ fromDate: from, toDate: to });
  const blends = useMedicationBlends().data;
  const rows = useMemo(
    () =>
      bodyCompIntervalExposure(
        (entries.data ?? []) as DoseHistoryEntry[],
        blends ?? [],
        from,
        to
      ),
    [entries.data, blends, from, to]
  );
  if (entries.isLoading || entries.isError) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">
        {t('labs.bodyComp.exposureTitle', 'Taken between these scans')}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'labs.bodyComp.exposureNone',
            'No doses were logged in this window.'
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 font-medium">
                  {t('labs.bodyComp.exposureCompound', 'Compound')}
                </th>
                <th className="pb-1 text-right font-medium">
                  {t('labs.bodyComp.exposureDays', 'Days active')}
                </th>
                <th className="pb-1 text-right font-medium">
                  {t('labs.bodyComp.exposureDoses', 'Doses')}
                </th>
                <th className="pb-1 text-right font-medium">
                  {t('labs.bodyComp.exposureTotal', 'Total (mg)')}
                </th>
                <th className="pb-1 text-right font-medium">
                  {t('labs.bodyComp.exposureSince', 'Days since last dose')}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((row) => (
                <tr key={row.medication_id ?? row.name} className="border-t">
                  <td className="py-1">
                    {row.name}
                    {Number(row.via_blends_mg) > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {t(
                          'medications.blends.derivedFrom',
                          '(derived, {{source}})',
                          { source: row.derived_source ?? 'label' }
                        )}
                      </span>
                    )}
                    <span className="block text-[10px] text-muted-foreground">
                      {formatDate(row.first_date)} – {formatDate(row.last_date)}
                    </span>
                  </td>
                  <td className="py-1 text-right">{row.days_active}</td>
                  <td className="py-1 text-right">{row.doses}</td>
                  <td className="py-1 text-right">
                    {Number(row.total_mg).toFixed(2)}
                  </td>
                  <td className="py-1 text-right">
                    {row.days_since_last_dose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t(
          'labs.bodyComp.exposureNote',
          'Doses logged in mass units from {{from}} to {{to}}, listed alphabetically. This is what was taken during the interval, not a reason for any change.',
          { from: formatDate(from), to: formatDate(to) }
        )}
      </p>
    </div>
  );
}

/**
 * DEXA body composition scans, as Pitstop's Body page keeps them: each report's printed figures,
 * the indices worked out from them, a check that the report agrees with itself, and the change
 * between two scans set against the scanner's own measurement noise. A change is only called one
 * when it clears that noise, and scans from different scanners or software are never compared.
 * Descriptive only: no target or goal is set from any of it.
 */
export default function BodyCompScansCard() {
  const { t } = useTranslation();
  const { formatDate, timezone } = usePreferences();
  const { data, isError, isLoading } = useBodyCompScans();
  const remove = useDeleteBodyCompScanMutation();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<BodyCompScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const scans = useMemo(() => data ?? [], [data]);
  const metabolicTests = useMetabolicTests().data;
  const lifeEvents = useLifeEvents().data;
  const today = todayInZone(timezone);

  const regionLabel = (name: string) =>
    t(`labs.bodyComp.region.${name}`, REGION_FALLBACK[name] ?? name);
  const answerWord = (value: boolean | null) =>
    value === null
      ? t('labs.bodyComp.unknownLower', 'unknown')
      : value
        ? t('labs.bodyComp.yesLower', 'yes')
        : t('labs.bodyComp.noLower', 'no');
  const prepItems = (prep: BodyCompPrep): [string, string][] => [
    [
      t('labs.bodyComp.fasted', 'Fasted'),
      `${answerWord(prep.fasted)}${
        prep.fasted === true && prep.fasting_hours !== null
          ? ` (${prep.fasting_hours} h)`
          : ''
      }`,
    ],
    [
      t('labs.bodyComp.noCaffeine', 'No caffeine'),
      answerWord(prep.no_caffeine),
    ],
    [
      t('labs.bodyComp.noTraining', 'No hard training the day before'),
      answerWord(prep.no_training_prior_day),
    ],
    [
      t('labs.bodyComp.activeTravel', 'Cycled or ran to the clinic'),
      answerWord(prep.active_travel),
    ],
    [
      t('labs.bodyComp.euhydrated', 'Normally hydrated, bladder emptied'),
      answerWord(prep.euhydrated_voided),
    ],
    [
      t('labs.bodyComp.illnessFree', 'No illness in the last 14 days'),
      answerWord(prep.illness_free_14d),
    ],
  ];
  const checkLabel = (name: string) =>
    ({
      fat_sum: t(
        'labs.bodyComp.check.fat_sum',
        'Region fat adds up to the total'
      ),
      lean_sum: t(
        'labs.bodyComp.check.lean_sum',
        'Region lean adds up to the total'
      ),
      bmc_sum: t(
        'labs.bodyComp.check.bmc_sum',
        'Region bone mineral adds up to the total'
      ),
      mass_sum: t(
        'labs.bodyComp.check.mass_sum',
        'Region mass adds up to the total'
      ),
      pct_fat: t(
        'labs.bodyComp.check.pct_fat',
        'Printed body fat matches fat over total mass'
      ),
    })[name] ?? name;

  // The latest two scans by default; any two can be chosen.
  const earlier = scans.find((s) => s.id === fromId) ?? scans[1];
  const later = scans.find((s) => s.id === toId) ?? scans[0];
  const comparison =
    earlier && later && earlier.id !== later.id
      ? earlier.scanned_day <= later.scanned_day
        ? compareBodyCompScans(earlier, later)
        : compareBodyCompScans(later, earlier)
      : null;
  const ordered =
    earlier && later && earlier.scanned_day > later.scanned_day
      ? { from: later, to: earlier }
      : { from: earlier, to: later };
  const next = scans[0]
    ? nextBodyCompScanWindow(scans[0].scanned_day, today)
    : null;

  const tierLabel = (tier: ChangeTier) =>
    t(`labs.bodyComp.tier.${tier}`, TIER_FALLBACK[tier]);
  const unitText = (unit: 'kg' | 'pct' | 'g') =>
    unit === 'kg'
      ? 'kg'
      : unit === 'pct'
        ? t('labs.bodyComp.points', 'points')
        : 'g';
  const decimals = (unit: 'kg' | 'pct' | 'g') => (unit === 'g' ? 0 : 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ScanLine className="h-4 w-4" />
            {t('labs.bodyComp.title', 'Body composition (DEXA)')}
          </CardTitle>
          {!adding && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('labs.bodyComp.add', 'Add a scan')}
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          {t(
            'labs.bodyComp.intro',
            'Each report’s printed figures, the indices worked out from them, and what changed between two scans against the scanner’s own measurement noise. Nothing here sets a target.'
          )}{' '}
          <Link
            to="/labs/dexa-checklist"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('labs.bodyComp.prepLink', 'Pre-visit checklist')}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {adding && (
          <BodyCompScanForm
            onSaved={() => {
              setAdding(false);
              setFromId(null);
              setToId(null);
            }}
          />
        )}
        {adding && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdding(false)}
          >
            {t('labs.bodyComp.cancel', 'Cancel')}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {isError && (
          <p className="text-xs text-muted-foreground">
            {t('labs.bodyComp.loadFailed', 'Could not load the scans.')}
          </p>
        )}
        {!isLoading && !isError && scans.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground">
            {t(
              'labs.bodyComp.empty',
              'No scans yet. Add one from a DEXA report to see the indices and, with two or more, what changed.'
            )}
          </p>
        )}

        {next && (
          <p className="text-xs text-muted-foreground">
            {next.status === 'upcoming'
              ? t(
                  'labs.bodyComp.nextUpcoming',
                  'A repeat scan is worth taking from {{from}} to {{to}}, twelve to sixteen weeks after the latest.',
                  {
                    from: formatDate(next.due_from),
                    to: formatDate(next.due_to),
                  }
                )
              : next.status === 'in_window'
                ? t(
                    'labs.bodyComp.nextNow',
                    'A repeat scan is worth taking now, until {{to}}.',
                    { to: formatDate(next.due_to) }
                  )
                : t(
                    'labs.bodyComp.nextPassed',
                    'The usual window for a repeat scan ended on {{to}}.',
                    { to: formatDate(next.due_to) }
                  )}
          </p>
        )}

        {scans.length > 0 && (
          <>
            <BodyCompFigureCard scans={scans} />
            <BodyCompSeries
              scans={scans}
              tests={metabolicTests ?? []}
              lifeEvents={lifeEvents ?? []}
            />
          </>
        )}

        {comparison && ordered.from && ordered.to && (
          <section
            className="space-y-3 rounded-md border p-3"
            aria-label={t('labs.bodyComp.compareLabel', 'Compare two scans')}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="dexa-compare-from"
                  className="text-xs text-muted-foreground"
                >
                  {t('labs.bodyComp.compareFrom', 'From')}
                </label>
                <select
                  id="dexa-compare-from"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={earlier?.id ?? ''}
                  onChange={(e) => setFromId(e.target.value)}
                >
                  {scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDate(s.scanned_day)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="dexa-compare-to"
                  className="text-xs text-muted-foreground"
                >
                  {t('labs.bodyComp.compareTo', 'To')}
                </label>
                <select
                  id="dexa-compare-to"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={later?.id ?? ''}
                  onChange={(e) => setToId(e.target.value)}
                >
                  {scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDate(s.scanned_day)}
                    </option>
                  ))}
                </select>
              </div>
              <span className="pb-2 text-xs text-muted-foreground">
                {t('labs.bodyComp.daysApart', '{{count}} days apart', {
                  count: comparison.days,
                })}
              </span>
            </div>

            {comparison.comparability.hidden ? (
              <p role="status" className="text-xs">
                {t(
                  'labs.bodyComp.notComparable',
                  'These scans cannot be compared: {{reasons}}. The numbers would not mean the same thing.',
                  { reasons: comparison.comparability.reasons.join(', ') }
                )}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-1 font-medium">
                          {t('labs.bodyComp.deltaWhat', 'Measure')}
                        </th>
                        <th className="pb-1 text-right font-medium">
                          {t('labs.bodyComp.deltaBefore', 'Before')}
                        </th>
                        <th className="pb-1 text-right font-medium">
                          {t('labs.bodyComp.deltaAfter', 'After')}
                        </th>
                        <th className="pb-1 text-right font-medium">
                          {t('labs.bodyComp.deltaChange', 'Change')}
                        </th>
                        <th className="pb-1 pl-3 font-medium">
                          {t('labs.bodyComp.deltaVerdict', 'Against noise')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {comparison.rows.map((row) => (
                        <tr key={row.key} className="border-t align-top">
                          <td className="py-1">
                            {t(
                              `labs.bodyComp.delta.${row.key}`,
                              DELTA_FALLBACK[row.key]
                            )}
                          </td>
                          <td className="py-1 text-right">
                            {row.unit === 'g'
                              ? Math.round(row.previous)
                              : one(row.previous)}{' '}
                            {unitText(row.unit)}
                          </td>
                          <td className="py-1 text-right">
                            {row.unit === 'g'
                              ? Math.round(row.next)
                              : one(row.next)}{' '}
                            {unitText(row.unit)}
                          </td>
                          <td className="py-1 text-right font-medium">
                            {signed(row.flag.delta, decimals(row.unit))}{' '}
                            {unitText(row.unit)}
                            {row.per_30_days !== null && (
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                {t(
                                  'labs.bodyComp.per30',
                                  '{{rate}} {{unit}} per 30 days',
                                  {
                                    rate: signed(
                                      row.per_30_days,
                                      decimals(row.unit)
                                    ),
                                    unit: unitText(row.unit),
                                  }
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pl-3">
                            <Badge variant={TIER_VARIANT[row.flag.tier]}>
                              {tierLabel(row.flag.tier)}
                            </Badge>
                            {row.flag.demoted && (
                              <span className="block text-[10px] text-muted-foreground">
                                {t(
                                  'labs.bodyComp.demoted',
                                  'Lowered a step: the scans were not taken alike (the numbers alone say: {{tier}}).',
                                  { tier: tierLabel(row.flag.raw_tier) }
                                )}
                              </span>
                            )}
                            <span className="block text-[10px] text-muted-foreground">
                              {t(
                                'labs.bodyComp.band',
                                'noise {{technical}}{{practical}}',
                                {
                                  technical: row.flag.band.technical.toFixed(
                                    row.unit === 'g' ? 0 : 2
                                  ),
                                  practical:
                                    row.flag.band.practical === null
                                      ? ''
                                      : `, clear above ${row.flag.band.practical.toFixed(
                                          row.unit === 'g' ? 0 : 2
                                        )}`,
                                }
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {comparison.comparability.reasons.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('labs.bodyComp.differences', 'Not alike: {{reasons}}.', {
                      reasons: comparison.comparability.reasons.join('; '),
                    })}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {t(
                    'labs.bodyComp.precisionNote',
                    'Noise limits are a Hologic Horizon A default from published same-day precision, not your clinic’s own; a smaller change than the first figure cannot be told from re-measuring.'
                  )}
                </p>
              </>
            )}
            <IntervalExposure
              from={ordered.from.scanned_day}
              to={ordered.to.scanned_day}
            />
          </section>
        )}

        {scans[0] && <BodyCompNearestLabs scanDay={scans[0].scanned_day} />}

        <ul className="space-y-2">
          {scans.map((scan) => {
            const regionColumns = regionReportColumns(scan.regions);
            const idx = bodyCompIndices(scan);
            const asym = limbAsymmetry(scan);
            const ratios = distributionRatios(scan);
            const failed = bodyCompChecks(scan).filter(
              (c) => c.evaluated && !c.pass
            );
            return (
              <li key={scan.id} className="rounded-md border">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-3">
                    <span className="font-medium">
                      {formatDate(scan.scanned_day)}
                      {(scan.device_label || scan.facility) && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {[scan.device_label, scan.facility]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {one(scan.pct_fat)}% {t('labs.bodyComp.fatWord', 'fat')} ·{' '}
                      {kg(scan.total_fat_g)} kg{' '}
                      {t('labs.bodyComp.fatShort', 'fat')} ·{' '}
                      {kg(scan.total_lean_g)} kg{' '}
                      {t('labs.bodyComp.leanShort', 'lean')}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t p-3">
                    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      {(
                        [
                          [
                            t('labs.bodyComp.ffm', 'Fat-free mass'),
                            `${one(idx.ffm_kg)} kg`,
                          ],
                          [t('labs.bodyComp.ffmi', 'FFMI'), one(idx.ffmi)],
                          [t('labs.bodyComp.fmi', 'FMI'), one(idx.fmi)],
                          [t('labs.bodyComp.lmi', 'LMI'), one(idx.lmi)],
                          ...(idx.alm_kg !== null && idx.almi !== null
                            ? ([
                                [
                                  t('labs.bodyComp.alm', 'Appendicular lean'),
                                  `${one(idx.alm_kg)} kg`,
                                ],
                                [
                                  t('labs.bodyComp.almi', 'ALMI'),
                                  one(idx.almi),
                                ],
                              ] as [string, string][])
                            : []),
                          ...(scan.vat_mass_g !== null
                            ? ([
                                [
                                  t('labs.bodyComp.vatShort', 'Visceral fat'),
                                  `${Math.round(scan.vat_mass_g)} g`,
                                ],
                              ] as [string, string][])
                            : []),
                          ...(scan.total_bmd_gcm2 !== null
                            ? ([
                                [
                                  t('labs.bodyComp.bmdShort', 'Bone density'),
                                  `${scan.total_bmd_gcm2.toFixed(3)} g/cm²`,
                                ],
                              ] as [string, string][])
                            : []),
                        ] as [string, string][]
                      ).map(([label, value]) => (
                        <div key={label} className="rounded bg-muted/40 p-2">
                          <dt className="text-[10px] font-semibold text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="font-medium tabular-nums">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    {failed.length > 0 && (
                      <ul
                        role="status"
                        className="space-y-0.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-700 dark:bg-amber-950/30"
                      >
                        {failed.map((check) => (
                          <li key={check.name}>
                            {checkLabel(check.name)}:{' '}
                            {t(
                              'labs.bodyComp.checkValues',
                              'worked out {{computed}}, printed {{printed}}',
                              {
                                computed: one(check.computed),
                                printed: one(check.printed),
                              }
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <BodyCompReportFields scan={scan} />

                    {scan.regions.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[360px] text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="pb-1 font-medium">
                                {t('labs.bodyComp.regionWord', 'Region')}
                              </th>
                              <th className="pb-1 text-right font-medium">
                                {t('labs.bodyComp.regionFat', 'Fat (g)')}
                              </th>
                              <th className="pb-1 text-right font-medium">
                                {t('labs.bodyComp.regionLean', 'Lean (g)')}
                              </th>
                              <th className="pb-1 text-right font-medium">
                                {t('labs.bodyComp.regionPct', '% fat')}
                              </th>
                              {regionColumns.pctFatYn && (
                                <th className="pb-1 text-right font-medium">
                                  {t('labs.bodyComp.regionYn', 'YN %ile')}
                                </th>
                              )}
                              {regionColumns.pctFatAm && (
                                <th className="pb-1 text-right font-medium">
                                  {t('labs.bodyComp.regionAm', 'AM %ile')}
                                </th>
                              )}
                              {regionColumns.bmd && (
                                <th className="pb-1 text-right font-medium">
                                  {t('labs.bodyComp.regionBmd', 'BMD g/cm²')}
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="tabular-nums">
                            {[...scan.regions]
                              .sort(
                                (a, b) =>
                                  BODY_COMP_REGIONS.indexOf(a.region) -
                                  BODY_COMP_REGIONS.indexOf(b.region)
                              )
                              .map((r) => (
                                <tr key={r.region} className="border-t">
                                  <td className="py-1">
                                    {regionLabel(r.region)}
                                  </td>
                                  <td className="py-1 text-right">
                                    {Math.round(r.fat_g)}
                                  </td>
                                  <td className="py-1 text-right">
                                    {Math.round(r.lean_g)}
                                  </td>
                                  <td className="py-1 text-right">
                                    {one(r.pct_fat)}
                                  </td>
                                  {regionColumns.pctFatYn && (
                                    <td className="py-1 text-right">
                                      {num(r.pct_fat_yn, 0)}
                                    </td>
                                  )}
                                  {regionColumns.pctFatAm && (
                                    <td className="py-1 text-right">
                                      {num(r.pct_fat_am, 0)}
                                    </td>
                                  )}
                                  {regionColumns.bmd && (
                                    <td className="py-1 text-right">
                                      {num(r.bmd_gcm2, 3)}
                                    </td>
                                  )}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {(asym.arms_pct !== null ||
                      asym.legs_pct !== null ||
                      ratios.android_gynoid !== null ||
                      ratios.trunk_limb_fat !== null) && (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {asym.arms_pct !== null && (
                          <li>
                            {t(
                              'labs.bodyComp.armsAsym',
                              'Arm lean mass, right against left: {{pct}}%',
                              { pct: signed(asym.arms_pct) }
                            )}
                          </li>
                        )}
                        {asym.legs_pct !== null && (
                          <li>
                            {t(
                              'labs.bodyComp.legsAsym',
                              'Leg lean mass, right against left: {{pct}}%',
                              { pct: signed(asym.legs_pct) }
                            )}
                          </li>
                        )}
                        {ratios.android_gynoid !== null && (
                          <li>
                            {t(
                              'labs.bodyComp.androidGynoid',
                              'Android over gynoid fat: {{ratio}}',
                              { ratio: ratios.android_gynoid.toFixed(2) }
                            )}
                          </li>
                        )}
                        {ratios.trunk_limb_fat !== null && (
                          <li>
                            {t(
                              'labs.bodyComp.trunkLimb',
                              'Trunk fat over limb fat: {{ratio}}',
                              { ratio: ratios.trunk_limb_fat.toFixed(2) }
                            )}
                          </li>
                        )}
                      </ul>
                    )}

                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground">
                        {t('labs.bodyComp.conditions', 'Conditions')}
                      </p>
                      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                        {prepItems(scan.prep).map(([label, value]) => (
                          <li key={label}>
                            {label}:{' '}
                            <span
                              className={
                                value === answerWord(null)
                                  ? 'text-muted-foreground'
                                  : 'font-medium'
                              }
                            >
                              {value}
                            </span>
                          </li>
                        ))}
                        {scan.creatine_status && (
                          <li>
                            {t('labs.bodyComp.creatine', 'Creatine')}:{' '}
                            <span className="font-medium">
                              {t(
                                `labs.bodyComp.creatineStatus.${scan.creatine_status}`,
                                scan.creatine_status
                              )}
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>

                    {scan.notes && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {scan.notes}
                      </p>
                    )}
                    <LinkedDocuments bodyCompScanId={scan.id} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(scan)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t('labs.bodyComp.delete', 'Delete')}
                    </Button>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('labs.bodyComp.deleteTitle', 'Delete this scan?')}
        description={t(
          'labs.bodyComp.deleteDescription',
          'The scan and what was recorded with it will be removed. This cannot be undone.'
        )}
        variant="destructive"
        confirmLabel={t('labs.bodyComp.delete', 'Delete')}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          setError(null);
          if (target)
            remove.mutate(target.id, {
              onSuccess: () => {
                setFromId(null);
                setToId(null);
              },
              onError: (failure) =>
                setError(
                  failure instanceof Error
                    ? failure.message
                    : t(
                        'labs.bodyComp.deleteFailed',
                        'Could not delete the scan. Please try again.'
                      )
                ),
            });
        }}
      />
    </Card>
  );
}
