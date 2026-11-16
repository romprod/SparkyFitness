import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  computeDraw,
  normalizeDeviceDose,
  type CalculatedDrawInput,
  type MedicationPen,
  type MedicationSyringe,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import Glp1LogInjection from '@/pages/Medications/Glp1LogInjection';
let mockCourseCurrent = true;
let mockCourseSlots: Record<string, unknown>[] = [];
let mockFulfilled: Record<string, unknown>[] = [];
const mockCourseRefresh = jest.fn(async () => ({
  data: { slots: mockCourseSlots, fulfilled_slots: mockFulfilled },
}));
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
  useMedicationCourses: () => ({
    scope: {
      key: 'owner',
      ownerId: 'owner',
      ready: true,
      canWrite: true,
      isCurrent: () => mockCourseCurrent,
    },
    data: { courses: [] },
    query: { refetch: jest.fn(async () => ({ data: { courses: [] } })) },
  }),
  useMedicationCourseDue: () => ({ query: { refetch: mockCourseRefresh } }),
}));
const mockLog = jest.fn();
const mockPreview = jest.fn();
let mockPens: Partial<MedicationPen>[] = [];
let mockDefault: string | null = 'syringe';
let mockFetching = false;
let mockTimezone = 'Europe/London';
let mockSyringes: Partial<MedicationSyringe>[] = [];
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({
    data: mockPens,
    refetch: jest.fn(async () => ({ data: mockPens })),
  }),
  useLogInjectionMutation: () => ({ mutate: mockLog, isPending: false }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    refetch: jest.fn(async () => ({})),
    data: {
      syringes: mockSyringes,
      default_syringe_id: mockDefault,
    },
  }),
  useMedicationDrawPreview: (
    pen: string | null,
    input: CalculatedDrawInput | null
  ) => mockPreview(pen, input),
}));
jest.mock('@/hooks/useInjectionSiteSelection', () => ({
  useInjectionSiteSelection: () => ({
    sitesQ: { data: { restDays: 7 } },
    site: 'abdomen_left',
    setSelectedSite: jest.fn(),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: mockTimezone }),
}));
jest.mock('@/pages/Medications/InjectionSitePicker', () => ({
  __esModule: true,
  default: () => <p>Site picker</p>,
}));
jest.mock('@/pages/Medications/InjectionSiteSettings', () => ({
  __esModule: true,
  default: () => <button>Customize sites</button>,
}));
jest.mock('@/pages/Medications/MedicationSyringeSettings', () => ({
  __esModule: true,
  default: () => <button>Manage syringes</button>,
}));
const syringe = {
  name: 'Synthetic U100',
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
};
const medication = {
  id: 'med',
  type_id: 'injection',
  dose_amount: 0.6,
  dose_unit: 'mg',
} as Medication;
const prep = {
  id: 'prep',
  mode: 'reconstituted' as const,
  mass_value: 12,
  mass_unit: 'mg' as const,
  final_volume_ml: 3,
  prepared_date: '2026-11-15',
  mass_mg: 12,
  concentration_mg_ml: 4,
  created_at: '2026-11-15T00:00:00Z',
};
beforeEach(() => {
  mockLog.mockClear();
  mockCourseCurrent = true;
  mockCourseSlots = [];
  mockFulfilled = [];
  mockCourseRefresh.mockClear();
  mockTimezone = 'Europe/London';
  mockDefault = 'syringe';
  mockSyringes = [{ ...syringe, id: 'syringe' }];
  mockFetching = false;
  mockPens = [
    {
      id: 'vial',
      kind: 'vial',
      status: 'in_use',
      preparation: prep,
      stock: {
        totalMg: 12,
        usedMg: 0,
        remainingMg: 12,
        remainingMl: 3,
        overdrawnMg: 0,
      },
    },
  ];
  mockPreview.mockImplementation(
    (_pen: string | null, input: CalculatedDrawInput | null) => {
      try {
        const device = {
          ...syringe,
          ...mockSyringes.find((row) => row.id === input?.syringe_id),
        };
        return {
          data: input
            ? {
                ...computeDraw({
                  dose: normalizeDeviceDose(input.dose, device),
                  concentrationMcgPerMl: '4000',
                  syringe: device,
                  remainingMl: String(mockPens[0]?.stock?.remainingMl ?? 3),
                }),
                syringeCapacityMl: syringe.capacity_ml,
              }
            : undefined,
          isFetching: mockFetching,
          isError: false,
          refetch: jest.fn(async () => ({})),
        };
      } catch {
        return { data: undefined, isFetching: false, isError: true };
      }
    }
  );
});
const button = () => screen.getByRole('button', { name: /Log injection —/ });
it('submits the chosen syringe and original decimal input while the server derives dose', () => {
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByText('Measurable marking: 15 units')).toBeInTheDocument();
  expect(screen.getAllByText('600 mcg · 0.15 mL')).toHaveLength(2);
  fireEvent.click(button());
  expect(mockLog).toHaveBeenCalledWith(
    expect.objectContaining({
      pen_id: 'vial',
      deduct_pen: true,
      calculated_draw: {
        syringe_id: 'syringe',
        dose: { value: '0.6', unit: 'mg' },
      },
    }),
    expect.anything()
  );
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('dose_mg');
});
it('retains the explicit manual dose path', async () => {
  mockDefault = null;
  render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Device'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Manual dose (mg)' })
  );
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.6' },
  });
  fireEvent.click(button());
  expect(mockLog.mock.calls[0][0]).toEqual(
    expect.objectContaining({ dose_mg: 0.6, pen_id: 'vial' })
  );
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('calculated_draw');
});
it('blocks a target volume larger than syringe capacity', () => {
  render(<Glp1LogInjection med={medication} />);
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '8' },
  });
  expect(screen.getByText(/Synthetic U100 holds 1 mL/)).toBeInTheDocument();
  expect(button()).toBeDisabled();
});
it('blocks a target volume larger than known vial stock', () => {
  mockPens[0]!.stock!.remainingMl = 0.1;
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByText(/vial balance: 0.1 mL/)).toBeInTheDocument();
  expect(button()).toBeDisabled();
});
it('allows positive inputs rounded to zero delivery with warnings', () => {
  render(<Glp1LogInjection med={medication} />);
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.001' },
  });
  expect(screen.getByText('Measurable marking: 0 units')).toBeInTheDocument();
  expect(
    screen.getByText(/below the 2-unit measurement threshold/)
  ).toBeInTheDocument();
  expect(screen.getByText(/The nearest graduation gives/)).toBeInTheDocument();
  expect(button()).toBeEnabled();
});
it('allows an exactly full barrel with its warning', () => {
  render(<Glp1LogInjection med={medication} />);
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '4' },
  });
  expect(screen.getByText(/reaches the capacity/)).toBeInTheDocument();
  expect(button()).toBeEnabled();
});
it.each(['0', '-1', 'invalid'])(
  'does not submit invalid source-form input %s',
  (value) => {
    render(<Glp1LogInjection med={medication} />);
    fireEvent.change(screen.getByLabelText('Entered amount'), {
      target: { value },
    });
    expect(button()).toBeDisabled();
  }
);
it('does not submit a stale result while the new preview is loading', () => {
  mockFetching = true;
  render(<Glp1LogInjection med={medication} />);
  expect(button()).toBeDisabled();
});
it('supports mL input without changing its decimal text', async () => {
  render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Amount unit'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'mL' }));
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.1200' },
  });
  fireEvent.click(button());
  expect(mockLog.mock.calls[0][0].calculated_draw.dose).toEqual({
    value: '0.1200',
    unit: 'ml',
  });
});
it('excludes finished and discarded vials from deduction choices', async () => {
  mockPens.push({
    id: 'closed',
    kind: 'vial',
    status: 'discarded',
    label: 'Closed vial',
  });
  render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Deduct from pen/vial'), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findAllByRole('option')).toHaveLength(2);
});
it('clears 500 mcg when switching from calculated input to manual mg', async () => {
  render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Amount unit'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'mcg' }));
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '500' },
  });
  fireEvent.pointerDown(screen.getByLabelText('Device'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Manual dose (mg)' })
  );
  expect(screen.getByLabelText('Dose (mg)')).toHaveValue('');
  expect(button()).toBeDisabled();
});
it('uses a known legacy concentration without inventing preparation details', () => {
  mockPens[0]!.preparation = null;
  mockPens[0]!.concentration_mg_ml = 4;
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByText('Measurable marking: 15 units')).toBeInTheDocument();
  expect(button()).toBeEnabled();
});
it('does not silently replace explicitly selected stock after it is retired', async () => {
  mockDefault = null;
  mockPens.push({
    id: 'second',
    kind: 'vial',
    status: 'in_use',
    label: 'Second',
  });
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Deduct from pen/vial'), {
    button: 0,
    ctrlKey: false,
  });
  const options = await screen.findAllByRole('option');
  fireEvent.click(options[2]!);
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.6' },
  });
  mockPens[1]!.status = 'discarded';
  rerender(<Glp1LogInjection med={medication} />);
  expect(
    screen.getByText(/selected stock is no longer active/)
  ).toBeInTheDocument();
  expect(button()).toBeDisabled();
});

