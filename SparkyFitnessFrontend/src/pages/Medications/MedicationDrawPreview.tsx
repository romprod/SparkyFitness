import { useTranslation } from 'react-i18next';
import {
  drawTargetDisplay,
  drawTargetFillFraction,
  type DrawResult,
  type MedicationDeviceType,
  mlToPumps,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import SyringeDrawFigure from './SyringeDrawFigure';
import { displayQuantity } from '@/utils/displayNumber';
export default function MedicationDrawPreview({
  preview: cachedPreview,
  isFetching,
  isError,
  deviceType,
}: {
  preview?: DrawResult;
  isFetching: boolean;
  isError: boolean;
  deviceType?: MedicationDeviceType;
}) {
  const { t } = useTranslation();
  const preview = !isFetching && !isError ? cachedPreview : undefined;
  const targetDisplay = preview ? drawTargetDisplay(preview) : null;
  const capacity = preview?.device?.capacity_ml ?? preview?.syringeCapacityMl;
  const currentDeviceType =
    preview?.device?.device_type ?? deviceType ?? 'syringe';
  const fillFraction = capacity
    ? drawTargetFillFraction(preview!.targetVolumeMl, capacity)
    : null;
  const pumps =
    currentDeviceType === 'pump' && preview?.device
      ? mlToPumps(preview.markingValue, preview.device.increment)
      : null;
  const markingLabel =
    pumps !== null
      ? `${pumps} ${pumps === '1' ? t('medications.devices.pump', 'pump') : t('medications.devices.pumps', 'pumps')} (${preview!.markingValue} mL)`
      : preview
        ? `${preview.markingValue} ${preview.markingScale === 'ml' ? 'mL' : t('medications.syringes.units', 'units')}`
        : '';
  const equivalenceLabel =
    currentDeviceType === 'pump'
      ? t('medications.devices.doseEquivalents', 'Dose equivalents')
      : t('medications.syringes.targetEquivalents', 'Target dose equivalents');
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
        <Badge
          variant="destructive"
          className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
        >
          {t(
            'medications.syringes.previewError',
            'Could not calculate a marking. Check the entered amount and device settings.'
          )}
        </Badge>
      )}
      <p className="font-medium break-words">
        {preview
          ? `${t('medications.devices.measurable', 'Measurable marking')}: ${markingLabel}`
          : t('medications.syringes.emptyMarking', 'Measurable marking: —')}
      </p>
      <SyringeDrawFigure
        deviceType={currentDeviceType}
        fillFraction={fillFraction ?? 0}
        markingLabel={fillFraction !== null ? markingLabel : '—'}
        blocked={fillFraction !== null && blocked}
      />
      {preview && (
        <>
          {targetDisplay && (
            <div className="space-y-1">
              <p className="text-xs font-medium">{equivalenceLabel}</p>
              <dl
                aria-label={equivalenceLabel}
                className="grid grid-cols-2 gap-2 text-center text-xs tabular-nums sm:grid-cols-4"
              >
                {(['mcg', 'mg', 'ml', 'units'] as const).map((unit) => (
                  <div key={unit} className="min-w-0">
                    <dt className="text-muted-foreground">
                      {unit === 'ml'
                        ? 'mL'
                        : unit === 'units'
                          ? currentDeviceType === 'pump'
                            ? t(
                                'medications.devices.roundedPumps',
                                'Pumps (rounded)'
                              )
                            : t('medications.syringes.units', 'units')
                          : unit}
                    </dt>
                    <dd className="break-words">
                      {unit === 'units' && currentDeviceType === 'pump'
                        ? (pumps ?? '—')
                        : targetDisplay[unit]}
                    </dd>
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
              {displayQuantity(preview.targetMassMcg, 2)} mcg ·{' '}
              {displayQuantity(preview.targetVolumeMl, 3)} mL
            </dd>
            <dt className="text-muted-foreground">
              {t('medications.syringes.delivered', 'Delivered')}
            </dt>
            <dd className="break-words">
              {displayQuantity(preview.deliveredMassMcg, 2)} mcg ·{' '}
              {displayQuantity(preview.deliveredVolumeMl, 3)} mL
            </dd>
            <dt className="text-muted-foreground">
              {t('medications.syringes.rounding', 'Rounding difference')}
            </dt>
            <dd className="break-words">
              {displayQuantity(preview.roundingErrorMcg, 2)} mcg
            </dd>
          </dl>
          {preview.warnings.map((warning) =>
            warning.severity === 'block' ? (
              <Badge
                key={warning.code}
                variant="destructive"
                className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
              >
                {warning.message}
              </Badge>
            ) : (
              <p
                key={warning.code}
                className="text-amber-700 dark:text-amber-400"
              >
                {warning.message}
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
