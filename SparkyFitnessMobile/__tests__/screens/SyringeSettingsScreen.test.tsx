import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { RootStackScreenProps } from '../../src/types/navigation';
import SyringeSettingsScreen from '../../src/screens/SyringeSettingsScreen';

const mockSave = jest.fn();
const mockDefault = jest.fn();
const mockDelete = jest.fn();
let mockHeaderSave: (() => void) | undefined;
let mockShared = false;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../src/hooks/useSyringes', () => ({
  useSyringes: () => ({
    data: {
      default_syringe_id: 'syringe',
      syringes: [
        {
          id: 'syringe',
          name: 'Example syringe',
          is_shared: mockShared,
          graduation_type: 'units',
          device_type: 'syringe',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '1',
          is_default: true,
          created_at: '',
          updated_at: '',
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useSyringeMutations: () => ({
    save: { mutate: mockSave, isPending: false },
    setDefault: { mutate: mockDefault, isPending: false },
    remove: { mutate: mockDelete, isPending: false },
  }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: (config: { right?: { onPress: () => void } }) => {
    mockHeaderSave = config.right?.onPress;
    return null;
  },
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('../../src/components/FormInput', () => ({
  __esModule: true,
  default: require('react-native').TextInput,
}));
jest.mock('../../src/components/BottomSheetPicker', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      options,
      onSelect,
    }: {
      options: { value: string; label: string }[];
      onSelect: (value: string) => void;
    }) => (
      <View>
        {options.map((option) => (
          <Pressable key={option.value} onPress={() => onSelect(option.value)}>
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});
const setup = () =>
  render(
    <SyringeSettingsScreen
      route={{ name: 'SyringeSettings', key: 'settings', params: undefined }}
      navigation={
        {
          goBack: jest.fn(),
        } as unknown as RootStackScreenProps<'SyringeSettings'>['navigation']
      }
    />
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockShared = false;
});
test('edits reusable settings while keeping decimal capacities and increment exact', () => {
  const view = setup();
  fireEvent.press(view.getAllByText('Example syringe')[1]!);
  fireEvent.changeText(
    view.getByLabelText('Capacity (mL)'),
    '0.3333333333333333333333333333333333333333'
  );
  fireEvent.changeText(view.getByLabelText('Marking increment'), '0.5');
  act(() => mockHeaderSave?.());
  expect(mockSave).toHaveBeenCalledWith(
    {
      id: 'syringe',
      body: {
        name: 'Example syringe',
        graduation_type: 'units',
        device_type: 'syringe',
        units_per_ml: 100,
        capacity_ml: '0.3333333333333333333333333333333333333333',
        capacity_units: 100,
        increment: '0.5',
      },
    },
    expect.anything()
  );
});
test('default can be cleared without changing a preparation', () => {
  const view = setup();
  fireEvent.press(view.getByText('None'));
  expect(mockDefault).toHaveBeenCalledWith(null, expect.anything());
  expect(mockSave).not.toHaveBeenCalled();
});
test('deletion remains available for an existing syringe and preserves numeric history in its confirmation', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = setup();
  fireEvent.press(view.getAllByText('Example syringe')[1]!);
  fireEvent.press(view.getByText('Delete'));
  expect(alert).toHaveBeenCalledWith(
    'Delete syringe?',
    'This removes the reusable syringe setting. Saved injection calculations are preserved.',
    expect.anything()
  );
  const buttons = alert.mock.calls[0]![2]!;
  act(() => buttons[1]!.onPress!());
  expect(mockDelete).toHaveBeenCalledWith('syringe', expect.anything());
  alert.mockRestore();
});

test('pump settings use mL per spray and cannot retain insulin-unit calibration', () => {
  const view = setup();
  fireEvent.press(view.getByText('Add device'));
  fireEvent.press(view.getByText('Nasal pump'));
  fireEvent.changeText(view.getByLabelText('Name'), 'Example nasal pump');
  fireEvent.changeText(view.getByLabelText('Capacity (mL)'), '10');
  fireEvent.changeText(view.getByLabelText('mL per spray'), '0.1');
  expect(view.queryByLabelText('Units per mL')).toBeNull();
  expect(view.queryByLabelText('Capacity (units)')).toBeNull();
  act(() => mockHeaderSave?.());
  expect(mockSave.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      device_type: 'pump',
      graduation_type: 'ml',
      units_per_ml: 1,
      capacity_ml: '10',
      capacity_units: 100,
      increment: '0.1',
    })
  );
});
test('shared devices remain selectable as default but their editor is read-only', () => {
  mockShared = true;
  const view = setup();
  fireEvent.press(view.getAllByText('Example syringe')[0]!);
  expect(mockDefault).toHaveBeenCalledWith('syringe', expect.anything());
  fireEvent.press(view.getAllByText('Example syringe')[1]!);
  expect(view.getByLabelText('Name').props.editable).toBe(false);
  expect(view.queryByText('Delete')).toBeNull();
  expect(mockHeaderSave).toBeUndefined();
  expect(mockSave).not.toHaveBeenCalled();
});