it('automatically shows the first saved syringe and preview without a preferred device or dropdown interaction', () => {
  mockDefault = null;
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Device')).toHaveTextContent('Synthetic U100');
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to 15 units' })
  ).toBeInTheDocument();
  const preview = screen.getByText('Measurable marking: 15 units');
  expect(
    preview.compareDocumentPosition(screen.getByText('Site picker')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});
it('uses the first available device when the preferred device no longer exists', () => {
  mockDefault = 'deleted';
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Device')).toHaveTextContent('Synthetic U100');
});
it('does not invent a device when none have been configured', () => {
  mockSyringes = [];
  mockDefault = null;
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Device')).toHaveTextContent('Manual dose (mg)');
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to —' })
  ).toBeInTheDocument();
});
it('clears a mcg draft and keeps an empty figure on implicit device replacement', async () => {
  mockDefault = null;
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Amount unit'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'mcg' }));
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '500' },
  });
  mockSyringes = [
    { ...syringe, id: 'replacement', name: 'Replacement syringe' },
  ];
  rerender(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Entered amount')).toHaveValue('');
  expect(screen.getByLabelText('Amount unit')).toHaveTextContent('mg');
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to —' })
  ).toBeInTheDocument();
  expect(button()).toBeDisabled();
});
it('keeps explicit manual mode when the preferred syringe changes', async () => {
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Device'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Manual dose (mg)' })
  );
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.4' },
  });
  mockDefault = null;
  rerender(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Dose (mg)')).toHaveValue('0.4');
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to —' })
  ).toBeInTheDocument();
});

