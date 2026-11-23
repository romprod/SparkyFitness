import { useTranslation } from 'react-i18next';
import {
  doseAsMg,
  expandBlendDose,
  roundSplitForDisplay,
  weakestBlendSource,
  type BlendComponentRatio,
} from '@workspace/shared';

/**
 * What each compound of a blend receives from one dose of it, in mcg, and the source of the ratio
 * it comes from. Always labelled derived: it is the blend's stated ratio applied to the dose, not
 * a measurement. Shows nothing for a dose that cannot be split.
 */
export default function MedicationBlendSplit({
  amount,
  unit,
  components,
}: {
  /** The dose of the whole blend, and the unit it is in; only mass units can be split. */
  amount: string | number | null;
  unit: string;
  components: readonly BlendComponentRatio[];
}) {
  const { t } = useTranslation();
  const split = expandBlendDose(doseAsMg(amount, unit), components);
  if (split.length === 0) return null;
  const shown = roundSplitForDisplay(
    split.map((part) => Number(part.dose_mg) * 1000)
  );
  return (
    <p className="text-xs tabular-nums text-muted-foreground">
      ↳{' '}
      {split
        .map((part, index) => `${part.name} ${shown[index]} mcg`)
        .join(' · ')}{' '}
      <span className="opacity-70">
        {t('medications.blends.derivedFrom', '(derived, {{source}})', {
          source: weakestBlendSource(components),
        })}
      </span>
    </p>
  );
}
