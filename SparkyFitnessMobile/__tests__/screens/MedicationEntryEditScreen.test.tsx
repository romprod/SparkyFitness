import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import MedicationEntryEditScreen from '../../src/screens/MedicationEntryEditScreen';
import { useUpdateMedicationEntry } from '../../src/hooks/useMedications';
import { useUpdateInjection } from '../../src/hooks/useGlp1';
import type { RootStackScreenProps } from '../../src/types/navigation';
import { pressAction } from './helpers/nativeHeaderTestUtils';
import { buildEntry } from '../helpers/medicationFixtures';

type ScreenProps = RootStackScreenProps<'MedicationEntryEdit'>;

const mockDrawPreview = jest.fn();
let mockTimezone = 'UTC';
let mockTimeSelection = '21:15';
jest.mock('../../src/hooks/useSyringes', () => ({
  useSyringeDrawPreview: (...args: unknown[]) => mockDrawPreview(...args),
}));
jest.mock('../../src/hooks/useMedications', () => ({
  useUpdateMedicationEntry: jest.fn(),
}));
jest.mock('../../src/hooks/useGlp1', () => ({
  useUpdateInjection: jest.fn(),
}));
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { time_format: 'HH:mm' } }),
}));
jest.mock('../../src/utils/dateUtils', () => ({
  ...jest.requireActual('../../src/utils/dateUtils'),
  getDeviceTimezone: () => mockTimezone,
}));
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));