it('does not request or draw a device after an explicitly selected syringe is deleted', async () => {
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Device'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Manual dose (mg)' })
  );
  fireEvent.pointerDown(screen.getByLabelText('Device'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole('option', { name: 'Synthetic U100' })
  );
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.6' },
  });
  mockSyringes = [];
  rerender(<Glp1LogInjection med={medication} />);
  expect(
    screen.getByText(/selected syringe is no longer available/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to —' })
  ).toBeInTheDocument();
  expect(mockPreview.mock.calls.at(-1)?.[1]).toBeNull();
  expect(button()).toBeDisabled();
  expect(screen.getByLabelText('Entered amount')).toHaveValue('');
});
it('clears the amount when an automatically selected vial changes', () => {
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.8' },
  });
  mockPens = [{ ...mockPens[0], id: 'new-vial' }];
  rerender(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Entered amount')).toHaveValue('');
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
});
it('clears a units draft when the same selected device calibration changes', async () => {
  const { rerender } = render(<Glp1LogInjection med={medication} />);
  fireEvent.pointerDown(screen.getByLabelText('Amount unit'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('option', { name: 'units' }));
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '20' },
  });
  mockSyringes = [
    { ...syringe, id: 'syringe', units_per_ml: 50, capacity_units: 50 },
  ];
  rerender(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Entered amount')).toHaveValue('');
  expect(screen.getByLabelText('Amount unit')).toHaveTextContent('mg');
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
});

