import { useTranslation } from 'react-i18next';
import {
  drawTargetDisplay,
  drawTargetFillFraction,
  type DrawResult,
} from '@workspace/shared';
import SyringeDrawFigure from './SyringeDrawFigure';
export default function MedicationDrawPreview({
  preview: cachedPreview,
  isFetching,
  isError,
}: {
  preview?: DrawResult;
  isFetching: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const preview = !isFetching && !isError ? cachedPreview : undefined;
  const targetDisplay = preview ? drawTargetDisplay(preview) : null;
  const fillFraction = preview?.syringeCapacityMl
    ? drawTargetFillFraction(preview.targetVolumeMl, preview.syringeCapacityMl)
    : null;
  const markingLabel = preview
    ? `${preview.markingValue} ${preview.markingScale === 'ml' ? 'mL' : t('medications.syringes.units', 'units')}`
    : '';
  const blocked =
    preview?.warnings.some((warning) => warning.severity === 'block') ?? false;
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
      <p className="font-medium break-words">
        {preview
          ? t(
              'medications.syringes.marking',
              'Measurable marking: {{value}} {{scale}}',
              {
                value: preview.markingValue,
                scale:
                  preview.markingScale === 'ml'
                    ? 'mL'
                    : t('medications.syringes.units', 'units'),
              }
            )
          : t('medications.syringes.emptyMarking', 'Measurable marking: —')}
      </p>
      <SyringeDrawFigure
        fillFraction={fillFraction ?? 0}
        markingLabel={fillFraction !== null ? markingLabel : '—'}
        blocked={fillFraction !== null && blocked}
      />
      {preview && (
        <>
          {targetDisplay && (
            <div className="space-y-1">
              <p className="text-xs font-medium">
                {t(
                  'medications.syringes.targetEquivalents',
                  'Target dose equivalents'
                )}
              </p>
              <dl
                aria-label={t(
                  'medications.syringes.targetEquivalents',
                  'Target dose equivalents'
                )}
                className="grid grid-cols-2 gap-2 text-center text-xs tabular-nums sm:grid-cols-4"
              >
                {(['mcg', 'mg', 'ml', 'units'] as const).map((unit) => (
                  <div key={unit} className="min-w-0">
                    <dt className="text-muted-foreground">
                      {unit === 'ml'
                        ? 'mL'
                        : unit === 'units'
                          ? t('medications.syringes.units', 'units')
                          : unit}
                    </dt>
                    <dd className="break-words">{targetDisplay[unit]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
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
