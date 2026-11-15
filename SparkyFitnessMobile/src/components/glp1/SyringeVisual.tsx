import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { useTranslation } from 'react-i18next';
import { drawTargetFillFraction, type DrawResult } from '@workspace/shared';

/** Decorative target-volume fill; the adjacent exact caption remains the measured marking. */
export default function SyringeVisual({
  draw,
  neutral = false,
}: {
  draw?: DrawResult;
  neutral?: boolean;
}) {
  const { t } = useTranslation();
  const [accent, danger, muted, surface] = useCSSVariable([
    '--color-accent-primary',
    '--color-icon-danger',
    '--color-text-muted',
    '--color-surface',
  ]) as [string, string, string, string];
  const fraction = draw?.syringeCapacityMl
    ? drawTargetFillFraction(draw.targetVolumeMl, draw.syringeCapacityMl)
    : !draw && neutral
      ? 0
      : null;
  if (fraction === null) return null;
  const fill = draw?.warnings.some((warning) => warning.severity === 'block')
    ? danger
    : accent;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        draw
          ? t('medications.syringes.visualTarget', {
              defaultValue:
                'Syringe preview: target volume {{volume}} mL of {{capacity}} mL capacity',
              volume: draw.targetVolumeMl,
              capacity: draw.syringeCapacityMl,
            })
          : t('medications.syringes.visualEmpty', {
              defaultValue: 'Syringe preview: no calculated draw',
            })
      }
    >
      <Svg width="100%" height={64} viewBox="0 0 260 64" accessible={false}>
        <Rect
          x={8}
          y={18}
          width={210}
          height={28}
          rx={4}
          fill={surface}
          stroke={muted}
          strokeWidth={1.5}
        />
        <Rect
          testID="syringe-target-fill"
          x={8}
          y={18}
          width={210 * fraction}
          height={28}
          rx={4}
          fill={fill}
          opacity={0.85}
        />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <Line
            key={tick}
            testID="syringe-quarter-tick"
            x1={8 + 210 * tick}
            y1={14}
            x2={8 + 210 * tick}
            y2={50}
            stroke={muted}
            strokeWidth={1}
            opacity={0.5}
          />
        ))}
        <Rect x={218} y={22} width={18} height={20} rx={2} fill={muted} />
        <Line
          x1={236}
          y1={32}
          x2={258}
          y2={32}
          stroke={muted}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}