it('uses a prepared nasal vial and eligible pump without body or site controls', () => {
  const pump = {
    ...syringe,
    id: 'pump',
    device_type: 'pump' as const,
    graduation_type: 'ml' as const,
    increment: '0.1',
  };
  mockSyringes = [{ ...syringe, id: 'injection-device' }, pump];
  mockDefault = 'injection-device';
  render(
    <Glp1LogInjection
      med={{ ...medication, type_id: 'nasal_spray', route_id: 'nasal' }}
    />
  );
  expect(screen.getByLabelText('Device')).toHaveTextContent('Synthetic U100');
  expect(screen.getByLabelText('Amount unit')).toHaveTextContent('pumps');
  expect(screen.getByLabelText('Entered amount')).toHaveValue('1');
  expect(mockPreview.mock.calls.at(-1)?.[1]).toMatchObject({
    syringe_id: 'pump',
    dose: { value: '1', unit: 'pumps' },
  });
  expect(screen.queryByText('Site picker')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Log nasal dose' }));
  expect(mockLog.mock.calls[0][0]).toMatchObject({
    site: null,
    pen_id: 'vial',
    deduct_pen: true,
    calculated_draw: {
      syringe_id: 'pump',
      dose: { value: '1', unit: 'pumps' },
    },
  });
});
it('does not invent a pump or use manual injection logging for an unprepared nasal medication', () => {
  mockSyringes = [];
  mockPens = [];
  render(
    <Glp1LogInjection
      med={{ ...medication, type_id: 'nasal_spray', route_id: 'nasal' }}
    />
  );
  expect(
    screen.getByRole('img', { name: 'Nasal pump: —' })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Log nasal dose' })).toBeDisabled();
  expect(mockPreview.mock.calls.at(-1)?.[1]).toBeNull();
});

describe('new injection date and time', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-10T23:45:30.456Z'));
  });
  afterEach(() => jest.useRealTimers());

  const dateInput = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;

  it('starts at the current local clock time rather than the UTC calendar day', () => {
    const { container } = render(<Glp1LogInjection med={medication} />);
    expect(dateInput(container)).toHaveValue('2026-07-11T00:45');
    fireEvent.click(button());
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ injected_at: '2026-07-10T23:45:30.456Z' }),
      expect.anything()
    );
  });

  it('keeps an explicitly edited time through rerenders and starts a new medication at now', () => {
    const { container, rerender } = render(
      <Glp1LogInjection med={medication} />
    );
    fireEvent.change(dateInput(container), {
      target: { value: '2026-07-09T09:15' },
    });
    jest.setSystemTime(new Date('2026-07-12T12:30:00Z'));
    rerender(<Glp1LogInjection med={medication} />);
    expect(dateInput(container)).toHaveValue('2026-07-09T09:15');
    fireEvent.click(button());
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ injected_at: '2026-07-09T08:15:00.000Z' }),
      expect.anything()
    );
    rerender(<Glp1LogInjection med={{ ...medication, id: 'another-med' }} />);
    expect(dateInput(container)).toHaveValue('2026-07-12T13:30');
  });

  it('uses a fresh current time on reopening and after successful logging', () => {
    const first = render(<Glp1LogInjection med={medication} />);
    first.unmount();
    jest.setSystemTime(new Date('2026-07-12T12:30:00Z'));
    const { container } = render(<Glp1LogInjection med={medication} />);
    expect(dateInput(container)).toHaveValue('2026-07-12T13:30');
    fireEvent.click(button());
    jest.setSystemTime(new Date('2026-07-12T13:40:00Z'));
    act(() => mockLog.mock.calls[0][1].onSuccess());
    expect(dateInput(container)).toHaveValue('2026-07-12T14:40');
  });
});

it('reformats an untouched current-time default when saved timezone preferences load', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-07-10T23:45:30.456Z'));
  mockTimezone = 'UTC';
  const { container, rerender } = render(<Glp1LogInjection med={medication} />);
  const input = () =>
    container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  expect(input()).toHaveValue('2026-07-10T23:45');
  mockTimezone = 'Asia/Tokyo';
  rerender(<Glp1LogInjection med={medication} />);
  expect(input()).toHaveValue('2026-07-11T08:45');
  fireEvent.click(button());
  expect(mockLog).toHaveBeenCalledWith(
    expect.objectContaining({ injected_at: '2026-07-10T23:45:30.456Z' }),
    expect.anything()
  );
  jest.useRealTimers();
});

