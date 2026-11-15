import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  computeDraw,
  normalizeDeviceDose,
  type DrawPreviewInput,
  type InjectionEntry,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import Glp1RecentInjections from '@/pages/Medications/Glp1RecentInjections';
const mockUpdate = jest.fn();
const mockPreview = jest.fn();
let mockEntries: InjectionEntry[] = [];
let mockTimezone = 'Europe/London';
let mockTimeFormat = 'HH:mm';
let mockFetching = false;
let mockState = 'synthetic-state';
jest.mock('@/hooks/useMedications', () => ({
  useMedicationInjections: () => ({ data: mockEntries }),
  useUpdateInjectionMutation: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteInjectionMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: { syringes: [{ ...syringe, id: 'original-syringe' }] },
  }),
  useMedicationDrawPreview: (
    pen: string | null,
    input: DrawPreviewInput | null
  ) => mockPreview(pen, input),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: mockTimezone,
    timeFormat: mockTimeFormat,
    formatDate: (date: string) => date,
  }),
}));
const medication = { id: 'med', type_id: 'injection' } as Medication;
const syringe = {
  name: 'Synthetic U100',
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
};
beforeEach(() => {
  mockUpdate.mockClear();
  mockTimezone = 'Europe/London';
  mockTimeFormat = 'HH:mm';
  mockFetching = false;
  mockState = 'synthetic-state';
  mockEntries = [
    {
      id: 'entry',
      medication_id: 'med',
      pen_id: 'vial',
      syringe_id: 'original-syringe',
      dose_input_unit: 'mg',
      dose_mg: 0.6,
      volume_ml: '0.15',
      syringe_units: '15',
      site: 'abdomen_left',
      notes: null,
      injected_at: '2026-11-15T12:00:00Z',
      entry_date: '2026-11-15',
    },
  ];
  mockPreview.mockImplementation(
    (_pen: string | null, input: DrawPreviewInput | null) => ({
      data: input
        ? {
            ...computeDraw({
              dose: normalizeDeviceDose(input.dose, syringe),
              concentrationMcgPerMl: '4000',
              syringe,
              remainingMl: '0.15',
            }),
            syringeCapacityMl: syringe.capacity_ml,
            review: {
              state: mockState,
              previous: { doseMg: '0.6', volumeMl: '0.15' },
              remainingBeforeMl: '0.15',
              remainingAfterMl: '0.05',
            },
          }
        : undefined,
      isFetching: mockFetching,
      isError: false,
    })
  );
});
function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
}
function open() {
  const result = render(<Glp1RecentInjections med={medication} />);
  fireEvent.click(
    screen.getByRole('button', { name: /Edit (injection entry|dose)/ })
  );
  return result;
}
it('omits unchanged dose on metadata edits, including when the original syringe was deleted', () => {
  mockEntries[0]!.syringe_id = null;
  open();
  expect(screen.getByLabelText('Entered amount')).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Corrected note' },
  });
  save();
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('dose_mg');
  expect(mockUpdate.mock.calls[0][0].body.notes).toBe('Corrected note');
});
it('previews a changed amount with the original injection credited in the server request', () => {
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.4' },
  });
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: 'original-syringe',
    editing_injection_id: 'entry',
    dose: { value: '0.4', unit: 'mg' },
  });
  expect(screen.getByText('Measurable marking: 10 units')).toBeInTheDocument();
  save();
  expect(mockUpdate.mock.calls[0][0].body.calculated_draw).toEqual({
    syringe_id: 'original-syringe',
    dose: { value: '0.4', unit: 'mg' },
    review_intent: true,
    expected_preview_state: 'synthetic-state',
  });
});
it('blocks an amount correction above credited known remaining stock', () => {
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.8' },
  });
  expect(screen.getByText(/vial balance: 0.15 mL/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
});
it('prevents clearing a calculated amount', () => {
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '' },
  });
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
});

it('preserves a fresh decimal target through preview and raw update', () => {
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.019999999999999999999' },
  });
  expect(mockPreview).toHaveBeenLastCalledWith(
    'vial',
    expect.objectContaining({
      dose: { value: '0.019999999999999999999', unit: 'mg' },
    })
  );
  expect(screen.getByText('Measurable marking: 0 units')).toBeInTheDocument();
  save();
  expect(mockUpdate.mock.calls[0][0].body.calculated_draw.dose).toEqual({
    value: '0.019999999999999999999',
    unit: 'mg',
  });
});

it('keeps a neutral figure for an unchanged calculated entry without reinterpreting its recorded dose', () => {
  open();
  expect(screen.getByText('Measurable marking: —')).toBeInTheDocument();
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
  expect(mockPreview).toHaveBeenLastCalledWith(null, null);
  save();
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('dose_mg');
});

it.each(['UTC', 'Asia/Tokyo'])(
  'preserves timestamp precision and frozen tracking day on notes-only edits in %s',
  (timezone) => {
    mockTimezone = timezone;
    mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
    mockEntries[0]!.entry_date = '2026-10-14';
    open();
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Metadata correction' },
    });
    save();
    expect(mockUpdate.mock.calls[0][0].body).toEqual({
      site: 'abdomen_left',
      notes: 'Metadata correction',
    });
  }
);

it('omits timestamp and frozen tracking day when only the site changes', () => {
  mockTimezone = 'Asia/Tokyo';
  mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
  mockEntries[0]!.entry_date = '2026-10-14';
  open();
  fireEvent.click(screen.getAllByRole('combobox').at(-1)!);
  fireEvent.click(screen.getByRole('option', { name: '—' }));
  save();
  expect(mockUpdate.mock.calls[0][0].body).toEqual({ site: null, notes: null });
});

