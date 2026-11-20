import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    // Pitstop's 28 days from the prepared date, unless another figure is set.
    bud_mode: 'interval',
    bud_interval_days: 28,
    bud_date: '2026-12-13',
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

it('keeps new-vial label metadata blank until explicitly entered and reviews/submits it separately', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '10');
  expect(screen.getByLabelText('Vial label amount (mg)')).toHaveValue('');
  review();
  expect(
    screen.getByText(/Vial label amount \(mg\): Not recorded/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  change('Vial label amount (mg)', '20.00000000000000000001');
  review();
  expect(screen.getByText(/20\.00000000000000000001/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls[0][0].label_mass_mg).toBe(
    '20.00000000000000000001'
  );
  expect(mockCreate.mock.calls[0][0].preparation).not.toHaveProperty(
    'label_mass_mg'
  );
});
it('does not write or edit independent label metadata during preparation correction', () => {
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={{ ...pen, label_mass_mg: '20' }}
      onClose={jest.fn()}
    />
  );
  expect(
    screen.queryByLabelText('Vial label amount (mg)')
  ).not.toBeInTheDocument();
  change('Powder in the vial', '8');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCorrect.mock.calls[0][0].body).not.toHaveProperty('label_mass_mg');
  expect(mockCorrect.mock.calls[0][0].body.preparation).not.toHaveProperty(
    'label_mass_mg'
  );
});

