import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BodyCompRegion,
  BodyCompScan,
  ChangeTier,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { usePreferences } from '@/contexts/PreferencesContext';
import BodyCompFigure, { type FigureMode } from './BodyCompFigure';
import {
  FAT_HUE_DOMAIN,
  buildBodyFigureModel,
  fatFillColor,
  REGION_LABEL,
  type BodyFigureModel,
  type FigureCell,
} from './bodyCompFigureModel';
import { num, signed, signedNum } from './bodyCompFormat';
import { scansOldestFirst } from './bodyCompSeriesModel';
import { TIER_FALLBACK, TIER_FILL, TIER_VARIANT } from './bodyCompTier';

const TIERS: ChangeTier[] = ['within_noise', 'indeterminate', 'exceeds_lsc'];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Regional distribution of the latest scan as a drawn outline with a Levels view and, when a
 * comparable earlier scan exists, a Change view against the whole-body % fat noise band. Shows
 * what the report printed and how far each region moved; it sets no target and says nothing
 * about why a value is what it is.
 */
export default function BodyCompFigureCard({
  scans,
}: {
  scans: readonly BodyCompScan[];
}) {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const [hovered, setHovered] = useState<BodyCompRegion | null>(null);
  const [selected, setSelected] = useState<BodyCompRegion | null>(null);
  const [mode, setMode] = useState<FigureMode>('levels');

  const model: BodyFigureModel | null = useMemo(() => {
    const ordered = scansOldestFirst(scans);
    const latest = ordered[ordered.length - 1];
    if (!latest) return null;
    return buildBodyFigureModel(latest, {
      prev: ordered.length >= 2 ? ordered[ordered.length - 2] : null,
    });
  }, [scans]);
  if (!model || model.regions.length === 0) return null;

  const regionLabel = (region: BodyCompRegion) =>
    t(`labs.bodyComp.figure.region.${region}`, REGION_LABEL[region]);
  const tierLabel = (tier: ChangeTier) =>
    t(`labs.bodyComp.tier.${tier}`, TIER_FALLBACK[tier]);
  const demotedWord = t('labs.bodyComp.figure.demoted', 'demoted');
  const cells: FigureCell[] = [...model.regions, ...model.bands];
  const canChange = model.change !== null;
  const shown: FigureMode = canChange ? mode : 'levels';
  const active = hovered ?? selected;
  const activeCell = cells.find((c) => c.region === active) ?? null;
  const toggle = (region: BodyCompRegion) =>
    setSelected((current) => (current === region ? null : region));

  const stats: [string, string][] = (() => {
    if (!activeCell) {
      const w = model.wholeBody;
      return [
        [
          t('labs.bodyComp.figure.weight', 'Weight'),
          `${(w.clinicWeightKg ?? w.massKg).toFixed(2)} kg`,
        ],
        [
          t('labs.bodyComp.figure.bodyFat', 'Body fat'),
          `${w.pctFat.toFixed(1)} % · ${w.fatKg.toFixed(2)} kg`,
        ],
        [t('labs.bodyComp.figure.lean', 'Lean'), `${w.leanKg.toFixed(2)} kg`],
        [
          t('labs.bodyComp.figure.bone', 'Bone mineral'),
          `${w.bmcKg.toFixed(3)} kg`,
        ],
        [t('labs.bodyComp.ffmi', 'FFMI'), `${w.ffmi.toFixed(2)} kg/m²`],
        [
          t('labs.bodyComp.almi', 'ALMI'),
          w.almi === null ? '—' : `${w.almi.toFixed(2)} kg/m²`,
        ],
        [
          t('labs.bodyComp.figure.androidGynoid', 'Android / gynoid % fat'),
          num(model.ratios.android_gynoid, 2),
        ],
        [
          t('labs.bodyComp.figure.trunkLimb', 'Trunk / limb fat mass'),
          num(model.ratios.trunk_limb_fat, 2),
        ],
        [
          t('labs.bodyComp.figure.armAsym', 'Arm lean asymmetry (R − L)'),
          model.asymmetry.arms_pct === null
            ? '—'
            : `${signed(model.asymmetry.arms_pct, 1)} %`,
        ],
        [
          t('labs.bodyComp.figure.legAsym', 'Leg lean asymmetry (R − L)'),
          model.asymmetry.legs_pct === null
            ? '—'
            : `${signed(model.asymmetry.legs_pct, 1)} %`,
        ],
      ];
    }
    const c = activeCell;
    if (shown === 'change') {
      const d = c.delta;
      return [
        [
          t('labs.bodyComp.figure.dFat', 'Δ fat'),
          d ? `${signed(d.fatPts, 1)} pts` : '—',
        ],
        [
          t('labs.bodyComp.figure.dLean', 'Δ lean'),
          d ? `${signed(d.leanPts, 1)} pts` : '—',
        ],
        [
          t('labs.bodyComp.figure.dFatMass', 'Δ fat mass'),
          d ? `${signed(d.fatKg, 2)} kg` : '—',
        ],
        [
          t('labs.bodyComp.figure.reading', 'Reading'),
          d
            ? `${tierLabel(d.tier)}${d.demoted ? ` (${demotedWord})` : ''}`
            : t(
                'labs.bodyComp.figure.noPrevRegion',
                'not on the previous report'
              ),
        ],
      ];
    }
    return [
      [
        t('labs.bodyComp.figure.fat', 'Fat'),
        `${c.pctFat.toFixed(1)} % · ${c.fatKg.toFixed(2)} kg`,
      ],
      [
        t('labs.bodyComp.figure.lean', 'Lean'),
        `${c.pctLean.toFixed(1)} % · ${c.leanKg.toFixed(2)} kg`,
      ],
      [
        t('labs.bodyComp.figure.boneShare', 'Bone'),
        c.pctBone === null ? '—' : `${c.pctBone.toFixed(1)} %`,
      ],
      [
        t('labs.bodyComp.figure.bmd', 'BMD'),
        c.bmdGcm2 === null ? '—' : `${c.bmdGcm2.toFixed(3)} g/cm²`,
      ],
    ];
  })();

  const th = (text: string, extra = '') => (
    <th
      className={`whitespace-nowrap py-1 pr-2 text-right font-medium ${extra}`}
    >
      {text}
    </th>
  );

  return (
    <section
      className="space-y-2 rounded-md border p-3"
      aria-labelledby="dexa-figure-title"
      data-body-figure-card
    >
      <h3
        id="dexa-figure-title"
        className="text-xs font-semibold text-muted-foreground"
      >
        {t('labs.bodyComp.figure.title', 'Regional distribution')}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col items-center gap-2">
          <p className="self-start text-xs text-muted-foreground">
            {shown === 'change' && model.change
              ? t('labs.bodyComp.figure.vs', '{{date}} vs {{prev}}', {
                  date: formatDate(model.scannedDay),
                  prev: formatDate(model.change.prevDay),
                })
              : formatDate(model.scannedDay)}
          </p>
          <BodyCompFigure
            model={model}
            mode={shown}
            active={active}
            onHover={setHovered}
            onSelect={toggle}
            regionLabel={regionLabel}
          />
          {shown === 'change' && model.change ? (
            <div className="flex w-full flex-col gap-1" data-legend="change">
              <div className="flex flex-wrap justify-center gap-2 text-[11px]">
                {TIERS.map((tier) => (
                  <span key={tier} className="inline-flex items-center gap-1.5">
                    <i
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: TIER_FILL[tier] }}
                    />
                    <Badge variant={TIER_VARIANT[tier]}>
                      {tierLabel(tier)}
                    </Badge>
                  </span>
                ))}
              </div>
              <p className="text-center text-[10px] text-muted-foreground">
                {t(
                  'labs.bodyComp.figure.legendChange',
                  'fat % vs the previous scan'
                )}{' '}
                ·{' '}
                {t(
                  'labs.bodyComp.figure.lsc',
                  'LSC {{technical}} / {{practical}} pts',
                  {
                    technical: num(model.change.band.technical, 1),
                    practical: num(model.change.band.practical, 1),
                  }
                )}
                {model.change.demoted ? ` · ${demotedWord}` : ''}
              </p>
            </div>
          ) : (
            <div className="flex w-full flex-col gap-1" data-legend="levels">
              <span className="flex items-center justify-center gap-1.5 text-[11px]">
                <i
                  aria-hidden
                  className="inline-block h-2.5 w-10 rounded-sm"
                  style={{
                    background: `linear-gradient(90deg, ${fatFillColor(
                      FAT_HUE_DOMAIN[0]
                    )}, ${fatFillColor(FAT_HUE_DOMAIN[1])})`,
                  }}
                />
                {t('labs.bodyComp.figure.legendFat', 'fat {{lo}} → {{hi}} %', {
                  lo: FAT_HUE_DOMAIN[0],
                  hi: FAT_HUE_DOMAIN[1],
                })}
              </span>
              <p className="text-center text-[10px] text-muted-foreground">
                {t(
                  'labs.bodyComp.figure.legendLevels',
                  'fill = the region’s fat %, warmer as the % rises'
                )}
              </p>
            </div>
          )}
          <div
            className="inline-flex overflow-hidden rounded-md border text-xs"
            role="group"
            aria-label={t('labs.bodyComp.figure.view', 'View')}
          >
            {(
              [
                ['levels', t('labs.bodyComp.figure.levels', 'Levels')],
                ['change', t('labs.bodyComp.figure.change', 'Change')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={shown === key}
                disabled={key === 'change' && !canChange}
                title={
                  key === 'change' && !canChange
                    ? t(
                        'labs.bodyComp.figure.needsPrev',
                        'Needs a previous comparable scan'
                      )
                    : undefined
                }
                onClick={() => setMode(key)}
                className={`px-2.5 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  shown === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[360px] text-xs"
              aria-label={t('labs.bodyComp.figure.table', 'Region table')}
            >
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">
                    {t('labs.bodyComp.regionWord', 'Region')}
                  </th>
                  {shown === 'change' ? (
                    <>
                      {th(t('labs.bodyComp.figure.colDFat', 'Δ fat pts'))}
                      {th(t('labs.bodyComp.figure.colDLean', 'Δ lean pts'))}
                      {th(t('labs.bodyComp.figure.colDFatKg', 'Δ fat kg'))}
                      {th(t('labs.bodyComp.figure.colFatNow', 'Fat % now'))}
                      <th className="py-1 pl-2 text-left font-medium">
                        {t('labs.bodyComp.deltaVerdict', 'Against noise')}
                      </th>
                    </>
                  ) : (
                    <>
                      {th(t('labs.bodyComp.figure.colFat', 'Fat %'))}
                      {th(t('labs.bodyComp.figure.colLean', 'Lean %'))}
                      {th(t('labs.bodyComp.figure.colBone', 'Bone %'))}
                      {th(t('labs.bodyComp.figure.colFatKg', 'Fat kg'))}
                      {th(t('labs.bodyComp.figure.colLeanKg', 'Lean kg'))}
                      {th(t('labs.bodyComp.figure.colBmd', 'BMD g/cm²'))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {cells.map((c) => {
                  const isActive = active === c.region;
                  const d = c.delta;
                  return (
                    <tr
                      key={c.region}
                      data-region-row={c.region}
                      data-active={isActive || undefined}
                      onMouseEnter={() => setHovered(c.region)}
                      onMouseLeave={() => setHovered(null)}
                      className={`border-t ${isActive ? 'bg-muted' : ''}`}
                    >
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          aria-pressed={selected === c.region}
                          onClick={() => toggle(c.region)}
                          onFocus={() => setHovered(c.region)}
                          onBlur={() => setHovered(null)}
                          className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                        >
                          {regionLabel(c.region)}
                        </button>
                      </td>
                      {shown === 'change' ? (
                        <>
                          <td className="py-1 pr-2 text-right">
                            {signedNum(d?.fatPts, 1)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {signedNum(d?.leanPts, 1)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {signedNum(d?.fatKg, 2)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {c.pctFat.toFixed(1)}
                          </td>
                          <td className="py-1 pl-2">
                            {d ? (
                              <>
                                <Badge variant={TIER_VARIANT[d.tier]}>
                                  {tierLabel(d.tier)}
                                </Badge>
                                {d.demoted && (
                                  <span className="ml-1 text-[10px] text-muted-foreground">
                                    ({demotedWord})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                {t(
                                  'labs.bodyComp.figure.noPrevRegion',
                                  'not on the previous report'
                                )}
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-1 pr-2 text-right">
                            {c.pctFat.toFixed(1)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {c.pctLean.toFixed(1)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {num(c.pctBone, 1)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {c.fatKg.toFixed(2)}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {c.leanKg.toFixed(2)}
                          </td>
                          <td className="py-1 text-right">
                            {num(c.bmdGcm2, 3)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div aria-live="polite">
            <p className="mb-1 text-[11px] font-semibold">
              {activeCell
                ? regionLabel(activeCell.region)
                : t('labs.bodyComp.figure.wholeBody', 'Whole body')}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {stats.map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </dl>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t(
                'labs.bodyComp.figure.note',
                'Regions differ from each other by anatomy. Only a later scan of the same region, beyond the noise band, counts as change.'
              )}
            </p>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {shown === 'change'
          ? t(
              'labs.bodyComp.figure.introChange',
              'Change view tints each region by how far its fat percentage moved since the previous scan: grey within the noise band, amber possible change, dark beyond the practical LSC. The scanner prints no regional precision, so the whole-body fat-percentage band is applied to every region.'
            )
          : t(
              'labs.bodyComp.figure.intro',
              'Each region is filled by its fat percentage: the fill warms as the region’s percentage rises. The number is the region’s fat percentage as printed.'
            )}{' '}
        {t(
          'labs.bodyComp.figure.artNote',
          'The figure is a drawn outline, not the scan image; regions follow the printed report. Android and gynoid are listed in the table only.'
        )}{' '}
        {t(
          'labs.bodyComp.figure.hint',
          'Hover or tap a region, or choose one in the table, for its numbers.'
        )}
        {model.missing.length > 0 && (
          <>
            {' '}
            {t(
              'labs.bodyComp.figure.missing',
              'A region the report did not print is left unlit.'
            )}{' '}
            <span data-figure-missing>
              {t(
                'labs.bodyComp.figure.missingList',
                'Not printed: {{regions}}.',
                {
                  regions: model.missing.map((r) => regionLabel(r)).join(', '),
                }
              )}
            </span>
          </>
        )}
      </p>
    </section>
  );
}
