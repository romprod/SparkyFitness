import { useTranslation } from 'react-i18next';
import type { BodyCompScan } from '@workspace/shared';
import { reportFields, scannerFields } from './bodyCompReportFieldsModel';

/**
 * One scan's printed report figures: percentiles, bone density scores, the site precision and the
 * scan mode and reference population, with the note that a percentile is a position and not a
 * target. Shown inside the scan's detail.
 */
export default function BodyCompReportFields({ scan }: { scan: BodyCompScan }) {
  const { t } = useTranslation();
  const fields = reportFields(scan);
  const scanner = scannerFields(scan);
  const label = (key: string, fallback: string) =>
    t(`labs.bodyComp.report.${key}`, fallback);
  return (
    <div className="space-y-2" data-report-fields>
      <p className="text-xs font-semibold text-muted-foreground">
        {t('labs.bodyComp.report.title', 'Report figures')}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {fields.map((field) => (
          <div key={field.key} className="rounded bg-muted/40 p-2">
            <dt className="text-[10px] font-semibold text-muted-foreground">
              {label(field.key, field.label)}
            </dt>
            <dd
              className={`font-medium tabular-nums ${
                field.value === 'not printed' ? 'text-muted-foreground' : ''
              }`}
            >
              {field.value === 'not printed'
                ? t('labs.bodyComp.report.notPrinted', 'not printed')
                : field.value}
            </dd>
          </div>
        ))}
      </dl>
      {scanner.length > 0 && (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          {scanner.map((field) => (
            <div key={field.key} className="rounded bg-muted/40 p-2">
              <dt className="text-[10px] font-semibold text-muted-foreground">
                {label(field.key, field.label)}
              </dt>
              <dd className="font-medium">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-[10px] text-muted-foreground">
        {t(
          'labs.bodyComp.report.note',
          "Population position, not a target. Percentiles are as printed against the scanner's reference population; the report names it."
        )}
      </p>
    </div>
  );
}