it('keeps an explicitly entered datetime and its zone when preferences change', () => {
  mockTimezone = 'UTC';
  const { container, rerender } = render(<Glp1LogInjection med={medication} />);
  const input = () =>
    container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  fireEvent.change(input(), { target: { value: '2026-07-09T09:15' } });
  mockTimezone = 'Asia/Tokyo';
  rerender(<Glp1LogInjection med={medication} />);
  expect(input()).toHaveValue('2026-07-09T09:15');
  fireEvent.click(button());
  expect(mockLog).toHaveBeenCalledWith(
    expect.objectContaining({ injected_at: '2026-07-09T09:15:00.000Z' }),
    expect.anything()
  );
});

const courseContext = {
  course_revision_id: 'revision',
  course_rule_id: 'rule',
  course_step_id: null,
  course_slot_key: 'slot',
  course_expected_version: 1,
  scheduled_day: '2026-11-01',
  scheduled_for: '2026-11-01T09:00:00Z',
};
const managedMed = { ...medication, user_id: 'owner' };
it('keeps managed unknown actual blank and the syringe graphic visible with no saved device', () => {
  mockPens = [];
  mockSyringes = [];
  render(
    <Glp1LogInjection
      med={managedMed}
      courseContext={courseContext}
      plannedDose={null}
    />
  );
  expect(screen.getByLabelText('Dose (mg)')).toHaveValue('');
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
  expect(screen.getByText(/Planned dose: Unknown/)).toBeInTheDocument();
  expect(button()).toBeDisabled();
  expect(mockLog).not.toHaveBeenCalled();
});
it('uses planned raw input only by explicit action through the current prepared draw, retaining stock and attribution', () => {
  render(
    <Glp1LogInjection
      med={managedMed}
      courseContext={courseContext}
      plannedDose={{ value: '500', unit: 'mcg' }}
    />
  );
  expect(screen.getByLabelText('Entered amount')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Use planned amount' }));
  expect(screen.getByLabelText('Entered amount')).toHaveValue('500');
  fireEvent.click(button());
  expect(mockLog).toHaveBeenCalledWith(
    expect.objectContaining({
      ...courseContext,
      calculated_draw: {
        syringe_id: 'syringe',
        dose: { value: '500', unit: 'mcg' },
      },
      pen_id: 'vial',
      deduct_pen: true,
    }),
    expect.anything()
  );
  expect(mockLog.mock.calls[0][0]).not.toHaveProperty('dose_mg');
});
it('preserves the captured autumn repeated-hour instant and seconds across preference reformat', () => {
  mockTimezone = 'Europe/London';
  const props = {
    med: managedMed,
    courseContext,
    plannedDose: null,
    initialTakenAt: '2026-10-25T01:30:45.678Z',
  };
  const { rerender } = render(<Glp1LogInjection {...props} />);
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.5' },
  });
  mockTimezone = 'Asia/Tokyo';
  rerender(<Glp1LogInjection {...props} />);
  fireEvent.click(button());
  expect(mockLog).toHaveBeenCalledWith(
    expect.objectContaining({
      injected_at: '2026-10-25T01:30:45.678Z',
      scheduled_for: '2026-11-01T09:00:00Z',
    }),
    expect.anything()
  );
});
it('stops stale scheduled injection retries until explicit canonical refresh while retaining actual draft', async () => {
  const { HttpApiError } = jest.requireActual(
    '@/api/api'
  ) as typeof import('@/api/api');
  render(
    <Glp1LogInjection
      med={managedMed}
      courseContext={courseContext}
      plannedDose={{ value: '500', unit: 'mcg' }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use planned amount' }));
  fireEvent.click(button());
  act(() => mockLog.mock.calls[0][1].onError(new HttpApiError('stale', 409)));
  expect(button()).toBeDisabled();
  expect(screen.getByLabelText('Entered amount')).toHaveValue('500');
  mockCourseSlots = [
    {
      ...courseContext,
      course_expected_version: 2,
      per_dose_amount: '0.7',
      dose_unit: 'mg',
    },
  ];
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Refresh course' }))
  );
  expect(screen.getByLabelText('Entered amount')).toHaveValue('500');
  expect(button()).toBeEnabled();
  expect(mockLog).toHaveBeenCalledTimes(1);
  fireEvent.click(button());
  expect(mockLog.mock.calls[1][0]).toMatchObject({
    course_expected_version: 2,
    calculated_draw: { dose: { value: '500', unit: 'mcg' } },
  });
});
