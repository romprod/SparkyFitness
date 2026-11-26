import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationBlend } from '@workspace/shared';
import MedicationBlendCard from '@/pages/Medications/MedicationBlendCard';
import MedicationBlendSplit from '@/pages/Medications/MedicationBlendSplit';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockBlends: MedicationBlend[] | undefined = [];
let mockLoading = false;
let mockFailed = false;
let mockPending = false;
const mockSave = jest.fn();
let mockPens: Array<Record<string, unknown>> = [];
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({ data: mockPens }),
}));
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({
    data: mockBlends,
    query: { isLoading: mockLoading, isError: mockFailed },
  }),
  useSaveMedicationBlendMutation: () => ({
    mutateAsync: mockSave,
    isPending: mockPending,
  }),
}));

const GHK = '00000000-0000-4000-8000-000000000001';
const BPC = '00000000-0000-4000-8000-000000000002';
const TB = '00000000-0000-4000-8000-000000000003';
const KPV = '00000000-0000-4000-8000-000000000004';
const KLOW = 'blend-1';
const part = (
  id: string,
  name: string,
  mass_mg: string,
  sort_index: number,
  source: 'label' | 'coa' | 'assumed' = 'label'
) => ({
  component_medication_id: id,
  name,
  mass_mg,
  source,
  sort_index,
});
const klow = (over: Partial<MedicationBlend> = {}): MedicationBlend => ({
  blend_medication_id: KLOW,
  name: 'KLOW',
  components: [
    part(GHK, 'GHK-Cu', '50', 0),
    part(BPC, 'BPC-157', '10', 1, 'coa'),
    part(TB, 'TB-500', '10', 2),
    part(KPV, 'KPV', '10', 3),
  ],
  ...over,
});
const candidates = [
  { id: GHK, name: 'GHK-Cu' },
  { id: BPC, name: 'BPC-157' },
  { id: TB, name: 'TB-500' },
  { id: KPV, name: 'KPV' },
  { id: 'other-blend', name: 'Wolverine' },
];
const renderCard = (id = KLOW, name = 'KLOW') =>
  render(
    <MedicationBlendCard
      medication={{ id, name }}
      candidates={[...candidates, { id: KLOW, name: 'KLOW' }]}
    />
  );
const choose = (index: number, id: string) =>
  fireEvent.change(
    screen.getAllByLabelText('Component')[index] as HTMLElement,
    { target: { value: id } }
  );
const mass = (index: number, value: string) =>
  fireEvent.change(
    screen.getAllByLabelText('mg in one vial')[index] as HTMLElement,
    { target: { value } }
  );

beforeEach(() => {
  mockBlends = [];
  mockLoading = false;
  mockFailed = false;
  mockPending = false;
  mockPens = [];
  mockSave.mockReset().mockResolvedValue({});
});

