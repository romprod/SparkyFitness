import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  computeDraw,
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
jest.mock('@/hooks/useMedications', () => ({
  useMedicationInjections: () => ({ data: mockEntries }),
  useUpdateInjectionMutation: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteInjectionMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: { syringes: [{ id: 'original-syringe' }] },
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
const medication = { id: 'med' } as Medication;
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
              dose: input.dose,
              concentrationMcgPerMl: '4000',
              syringe,
              remainingMl: '0.15',
            }),
            syringeCapacityMl: syringe.capacity_ml,
          }
        : undefined,
      isFetching: false,
      isError: false,
    })
  );
});
function open() {
  const result = render(<Glp1RecentInjections med={medication} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit injection entry' }));
  return result;
}
it('omits unchanged dose on metadata edits, including when the original syringe was deleted', () => {
  mockEntries[0]!.syringe_id = null;
  open();
  expect(screen.getByLabelText('Dose (mg)')).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Corrected note' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body).not.toHaveProperty('dose_mg');
  expect(mockUpdate.mock.calls[0][0].body.notes).toBe('Corrected note');
});
it('previews a changed amount with the original injection credited in the server request', () => {
  open();
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.4' },
  });
  expect(mockPreview).toHaveBeenLastCalledWith('vial', {
    syringe_id: 'original-syringe',
    editing_injection_id: 'entry',
    dose: { value: '0.4', unit: 'mg' },
  });
  expect(screen.getByText('Measurable marking: 10 units')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body.dose_mg).toBe(0.4);
});
it('blocks an amount correction above credited known remaining stock', () => {
  open();
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.8' },
  });
  expect(screen.getByText(/vial balance: 0.15 mL/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
it('prevents clearing a calculated amount', () => {
  open();
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '' },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it('previews the same numeric-mg precision used by the existing update API', () => {
  open();
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.019999999999999999999' },
  });
  expect(mockPreview).toHaveBeenLastCalledWith(
    'vial',
    expect.objectContaining({ dose: { value: '0.02', unit: 'mg' } })
  );
  expect(screen.getByText('Measurable marking: 1 units')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body.dose_mg).toBe(0.02);
});

it('keeps a neutral figure for an unchanged calculated entry without reinterpreting its recorded dose', () => {
  open();
  expect(screen.getByText('Measurable marking: —')).toBeInTheDocument();
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
  expect(mockPreview).toHaveBeenLastCalledWith(null, null);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: '—' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body).toEqual({ site: null, notes: null });
});

it('omits timestamp and frozen tracking day on an amount-only correction', () => {
  mockTimezone = 'Asia/Tokyo';
  mockEntries[0]!.injected_at = '2026-10-14T23:30:45.678Z';
  mockEntries[0]!.entry_date = '2026-10-14';
  open();
  fireEvent.change(screen.getByLabelText('Dose (mg)'), {
    target: { value: '0.4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    site: 'abdomen_left',
    dose_mg: 0.4,
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[0][0].body).toEqual({
    site: 'abdomen_left',
    injected_at: '2026-10-16T09:45:00.000Z',
    entry_date: '2026-10-16',
    notes: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit injection entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockUpdate.mock.calls[1][0].body).toEqual({
    site: 'abdomen_left',
    notes: null,
  });
});
