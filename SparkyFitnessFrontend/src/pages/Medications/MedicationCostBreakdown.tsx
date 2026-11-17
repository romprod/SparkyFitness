import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCostAnalytics,
} from '@workspace/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function ScrollTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export default function MedicationCostBreakdown({
  data,
}: {
  data: MedicationCostAnalytics;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const number = (value: string | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
          Number(value)
        );
  const money = (
    value: string | null,
    currency: string | null,
    mixed = false
  ) =>
    mixed || value === null || currency === null
      ? '—'
      : formatPurchaseMoney(value, currency);
  const warning = (
    <Badge
      variant="destructive"
      className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
    >
      {t(
        'medications.costReport.mixed',
        'Mixed currencies: affected figures are hidden.'
      )}
    </Badge>
  );
  const monthName = (month: string) => {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year!, monthIndex! - 1, 1)));
  };
  const monthly = data.monthly_spend;
  const currencies = new Set(
    monthly
      .map((row) => row.currency)
      .filter((currency): currency is string => currency !== null)
  );
  const monthlyMixed =
    currencies.size > 1 || monthly.some((row) => row.mixed_currency);
  const chartCurrency = currencies.size === 1 ? [...currencies][0]! : null;
  const chartData = monthly.map((row) => ({
    month: monthName(row.month),
    medication:
      row.medication_subtotal === null ? null : Number(row.medication_subtotal),
    consumables:
      row.consumable_subtotal === null ? null : Number(row.consumable_subtotal),
    overhead: row.overhead === null ? null : Number(row.overhead),
  }));
  const bands = [
    {
      key: 'medication',
      label: t('medications.costs.medication', 'Medication'),
      color: '#3b82f6',
    },
    {
      key: 'consumables',
      label: t('medications.costReport.sundriesBand', 'Sundries'),
      color: '#14b8a6',
    },
    {
      key: 'overhead',
      label: t('medications.costReport.overhead', 'Shipping & fees'),
      color: '#f59e0b',
    },
  ];
  const consumables = data.consumables;
  const waste = data.waste;
  const valuedWaste = waste.rows.filter((row) => !row.value_unavailable);
  const th = 'p-3 text-right font-medium whitespace-nowrap';
  const td = 'p-3 text-right tabular-nums whitespace-nowrap';
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('medications.costReport.monthlyTitle', 'Spend by month')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {'cost_basis' in data &&
            data.cost_basis === 'with_prescription_estimates' && (
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.costEstimates.monthlyCash',
                  'Monthly bars and invoice totals show recorded invoice cash only; prescription estimates are excluded.'
                )}
              </p>
            )}
          {monthlyMixed && warning}
          {monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.costReport.noInvoices',
                'No invoices in this window.'
              )}
            </p>
          ) : (
            <>
              {!monthlyMixed && chartCurrency && (
                <div aria-hidden="true" className="h-64 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart
                      data={chartData}
                      stackOffset="sign"
                      accessibilityLayer={false}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        dataKey="month"
                        tick={{
                          fill: 'hsl(var(--muted-foreground))',
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        label={{
                          value: chartCurrency,
                          angle: -90,
                          position: 'insideLeft',
                          fill: 'hsl(var(--muted-foreground))',
                          fontSize: 11,
                        }}
                        width={64}
                        tick={{
                          fill: 'hsl(var(--muted-foreground))',
                          fontSize: 11,
                        }}
                      />
                      <ReferenceLine
                        y={0}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <Tooltip
                        formatter={(value) =>
                          formatPurchaseMoney(String(value), chartCurrency)
                        }
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          borderColor: 'hsl(var(--border))',
                          color: 'hsl(var(--foreground))',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {bands.map((band) => (
                        <Bar
                          key={band.key}
                          dataKey={band.key}
                          name={band.label}
                          stackId="spend"
                          fill={band.color}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ScrollTable
                label={t(
                  'medications.costReport.monthlyTable',
                  'Monthly invoice spend'
                )}
              >
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-3 text-left font-medium">
                      {t('medications.costReport.month', 'Month')}
                    </th>
                    {bands.map((band) => (
                      <th key={band.key} className={th}>
                        {band.label}
                      </th>
                    ))}
                    <th className={th}>
                      {t('medications.costs.total', 'Total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((row) => (
                    <tr key={row.month} className="border-b last:border-b-0">
                      <th
                        scope="row"
                        className="p-3 text-left font-medium whitespace-nowrap"
                      >
                        {monthName(row.month)}
                      </th>
                      {[
                        row.medication_subtotal,
                        row.consumable_subtotal,
                        row.overhead,
                        row.total,
                      ].map((value, index) => (
                        <td key={index} className={td}>
                          {money(value, row.currency, row.mixed_currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </ScrollTable>
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.costReport.monthlyNote',
                  'Invoice totals in the selected window. Shipping & fees includes tax and discounts; negative values remain below zero. Category totals include rounding adjustments.'
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {t(
              'medications.costReport.consumablesTitle',
              'Sundries & consumables'
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(consumables.spend_mixed_currency ||
            consumables.cost_per_dose_mixed_currency) &&
            warning}
          {consumables.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.costReport.noConsumables',
                'None recorded. Add needles, swabs, pen tips or a sharps container as consumable lines on an invoice to see their share of each dose.'
              )}
            </p>
          ) : (
            <>
              <ScrollTable
                label={t(
                  'medications.costReport.consumablesTable',
                  'Consumable costs by category'
                )}
              >
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-3 text-left font-medium">
                      {t('medications.costReport.category', 'Category')}
                    </th>
                    <th className={th}>
                      {t('medications.costReport.spend', 'Spend')}
                    </th>
                    <th className={th}>
                      {t('medications.costReport.pieces', 'Pieces')}
                    </th>
                    <th className={th}>
                      {t('medications.costReport.perPiece', 'Per piece')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {consumables.rows.map((row) => (
                    <tr key={row.category} className="border-b last:border-b-0">
                      <th scope="row" className="p-3 text-left font-medium">
                        {t(
                          `medications.costs.categories.${row.category}`,
                          row.category
                        )}
                      </th>
                      <td className={td}>
                        {money(
                          row.spend,
                          row.spend_currency,
                          row.spend_mixed_currency
                        )}
                      </td>
                      <td className={td}>{number(row.pieces)}</td>
                      <td className={td}>
                        {row.spend_mixed_currency
                          ? '—'
                          : formatPurchaseRate(
                              row.cost_per_piece,
                              row.spend_currency
                            )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ScrollTable>
              <div className="space-y-1 border-t pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    {t(
                      'medications.costReport.perDoseEstimate',
                      'Per dose estimate'
                    )}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {consumables.cost_per_dose_mixed_currency
                      ? '—'
                      : formatPurchaseRate(
                          consumables.cost_per_dose,
                          consumables.cost_per_dose_currency
                        )}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {consumables.cost_per_dose_basis === 'modelled'
                    ? t(
                        'medications.costReport.modelledBasis',
                        'Modelled from landed cost per piece × declared units per dose. Declared lines included: {{included}}; lines without a positive units-per-dose value excluded: {{excluded}}.',
                        {
                          included: consumables.modelled_lines,
                          excluded: consumables.unmodelled_lines,
                        }
                      )
                    : consumables.cost_per_dose_basis === 'amortised'
                      ? t(
                          'medications.costReport.amortisedBasis',
                          'Amortised: landed sundry spend in the invoice-date window ÷ {{count}} logged doses in the tracking-day window.',
                          { count: consumables.dose_count }
                        )
                      : t(
                          'medications.costReport.unavailableBasis',
                          'Estimate unavailable. A modelled estimate needs a positive units-per-dose value; an amortised estimate needs logged doses and one currency.'
                        )}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('medications.costReport.wasteTitle', 'Wasted product')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {waste.mixed_currency && warning}
          <div>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.costReport.wasteEstimate',
                'Current closed-stock unused value estimate'
              )}
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {money(
                waste.estimated_unused_value,
                waste.currency,
                waste.mixed_currency
              )}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.costReport.wasteBasis',
              'Uses all logged delivered history, independent of the selected window. Includes priced, labelled finished or discarded vials with at most 70% delivered. Sealed and in-use vials are excluded. This is a display rule, not a clinical threshold.'
            )}
          </p>
          {waste.unavailable_vials > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.costReport.wasteUnavailable',
                'Closed vials with missing cost, label or delivered history: {{count}}. The estimate excludes them.',
                { count: waste.unavailable_vials }
              )}
            </p>
          )}
          {valuedWaste.length > 0 && (
            <ul className="divide-y">
              {valuedWaste.slice(0, 6).map((row) => (
                <li
                  key={row.vial_id}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="break-words font-medium">
                      {row.medication_name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t(
                        `medications.stock.status.${row.status}`,
                        row.status === 'finished' ? 'Finished' : 'Discarded'
                      )}{' '}
                      ·{' '}
                      {t(
                        'medications.costReport.unusedMass',
                        '{{mass}} mg estimated unused',
                        { mass: number(row.estimated_unused_mg) }
                      )}
                    </span>
                    {'cost_source' in row &&
                      row.cost_source === 'prescription' && (
                        <span className="block text-xs text-muted-foreground">
                          {t(
                            'medications.costEstimates.prescriptionEstimate',
                            'Prescription estimate'
                          )}{' '}
                          ·{' '}
                          {t(
                            'medications.costEstimates.noShipping',
                            'no shipping'
                          )}
                        </span>
                      )}
                    {'cost_source' in row && row.cost_source === 'invoice' && (
                      <span className="block text-xs text-muted-foreground">
                        {t('medications.costs.invoice', 'Invoice')}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {money(
                      row.estimated_unused_value,
                      row.currency,
                      row.value_unavailable
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {valuedWaste.length > 6 && (
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.costReport.wasteFirstSix',
                'Showing six eligible closed vials.'
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