const queuedPen = {
  ...pen,
  status: 'sealed' as const,
  doses_used: 0,
  preparation: null,
};
const queueToken = 'c'.repeat(64);
it('prepares a queued existing vial inline from the usual defaults and same-ID guarded PUT only', () => {
  render(
    <MedicationPreparationWizard
      inline
      med={medication}
      pen={queuedPen}
      onClose={jest.fn()}
      queueContext={{ state: queueToken, isCurrent: () => true }}
    />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  // As in Pitstop, 2 mL of diluent and the medication's own dose are the starting points.
  expect(screen.getByLabelText('Diluent added (mL)')).toHaveValue('2');
  change('Powder in the vial', '8');
  change('Diluent added (mL)', '1.5');
  review();
  expect(screen.getByLabelText('Target amount')).toHaveValue(
    String(medication.dose_amount)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockCorrect).not.toHaveBeenCalled();
  expect(mockAttach).toHaveBeenCalledWith(
    {
      id: 'vial',
      body: expect.objectContaining({
        expected_preparation_queue_state: queueToken,
        preparation: expect.objectContaining({
          mass_value: '8',
          final_volume_ml: '1.5',
        }),
      }),
    },
    expect.anything()
  );
});
it('stops a queue save when live profile authority is lost without erasing the draft', () => {
  let current = true;
  render(
    <MedicationPreparationWizard
      inline
      med={medication}
      pen={queuedPen}
      onClose={jest.fn()}
      queueContext={{ state: queueToken, isCurrent: () => current }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '8');
  change('Diluent added (mL)', '1.5');
  review();
  current = false;
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockAttach).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByText('1.5 mL')).toBeInTheDocument();
});
it('pins the reviewed queue token across refresh and stops stale409 retries until reopened', () => {
  const props = {
    inline: true,
    med: medication,
    pen: queuedPen,
    onClose: jest.fn(),
    queueContext: { state: queueToken, isCurrent: () => true },
  };
  const view = render(<MedicationPreparationWizard {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '8');
  change('Diluent added (mL)', '1.5');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  act(() => mockAttach.mock.calls[0][1].onError({ status: 409 }));
  expect(screen.getByRole('status')).toHaveTextContent('stock record changed');
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  view.rerender(
    <MedicationPreparationWizard
      {...props}
      queueContext={{ state: 'd'.repeat(64), isCurrent: () => true }}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  expect(screen.getByText('1.5 mL')).toBeInTheDocument();
  expect(mockAttach).toHaveBeenCalledTimes(1);
});
it('does not adopt a refreshed queue token into an already reviewed preparation', () => {
  const props = {
    inline: true,
    med: medication,
    pen: queuedPen,
    onClose: jest.fn(),
    queueContext: { state: queueToken, isCurrent: () => true },
  };
  const view = render(<MedicationPreparationWizard {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '8');
  change('Diluent added (mL)', '1.5');
  review();
  view.rerender(
    <MedicationPreparationWizard
      {...props}
      queueContext={{ state: 'd'.repeat(64), isCurrent: () => true }}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('stock record changed');
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  expect(screen.getByText('1.5 mL')).toBeInTheDocument();
  expect(mockAttach).not.toHaveBeenCalled();
});

it('keeps labels and inputs distinct when two inline queue preparations are open', () => {
  render(
    <>
      <MedicationPreparationWizard
        inline
        med={medication}
        pen={queuedPen}
        onClose={jest.fn()}
        queueContext={{ state: queueToken, isCurrent: () => true }}
      />
      <MedicationPreparationWizard
        inline
        med={medication}
        pen={{ ...queuedPen, id: 'other-vial' }}
        onClose={jest.fn()}
        queueContext={{ state: queueToken, isCurrent: () => true }}
      />
    </>
  );
  const sections = screen.getAllByRole('region', { name: 'Prepare a vial' });
  fireEvent.click(
    within(sections[0]!).getByRole('button', { name: /Dry powder —/ })
  );
  fireEvent.click(
    within(sections[1]!).getByRole('button', { name: /Dry powder —/ })
  );
  const first = within(sections[0]!).getByLabelText('Powder in the vial');
  const second = within(sections[1]!).getByLabelText('Powder in the vial');
  expect(first.id).not.toEqual(second.id);
  fireEvent.change(first, { target: { value: '8' } });
  fireEvent.change(second, { target: { value: '9' } });
  expect(first).toHaveValue('8');
  expect(second).toHaveValue('9');
  expect(within(sections[0]!).getByLabelText('Prepared date').id).not.toEqual(
    within(sections[1]!).getByLabelText('Prepared date').id
  );
});

describe('Pitstop-style presentation', () => {
  it('names the compound, describes each choice and has no back arrow on the first step', () => {
    render(
      <MedicationPreparationWizard
        med={{ ...medication, name: 'Retatrutide' } as Medication}
        onClose={jest.fn()}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'How does this vial come?' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Retatrutide — choose how it’s prepared.')
    ).toBeInTheDocument();
    const dry = screen.getByRole('button', { name: /Dry powder —/ });
    expect(dry).toHaveTextContent('Add diluent to mix');
    expect(
      screen.getByRole('button', { name: /Premixed —/ })
    ).toHaveTextContent('Ready to use, known concentration');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass(
      'invisible'
    );
  });

  it('shows the concentration as you type, and a back arrow after the first step', () => {
    render(
      <MedicationPreparationWizard med={medication} onClose={jest.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
    expect(
      screen.getByRole('heading', { name: 'Mix it up' })
    ).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    change('Powder in the vial', '10');
    expect(
      screen.getByText('Concentration').nextElementSibling
    ).toHaveTextContent('5 mg/mL');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'How does this vial come?' })
    ).toBeInTheDocument();
  });

  it('asks for label details when the vial is premixed', () => {
    render(
      <MedicationPreparationWizard med={medication} onClose={jest.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Premixed —/ }));
    expect(
      screen.getByRole('heading', { name: 'What’s in the vial' })
    ).toBeInTheDocument();
  });

  it('keeps the optional vial details folded for a new vial, and open when editing', () => {
    const { unmount } = render(
      <MedicationPreparationWizard med={medication} onClose={jest.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
    // The dialog renders in a portal, outside the render container.
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    // The fields stay reachable and valid while folded.
    change('Prepared date', '2026-11-15');
    unmount();
    render(
      <MedicationPreparationWizard
        med={medication}
        pen={pen}
        onClose={jest.fn()}
      />
    );
    expect(document.querySelector('details')).toHaveAttribute('open');
  });
});
it('starts the beyond-use days at 28, or at the medication default, and lets them change on the last step', () => {
  const { unmount } = render(
    <MedicationPreparationWizard
      med={{ ...medication, custom_fields: { default_bud_days: 21 } }}
      onClose={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '10');
  review();
  expect(screen.getByLabelText('Use within')).toHaveValue('21');
  expect(screen.getByText(/Medication default/)).toBeInTheDocument();
  expect(screen.getByText('Keep refrigerated')).toBeInTheDocument();
  unmount();

  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '10');
  change('Prepared date', '2026-11-15');
  review();
  expect(screen.getByLabelText('Use within')).toHaveValue('28');
  expect(screen.getByText(/Beyond-use date 2026-12-13/)).toBeInTheDocument();
  expect(screen.getByText(/Standard 28 days/)).toBeInTheDocument();
  change('Use within', '14');
  expect(screen.getByText(/Beyond-use date 2026-11-29/)).toBeInTheDocument();
  change('Use within', '');
  expect(
    screen.getByRole('button', { name: 'Confirm and save' })
  ).toBeDisabled();
  change('Use within', '14');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockCreate.mock.calls.at(-1)![0]).toMatchObject({
    bud_interval_days: 14,
    bud_date: '2026-11-29',
  });
});
it('explains a non-number in the powder field instead of silently disabling Review', () => {
  render(<MedicationPreparationWizard med={medication} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', 'Cagri');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a number greater than zero'
  );
  expect(screen.getByLabelText('Powder in the vial')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeDisabled();
  change('Powder in the vial', '10');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Review preparation' })
  ).toBeEnabled();
});

describe('a new preparation follows the vial and medication settings', () => {
  const pen = (labelMass: string | null) =>
    ({
      id: 'pen-1',
      medication_id: 'med-1',
      status: 'sealed',
      label_mass_mg: labelMass,
    }) as unknown as MedicationPen;

  it('starts the powder amount from the vial label, with 2 mL of diluent', () => {
    render(
      <MedicationPreparationWizard
        med={medication}
        pen={pen('10.000')}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
    expect(screen.getByLabelText('Powder in the vial')).toHaveValue('10');
    expect(screen.getByLabelText('Diluent added (mL)')).toHaveValue('2');
  });

  it('starts the beyond-use days from the medication default, counted from the prepared date', () => {
    render(
      <MedicationPreparationWizard
        med={{ ...medication, custom_fields: { default_bud_days: 28 } }}
        pen={pen('10')}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
    expect(screen.getByLabelText('Days')).toHaveValue('28');
    expect(screen.getByLabelText('BUD source')).toHaveValue(
      'Medication default'
    );
    expect(screen.getByLabelText('From date')).toHaveValue(
      screen.getByLabelText('Prepared date').getAttribute('value')
    );
    // Powder from the label, 2 mL and a ready beyond-use interval: nothing left to fill in.
    expect(
      screen.getByRole('button', { name: 'Review preparation' })
    ).toBeEnabled();
  });
});
it('stamps the opened date when it prepares a sealed vial', () => {
  render(
    <MedicationPreparationWizard
      med={medication}
      pen={{ ...queuedPen, opened_at: null } as MedicationPen}
      onClose={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  change('Powder in the vial', '10');
  change('Prepared date', '2026-11-15');
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockAttach.mock.calls.at(-1)![0].body).toMatchObject({
    status: 'in_use',
    opened_at: '2026-11-15',
  });
});
