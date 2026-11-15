import { act, fireEvent, render } from '@testing-library/react-native';
import type {
  MedicationPurchaseEditorData,
  MedicationPurchaseView,
} from '@workspace/shared';
import MedicationPurchaseEditor from '../../src/components/medications/MedicationPurchaseEditor';
import { ApiError } from '../../src/services/api/errors';
const owner = '11111111-1111-4111-8111-111111111111',
  med = '22222222-2222-4222-8222-222222222222',
  vial = '33333333-3333-4333-8333-333333333333',
  second = '44444444-4444-4444-8444-444444444444',
  lineId = '55555555-5555-4555-8555-555555555555';
let mockSave: () => void;
const mockCreate = jest.fn(),
  mockUpdate = jest.fn();
let mockCurrent = true;
jest.mock('../../src/hooks/useMedicationPurchases', () => ({
  useMedicationPurchaseMutations: () => ({
    create: { mutate: mockCreate, isPending: false },
    update: { mutate: mockUpdate, isPending: false },
  }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: (config: { right: { onPress: () => void } }) => {
    mockSave = config.right.onPress;
    return null;
  },
}));
jest.mock('../../src/hooks/useNativeIOSHeadersActive', () => ({}), {
  virtual: true,
});
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('../../src/components/FormInput', () => ({
  __esModule: true,
  default: require('react-native').TextInput,
}));
jest.mock('../../src/components/ui/Switch', () => ({
  __esModule: true,
  default: require('react-native').Switch,
}));
jest.mock('../../src/utils/dateUtils', () => ({
  getTodayDate: () => '2026-11-15',
}));
jest.mock('../../src/components/glp1/OptionalDateField', () => ({
  __esModule: true,
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => {
    const { TextInput } = require('react-native');
    return (
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
      />
    );
  },
}));
jest.mock('../../src/components/BottomSheetPicker', () => ({
  __esModule: true,
  default: ({
    options,
    onSelect,
  }: {
    options: { value: string; label: string }[];
    onSelect: (v: string) => void;
  }) => {
    const { View, Pressable, Text } = require('react-native');
    return (
      <View>
        {options.map((option) => (
          <Pressable key={option.value} onPress={() => onSelect(option.value)}>
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  },
}));
const data: MedicationPurchaseEditorData = {
  medications: [{ id: med, name: 'Example medication' }],
  vials: [
    {
      id: vial,
      medication_id: med,
      medication_name: 'Example medication',
      label: 'Vial A',
      status: 'finished',
      lot_number: null,
      expiry_date: null,
      purchase_item_id: null,
    },
    {
      id: second,
      medication_id: med,
      medication_name: 'Example medication',
      label: 'Vial B',
      status: 'discarded',
      lot_number: null,
      expiry_date: null,
      purchase_item_id: null,
    },
    {
      id: 'foreign',
      medication_id: 'other-med',
      medication_name: 'Other medication',
      label: 'Foreign vial',
      status: 'sealed',
      lot_number: null,
      expiry_date: null,
      purchase_item_id: null,
    },
    {
      id: 'claimed',
      medication_id: med,
      medication_name: 'Example medication',
      label: 'Claimed vial',
      status: 'sealed',
      lot_number: null,
      expiry_date: null,
      purchase_item_id: 'different-item',
    },
  ],
};
const initial: MedicationPurchaseView = {
  id: 'invoice',
  revision: 2,
  created_at: '',
  vendor: 'Example supplier',
  reference: 'order',
  ordered_date: '2026-11-15',
  received_date: null,
  currency: 'AUD',
  shipping_cost: '0',
  tax_cost: '0',
  other_fees: '0',
  discount: '0',
  allocation_method: 'value',
  notes: null,
  items: [
    {
      id: lineId,
      kind: 'medication',
      medication_id: med,
      medication_name: 'Example medication',
      description: 'Original vial line',
      quantity: 1,
      unit_cost: '1',
      units_per_pack: null,
      units_per_dose: null,
      vial_ids: [],
      subtotal: '1',
      allocated: '0',
      landed: '1',
      landed_unit: '1',
    },
  ],
  totals: {
    lines: [],
    subtotal: '1',
    overhead: '0',
    total: '1',
    unallocated: '0',
    effective_method: 'value',
  },
  vials_expected: 1,
  vials_linked: 0,
};
const setup = (invoice?: MedicationPurchaseView) => {
  const close = jest.fn(),
    reload = jest.fn();
  return {
    view: render(
      <MedicationPurchaseEditor
        ownerId={owner}
        initial={invoice}
        data={data}
        isScopeCurrent={() => mockCurrent}
        onClose={close}
        onReload={reload}
      />
    ),
    close,
    reload,
  };
};
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent = true;
});
test('new invoice keeps exact prices and permits source overmatching across retired vials without duplicate submission', () => {
  const { view } = setup();
  fireEvent.changeText(
    view.getByLabelText('Unit cost'),
    '0.123456789012345678901'
  );
  fireEvent.changeText(view.getByLabelText('Shipping'), '1.01');
  expect(view.queryByText('Foreign vial')).toBeNull();
  expect(view.queryByText('Claimed vial')).toBeNull();
  fireEvent(view.getByLabelText('Vial A · finished'), 'valueChange', true);
  fireEvent(view.getByLabelText('Vial B · discarded'), 'valueChange', true);
  expect(view.getByText(/^More vials are matched/)).toBeTruthy();
  act(() => {
    mockSave();
    mockSave();
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const body = mockCreate.mock.calls[0][0];
  expect(body).toEqual(
    expect.objectContaining({
      expected_owner_id: owner,
      operation_id: expect.any(String),
      currency: 'AUD',
      shipping_cost: '1.01',
    })
  );
  expect(body.items[0]).toEqual(
    expect.objectContaining({
      unit_cost: '0.123456789012345678901',
      quantity: 1,
      vial_ids: [vial, second],
    })
  );
});
test('uncertain create locks the draft and retry pins the identical operation and payload', () => {
  const { view } = setup();
  fireEvent.changeText(
    view.getByLabelText('Unit cost'),
    '1.234567890123456789'
  );
  act(() => mockSave());
  const first = mockCreate.mock.calls[0][0];
  act(() => {
    mockCreate.mock.calls[0][1].onError(new Error('lost response'));
    mockCreate.mock.calls[0][1].onSettled();
  });
  expect(view.getByLabelText('Unit cost').props.editable).toBe(false);
  fireEvent.changeText(view.getByLabelText('Unit cost'), '999');
  act(() => mockSave());
  expect(mockCreate.mock.calls[1][0]).toEqual(first);
});
test('stale edited invoice requires explicit reload and always sends owner plus original revision', () => {
  const { view, reload } = setup(initial);
  fireEvent.changeText(view.getByLabelText('Unit cost'), '2');
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body).toEqual(
    expect.objectContaining({ expected_owner_id: owner, expected_revision: 2 })
  );
  act(() => {
    mockUpdate.mock.calls[0][1].onError(new ApiError('stale', 409));
    mockUpdate.mock.calls[0][1].onSettled();
    mockSave();
  });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('Reload invoice'));
  expect(reload).toHaveBeenCalledTimes(1);
});
test('orphan medication line retains its identity and description while financial fields stay editable', () => {
  const { view } = setup({
    ...initial,
    items: [
      { ...initial.items[0]!, medication_id: null, medication_name: null },
    ],
  });
  expect(view.getByText(/^Medication removed/)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Unit cost'), '3.40');
  act(() => mockSave());
  expect(mockUpdate.mock.calls[0][0].body.items[0]).toEqual(
    expect.objectContaining({
      id: lineId,
      medication_id: null,
      description: 'Original vial line',
      unit_cost: '3.4',
    })
  );
});
test('blank consumable description is kept for correction, and named zero-cost consumable is a real invoice line', () => {
  const { view } = setup();
  fireEvent.press(view.getByText('Add consumable line'));
  fireEvent.press(view.getByText('Remove line 1'));
  fireEvent.changeText(view.getByLabelText('Unit cost'), '0');
  act(() => mockSave());
  expect(mockCreate).not.toHaveBeenCalled();
  expect(
    view.getByText(
      'Enter a description for each consumable line, or remove the unused line.'
    )
  ).toBeTruthy();
  fireEvent.changeText(
    view.getByLabelText('Description'),
    'Example needle pack'
  );
  act(() => mockSave());
  expect(mockCreate.mock.calls[0][0].items).toEqual([
    expect.objectContaining({
      kind: 'consumable',
      description: 'Example needle pack',
      unit_cost: '0',
      quantity: 1,
      category: 'needle',
    }),
  ]);
});
test('account change prevents a draft from being submitted or publishing a pending result', () => {
  const { close } = setup();
  act(() => mockSave());
  mockCurrent = false;
  act(() => {
    mockCreate.mock.calls[0][1].onSuccess();
    mockCreate.mock.calls[0][1].onSettled();
    mockSave();
  });
  expect(close).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('an existing same-invoice vial can be unticked from line A and moved to line B in one PATCH', () => {
  const otherLine = '66666666-6666-4666-8666-666666666666';
  const invoice = {
    ...initial,
    items: [
      { ...initial.items[0]!, vial_ids: [vial] },
      {
        ...initial.items[0]!,
        id: otherLine,
        description: 'Second line',
        vial_ids: [],
      },
    ],
  };
  const editorData = {
    ...data,
    vials: [{ ...data.vials[0]!, purchase_item_id: lineId }],
  };
  const view = render(
    <MedicationPurchaseEditor
      ownerId={owner}
      initial={invoice}
      data={editorData}
      isScopeCurrent={() => true}
      onClose={jest.fn()}
      onReload={jest.fn()}
    />
  );
  expect(view.getAllByLabelText('Vial A · finished')).toHaveLength(1);
  fireEvent(view.getByLabelText('Vial A · finished'), 'valueChange', false);
  expect(view.getAllByLabelText('Vial A · finished')).toHaveLength(2);
  fireEvent(
    view.getAllByLabelText('Vial A · finished')[1]!,
    'valueChange',
    true
  );
  act(() => mockSave());
  expect(
    mockUpdate.mock.calls[0][0].body.items.map(
      (item: { vial_ids: string[] }) => item.vial_ids
    )
  ).toEqual([[], [vial]]);
});
test('definite prewrite validation rejection unlocks fields while preserving the entered financial row', () => {
  const { view } = setup();
  fireEvent.changeText(
    view.getByLabelText('Unit cost'),
    '1.234567890123456789'
  );
  act(() => mockSave());
  act(() => {
    mockCreate.mock.calls[0][1].onError(new ApiError('validation', 400));
    mockCreate.mock.calls[0][1].onSettled();
  });
  expect(view.getByLabelText('Unit cost').props.editable).toBe(true);
  expect(view.getByLabelText('Unit cost').props.value).toBe(
    '1.234567890123456789'
  );
});

test.each([401, 403])(
  'a later %s after an uncertain create cannot unlock or replace the original operation',
  (status) => {
    const { view } = setup();
    fireEvent.changeText(
      view.getByLabelText('Unit cost'),
      '1.234567890123456789'
    );
    act(() => mockSave());
    const body = mockCreate.mock.calls[0][0];
    act(() => {
      mockCreate.mock.calls[0][1].onError(new Error('response lost'));
      mockCreate.mock.calls[0][1].onSettled();
    });
    act(() => mockSave());
    act(() => {
      mockCreate.mock.calls[1][1].onError(
        new ApiError('not authorized', status)
      );
      mockCreate.mock.calls[1][1].onSettled();
    });
    expect(view.getByLabelText('Unit cost').props.editable).toBe(false);
    fireEvent.changeText(view.getByLabelText('Unit cost'), '999');
    act(() => mockSave());
    expect(mockCreate.mock.calls[1][0]).toEqual(body);
    expect(mockCreate.mock.calls[2][0]).toEqual(body);
  }
);

test('same-label vials retain known saved preparation mass and legacy unknown gets no invented mass', () => {
  const shared = {
    ...data.vials[0]!,
    label: 'Same vial',
    lot_number: 'Same lot',
    status: 'sealed',
    expiry_date: '2027-01-01',
  };
  const editorData = {
    ...data,
    vials: [
      { ...shared, id: vial, prepared_mass_mg: '10' },
      { ...shared, id: second, prepared_mass_mg: '20' },
      {
        ...shared,
        id: '77777777-7777-4777-8777-777777777777',
        prepared_mass_mg: null,
      },
    ],
  };
  const view = render(
    <MedicationPurchaseEditor
      ownerId={owner}
      data={editorData}
      isScopeCurrent={() => true}
      onClose={jest.fn()}
      onReload={jest.fn()}
    />
  );
  const ten =
      'Same vial · Prepared content: 10 mg · sealed · Same lot · 2027-01-01',
    twenty =
      'Same vial · Prepared content: 20 mg · sealed · Same lot · 2027-01-01',
    legacy = 'Same vial · sealed · Same lot · 2027-01-01';
  expect(view.getByLabelText(ten)).toBeTruthy();
  expect(view.getByLabelText(twenty)).toBeTruthy();
  expect(view.getByLabelText(legacy)).toBeTruthy();
  expect(view.getAllByText(/Prepared content:/)).toHaveLength(2);
  fireEvent(view.getByLabelText(twenty), 'valueChange', true);
  act(() => mockSave());
  expect(mockCreate.mock.calls[0][0].items[0].vial_ids).toEqual([second]);
});

test('explicit vial label is preferred over preparation content, while null labels retain prepared or human fallback', () => {
  const common = {
    ...data.vials[0]!,
    label: 'Same vial',
    lot_number: 'Same lot',
    status: 'sealed',
    expiry_date: '2027-01-01',
  };
  const editorData = {
    ...data,
    vials: [
      {
        ...common,
        id: vial,
        label_mass_mg: '10.123456789012345678901',
        prepared_mass_mg: '20',
      },
      { ...common, id: second, label_mass_mg: null, prepared_mass_mg: '20' },
      {
        ...common,
        id: '77777777-7777-4777-8777-777777777777',
        label_mass_mg: null,
        prepared_mass_mg: null,
      },
    ],
  };
  const view = render(
    <MedicationPurchaseEditor
      ownerId={owner}
      data={editorData}
      isScopeCurrent={() => true}
      onClose={jest.fn()}
      onReload={jest.fn()}
    />
  );
  const explicit =
    'Same vial · Vial label amount: 10.123456789012345678901 mg · sealed · Same lot · 2027-01-01';
  expect(view.getByLabelText(explicit)).toBeTruthy();
  expect(
    view.getByLabelText(
      'Same vial · Prepared content: 20 mg · sealed · Same lot · 2027-01-01'
    )
  ).toBeTruthy();
  expect(
    view.getByLabelText('Same vial · sealed · Same lot · 2027-01-01')
  ).toBeTruthy();
  fireEvent(view.getByLabelText(explicit), 'valueChange', true);
  act(() => mockSave());
  expect(mockCreate.mock.calls[0][0].items[0].vial_ids).toEqual([vial]);
});
