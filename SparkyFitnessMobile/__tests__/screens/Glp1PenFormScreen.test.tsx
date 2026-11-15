import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { MedicationPen } from '@workspace/shared';
import type { RootStackScreenProps } from '../../src/types/navigation';
import Glp1PenFormScreen from '../../src/screens/Glp1PenFormScreen';

type Props = RootStackScreenProps<'Glp1PenForm'>;
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
let mockPens: MedicationPen[] = [];
let mockSave: () => void;
let mockCreationDevice = false;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../src/hooks/useMedications', () => ({
  useMedicationDetail: () => ({
    data: {
      type_id: 'injection',
      route_id: 'subcutaneous',
      dose_amount: 1,
      dose_unit: 'mg',
    },
  }),
}));
jest.mock('../../src/hooks/useSyringes', () => ({
  useSyringes: () => ({
    data: {
      syringes: mockCreationDevice
        ? [
            {
              id: 'device',
              name: 'Example syringe',
              device_type: 'syringe',
              graduation_type: 'units',
              units_per_ml: 100,
              capacity_ml: '1',
              capacity_units: 100,
              increment: '1',
            },
          ]
        : [],
      default_syringe_id: null,
    },
  }),
}));
jest.mock('../../src/hooks/useGlp1', () => ({
  useMedicationPens: () => ({ data: mockPens }),
  useCreatePen: () => ({ mutate: mockCreate, isPending: false }),
  useUpdatePen: () => ({ mutate: mockUpdate, isPending: false }),
  useDeletePen: () => ({ mutate: jest.fn() }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: (config: { right: { onPress: () => void } }) => {
    mockSave = config.right.onPress;
    return null;
  },
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('../../src/components/FormInput', () => {
  const { TextInput: Input } = require('react-native');
  return { __esModule: true, default: Input };
});
jest.mock('../../src/components/ui/Switch', () => {
  const { Switch } = require('react-native');
  return { __esModule: true, default: Switch };
});
jest.mock('../../src/components/glp1/OptionalDateField', () => {
  const { TextInput: Input } = require('react-native');
  return {
    __esModule: true,
    default: ({
      label,
      value,
      onChange,
    }: {
      label: string;
      value: string;
      onChange: (value: string) => void;
    }) => (
      <Input accessibilityLabel={label} value={value} onChangeText={onChange} />
    ),
  };
});
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

const legacy: MedicationPen = {
  id: 'vial',
  medication_id: 'med',
  kind: 'vial',
  label: 'Example',
  dose_mg: 1,
  concentration_mg_ml: 5,
  volume_ml: 2,
  doses_total: 10,
  doses_used: 0,
  opened_at: '2026-11-01',
  expiry_date: null,
  bud_date: '2026-12-02',
  reorder_flag: false,
  reorder_threshold: null,
  notes: null,
  status: 'in_use',
};
const screen = (editing = false) =>
  render(
    <Glp1PenFormScreen
      route={{
        key: 'form',
        name: 'Glp1PenForm',
        params: { medicationId: 'med', ...(editing ? { penId: 'vial' } : {}) },
      }}
      navigation={{ goBack: jest.fn() } as unknown as Props['navigation']}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPens = [];
  mockCreationDevice = false;
});

test('unrelated legacy edits omit preparation and BUD fields', () => {
  mockPens = [legacy];
  const view = screen(true);
  expect(view.getByText('Preparation details not recorded.')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Label'), 'Updated label');
  act(() => mockSave());
  const { body } = mockUpdate.mock.calls[0][0];
  expect(body.label).toBe('Updated label');
  expect(body).not.toHaveProperty('preparation');
  expect(body).not.toHaveProperty('bud_date');
  expect(body).not.toHaveProperty('bud_mode');
  expect(body).not.toHaveProperty('status');
  expect(body).not.toHaveProperty('lifecycle_intent');
});

test('reviews dry mcg preparation without requiring dose or inventing a BUD', () => {
  const view = screen();
  fireEvent.press(view.getByText('Next'));
  fireEvent.changeText(view.getByLabelText('Labelled vial content'), '1000');
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Final volume (mL)'), '2');
  fireEvent.changeText(view.getByLabelText('Prepared date'), '2026-11-15');
  fireEvent.press(view.getByText('Review preparation'));
  act(() => mockSave());
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        preparation: {
          mode: 'reconstituted',
          mass_value: '1000',
          mass_unit: 'mcg',
          final_volume_ml: '2',
          prepared_date: '2026-11-15',
          diluent: null,
        },
      }),
    }),
    expect.anything()
  );
  expect(mockCreate.mock.calls[0][0].body).not.toHaveProperty('bud_date');
});

