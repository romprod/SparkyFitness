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
  expect(view.getByText('Target dose in all units')).toBeTruthy();
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
