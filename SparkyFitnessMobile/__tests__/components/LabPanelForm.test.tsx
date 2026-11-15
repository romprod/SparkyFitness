import { fireEvent, render, waitFor } from '@testing-library/react-native';
import LabPanelForm from '../../src/components/labs/LabPanelForm';
import { useCreateManualLabPanel } from '../../src/hooks/useLabResults';
jest.mock('../../src/hooks/useLabResults', () => ({
  useCreateManualLabPanel: jest.fn(),
}));
jest.mock('../../src/components/CalendarSheet', () => 'CalendarSheet');
jest.mock('../../src/components/BottomSheetPicker', () => {
  const { Pressable: P, Text: T } = jest.requireActual('react-native');
  return ({
    title,
    options,
    onSelect,
  }: {
    title: string;
    options: { value: string }[];
    onSelect: (value: string) => void;
  }) => (
    <P accessibilityLabel={title} onPress={() => onSelect(options[1]!.value)}>
      <T>{title}</T>
    </P>
  );
});
const mutateAsync = jest.fn();
const onSaved = jest.fn();
const show = () =>
  render(
    <LabPanelForm
      ownerId="00000000-0000-4000-8000-000000000001"
      customMarkers={[]}
      labels={{}}
      onSaved={onSaved}
    />
  );
beforeEach(() => {
  jest.clearAllMocks();
  mutateAsync.mockResolvedValue({});
  jest
    .mocked(useCreateManualLabPanel)
    .mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<
      typeof useCreateManualLabPanel
    >);
});
it('keeps raw qualifier and categorical values together in one saved panel', async () => {
  const screen = show();
  fireEvent.changeText(screen.getByLabelText('Result 1'), '<3');
  fireEvent.press(screen.getByText('Add result'));
  fireEvent.press(screen.getByLabelText('Marker 2'));
  fireEvent.changeText(screen.getByLabelText('Result 2'), 'Negative');
  fireEvent.press(screen.getByText('Save lab panel'));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  expect(mutateAsync.mock.calls[0]![0].expected_owner_id).toBe(
    '00000000-0000-4000-8000-000000000001'
  );
  expect(mutateAsync.mock.calls[0]![0].results).toMatchObject([
    { marker_key: 'hba1c', value_text: '<3', unit: '%' },
    { marker_key: 'fasting_glucose', value_text: 'Negative' },
  ]);
  expect(onSaved).toHaveBeenCalledTimes(1);
});
it('keeps the failed panel entries available for retry', async () => {
  mutateAsync.mockRejectedValue(new Error('Synthetic failure'));
  const screen = show();
  fireEvent.changeText(screen.getByLabelText('Result 1'), '≥3');
  fireEvent.press(screen.getByText('Save lab panel'));
  await waitFor(() =>
    expect(
      screen.getByText('Could not save the lab panel. Your entries are kept.')
    ).toBeTruthy()
  );
  expect(screen.getByLabelText('Result 1').props.value).toBe('≥3');
  expect(onSaved).not.toHaveBeenCalled();
});
