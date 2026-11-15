import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  computeDraw,
  type CalculatedDrawInput,
  type MedicationPen,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';
import Glp1LogInjection from '@/pages/Medications/Glp1LogInjection';
const mockLog = jest.fn();
const mockPreview = jest.fn();
let mockPens: Partial<MedicationPen>[] = [];
let mockDefault: string | null = 'syringe';
let mockFetching = false;
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({ data: mockPens }),
  useLogInjectionMutation: () => ({ mutate: mockLog, isPending: false }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: {
      syringes: [{ id: 'syringe', name: 'Synthetic U100' }],
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
  usePreferences: () => ({ timezone: 'Europe/London' }),
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
  mockDefault = 'syringe';
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
        return {
          data: input
            ? {
                ...computeDraw({
                  dose: input.dose,
                  concentrationMcgPerMl: '4000',
                  syringe,
                  remainingMl: String(mockPens[0]?.stock?.remainingMl ?? 3),
                }),
                syringeCapacityMl: syringe.capacity_ml,
              }
            : undefined,
          isFetching: mockFetching,
          isError: false,
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
it('retains the manual dose path when no syringe is selected', () => {
  mockDefault = null;
  render(<Glp1LogInjection med={medication} />);
  expect(screen.getByLabelText('Dose (mg)')).toHaveValue('0.6');
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
  fireEvent.pointerDown(screen.getByLabelText('Syringe'), {
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