test('saved preparation is visible and its volume cannot be edited or resubmitted', () => {
  mockPens = [
    {
      ...legacy,
      preparation: {
        id: 'prep',
        mode: 'reconstituted',
        mass_value: 10,
        mass_unit: 'mg',
        final_volume_ml: '2',
        prepared_date: '2026-11-01',
        diluent: 'Example diluent',
        mass_mg: 10,
        concentration_mg_ml: 5,
        created_at: '2026-11-01T12:00:00Z',
      },
    },
  ];
  const view = screen(true);
  expect(view.getByText('Saved preparation')).toBeTruthy();
  expect(view.getByLabelText('Final volume (mL)').props.editable).toBe(false);
  expect(view.queryByText('Save preparation details')).toBeNull();
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('preparation');
});

test('interval BUD needs a source and submits only the explicit basis', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockPens = [legacy];
  const view = screen(true);
  fireEvent.press(view.getByText('Duration from a date'));
  fireEvent.changeText(
    view.getByLabelText('Beyond-use base date'),
    '2026-11-15'
  );
  fireEvent.changeText(view.getByLabelText('Beyond-use duration (days)'), '14');
  act(() => mockSave());
  expect(mockUpdate).not.toHaveBeenCalled();
  fireEvent.changeText(
    view.getByLabelText('Beyond-use source / instructions'),
    'Product instructions'
  );
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      bud_mode: 'interval',
      bud_interval_days: 14,
      bud_base_date: '2026-11-15',
      bud_source: 'Product instructions',
    })
  );
  alert.mockRestore();
});

test('used legacy vials do not offer a preparation backfill', () => {
  mockPens = [{ ...legacy, doses_used: 1 }];
  const view = screen(true);
  expect(view.getByText('Preparation details not recorded.')).toBeTruthy();
  expect(view.queryByText('Save preparation details')).toBeNull();
});

test('explicitly clearing a BUD clears its basis and source', () => {
  mockPens = [
    { ...legacy, bud_mode: 'date', bud_source: 'Product instructions' },
  ];
  const view = screen(true);
  fireEvent.press(view.getByText('Not set'));
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      bud_mode: null,
      bud_date: null,
      bud_interval_days: null,
      bud_base_date: null,
      bud_source: null,
    })
  );
});

test('retiring and reopening send deliberate lifecycle intent without changing quantities', () => {
  mockPens = [legacy];
  let view = screen(true);
  fireEvent.press(view.getByText('Discarded'));
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      status: 'discarded',
      lifecycle_intent: true,
      volume_ml: 2,
      concentration_mg_ml: 5,
    })
  );
  view.unmount();
  mockUpdate.mockClear();
  mockPens = [{ ...legacy, status: 'discarded' }];
  view = screen(true);
  fireEvent.press(view.getByText('In use'));
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({
      status: 'in_use',
      lifecycle_intent: true,
      volume_ml: 2,
    })
  );
});

test('choosing the existing naturally finished status does not signal manual retirement', () => {
  mockPens = [{ ...legacy, status: 'finished' }];
  const view = screen(true);
  fireEvent.press(view.getByText('Finished'));
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('status');
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
    'lifecycle_intent'
  );
});

test('premix creation reviews the exact labelled concentration and fill without a synthetic target', () => {
  const view = screen();
  fireEvent.press(view.getByText('Premixed'));
  fireEvent.press(view.getByText('Next'));
  fireEvent.changeText(
    view.getByLabelText('Label concentration (mg/mL)'),
    '1.234567890123456789'
  );
  fireEvent.changeText(
    view.getByLabelText('Final volume (mL)'),
    '3.000000000000000001'
  );
  fireEvent.press(view.getByText('Review preparation'));
  expect(
    view.getByText('Concentration: 1.234567890123456789 mg/mL')
  ).toBeTruthy();
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(view.getByText('Estimated doses in vial: —')).toBeTruthy();
  act(() => mockSave());
  expect(mockCreate.mock.calls[0][0].body.preparation).toEqual(
    expect.objectContaining({
      mode: 'premixed',
      label_concentration_value: '1.234567890123456789',
      final_volume_ml: '3.000000000000000001',
    })
  );
  expect(mockCreate.mock.calls[0][0].body).not.toHaveProperty(
    'calculated_draw'
  );
});

test('creation review calculates estimated yield from the actual dose and one saved eligible device without logging', () => {
  mockCreationDevice = true;
  const view = screen();
  fireEvent.press(view.getByText('Next'));
  fireEvent.changeText(view.getByLabelText('Labelled vial content'), '10');
  fireEvent.changeText(view.getByLabelText('Final volume (mL)'), '2');
  fireEvent.press(view.getByText('Review preparation'));
  expect(view.getByText('Measured marking: 20 Units')).toBeTruthy();
  expect(view.getByText('Estimated doses in vial: 10')).toBeTruthy();
  expect(mockCreate).not.toHaveBeenCalled();
});
