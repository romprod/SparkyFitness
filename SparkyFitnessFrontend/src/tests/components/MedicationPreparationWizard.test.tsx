import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  MedicationPreparationReview,
  MedicationPreparationReviewInput,
} from '@workspace/shared';
import type { Medication, MedicationPen } from '@/types/medications';
import MedicationPreparationWizard from '@/pages/Medications/MedicationPreparationWizard';
const mockCreate = jest.fn();
const mockAttach = jest.fn();
const mockCorrect = jest.fn();
const mockReview = jest.fn();
let mockResponse: MedicationPreparationReview;
let mockFetching = false;
let mockCurrentRevision: number | undefined;
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({
    data:
      mockCurrentRevision === undefined
        ? undefined
        : [
            {
              ...pen,
              preparation: {
                ...pen.preparation!,
                revision: mockCurrentRevision,
              },
            },
          ],
    isFetching: false,
  }),
  useCreatePenMutation: () => ({ mutate: mockCreate, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: mockAttach, isPending: false }),
  useCorrectPreparationMutation: () => ({
    mutate: mockCorrect,
    isPending: false,
  }),
  usePreparationReview: (
    id: string | null,
    input: MedicationPreparationReviewInput | null
  ) => {
    mockReview(id, input);
    return {
      data: input ? mockResponse : undefined,
      isFetching: mockFetching,
      isError: false,
    };
  },
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: { syringes: [], default_syringe_id: null },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const medication = {
  id: 'med',
  dose_amount: 0.5,
  dose_unit: 'mg',
} as Medication;
const pen = {
  id: 'vial',
  kind: 'vial',
  status: 'in_use',
  doses_used: 2,
  bud_date: '2026-12-01',
  bud_mode: null,
  preparation: {
    id: 'prep',
    revision: 3,
    mode: 'reconstituted',
    mass_value: 10,
    mass_unit: 'mg',
    mass_mg: 10,
    final_volume_ml: 2,
    concentration_mg_ml: 5,
    prepared_date: '2026-11-01',
    diluent: null,
  },
} as MedicationPen;
beforeEach(() => {
  jest.clearAllMocks();
  mockFetching = false;
  mockCurrentRevision = undefined;
  mockResponse = {
    expected_revision: 3,
    review_hash: 'a'.repeat(64),
    before: {
      concentration_mg_ml: '5',
      final_volume_ml: '2',
      remaining_mg: '8',
      remaining_ml: '1.6',
    },
    after: {
      concentration_mg_ml: '2.5',
      final_volume_ml: '4',
      remaining_mg: '9',
      remaining_ml: '3.6',
    },
    affected_dose_count: 2,
    overdrawn_mg: null,
    overdraw_warning: false,
    stock_unknown: false,
    can_confirm: true,
    blocking_reason: null,
  };
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000123',
  });
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const review = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
it('creates dry preparation only after labelled inputs and review, retaining values on Back', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  expect(screen.getByLabelText('Diluent added (mL)')).toHaveValue('2');
  change('Powder in the vial', '10');
  change('Prepared date', '2026-11-15');
  review();
  expect(screen.getByText('5 mg/mL')).toBeInTheDocument();
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Powder in the vial')).toHaveValue('10');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    kind: 'vial',
    status: 'in_use',
    preparation: {
      mode: 'reconstituted',
      mass_value: '10',
      mass_unit: 'mg',
      final_volume_ml: '2',
      prepared_date: '2026-11-15',
    },
    bud_date: null,
  });
});
it('submits premix label concentration and fill without a client supplied mass', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Premixed —/ }));
  expect(screen.getByLabelText('Volume in the vial (mL)')).toHaveValue('');
  change('Label concentration (mg/mL)', '4.50');
  change('Volume in the vial (mL)', '3');
  review();
  expect(screen.getByText('13.5 mg')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls[0][0].preparation).toEqual(
    expect.objectContaining({
      mode: 'premixed',
      label_concentration_value: '4.50',
      label_concentration_unit: 'mg/ml',
      final_volume_ml: '3',
    })
  );
  expect(mockCreate.mock.calls[0][0].preparation).not.toHaveProperty(
    'mass_value'
  );
});
it('blocks invalid amounts instead of proceeding with a previous concentration', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '0');
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
  change('Powder in the vial', 'NaN');
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
});
it('reviews correction using raw inputs and the active revision, preserving omitted BUD and status', () => {
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  change('Diluent added (mL)', '4.000');
  review();
  expect(mockReview).toHaveBeenLastCalledWith('vial', {
    expected_revision: 3,
    preparation: {
      mode: 'reconstituted',
      mass_value: '10',
      mass_unit: 'mg',
      final_volume_ml: '4.000',
      prepared_date: '2026-11-01',
      diluent: null,
    },
  });
  expect(screen.getByText('1.6 → 3.6 mL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCorrect.mock.calls[0][0].body).toMatchObject({
    review_hash: 'a'.repeat(64),
    operation_id: '00000000-0000-4000-8000-000000000123',
    expected_revision: 3,
  });
  expect(mockCorrect.mock.calls[0][0].body).not.toHaveProperty('bud');
  expect(mockCorrect.mock.calls[0][0].body).not.toHaveProperty('status');
});
it('keeps unknown stock unknown and blocks confirmation when physical history is insufficient', () => {
  mockResponse = {
    ...mockResponse,
    stock_unknown: true,
    can_confirm: false,
    blocking_reason: 'INCOMPLETE_PHYSICAL_HISTORY',
    before: { ...mockResponse.before, remaining_ml: null },
    after: { ...mockResponse.after, remaining_ml: null },
  };
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  review();
  expect(screen.getByText('— → — mL')).toBeInTheDocument();
  expect(
    screen.getByText(/Available stock remains unknown/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
});
it('hides retained balances and prevents confirm while the authoritative review is refreshing', () => {
  mockFetching = true;
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  review();
  expect(screen.queryByText('1.6 → 3.6 mL')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
});
it('retries the identical attempted correction after a lost response and newer revision readback', () => {
  const { rerender } = render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  change('Diluent added (mL)', '4.000');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  const first = mockCorrect.mock.calls[0][0];
  mockCorrect.mock.calls[0][1].onError(new Error('Synthetic lost response'));
  mockCurrentRevision = 4;
  mockResponse = {
    ...mockResponse,
    expected_revision: 4,
    review_hash: 'b'.repeat(64),
  };
  rerender(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCorrect.mock.calls[1][0]).toEqual(first);
});
it('requires a fresh review for an unsubmitted stale revision', () => {
  const { rerender } = render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  review();
  mockCurrentRevision = 4;
  rerender(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  expect(mockCorrect).not.toHaveBeenCalled();
});
it('uses exact persisted preparation inputs when opening a correction', () => {
  const exactPen = {
    ...pen,
    preparation: {
      ...pen.preparation!,
      exact: {
        mass_value: '10.00000000000000000001',
        mass_mg: '10.00000000000000000001',
        concentration_mg_ml: '5.000000000000000000005',
        final_volume_ml: '2.00000000000000000000',
      },
    },
  };
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={exactPen}
      onClose={jest.fn()}
    />
  );
  expect(screen.getByLabelText('Powder in the vial')).toHaveValue(
    '10.00000000000000000001'
  );
  expect(screen.getByLabelText('Diluent added (mL)')).toHaveValue(
    '2.00000000000000000000'
  );
  review();
  expect(mockReview.mock.calls.at(-1)?.[1].preparation).toMatchObject({
    mass_value: '10.00000000000000000001',
    final_volume_ml: '2.00000000000000000000',
  });
});
it('keeps an unknown medication unit out of the optional nasal target and still saves valid preparation', () => {
  render(
    <MedicationPreparationWizard
      med={{
        ...medication,
        type_id: 'nasal_spray',
        route_id: 'nasal',
        dose_amount: 2,
        dose_unit: 'sprays',
      }}
      onClose={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Premixed —/ }));
  change('Label concentration (mg/mL)', '3.3');
  change('Volume in the vial (mL)', '0.3');
  review();
  expect(screen.getByLabelText('Target amount')).toHaveValue('');
  expect(
    screen.getByRole('img', { name: 'Nasal pump: —' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('calculated_draw');
  expect(mockCreate.mock.calls[0][0].dose_mg).toBeNull();
});
it('preserves raw creation mass and fill strings through the reviewed request', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '0.100000000000000000001');
  change('Diluent added (mL)', '0.300000000000000000003');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls[0][0].preparation).toMatchObject({
    mass_value: '0.100000000000000000001',
    final_volume_ml: '0.300000000000000000003',
  });
});
it('shows a known correction deficit as zero available with a warning instead of adding a block', () => {
  mockResponse = {
    ...mockResponse,
    overdraw_warning: true,
    overdrawn_mg: '1',
    after: { ...mockResponse.after, remaining_mg: '0', remaining_ml: '0' },
  };
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={pen}
      onClose={jest.fn()}
    />
  );
  review();
  expect(screen.getByText('1.6 → 0 mL')).toBeInTheDocument();
  expect(screen.getByText(/Available stock will be zero/)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeEnabled();
});
