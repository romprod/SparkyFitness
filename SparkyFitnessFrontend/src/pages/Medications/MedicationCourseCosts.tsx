import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCourseCostRow,
} from '@workspace/shared';
import { useMedicationCourseCosts } from '@/hooks/useMedicationPurchases';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Actual = MedicationCourseCostRow['actual'];

function Counts({ actual }: { actual: Actual }) {
  const { t } = useTranslation();
  return (
    <span className="mt-1 block text-xs text-muted-foreground">
      {t(
        'medications.courseCosts.counts',
        '{{costed}} costed doses · {{uncosted}} uncosted',
        { costed: actual.costed_doses, uncosted: actual.uncosted_doses }
      )}
    </span>
  );
}

function Spent({ actual }: { actual: Actual }) {
  const { t } = useTranslation();
  if (actual.mixed_currency)
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">
          {t(
            'medications.courseCosts.mixed',
            'Unavailable: this course has costs in different currencies.'
          )}
        </span>
      </>
    );
  return (
    <>
      {actual.cost !== null && actual.currency !== null
        ? formatPurchaseMoney(actual.cost, actual.currency)
        : '—'}
    </>
  );
}

function Remaining({ row }: { row: MedicationCourseCostRow }) {
  const { t } = useTranslation();
  const r = row.remaining;
  if (r.estimate !== null && r.currency !== null)
    return (
      <>
        <span>{formatPurchaseMoney(r.estimate, r.currency)}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {t(
            'medications.courseCosts.plannedBasis',
            '{{doses}} planned doses at {{rate}}/mg ({{source}}), {{through}}',
            {
              doses: r.planned_doses,
              rate: formatPurchaseRate(r.rate_per_mg, r.currency),
              source:
                r.rate_source === 'course_actual'
                  ? t('medications.courseCosts.sourceCourse', 'this course')
                  : t(
                      'medications.courseCosts.sourceMedication',
                      'this medication'
                    ),
              through:
                r.basis === 'course_end'
                  ? t('medications.courseCosts.toCourseEnd', 'to course end')
                  : r.through
                    ? t(
                        'medications.courseCosts.throughDate',
                        'through {{date}} only',
                        {
                          date: r.through,
                        }
                      )
                    : t(
                        'medications.courseCosts.partialPlan',
                        'part of the plan only'
                      ),
            }
          )}
        </span>
      </>
    );
  const reasons: Record<string, string> = {
    no_plan: t('medications.courseCosts.noPlan', 'No planned doses left'),
    non_mass_dose: t(
      'medications.courseCosts.nonMass',
      'Planned doses are not set in mass units'
    ),
    no_rate: t(
      'medications.courseCosts.noRate',
      'No costed doses to price this from'
    ),
    mixed_currency: t(
      'medications.courseCosts.mixedRate',
      'Price unavailable: costs are in different currencies'
    ),
  };
  return (
    <span className="text-xs text-muted-foreground">
      {r.unavailable_reason ? reasons[r.unavailable_reason] : '—'}
    </span>
  );
}

export default function MedicationCourseCosts({
  ownerId,
}: {
  ownerId: string;
}) {
  const { t } = useTranslation();
  const query = useMedicationCourseCosts(ownerId, true);
  const data = !query.isFetching && !query.isError ? query.data : undefined;
  const unattributed = data?.unattributed;
  const hasUnattributed =
    !!unattributed &&
    unattributed.costed_doses + unattributed.uncosted_doses > 0;
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>{t('medications.courseCosts.title', 'By course')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.courseCosts.note',
            'Spent is the cost of doses logged under each course, priced like the medication report. The remaining estimate prices the planned doses still to come at the cost per mg of this course, else of the medication. It is an estimate, not a forecast of purchases.'
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isFetching && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('medications.courseCosts.loading', 'Loading course costs…')}
          </p>
        )}
        {query.isError && (
          <div className="space-y-2">
            <Badge
              variant="destructive"
              className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
            >
              {t(
                'medications.courseCosts.loadFailed',
                'Could not load course costs.'
              )}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {data &&
          (data.rows.length === 0 && !hasUnattributed ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.courseCosts.empty',
                'No courses or logged doses to cost yet.'
              )}
            </p>
          ) : (
            <div
              className="relative overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              role="region"
              tabIndex={0}
              aria-label={t(
                'medications.courseCosts.table',
                'Course cost report'
              )}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="min-w-40 p-3 font-medium">
                      {t('medications.courseCosts.course', 'Course')}
                    </th>
                    <th className="min-w-24 p-3 text-right font-medium">
                      {t('medications.courseCosts.spent', 'Spent so far')}
                    </th>
                    <th className="min-w-24 p-3 text-right font-medium">
                      {t('medications.courseCosts.perDose', 'Per dose')}
                    </th>
                    <th className="min-w-44 p-3 text-right font-medium">
                      {t(
                        'medications.courseCosts.remaining',
                        'Remaining plan (estimate)'
                      )}
                    </th>
                    <th className="min-w-28 p-3 text-right font-medium">
                      {t('medications.courseCosts.total', 'Projected total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={row.course_id}
                      className="border-b last:border-b-0"
                    >
                      <td className="p-3">
                        <span className="break-words font-medium">
                          {row.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.medication_name} · {row.status}
                        </span>
                        <Counts actual={row.actual} />
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        <Spent actual={row.actual} />
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {row.actual.mixed_currency
                          ? '—'
                          : formatPurchaseRate(
                              row.actual.cost_per_dose,
                              row.actual.currency
                            )}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        <Remaining row={row} />
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {row.projected_total !== null &&
                        row.projected_currency !== null
                          ? formatPurchaseMoney(
                              row.projected_total,
                              row.projected_currency
                            )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {hasUnattributed && unattributed && (
                    <tr className="border-b last:border-b-0">
                      <td className="p-3">
                        <span className="font-medium">
                          {t(
                            'medications.courseCosts.unattributed',
                            'Not linked to a course'
                          )}
                        </span>
                        <Counts actual={unattributed} />
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        <Spent actual={unattributed} />
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {unattributed.mixed_currency
                          ? '—'
                          : formatPurchaseRate(
                              unattributed.cost_per_dose,
                              unattributed.currency
                            )}
                      </td>
                      <td className="p-3 text-right">—</td>
                      <td className="p-3 text-right">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
