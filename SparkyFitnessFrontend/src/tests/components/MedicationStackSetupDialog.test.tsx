import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MedicationStackSetupDialog from '@/pages/Medications/MedicationStackSetupDialog';
import { useSetupStackMutation } from '@/hooks/Medications/useMedicationStacks';
import { useMedications } from '@/hooks/useMedications';

jest.mock('@/hooks/Medications/useMedicationStacks', () => ({
  useSetupStackMutation: jest.fn(),
}));
jest.mock('@/hooks/useMedications', () => ({ useMedications: jest.fn() }));

const ids = ['00000000-0000-4000-b000-000000000001'];
const setup = (meds: { name: string; display_name?: string | null }[] = []) => {
  const mutate = jest.fn();
  jest.mocked(useSetupStackMutation).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetupStackMutation>);
  jest.mocked(useMedications).mockReturnValue({
    data: meds,
    isLoading: false,
  } as unknown as ReturnType<typeof useMedications>);
  const onClose = jest.fn();
  render(<MedicationStackSetupDialog onClose={onClose} />);
  return { mutate, onClose };
};
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fillFirstRow = () => {
  type('Stack name', ' Peptide stack ');
  type('Medicine name', 'Peptide A');
  type('Concentration', '5');
  fireEvent.change(screen.getByLabelText('Concentration unit'), {
    target: { value: 'mg/ml' },
  });
};

beforeAll(() => {
  if (!globalThis.crypto?.randomUUID)
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => ids[0] },
      configurable: true,
    });
});

it('starts with Pitstop defaults and updates the dose line as you type', () => {
  setup();
  expect(screen.getByLabelText('Vial volume (mL)')).toHaveValue('5');
  expect(screen.getByLabelText('Vials')).toHaveValue('1');
  expect(screen.getByLabelText('Dose volume (mL)')).toHaveValue('0.2');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  type('Concentration', '2500');
  expect(screen.getByRole('status')).toHaveTextContent(
    '0.2 mL → 500 mcg · 12.5 mg/vial'
  );
  type('Vial volume (mL)', '10');
  expect(screen.getByRole('status')).toHaveTextContent(
    '0.2 mL → 500 mcg · 25 mg/vial'
  );
  fireEvent.change(screen.getByLabelText('Concentration unit'), {
    target: { value: 'mg/ml' },
  });
  type('Concentration', '5');
  expect(screen.getByRole('status')).toHaveTextContent('0.2 mL → 1 mg ·');
});

it('shows the Pitstop validation wording and saves nothing', () => {
  const { mutate } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give the stack a name.');
  type('Stack name', 'Peptide stack');
  type('Medicine name', 'Peptide A');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Add at least one component with a concentration and positive dose.'
  );
  type('Concentration', '5');
  type('Vials', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Each component needs a whole vial quantity of 1 or more.'
  );
  expect(mutate).not.toHaveBeenCalled();
});

it('summarises what will be created, then sends the request on Create stack', () => {
  const { mutate } = setup();
  fillFirstRow();
  type('Vials', '3');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));

  expect(screen.getByText('Review before saving')).toBeInTheDocument();
  expect(
    screen.getByText(/Stack “Peptide stack” with 1 medicine/)
  ).toBeInTheDocument();
  expect(screen.getByText('(new injectable medicine)')).toBeInTheDocument();
  expect(
    screen.getByText(/3 premixed vials of 5 mL \(25 mg each\)/)
  ).toBeInTheDocument();
  expect(screen.getByText('Daily plan: 0.2 mL = 1 mg.')).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Create stack' }));
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate.mock.calls[0]![0]).toEqual({
    operation_id: expect.any(String),
    name: 'Peptide stack',
    notes: null,
    components: [
      {
        medication_name: 'Peptide A',
        concentration_value: 5,
        concentration_unit: 'mg/ml',
        vial_volume_ml: 5,
        quantity: 3,
        dose_volume_ml: 0.2,
      },
    ],
  });
});

it('says when a medicine already exists, ignoring case', () => {
  setup([{ name: 'peptide a' }]);
  fillFirstRow();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByText('(uses your existing medicine)')).toBeInTheDocument();
});

it('adds rows up to a limit and removes them', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add component' }));
  expect(screen.getByText('Component 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove component 2' }));
  expect(screen.queryByText('Component 2')).not.toBeInTheDocument();
});

it('builds a titration ramp from dose and day rows and sends it as steps', () => {
  const { mutate } = setup();
  fillFirstRow();
  type('Start date (optional)', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: '+ Titration ramp' }));
  type('Phase 1 dose', '250');
  type('Phase 1 days', '14');
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  type('Phase 2 dose', '500');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(
    screen.getByText('Daily plan with a 2-phase titration ramp.')
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create stack' }));
  const body = mutate.mock.calls[0]![0];
  expect(body.start_date).toBe('2026-12-01');
  expect(body.components[0].steps).toEqual([
    { dose: '250', dose_unit: 'mcg', duration_days: 14 },
    { dose: '500', dose_unit: 'mcg', duration_days: null },
  ]);
});

it('needs a start date for a ramp and days on every phase but the last', () => {
  const { mutate } = setup();
  fillFirstRow();
  fireEvent.click(screen.getByRole('button', { name: '+ Titration ramp' }));
  type('Phase 1 dose', '250');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'A titration ramp needs a stack start date.'
  );
  type('Start date (optional)', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  type('Phase 2 dose', '500');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Each ramp phase except the last needs a number of days.'
  );
  expect(mutate).not.toHaveBeenCalled();
});

it('shows the server refusal and returns to the form', () => {
  const { mutate } = setup();
  fillFirstRow();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create stack' }));
  const options = mutate.mock.calls[0]![1];
  act(() =>
    options.onError(
      Object.assign(
        new Error(
          'Peptide A already has an active plan. Add it to a stack from the stack list instead.'
        ),
        { status: 409 }
      )
    )
  );
  expect(
    within(screen.getByRole('alert')).getByText(/already has an active plan/)
  ).toBeInTheDocument();
  // Back on the form, so the person can change the name and try again.
  expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
});
