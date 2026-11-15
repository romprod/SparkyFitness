import { render } from '@testing-library/react-native';
import type { DrawResult } from '@workspace/shared';
import SyringeDrawPreview from '../../src/components/glp1/SyringeDrawPreview';

jest.mock('uniwind', () => ({
  useCSSVariable: () => ['#00aaff', '#ff0000', '#777777', '#eeeeee'],
}));
const draw = (overrides: Partial<DrawResult> = {}): DrawResult => ({
  targetMassMcg: '500',
  targetVolumeMl: '0.5',
  rawUnits: '50',
  markingValue: '50.123456789',
  markingScale: 'units',
  deliveredMassMcg: '501',
  deliveredVolumeMl: '0.501',
  roundingErrorMcg: '1',
  warnings: [],
  syringeCapacityMl: '1',
  ...overrides,
});
test('fills from target volume, preserves exact marking and separates target from delivered values', () => {
  const view = render(
    <SyringeDrawPreview data={draw()} pending={false} failed={false} />
  );
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(105);
  expect(view.getAllByTestId('syringe-quarter-tick')).toHaveLength(5);
  expect(view.getByText('Measured marking: 50.123456789 Units')).toBeTruthy();
  expect(view.getByText('Dose equivalents')).toBeTruthy();
  expect(view.getByText('500 mcg')).toBeTruthy();
  expect(view.getByText('0.5 mg')).toBeTruthy();
  expect(view.getByText('0.5 mL')).toBeTruthy();
  expect(view.getByText('50 Units')).toBeTruthy();
  expect(view.getByText('Delivered: 501 mcg · 0.501 mL')).toBeTruthy();
});
test('clamps visual capacity and colors any existing blocking warning red', () => {
  const view = render(
    <SyringeDrawPreview
      data={draw({
        targetVolumeMl: '2',
        warnings: [
          {
            code: 'EXCEEDS_REMAINING_VIAL',
            severity: 'block',
            message: 'Example existing stock block',
          },
        ],
      })}
      pending={false}
      failed={false}
    />
  );
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(210);
  expect(view.getByTestId('syringe-target-fill').props.fill).toEqual(
    expect.objectContaining({ payload: 4294901760 })
  );
  expect(view.getByText('Example existing stock block')).toBeTruthy();
});
test('a positive target rounded to zero still has a target fill and exact zero marking', () => {
  const view = render(
    <SyringeDrawPreview
      data={draw({
        targetVolumeMl: '0.001',
        markingValue: '0',
        deliveredMassMcg: '0',
        deliveredVolumeMl: '0',
      })}
      pending={false}
      failed={false}
    />
  );
  expect(view.getByTestId('syringe-target-fill').props.width).toBeCloseTo(0.21);
  expect(view.getByText('Measured marking: 0 Units')).toBeTruthy();
});
test('older preview responses without capacity keep numerical output without inventing a barrel capacity', () => {
  const view = render(
    <SyringeDrawPreview
      data={draw({ syringeCapacityMl: undefined })}
      pending={false}
      failed={false}
    />
  );
  expect(view.queryByTestId('syringe-target-fill')).toBeNull();
  expect(view.getByText('Measured marking: 50.123456789 Units')).toBeTruthy();
});

test.each([
  { pending: false, failed: false },
  { pending: true, failed: false },
  { pending: false, failed: true },
])(
  'retains a neutral nonnumeric figure without an authoritative result (%j)',
  ({ pending, failed }) => {
    const view = render(
      <SyringeDrawPreview
        showNeutral
        data={pending || failed ? draw() : undefined}
        pending={pending}
        failed={failed}
      />
    );
    expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
    expect(view.getByText('Draw to —')).toBeTruthy();
    expect(view.queryByText(/^Measured marking:/)).toBeNull();
    expect(view.queryByText(/^Delivered:/)).toBeNull();
  }
);

test('same-response pen and pump metadata drive dial and spray captions without insulin-unit pump output', () => {
  const pen = draw({
    device: {
      id: 'pen',
      device_type: 'pen',
      increment: '1',
      capacity_ml: '1',
      graduation_type: 'units',
      units_per_ml: 100,
    },
  });
  const view = render(
    <SyringeDrawPreview data={pen} pending={false} failed={false} showNeutral />
  );
  expect(view.getByText('Dial to 50.123456789 Units')).toBeTruthy();
  view.rerender(
    <SyringeDrawPreview
      data={draw({
        device: {
          id: 'pump',
          device_type: 'pump',
          increment: '0.1',
          capacity_ml: '1',
          graduation_type: 'ml',
          units_per_ml: 1,
        },
        markingValue: '0.5',
        markingScale: 'ml',
        deliveredVolumeMl: '0.5',
      })}
      pending={false}
      failed={false}
      showNeutral
    />
  );
  expect(view.getByText('Spray 5 pumps (0.5 mL)')).toBeTruthy();
  expect(view.getByText('5 Pumps (rounded)')).toBeTruthy();
  expect(view.queryByText('50 Units')).toBeNull();
  view.rerender(
    <SyringeDrawPreview
      data={pen}
      pending
      failed={false}
      showNeutral
      neutralDeviceType="pump"
    />
  );
  expect(view.getByText('Spray —')).toBeTruthy();
  expect(view.queryByText(/^Dial to/)).toBeNull();
  expect(view.queryByText(/^Delivered:/)).toBeNull();
});

test('pump equivalents retain source target mass/volume but explicitly label the rounded 1.4-to-1 spray count', () => {
  const view = render(
    <SyringeDrawPreview
      data={draw({
        targetMassMcg: '140',
        targetVolumeMl: '0.14',
        rawUnits: '999',
        markingValue: '0.1',
        markingScale: 'ml',
        deliveredMassMcg: '100',
        deliveredVolumeMl: '0.1',
        device: {
          id: 'pump',
          device_type: 'pump',
          increment: '0.1',
          capacity_ml: '1',
          graduation_type: 'ml',
          units_per_ml: 987,
        },
      })}
      pending={false}
      failed={false}
    />
  );
  expect(view.getByText('Dose equivalents')).toBeTruthy();
  expect(view.getByText('0.14 mL')).toBeTruthy();
  expect(view.getByText('140 mcg')).toBeTruthy();
  expect(view.getByText('1 Pumps (rounded)')).toBeTruthy();
  expect(view.getByText('Spray 1 pumps (0.1 mL)')).toBeTruthy();
  expect(view.queryByText('999 Units')).toBeNull();
});
