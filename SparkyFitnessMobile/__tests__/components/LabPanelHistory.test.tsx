import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import LabPanelHistory from '../../src/components/labs/LabPanelHistory';
import { useDeleteLabPanel } from '../../src/hooks/useLabResults';
import type { LabComparisonPanel } from '@workspace/shared';
jest.mock('../../src/hooks/useLabResults', () => ({
  useDeleteLabPanel: jest.fn(),
}));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
const mutate = jest.fn();
const panel: LabComparisonPanel = {
  id: 'manual-panel',
  collected_on: '2026-01-01',
  lab_name: 'Example lab',
  origin: 'manual',
  notes: 'Example note',
  created_at: '2026-01-01',
  results: [
    {
      id: 'result',
      marker_key: 'hba1c',
      custom_marker_id: null,
      entry_date: '2026-01-01',
      value_numeric: 3,
      value_text: '<3',
      unit: '%',
      ref_range_low: 4,
      ref_range_high: 5.6,
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(useDeleteLabPanel)
    .mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useDeleteLabPanel
    >);
});
it('shows the actual manual panel raw result, source, notes and reference without an exact flag', () => {
  const page = render(
    <LabPanelHistory
      panels={[panel]}
      markers={[]}
      isLoading={false}
      isError={false}
    />
  );
  expect(page.getByText('Manual panel')).toBeTruthy();
  expect(page.getByText('<3 %')).toBeTruthy();
  expect(page.getByText('Example lab')).toBeTruthy();
  expect(page.getByText('Example note')).toBeTruthy();
  expect(page.queryByText('Low')).toBeNull();
  expect(page.queryByText('In range')).toBeNull();
});
it('deletes only the selected panel after an explicit confirmation', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const page = render(
    <LabPanelHistory
      panels={[panel]}
      markers={[]}
      isLoading={false}
      isError={false}
    />
  );
  fireEvent.press(page.getByLabelText(/^Delete lab panel/));
  expect(mutate).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]![2]!;
  buttons.find((button) => button.style === 'destructive')!.onPress!();
  expect(mutate).toHaveBeenCalledWith('manual-panel', expect.anything());
  alert.mockRestore();
});
