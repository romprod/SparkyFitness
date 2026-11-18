import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCourseCostRow,
} from '@workspace/shared';
import { useMedicationCourseCosts } from '@/hooks/useMedicationPurchases';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CostSection } from './MedicationCostSection';

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
    <CostSection title={t('medications.courseCosts.title', 'By course')}>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.courseCosts.note',
          'Spent is the cost of doses logged under each course, priced like the medication report. Doses not logged under a course are listed separately.'
        )}
      </p>
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
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.course_id} className="border-b last:border-b-0">
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
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
    </CostSection>
  );
}
