import { act, fireEvent, render } from '@testing-library/react-native';
import {
  INJECTION_SITES,
  type DrawResult,
  type Medication,
  type MedicationPen,
  type MedicationSyringe,
  type CalculatedDrawInput,
} from '@workspace/shared';
import Glp1LogInjectionCard from '../../src/components/glp1/Glp1LogInjectionCard';

const mockSiteId = INJECTION_SITES[0]!.id;
const mockLog = jest.fn();
let mockResult: DrawResult;
let mockFetching = false;
let mockDefaultId: string | null = null;
let mockSavedSyringes: MedicationSyringe[] = [];
let mockFailed = false;
const mockSyringeId = '11111111-1111-4111-8111-111111111111';
const savedSyringe = (
  overrides: Partial<MedicationSyringe> = {}
): MedicationSyringe => ({
  id: mockSyringeId,
  name: 'Example syringe',
  graduation_type: 'units',
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
  is_default: true,
  created_at: '',
  updated_at: '',
  ...overrides,
});
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
      syringes: mockSavedSyringes,
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
      isError: mockFailed,
    };
  },
}));
jest.mock('../../src/components/FormInput', () => ({
  __esModule: true,
  default: require('react-native').TextInput,
}));
jest.mock('../../src/components/glp1/InjectionBodyMap', () => ({
  __esModule: true,
  default: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'injection-body-map',
    }),
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
  mockPen.preparation = undefined;
  mockPen.concentration_mg_ml = 1;
  mockDefaultId = mockSyringeId;
  mockSavedSyringes = [savedSyringe()];
  mockFailed = false;
  mockFetching = false;
  mockResult = {
    syringeCapacityMl: '1',
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

test('an implicit fallback to a different first syringe clears a mcg draft without reinterpreting it', () => {
  const secondId = '22222222-2222-4222-8222-222222222222';
  mockSavedSyringes = [
    savedSyringe({ id: secondId, name: 'First saved syringe' }),
    savedSyringe({ name: 'Preferred syringe' }),
  ];
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockDefaultId = null;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
  expect(
    view.getByText('The vial or syringe changed. Enter the dose again.')
  ).toBeTruthy();
  expect(view.getByText('Draw to —')).toBeTruthy();
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.5');
  fireEvent.press(logButton(view));
  expect(mockLog.mock.calls[0][0].calculated_draw).toEqual({
    syringe_id: secondId,
    dose: { value: '0.5', unit: 'mg' },
  });
});

test.each([null, 'missing-default'])(
  'automatically uses the first saved syringe when default %s is absent or invalid',
  (defaultId) => {
    mockDefaultId = defaultId;
    const view = setup();
    expect(view.getByText('Draw to —')).toBeTruthy();
    expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
    fireEvent.changeText(view.getByLabelText('Target dose / volume'), '1');
    expect(mockPreview).toHaveBeenLastCalledWith('vial', {
      syringe_id: mockSyringeId,
      dose: { value: '1', unit: 'mg' },
    });
  }
);

test('a normal entry uses its saved default and shows the figure without selecting the syringe dropdown', () => {
  const view = setup();
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.5');
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: mockSyringeId,
    dose: { value: '0.5', unit: 'mg' },
  });
});

test('explicit Manual remains selected across saved default changes', () => {
  const view = setup();
  fireEvent.press(view.getByText('Manual dose (mg)'));
  mockDefaultId = null;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Dose (mg)')).toBeTruthy();
  expect(view.queryByText('Draw to —')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Dose (mg)'), '0.5');
  fireEvent.press(logButton(view));
  expect(mockLog.mock.calls[0][0].dose_mg).toBe(0.5);
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('calculated_draw');
});

test('does not create or invent a syringe when none are saved', () => {
  mockDefaultId = null;
  mockSavedSyringes = [];
  const view = setup();
  expect(view.getByLabelText('Dose (mg)')).toBeTruthy();
  expect(view.queryByText('Draw to —')).toBeNull();
  expect(view.queryByTestId('syringe-target-fill')).toBeNull();
});

test('keeps a neutral figure through pending, error and invalid dose without displaying a cached marking', () => {
  const view = setup();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '1');
  expect(view.getByText('Measured marking: 1 Units')).toBeTruthy();
  mockFetching = true;
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '2');
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
  expect(view.queryByText('Measured marking: 1 Units')).toBeNull();
  expect(view.queryByText(/^Delivered:/)).toBeNull();
  mockFetching = false;
  mockFailed = true;
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '3');
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
  mockFailed = false;
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '.');
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
});

test('the dose and persistent calculation appear above the existing body map', () => {
  const view = setup();
  const tree = JSON.stringify(view.toJSON());
  expect(tree.indexOf('Target dose / volume')).toBeGreaterThan(-1);
  expect(tree.indexOf('Draw to —')).toBeLessThan(
    tree.indexOf('injection-body-map')
  );
  expect(tree.indexOf('Target dose / volume')).toBeLessThan(
    tree.indexOf('injection-body-map')
  );
});