it('omits timestamp and frozen tracking day on an amount-only correction', () => {
  mockTimezone = 'Asia/Tokyo';
  mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
  mockEntries[0]!.entry_date = '2026-10-14';
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.4' },
  });
  save();
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    site: 'abdomen_left',
    calculated_draw: {
      syringe_id: 'original-syringe',
      dose: { value: '0.4', unit: 'mg' },
      review_intent: true,
      expected_preview_state: 'synthetic-state',
    },
    notes: null,
  });
});

it.each(['HH:mm', 'h:mm A'])(
  'submits an explicitly edited clock segment with the selected %s clock format',
  (timeFormat) => {
    mockTimezone = 'Asia/Tokyo';
    mockTimeFormat = timeFormat;
    mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
    mockEntries[0]!.entry_date = '2026-10-14';
    open();
    const minute = screen.getByRole('spinbutton', { name: /minute/i });
    fireEvent.keyDown(minute, { key: 'ArrowUp' });
    save();
    expect(mockUpdate.mock.calls[0][0].body).toEqual({
      site: 'abdomen_left',
      injected_at: '2026-10-14T23:31:00.000Z',
      entry_date: '2026-10-15',
      notes: null,
    });
  }
);

it('submits a deliberately chosen native date/time and resets touch state on reopening', () => {
  mockTimezone = 'Asia/Tokyo';
  mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
  mockEntries[0]!.entry_date = '2026-10-14';
  open();
  const picker = document.querySelector<HTMLInputElement>(
    'input[type="datetime-local"][aria-hidden="true"]'
  )!;
  fireEvent.change(picker, { target: { value: '2026-10-16T18:45' } });
  save();
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    site: 'abdomen_left',
    injected_at: '2026-10-16T09:45:00.000Z',
    entry_date: '2026-10-16',
    notes: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(
    screen.getByRole('button', { name: /Edit (injection entry|dose)/ })
  );
  save();
  expect(mockUpdate.mock.calls[1][0].body).toEqual({
    site: 'abdomen_left',
    notes: null,
  });
});

it.each([
  ['mcg', '600'],
  ['mg', '0.6'],
  ['ml', '0.15'],
  ['units', '15'],
])(
  'seeds %s correction from the recorded delivered quantity without inventing a target',
  (unit, value) => {
    mockEntries[0]!.dose_input_unit = unit;
    open();
    expect(screen.getByLabelText('Entered amount')).toHaveValue(value);
    expect(screen.getByLabelText('Amount unit')).toHaveTextContent(
      unit === 'ml' ? 'mL' : unit
    );
    save();
    expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
      'calculated_draw'
    );
    expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('dose_mg');
  }
);
it('allows untouched metadata when the persisted physical quantity cannot seed an amount', () => {
  mockEntries[0]!.dose_input_unit = 'units';
  mockEntries[0]!.syringe_units = null;
  mockEntries[0]!.volume_ml = null;
  open();
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Metadata only' },
  });
  save();
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    site: 'abdomen_left',
    notes: 'Metadata only',
  });
});
it('uses additive exact delivered mass when the numeric compatibility field has lost precision', () => {
  mockEntries[0]!.dose_mg_exact = '0.6000000000000000000001';
  open();
  expect(screen.getByLabelText('Entered amount')).toHaveValue(
    '0.6000000000000000000001'
  );
  save();
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty(
    'calculated_draw'
  );
});
it('retains a raw target through Review and Back and confirms the current server review token', () => {
  open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.4000000000000000000001' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText('0.15 → 0.05 mL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Entered amount')).toHaveValue(
    '0.4000000000000000000001'
  );
  save();
  expect(mockUpdate.mock.calls[0][0].body.calculated_draw).toMatchObject({
    dose: { value: '0.4000000000000000000001', unit: 'mg' },
    expected_preview_state: 'synthetic-state',
    review_intent: true,
  });
});
it('keeps a known nasal history entry free of site controls even when the current medication route changes', () => {
  mockEntries[0]!.administration_route = 'nasal';
  open();
  expect(screen.getByText('Nasal dose')).toBeInTheDocument();
  expect(screen.queryByText('Injection site')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Preserve old site' },
  });
  save();
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    notes: 'Preserve old site',
  });
});
it('hides retained numeric review while a new authoritative preview is pending', () => {
  const { rerender } = open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText('0.15 → 0.05 mL')).toBeInTheDocument();
  mockFetching = true;
  rerender(<Glp1RecentInjections med={medication} />);
  expect(screen.queryByText('0.15 → 0.05 mL')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
});
it('pins the reviewed server state and requires review again if that state changes', () => {
  const { rerender } = open();
  fireEvent.change(screen.getByLabelText('Entered amount'), {
    target: { value: '0.4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  mockState = 'new-server-state';
  rerender(<Glp1RecentInjections med={medication} />);
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  expect(screen.queryByText('0.15 → 0.05 mL')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  save();
  expect(
    mockUpdate.mock.calls[0][0].body.calculated_draw.expected_preview_state
  ).toBe('new-server-state');
});
it('requires a valid explicitly edited date/time before Review without rewriting an untouched time', () => {
  open();
  const picker = document.querySelector<HTMLInputElement>(
    'input[type="datetime-local"][aria-hidden="true"]'
  )!;
  fireEvent.change(picker, { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
});
it('uses dose wording for an empty prepared nasal history', () => {
  mockEntries = [];
  render(
    <Glp1RecentInjections
      med={{ ...medication, type_id: 'nasal_spray', route_id: 'nasal' }}
    />
  );
  expect(screen.getByText('No doses logged yet.')).toBeInTheDocument();
  expect(
    screen.queryByText('No injections logged yet.')
  ).not.toBeInTheDocument();
});
