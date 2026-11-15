import { act, fireEvent, render } from '@testing-library/react-native';
import {
  INJECTION_SITES,
  type DrawResult,
  type Medication,
  type MedicationPen,
  type CalculatedDrawInput,
} from '@workspace/shared';
import Glp1LogInjectionCard from '../../src/components/glp1/Glp1LogInjectionCard';

const mockSiteId = INJECTION_SITES[0]!.id;
const mockLog = jest.fn();
let mockResult: DrawResult;
let mockFetching = false;
let mockDefaultId: string | null = null;
const mockSyringeId = '11111111-1111-4111-8111-111111111111';
const mockPreview = jest.fn();
jest.mock('../../src/hooks/useGlp1', () => ({
  useLogInjection: () => ({ mutate: mockLog, isPending: false }),
  useMedicationPens: () => ({ data: [mockPen] }),
  useSiteSuggestion: () => ({
    data: { suggestedSiteId: mockSiteId },
  }),
}));
jest.mock('../../src/hooks/useSyringes', () => ({
  useSyringes: () => ({
    data: {
      default_syringe_id: mockDefaultId,
      syringes: [{ id: mockSyringeId, name: 'Example syringe' }],
    },
  }),
  useSyringeDrawPreview: (
    id: string | null,
    input: CalculatedDrawInput | null
  ) => {
    mockPreview(id, input);
    return {
      data: input ? mockResult : undefined,
      isFetching: mockFetching,
      isError: false,
    };
  },
}));
jest.mock('../../src/components/FormInput', () => ({
  __esModule: true,
  default: require('react-native').TextInput,
}));
jest.mock('../../src/components/glp1/InjectionBodyMap', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/components/CalendarSheet', () => ({
  __esModule: true,
  default: () => null,
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
const mockPen: MedicationPen = {
  id: 'vial',
  medication_id: 'med',
  kind: 'vial',
  label: 'Example vial',
  dose_mg: 1,
  concentration_mg_ml: 1,
  volume_ml: 1,
  doses_total: 5,
  doses_used: 0,
  status: 'in_use',
  opened_at: null,
  expiry_date: null,
  bud_date: null,
  reorder_flag: false,
  reorder_threshold: null,
  notes: null,
};
const med: Medication = {
  id: 'med',
  user_id: 'user',
  name: 'Example',
  display_name: null,
  type_id: 'injection',
  route_id: null,
  strength_value: null,
  strength_unit: null,
  dose_amount: 1,
  dose_unit: 'mg',
  reason_text: null,
  effectiveness_rating: null,
  color: null,
  icon: null,
  photo_path: null,
  is_active: true,
  is_quick: false,
  is_glp1: false,
  notes: null,
  source: 'manual',
  custom_fields: {},
  created_at: '',
  updated_at: '',
};
const setup = () =>
  render(<Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />);
const logButton = (view: ReturnType<typeof setup>) =>
  view.getByText(/^Log injection:/);
beforeEach(() => {
  jest.clearAllMocks();
  mockPen.status = 'in_use';
  mockPen.kind = 'vial';
  mockDefaultId = mockSyringeId;
  mockFetching = false;
  mockResult = {
    targetMassMcg: '5',
    targetVolumeMl: '0.005',
    rawUnits: '0.5',
    markingValue: '1',
    markingScale: 'units',
    deliveredMassMcg: '10',
    deliveredVolumeMl: '0.01',
    roundingErrorMcg: '5',
    warnings: [],
  };
});
test('submits exact decimal input and calculated draw without a competing manual dose; duplicate taps collapse', () => {
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(
    view.getByLabelText('Target dose / volume'),
    '0.12345678901234567890123456789'
  );
  expect(view.getByText('Measured marking: 1 Units')).toBeTruthy();
  act(() => {
    fireEvent.press(logButton(view));
    fireEvent.press(logButton(view));
  });
  expect(mockLog).toHaveBeenCalledTimes(1);
  const body = mockLog.mock.calls[0][0];
  expect(body).toEqual(
    expect.objectContaining({
      pen_id: 'vial',
      deduct_pen: true,
      calculated_draw: {
        syringe_id: mockSyringeId,
        dose: { value: '0.12345678901234567890123456789', unit: 'mcg' },
      },
    })
  );
  expect(body).not.toHaveProperty('dose_mg');
});
test('source warnings and a positive draw rounded to zero do not block logging', () => {
  mockResult = {
    ...mockResult,
    markingValue: '0',
    deliveredMassMcg: '0',
    deliveredVolumeMl: '0',
    warnings: [
      {
        code: 'ROUNDING_ERROR_HIGH',
        severity: 'warn',
        message: 'Example source rounding warning',
      },
    ],
  };
  const view = setup();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.001');
  expect(view.getByText('Example source rounding warning')).toBeTruthy();
  fireEvent.press(logButton(view));
  expect(mockLog).toHaveBeenCalledTimes(1);
});
test('blocks source hard checks, pending previews and a zero target', () => {
  mockResult.warnings = [
    {
      code: 'EXCEEDS_REMAINING_VIAL',
      severity: 'block',
      message: 'Example source stock block',
    },
  ];
  const view = setup();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '2');
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
  mockResult.warnings = [];
  mockFetching = true;
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '1');
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
  mockFetching = false;
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0');
  fireEvent.press(logButton(view));
  expect(mockPreview).toHaveBeenLastCalledWith('vial', null);
  expect(mockLog).not.toHaveBeenCalled();
});
test('manual mode preserves the existing mg payload and changing deduction clears a previous units draft', () => {
  const view = setup();
  fireEvent.press(view.getByText('Units'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '20');
  fireEvent.press(view.getByText("Don't deduct"));
  expect(view.getByLabelText('Dose (mg)').props.value).toBe('');
  fireEvent.changeText(view.getByLabelText('Dose (mg)'), '0.5');
  fireEvent.press(logButton(view));
  expect(mockLog.mock.calls[0][0]).toEqual(
    expect.objectContaining({ pen_id: null, deduct_pen: false, dose_mg: 0.5 })
  );
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('calculated_draw');
});

test('a draft bound to a vial that becomes retired cannot silently log against it', () => {
  const view = setup();
  fireEvent.press(view.getByText('Units'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '20');
  mockPen.status = 'discarded';
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(
    view.getByText(
      'The selected vial is no longer active. Choose an active vial or choose not to deduct.'
    )
  ).toBeTruthy();
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
});

test('async default syringe clearing clears a mcg draft and cannot submit it as mg', () => {
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockDefaultId = null;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Dose (mg)').props.value).toBe('');
  expect(
    view.getByText('The vial or syringe changed. Enter the dose again.')
  ).toBeTruthy();
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('Dose (mg)'), '0.5');
  fireEvent.press(logButton(view));
  expect(mockLog.mock.calls[0][0]).toEqual(
    expect.objectContaining({ dose_mg: 0.5 })
  );
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('calculated_draw');
});