test('clearing a default that remains the first saved syringe keeps the same calculated unit context', () => {
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockDefaultId = null;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('500');
  expect(
    view.queryByText('The vial or syringe changed. Enter the dose again.')
  ).toBeNull();
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: mockSyringeId,
    dose: { value: '500', unit: 'mcg' },
  });
});

test('explicit device changes clear the prior unit draft while preserving site and notes', () => {
  const secondId = '22222222-2222-4222-8222-222222222222';
  mockSavedSyringes.push(
    savedSyringe({ id: secondId, name: 'Second saved syringe' })
  );
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  fireEvent.changeText(
    view.getByPlaceholderText('e.g. Mild stinging'),
    'Example note'
  );
  fireEvent.press(view.getByText('Second saved syringe'));
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
  expect(view.getByText('Draw to —')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.5');
  fireEvent.press(logButton(view));
  expect(mockLog.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      site: mockSiteId,
      notes: 'Example note',
      calculated_draw: {
        syringe_id: secondId,
        dose: { value: '0.5', unit: 'mg' },
      },
    })
  );
});

test('deleting an explicit selected device clears the draft and blocks without auto replacement or phantom figure', () => {
  const secondId = '22222222-2222-4222-8222-222222222222';
  mockSavedSyringes.push(
    savedSyringe({ id: secondId, name: 'Second saved syringe' })
  );
  const view = setup();
  fireEvent.press(view.getByText('Second saved syringe'));
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  expect(view.getByText('Measured marking: 1 Units')).toBeTruthy();
  mockSavedSyringes = [savedSyringe()];
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
  expect(mockPreview).toHaveBeenLastCalledWith('vial', null);
  expect(view.queryByTestId('syringe-target-fill')).toBeNull();
  expect(view.queryByText(/^Measured marking:/)).toBeNull();
  fireEvent.press(logButton(view));
  expect(mockLog).not.toHaveBeenCalled();
});

test.each<Partial<MedicationSyringe>>([
  { graduation_type: 'ml' },
  { units_per_ml: 40 },
  { capacity_ml: '0.5' },
  { capacity_units: 50 },
  { increment: '0.5' },
])(
  'same-ID calibration change %j clears the dose, unit and old numeric preview',
  (calibration) => {
    const view = setup();
    fireEvent.press(view.getByText('mcg'));
    fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
    mockSavedSyringes = [savedSyringe(calibration)];
    view.rerender(
      <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
    );
    expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
    expect(view.getByText('Draw to —')).toBeTruthy();
    expect(view.getByTestId('syringe-target-fill').props.width).toBe(0);
    expect(view.queryByText(/^Measured marking:/)).toBeNull();
    fireEvent.press(logButton(view));
    expect(mockLog).not.toHaveBeenCalled();
    fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.5');
    expect(mockPreview).toHaveBeenLastCalledWith('vial', {
      syringe_id: mockSyringeId,
      dose: { value: '0.5', unit: 'mg' },
    });
  }
);

test('rename and default/update metadata do not clear the dose or its unit', () => {
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockSavedSyringes = [
    savedSyringe({
      name: 'Renamed syringe',
      is_default: false,
      updated_at: '2026-11-15T12:00:00Z',
    }),
  ];
  mockDefaultId = null;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('500');
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: mockSyringeId,
    dose: { value: '500', unit: 'mcg' },
  });
});

test('changing legacy concentration on the same vial ID clears the unit draft', () => {
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockPen.concentration_mg_ml = 2;
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
  expect(view.getByText('Draw to —')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '0.5');
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: mockSyringeId,
    dose: { value: '0.5', unit: 'mg' },
  });
});

test('changing preparation identity on the same vial clears the interpreted dose', () => {
  mockPen.preparation = {
    id: 'preparation-one',
    mode: 'reconstituted',
    mass_value: 1,
    mass_unit: 'mg',
    final_volume_ml: 1,
    prepared_date: '2026-11-15',
    diluent: null,
    mass_mg: 1,
    concentration_mg_ml: 1,
    created_at: '',
  };
  const view = setup();
  fireEvent.press(view.getByText('mcg'));
  fireEvent.changeText(view.getByLabelText('Target dose / volume'), '500');
  mockPen.preparation = { ...mockPen.preparation, id: 'preparation-two' };
  view.rerender(
    <Glp1LogInjectionCard med={med} onManageSyringes={jest.fn()} />
  );
  expect(view.getByLabelText('Target dose / volume').props.value).toBe('');
  expect(view.getByText('Draw to —')).toBeTruthy();
  expect(mockPreview).toHaveBeenLastCalledWith('vial', null);
});
