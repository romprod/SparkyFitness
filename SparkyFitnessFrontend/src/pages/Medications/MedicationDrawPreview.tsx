import { useTranslation } from 'react-i18next';
import type { DrawResult } from '@workspace/shared';
export default function MedicationDrawPreview({
  preview,
  isFetching,
  isError,
}: {
  preview?: DrawResult;
  isFetching: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" aria-live="polite">
      {isFetching && (
        <p className="text-muted-foreground">
          {t('medications.syringes.calculating', 'Calculating marking…')}
        </p>
      )}
      {isError && (
        <p className="text-destructive">
          {t(
            'medications.syringes.previewError',
            'Could not calculate a marking. Check the entered amount and syringe settings.'
          )}
        </p>
      )}
      {preview && (
        <>
          <p className="font-medium break-words">
            {t(
              'medications.syringes.marking',
              'Measurable marking: {{value}} {{scale}}',
              {
                value: preview.markingValue,
                scale:
                  preview.markingScale === 'ml'
                    ? 'mL'
                    : t('medications.syringes.units', 'units'),
              }
            )}
          </p>
          <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            <dt className="text-muted-foreground">
              {t('medications.syringes.target', 'Target')}
            </dt>
            <dd className="break-words">
              {preview.targetMassMcg} mcg · {preview.targetVolumeMl} mL
            </dd>
            <dt className="text-muted-foreground">
              {t('medications.syringes.delivered', 'Delivered')}
            </dt>
            <dd className="break-words">
              {preview.deliveredMassMcg} mcg · {preview.deliveredVolumeMl} mL
            </dd>
            <dt className="text-muted-foreground">
              {t('medications.syringes.rounding', 'Rounding difference')}
            </dt>
            <dd className="break-words">{preview.roundingErrorMcg} mcg</dd>
          </dl>
          {preview.warnings.map((warning) => (
            <p
              key={warning.code}
              className={
                warning.severity === 'block'
                  ? 'text-destructive'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {warning.message}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