describe('blend components card', () => {
  it('says a medication is not a blend and offers to add components', () => {
    renderCard();
    expect(screen.getByText('Not a blend.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add components' })
    ).toBeInTheDocument();
  });

  it('shows nothing while the blends load or if they cannot be read', () => {
    mockLoading = true;
    mockBlends = undefined;
    const { container, rerender } = renderCard();
    expect(container).toBeEmptyDOMElement();
    mockLoading = false;
    mockFailed = true;
    rerender(
      <MedicationBlendCard
        medication={{ id: KLOW, name: 'KLOW' }}
        candidates={[]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a saved composition with each share, the vial total and the weakest source', () => {
    mockBlends = [klow()];
    renderCard();
    expect(screen.getByText('GHK-Cu')).toBeInTheDocument();
    expect(screen.getByText(/50 mg · 62.5% · Label/)).toBeInTheDocument();
    expect(
      screen.getByText(/10 mg · 12.5% · Certificate of analysis/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One labelled vial: 80 mg. Ratio source: Certificate of analysis.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit components' })
    ).toBeInTheDocument();
  });

  it('saves what was entered, in order, writing decimals plainly', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Add components' }));
    choose(0, GHK);
    mass(0, '50');
    fireEvent.click(screen.getByRole('button', { name: 'Add component' }));
    choose(1, BPC);
    mass(1, '10.50');
    fireEvent.change(
      screen.getAllByLabelText('Ratio source')[1] as HTMLElement,
      {
        target: { value: 'coa' },
      }
    );
    expect(screen.getByText('Total 60.5 mg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave).toHaveBeenCalledWith({
      id: KLOW,
      body: {
        components: [
          { component_medication_id: GHK, mass_mg: '50', source: 'label' },
          { component_medication_id: BPC, mass_mg: '10.5', source: 'coa' },
        ],
      },
    });
    expect(await screen.findByText('Components saved.')).toBeInTheDocument();
  });

  it('offers other compounds, never itself, a blend or a repeat', () => {
    mockBlends = [
      klow(),
      klow({
        blend_medication_id: 'other-blend',
        name: 'Wolverine',
        components: [part('x', 'X', '1', 0)],
      }),
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit components' }));
    const options = Array.from(
      (screen.getAllByLabelText('Component')[0] as HTMLSelectElement).options
    ).map((option) => option.textContent);
    expect(options).toEqual([
      '— choose —',
      'GHK-Cu',
      'BPC-157',
      'TB-500',
      'KPV',
    ]);
    const second = screen.getAllByLabelText(
      'Component'
    )[1] as HTMLSelectElement;
    const ghkInSecond = Array.from(second.options).find((o) => o.value === GHK);
    expect(ghkInSecond).toBeDisabled();
  });

  it('asks for a compound and a mass on every row before saving', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Add components' }));
    choose(0, GHK);
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    expect(
      await screen.findByText('Choose a compound and a mass for every row.')
    ).toBeInTheDocument();
    mass(0, '0');
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    expect(
      await screen.findByText('Enter a mass above zero')
    ).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when the save is refused, and stays open', async () => {
    mockSave.mockRejectedValueOnce(
      new Error('Wolverine is itself a blend, so it cannot be a component.')
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Add components' }));
    choose(0, GHK);
    mass(0, '5');
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    expect(
      await screen.findByText(
        'Wolverine is itself a blend, so it cannot be a component.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save components' })
    ).toBeInTheDocument();
  });

  it('clears the composition when saved with no rows, and says so', async () => {
    mockBlends = [klow()];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit components' }));
    for (let n = 0; n < 4; n++)
      fireEvent.click(
        screen.getAllByRole('button', {
          name: 'Remove component',
        })[0] as HTMLElement
      );
    expect(
      screen.getByText(
        'Saving with no components makes this a plain medication again.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        id: KLOW,
        body: { components: [] },
      })
    );
  });

  it('leaves the saved composition alone on cancel', () => {
    mockBlends = [klow()];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit components' }));
    mass(0, '99');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText(/50 mg · 62.5%/)).toBeInTheDocument();
  });

  it('explains that a component cannot have components of its own', () => {
    mockBlends = [klow()];
    renderCard(GHK, 'GHK-Cu');
    expect(
      screen.getByText(
        'This is a component of KLOW, so it cannot have components of its own.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /components$/ })
    ).not.toBeInTheDocument();
  });

  it('points to adding the compounds first when there is nothing to choose', () => {
    render(
      <MedicationBlendCard
        medication={{ id: KLOW, name: 'KLOW' }}
        candidates={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add components' }));
    expect(
      screen.getByText(
        'Add each compound as a medication first, then choose it here.'
      )
    ).toBeInTheDocument();
  });
});

describe('blend split line', () => {
  const components = klow().components;

  it('shows each compound’s share in mcg that adds up to the dose, as derived from the weakest source', () => {
    render(
      <MedicationBlendSplit amount="0.8" unit="mg" components={components} />
    );
    expect(
      screen.getByText(
        '↳ GHK-Cu 500 mcg · BPC-157 100 mcg · TB-500 100 mcg · KPV 100 mcg',
        { exact: false }
      )
    ).toHaveTextContent('(derived, coa)');
  });

  it('rounds so the parts add up to the dose', () => {
    render(
      <MedicationBlendSplit amount={250} unit="mcg" components={components} />
    );
    // 156.25 + 31.25 × 3 = 250: rounded one by one it would print 156.3 and 31.3 (250.2).
    const text = screen.getByText(/↳ GHK-Cu/).textContent ?? '';
    const sum = [...text.matchAll(/ ([\d.]+) mcg/g)].reduce(
      (s, m) => s + Number(m[1]),
      0
    );
    expect(sum).toBeCloseTo(250, 9);
  });

  it('shows nothing for a dose in tablets or millilitres or with nothing to split', () => {
    const { container, rerender } = render(
      <MedicationBlendSplit amount="1" unit="ml" components={components} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<MedicationBlendSplit amount="1" unit="mg" components={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <MedicationBlendSplit amount={null} unit="mg" components={components} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('vial label mismatch warning', () => {
  const vial = (over: Record<string, unknown>) => ({
    id: 'v',
    status: 'in_use',
    label: null,
    expiry_date: null,
    label_mass_mg: null,
    ...over,
  });
  const WARN = (sum: string, expected: string) =>
    `Components total ${sum} mg but the vial label says ${expected} mg — derived figures will scale off ${sum} mg.`;

  it('warns on the saved card when a live vial label differs from the total', () => {
    mockBlends = [klow()];
    mockPens = [vial({ label_mass_mg: '100', label: 'Vial A' })];
    renderCard();
    expect(
      screen.getByText(`${WARN('80', '100')} (Vial A)`)
    ).toBeInTheDocument();
  });

  it('is silent when the label equals the total, is unknown, or the vial is retired', () => {
    mockBlends = [klow()];
    mockPens = [
      vial({ label_mass_mg: '80.0' }),
      vial({ id: 'w', label_mass_mg: null }),
      vial({ id: 'x', label_mass_mg: '100', status: 'finished' }),
      vial({ id: 'y', label_mass_mg: '100', status: 'discarded' }),
    ];
    renderCard();
    expect(screen.queryByText(/vial label says/)).not.toBeInTheDocument();
  });

  it('lists each differing label once, naming vials by label or expiry', () => {
    mockBlends = [klow()];
    mockPens = [
      vial({ id: 'a', label_mass_mg: '100', label: 'Vial A' }),
      vial({ id: 'b', label_mass_mg: '100', expiry_date: '2027-01-31' }),
      vial({ id: 'c', label_mass_mg: '90' }),
    ];
    renderCard();
    expect(
      screen.getByText(`${WARN('80', '100')} (Vial A, exp 2027-01-31)`)
    ).toBeInTheDocument();
    expect(screen.getByText(WARN('80', '90'))).toBeInTheDocument();
    expect(screen.getAllByText(/vial label says/)).toHaveLength(2);
  });

  it('updates live while editing and never blocks saving', async () => {
    mockBlends = [klow()];
    mockPens = [vial({ label_mass_mg: '80' })];
    renderCard();
    expect(screen.queryByText(/vial label says/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit components' }));
    expect(screen.queryByText(/vial label says/)).not.toBeInTheDocument();
    mass(0, '60');
    expect(screen.getByText('Total 90 mg')).toBeInTheDocument();
    expect(screen.getByText(WARN('90', '80'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save components' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  });
});
