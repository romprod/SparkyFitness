import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  type MedicationPrescriptionAccountedBucket,
} from '@workspace/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
export function PrescriptionAccountedLines({
  buckets,
}: {
  buckets: MedicationPrescriptionAccountedBucket[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 text-xs text-left">
      {buckets.map((bucket) => (
        <div key={bucket.currency} className="break-words">
          <p>
            {t('medications.costEstimates.accounted', 'Accounted value')}:{' '}
            {formatPurchaseMoney(bucket.accounted_total, bucket.currency)}
          </p>
          {bucket.estimated_vials > 0 && (
            <>
              <p>
                {t(
                  'medications.costEstimates.prescriptionEstimate',
                  'Prescription estimate'
                )}
                :{' '}
                {formatPurchaseMoney(
                  bucket.prescription_estimate,
                  bucket.currency
                )}{' '}
                · {t('medications.costEstimates.noShipping', 'no shipping')}
              </p>
              <p>
                {t(
                  'medications.costEstimates.vials',
                  '{{count}} estimated vials',
                  { count: bucket.estimated_vials }
                )}
              </p>
            </>
          )}
          {bucket.undated_vials > 0 && (
            <p>
              {t(
                'medications.costEstimates.undated',
                '{{count}} vials have no prescription written date and are included in every window.',
                { count: bucket.undated_vials }
              )}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
export default function MedicationPrescriptionEstimates({
  buckets,
}: {
  buckets: MedicationPrescriptionAccountedBucket[];
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(
            'medications.costEstimates.summaryTitle',
            'Invoice cash and prescription estimates'
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.costEstimates.summaryHelp',
            'Accounted value combines recorded invoice cash with stock-linked per-vial prescription estimates. It is not proof of payment. Dated estimates use the prescription written date; undated estimates appear in every window. Estimates exclude shipping; currencies are shown separately and are never added together.'
          )}
        </p>
      </CardHeader>
      <CardContent>
        {!buckets.length ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.costEstimates.noAccounted',
              'No invoice cash or eligible stock estimates in this window.'
            )}
          </p>
        ) : (
          <div
            role="region"
            tabIndex={0}
            aria-label={t(
              'medications.costEstimates.accountedTable',
              'Accounted values by recorded currency'
            )}
            className="overflow-x-auto rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-3">
                    {t('medications.prescriptions.currency', 'Currency')}
                  </th>
                  <th className="p-3 min-w-32">
                    {t(
                      'medications.costEstimates.invoiceCash',
                      'Recorded invoice cash'
                    )}
                  </th>
                  <th className="p-3 min-w-36">
                    {t(
                      'medications.costEstimates.prescriptionEstimate',
                      'Prescription estimate'
                    )}
                  </th>
                  <th className="p-3 min-w-32">
                    {t(
                      'medications.costEstimates.accounted',
                      'Accounted value'
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((bucket) => (
                  <tr key={bucket.currency} className="border-b last:border-0">
                    <th scope="row" className="p-3 text-left break-words">
                      {bucket.currency}
                    </th>
                    <td className="p-3 tabular-nums">
                      {formatPurchaseMoney(
                        bucket.invoice_cash,
                        bucket.currency
                      )}
                    </td>
                    <td className="p-3 tabular-nums">
                      <p>
                        {formatPurchaseMoney(
                          bucket.prescription_estimate,
                          bucket.currency
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'medications.costEstimates.vials',
                          '{{count}} estimated vials',
                          { count: bucket.estimated_vials }
                        )}{' '}
                        ·{' '}
                        {t(
                          'medications.costEstimates.noShipping',
                          'no shipping'
                        )}
                      </p>
                      {bucket.undated_vials > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            'medications.costEstimates.undated',
                            '{{count}} vials have no prescription written date and are included in every window.',
                            { count: bucket.undated_vials }
                          )}
                        </p>
                      )}
                    </td>
                    <td className="p-3 tabular-nums">
                      {formatPurchaseMoney(
                        bucket.accounted_total,
                        bucket.currency
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
