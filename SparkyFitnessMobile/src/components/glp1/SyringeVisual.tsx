import { View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { useTranslation } from 'react-i18next';
import {
  drawTargetFillFraction,
  mlToPumps,
  type DrawResult,
  type MedicationDeviceType,
} from '@workspace/shared';

/** Decorative target-volume fill; the adjacent exact caption remains the measured marking. */
export default function SyringeVisual({
  draw,
  neutral = false,
  neutralDeviceType = 'syringe',
}: {
  draw?: DrawResult;
  neutral?: boolean;
  neutralDeviceType?: MedicationDeviceType;
}) {
  const { t } = useTranslation();
  const deviceType = draw?.device?.device_type ?? neutralDeviceType;
  const deviceLabel =
    deviceType === 'pump'
      ? t('medications.devices.pump', { defaultValue: 'Nasal pump' })
      : deviceType === 'pen'
        ? t('medications.devices.pen', { defaultValue: 'Pen' })
        : t('medications.devices.syringe', { defaultValue: 'Syringe' });
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
  const mark = !draw
    ? '—'
    : deviceType === 'pump' && draw.device
      ? mlToPumps(draw.markingValue, draw.device.increment)
      : draw.markingValue;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        draw
          ? t('medications.devices.visualTarget', {
              defaultValue:
                '{{device}} preview: target volume {{volume}} mL of {{capacity}} mL capacity',
              device: deviceLabel,
              volume: draw.targetVolumeMl,
              capacity: draw.syringeCapacityMl,
            })
          : t('medications.devices.visualEmpty', {
              defaultValue: '{{device}} preview: no calculated draw',
              device: deviceLabel,
            })
      }
    >
      <Svg width="100%" height={64} viewBox="0 0 260 64" accessible={false}>
        {deviceType === 'syringe' ? (
          <>
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
          </>
        ) : deviceType === 'pen' ? (
          <>
            <Rect
              x={26}
              y={19}
              width={190}
              height={26}
              rx={8}
              fill={surface}
              stroke={muted}
              strokeWidth={1.5}
            />
            <Rect
              x={30}
              y={38}
              width={182 * fraction}
              height={4}
              rx={2}
              fill={fill}
            />
            <Rect
              x={89}
              y={23}
              width={64}
              height={13}
              rx={3}
              fill={surface}
              stroke={fill}
              strokeWidth={1.5}
            />
            <SvgText
              x={121}
              y={33}
              textAnchor="middle"
              fill={muted}
              fontSize={10}
            >
              {mark}
            </SvgText>
            <Rect
              x={216}
              y={22}
              width={26}
              height={20}
              rx={5}
              fill={surface}
              stroke={muted}
            />
            {[222, 228, 234].map((x) => (
              <Line
                key={x}
                x1={x}
                y1={25}
                x2={x}
                y2={39}
                stroke={muted}
                opacity={0.5}
              />
            ))}
            <Line
              x1={242}
              y1={32}
              x2={258}
              y2={32}
              stroke={muted}
              strokeWidth={2}
            />
          </>
        ) : (
          <>
            <Rect
              x={70}
              y={15}
              width={90}
              height={34}
              rx={8}
              fill={surface}
              stroke={muted}
              strokeWidth={1.5}
            />
            <Rect
              x={160}
              y={27}
              width={14}
              height={10}
              rx={2}
              fill={surface}
              stroke={muted}
            />
            <Line
              x1={174}
              y1={32}
              x2={186}
              y2={32}
              stroke={muted}
              strokeWidth={2}
            />
            {[0, 1, 2].map((i) => (
              <Line
                key={i}
                x1={188}
                y1={26 + i * 6}
                x2={196}
                y2={23 + i * 9}
                stroke={muted}
                strokeWidth={1.5}
              />
            ))}
            <Rect
              x={70}
              y={24}
              width={90}
              height={16}
              rx={3}
              fill={surface}
              stroke={fill}
              strokeWidth={1.5}
            />
            <SvgText
              x={115}
              y={36}
              textAnchor="middle"
              fill={muted}
              fontSize={10}
            >
              {mark}
            </SvgText>
          </>
        )}
      </Svg>
    </View>
  );
}