jest.mock('../../src/components/BottomSheetPicker', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      options,
      onSelect,
      value,
    }: {
      options: { label: string; value: string }[];
      onSelect: (value: string) => void;
      value: string;
    }) => (
      <View>
        <Text>{`picker-value-${value}`}</Text>
        {options.map((o) => (
          <Pressable key={o.value} onPress={() => onSelect(o.value)}>
            <Text>{`opt-${o.value}`}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

jest.mock('../../src/components/TimeSheet', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  const MockTimeSheet = React.forwardRef(
    (
      { onSelectTime }: { onSelectTime: (time: string) => void },
      _ref: unknown
    ) => (
      <Pressable onPress={() => onSelectTime(mockTimeSelection)}>
        <Text>mock-time-sheet</Text>
      </Pressable>
    )
  );
  MockTimeSheet.displayName = 'MockTimeSheet';
  return { __esModule: true, default: MockTimeSheet };
});

const mockNavigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  dispatch: jest.fn(),
} as unknown as ScreenProps['navigation'];
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const updateEntryMutate = jest.fn();
const updateInjectionMutate = jest.fn();

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

function renderScreen(entry = buildEntry()) {
  const route: ScreenProps['route'] = {
    key: 'MedicationEntryEdit-key',
    name: 'MedicationEntryEdit',
    params: { entry },
  };
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <MedicationEntryEditScreen navigation={mockNavigation} route={route} />
    </SafeAreaProvider>
  );
}

describe('MedicationEntryEditScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTimezone = 'UTC';
    mockTimeSelection = '21:15';
    mockDrawPreview.mockReturnValue({
      data: {
        targetMassMcg: '200',
        targetVolumeMl: '0.2',
        rawUnits: '20',
        markingValue: '20',
        markingScale: 'units',
        deliveredMassMcg: '200',
        deliveredVolumeMl: '0.2',
        roundingErrorMcg: '0',
        warnings: [],
      },
      isFetching: false,
      isError: false,
    });
    (useUpdateMedicationEntry as jest.Mock).mockReturnValue({
      mutate: updateEntryMutate,
      isPending: false,
    });
    (useUpdateInjection as jest.Mock).mockReturnValue({
      mutate: updateInjectionMutate,
      isPending: false,
    });
  });

  it('starts from the logged dose', () => {
    const screen = renderScreen(
      buildEntry({ notes: 'with breakfast', status: 'skipped' })
    );
    expect(screen.getByText('Lisinopril')).toBeTruthy();
    expect(screen.getByText('08:00')).toBeTruthy();
    expect(screen.getByDisplayValue('with breakfast')).toBeTruthy();
    expect(screen.getByText('picker-value-skipped')).toBeTruthy();
  });

  it('saves a changed time, status and note on the same day', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText('mock-time-sheet'));
    fireEvent.press(screen.getByText('opt-skipped'));
    fireEvent.changeText(screen.getByDisplayValue(''), '  late  ');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateEntryMutate).toHaveBeenCalledWith(
      {
        id: 'entry-1',
        body: {
          taken_at: '2026-10-14T21:15:00.000Z',
          entry_date: '2026-10-14',
          notes: 'late',
          status: 'skipped',
        },
      },
      expect.any(Object)
    );
    expect(updateInjectionMutate).not.toHaveBeenCalled();
  });

  it('clears the note when it is emptied', () => {
    const screen = renderScreen(buildEntry({ notes: 'old' }));
    fireEvent.changeText(screen.getByDisplayValue('old'), '   ');
    pressAction(screen, mockNavigation, 'Save');
    expect(updateEntryMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ notes: null }),
      }),
      expect.any(Object)
    );
  });

  it('goes back and confirms once the change is saved', () => {
    updateEntryMutate.mockImplementation((_vars, options) =>
      options.onSuccess()
    );
    const screen = renderScreen();
    pressAction(screen, mockNavigation, 'Save');
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text1: 'Dose updated' })
    );
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('keeps the screen open and reports a failed save', () => {
    updateEntryMutate.mockImplementation((_vars, options) =>
      options.onError(new Error('boom'))
    );
    const screen = renderScreen();
    pressAction(screen, mockNavigation, 'Save');
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to save: boom');
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });

  it('does not offer a status change for an as-needed dose', () => {
    const screen = renderScreen(buildEntry({ status: 'prn_taken' }));
    expect(screen.queryByText('opt-skipped')).toBeNull();
    pressAction(screen, mockNavigation, 'Save');
    const body = updateEntryMutate.mock.calls[0]![0].body;
    expect(body).not.toHaveProperty('status');
  });

  it('edits an injection through the injection endpoint, with its site', () => {
    const screen = renderScreen(
      buildEntry({
        id: 'inj-1',
        entry_type: 'injection',
        site: 'stomach_upper_left',
        med_name_snapshot: 'Wegovy',
      })
    );
    expect(screen.getByText('picker-value-stomach_upper_left')).toBeTruthy();
    expect(screen.queryByText('opt-skipped')).toBeNull();

    fireEvent.press(screen.getByText('opt-stomach_upper_right'));
    fireEvent.press(screen.getByText('mock-time-sheet'));
    pressAction(screen, mockNavigation, 'Save');

    expect(updateInjectionMutate).toHaveBeenCalledWith(
      {
        id: 'inj-1',
        body: {
          injected_at: '2026-10-14T21:15:00.000Z',
          entry_date: '2026-10-14',
          site: 'stomach_upper_right',
          notes: null,
        },
      },
      expect.any(Object)
    );
    expect(updateEntryMutate).not.toHaveBeenCalled();
  });

  it('can clear an injection site', () => {
    const screen = renderScreen(
      buildEntry({ entry_type: 'injection', site: 'stomach_upper_left' })
    );
    fireEvent.press(screen.getByText('opt-none'));
    pressAction(screen, mockNavigation, 'Save');
    expect(updateInjectionMutate.mock.calls[0]![0].body.site).toBeNull();
  });
  it('previews a changed calculated mg dose with the original syringe and credited injection', () => {
    const screen = renderScreen(
      buildEntry({
        id: 'inj-1',
        entry_type: 'injection',
        pen_id: 'vial',
        syringe_id: 'syringe',
        volume_ml: '0.1',
        dose_input_unit: 'mg',
        dose_amount_snapshot: 0.1,
      })
    );
    fireEvent.changeText(screen.getByLabelText('Dose (mg)'), '0.2');
    expect(mockDrawPreview).toHaveBeenLastCalledWith('vial', {
      syringe_id: 'syringe',
      editing_injection_id: 'inj-1',
      dose: { value: '0.2', unit: 'mg' },
    });
    expect(screen.getByText('Measured marking: 20 Units')).toBeTruthy();
    pressAction(screen, mockNavigation, 'Save');
    expect(updateInjectionMutate.mock.calls[0]![0].body.dose_mg).toBe(0.2);
  });

  it('preserves calculated numeric snapshots when only metadata changes', () => {
    const screen = renderScreen(
      buildEntry({
        entry_type: 'injection',
        pen_id: 'vial',
        syringe_id: 'syringe',
        volume_ml: '0.1',
        dose_input_unit: 'mg',
        dose_amount_snapshot: 0.1,
      })
    );
    pressAction(screen, mockNavigation, 'Save');
    expect(mockDrawPreview).toHaveBeenLastCalledWith(null, null);
    expect(updateInjectionMutate.mock.calls[0]![0].body).not.toHaveProperty(
      'dose_mg'
    );
  });

  it('keeps a deleted-syringe calculated dose read-only while allowing metadata edits', () => {
    const screen = renderScreen(
      buildEntry({
        entry_type: 'injection',
        pen_id: 'vial',
        syringe_id: null,
        volume_ml: '0.1',
        dose_input_unit: 'mg',
        dose_amount_snapshot: 0.1,
      })
    );
    expect(screen.getByLabelText('Dose (mg)').props.editable).toBe(false);
    expect(
      screen.getByText(
        'The original syringe or vial is no longer available. The dose is read-only; other details can still be edited.'
      )
    ).toBeTruthy();
    pressAction(screen, mockNavigation, 'Save');
    expect(updateInjectionMutate).toHaveBeenCalledTimes(1);
    expect(updateInjectionMutate.mock.calls[0]![0].body).not.toHaveProperty(
      'dose_mg'
    );
  });

  it('blocks changed calculated dose saves while canonical preview is pending or blocked', () => {
    mockDrawPreview.mockReturnValue({
      data: undefined,
      isFetching: true,
      isError: false,
    });
    const screen = renderScreen(
      buildEntry({
        entry_type: 'injection',
        pen_id: 'vial',
        syringe_id: 'syringe',
        volume_ml: '0.1',
        dose_input_unit: 'mg',
        dose_amount_snapshot: 0.1,
      })
    );
    fireEvent.changeText(screen.getByLabelText('Dose (mg)'), '0.2');
    pressAction(screen, mockNavigation, 'Save');
    expect(updateInjectionMutate).not.toHaveBeenCalled();
  });
  it('shows a neutral figure for unchanged calculated zero or blank correction without inferring a saved marking', () => {
    const screen = renderScreen(
      buildEntry({
        entry_type: 'injection',
        pen_id: 'vial',
        syringe_id: 'syringe',
        volume_ml: '0',
        dose_input_unit: 'mg',
        dose_amount_snapshot: 0,
      })
    );
    expect(screen.getByText('Draw to —')).toBeTruthy();
    expect(screen.getByTestId('syringe-target-fill').props.width).toBe(0);
    expect(mockDrawPreview).toHaveBeenLastCalledWith(null, null);
    fireEvent.changeText(screen.getByLabelText('Dose (mg)'), '');
    expect(screen.getByText('Draw to —')).toBeTruthy();
    expect(screen.queryByText(/^Measured marking:/)).toBeNull();
  });
  it.each(['UTC', 'Asia/Tokyo'])(
    'notes-only edits preserve exact seconds and frozen day in %s for normal and injection entries',
    (zone) => {
      mockTimezone = zone;
      for (const entryType of ['entry', 'injection'] as const) {
        updateEntryMutate.mockClear();
        updateInjectionMutate.mockClear();
        const screen = renderScreen(
          buildEntry({
            entry_type: entryType,
            taken_at: '2026-10-14T23:30:45.678Z',
            entry_date: '2026-10-14',
            notes: 'Original note',
          })
        );
        fireEvent.changeText(
          screen.getByDisplayValue('Original note'),
          'Updated note'
        );
        pressAction(screen, mockNavigation, 'Save');
        const body = (
          entryType === 'injection' ? updateInjectionMutate : updateEntryMutate
        ).mock.calls[0]![0].body;
        expect(body.notes).toBe('Updated note');
        expect(body).not.toHaveProperty('injected_at');
        expect(body).not.toHaveProperty('taken_at');
        expect(body).not.toHaveProperty('entry_date');
        screen.unmount();
      }
    }
  );

  it.each(['site', 'dose'] as const)(
    '%s-only calculated injection edits preserve the original instant and calendar day',
    (change) => {
      mockTimezone = 'Asia/Tokyo';
      const screen = renderScreen(
        buildEntry({
          id: 'inj-1',
          entry_type: 'injection',
          taken_at: '2026-10-14T23:30:45.678Z',
          entry_date: '2026-10-14',
          site: 'stomach_upper_left',
          pen_id: 'vial',
          syringe_id: 'syringe',
          volume_ml: '0.1',
          dose_input_unit: 'mg',
          dose_amount_snapshot: 0.1,
        })
      );
      if (change === 'site')
        fireEvent.press(screen.getByText('opt-stomach_upper_right'));
      else fireEvent.changeText(screen.getByLabelText('Dose (mg)'), '0.2');
      pressAction(screen, mockNavigation, 'Save');
      const body = updateInjectionMutate.mock.calls[0]![0].body;
      expect(body).not.toHaveProperty('injected_at');
      expect(body).not.toHaveProperty('entry_date');
      if (change === 'dose') expect(body.dose_mg).toBe(0.2);
      else expect(body.site).toBe('stomach_upper_right');
    }
  );

  it.each([
    { zone: 'UTC', day: '2026-10-14', at: '2026-10-14T21:15:00.000Z' },
    { zone: 'Asia/Tokyo', day: '2026-10-15', at: '2026-10-15T12:15:00.000Z' },
  ])(
    'an intentional time selection uses the logged calendar day in $zone',
    ({ zone, day, at }) => {
      mockTimezone = zone;
      const screen = renderScreen(
        buildEntry({
          entry_type: 'injection',
          taken_at: '2026-10-14T23:30:45.678Z',
          entry_date: day,
        })
      );
      fireEvent.press(screen.getByText('mock-time-sheet'));
      pressAction(screen, mockNavigation, 'Save');
      expect(updateInjectionMutate.mock.calls[0]![0].body).toEqual(
        expect.objectContaining({ injected_at: at, entry_date: day })
      );
    }
  );
  it('confirming the displayed time without changing it preserves seconds and the frozen travel day', () => {
    mockTimezone = 'Asia/Tokyo';
    mockTimeSelection = '08:30';
    const screen = renderScreen(
      buildEntry({
        entry_type: 'injection',
        taken_at: '2026-10-14T23:30:45.678Z',
        entry_date: '2026-10-14',
      })
    );
    fireEvent.press(screen.getByText('mock-time-sheet'));
    pressAction(screen, mockNavigation, 'Save');
    expect(updateInjectionMutate.mock.calls[0]![0].body).not.toHaveProperty(
      'injected_at'
    );
    expect(updateInjectionMutate.mock.calls[0]![0].body).not.toHaveProperty(
      'entry_date'
    );
  });
});
