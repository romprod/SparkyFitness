import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationReorderDefaults as Defaults } from '@workspace/shared';
import { Accordion } from '@/components/ui/accordion';
import MedicationReorderDefaults from '@/pages/Settings/MedicationReorderDefaults';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string | { defaultValue: string; lead: number; buffer: number }
    ) =>
      typeof fallback === 'string'
        ? fallback
        : fallback.defaultValue
            .replace('{{lead}}', String(fallback.lead))
            .replace('{{buffer}}', String(fallback.buffer)),
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
let mockReady = true;
let mockCurrent = true;
let mockScopeKey = 'actor:self:1';
let mockData: Defaults | undefined;
const mockSave = jest.fn();
const mockRefetch = jest.fn();
const mockQuery = {
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: mockRefetch,
};
jest.mock('@/hooks/Medications/useMedicationInventoryForecast', () => ({
  useMedicationReorderDefaults: () => {
    const key = mockScopeKey;
    return {
      scope: {
        ready: mockReady,
        key,
        actorId: 'actor',
        ownerId: 'actor',
        isCurrent: () => mockCurrent && key === mockScopeKey,
      },
      query: mockQuery,
      data: mockData,
      save: mockSave,
    };
  },
}));
const Fixture = () => (
  <Accordion type="multiple" defaultValue={['medication-reorder-defaults']}>
    <MedicationReorderDefaults />
  </Accordion>
);
const edit = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const deferred = () => {
  let resolve!: (value: Defaults) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Defaults>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  mockReady = true;
  mockCurrent = true;
  mockScopeKey = 'actor:self:1';
  mockData = { lead_days: 14, buffer_days: 3 };
  Object.assign(mockQuery, {
    isLoading: false,
    isFetching: false,
    isError: false,
  });
  mockSave.mockReset().mockImplementation(async (body: Defaults) => body);
  mockRefetch.mockReset();
});

it('shows authoritative saved defaults with source 14/3 context and waits for explicit Save', () => {
  render(<Fixture />);
  expect(screen.getByLabelText('Lead time (days)')).toHaveValue('14');
  expect(screen.getByLabelText('Safety buffer (days)')).toHaveValue('3');
  expect(
    screen.getByText(
      'Default lead time is 14 days and safety buffer is 3 days.'
    )
  ).toBeInTheDocument();
  edit('Lead time (days)', '20');
  expect(mockSave).not.toHaveBeenCalled();
});
it.each(['Lead time (days)', 'Safety buffer (days)'])(
  'retains zero for %s rather than resetting to a default',
  async (label) => {
    render(<Fixture />);
    edit(label, '0');
    save();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Reorder defaults saved.'
      )
    );
    expect(mockSave).toHaveBeenCalledWith(
      label === 'Lead time (days)'
        ? { lead_days: 0, buffer_days: 3 }
        : { lead_days: 14, buffer_days: 0 }
    );
    expect(screen.getByLabelText(label)).toHaveValue('0');
  }
);
it.each(['', '-1', '1.5', '1day', '1e2', '2147483648', ' 2 '])(
  'rejects invalid lead days %p inline without replacing the draft or writing',
  (value) => {
    render(<Fixture />);
    edit('Lead time (days)', value);
    save();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number');
    expect(screen.getByLabelText('Lead time (days)')).toHaveValue(value);
    expect(mockSave).not.toHaveBeenCalled();
  }
);
it('also validates the buffer and accepts the shared maximum integer bound', async () => {
  render(<Fixture />);
  edit('Safety buffer (days)', '3.2');
  save();
  expect(mockSave).not.toHaveBeenCalled();
  edit('Safety buffer (days)', '2147483647');
  save();
  await waitFor(() =>
    expect(mockSave).toHaveBeenCalledWith({
      lead_days: 14,
      buffer_days: 2147483647,
    })
  );
});
it('renders the server-returned saved values after a successful round trip', async () => {
  mockSave.mockResolvedValue({ lead_days: 18, buffer_days: 4 });
  render(<Fixture />);
  edit('Lead time (days)', '19');
  save();
  await waitFor(() =>
    expect(screen.getByLabelText('Lead time (days)')).toHaveValue('18')
  );
  expect(screen.getByLabelText('Safety buffer (days)')).toHaveValue('4');
  expect(screen.getByRole('status')).toHaveTextContent(
    'Reorder defaults saved.'
  );
});
it('keeps the dirty draft during same-owner asynchronous data refresh', () => {
  const view = render(<Fixture />);
  edit('Lead time (days)', '21');
  mockData = { lead_days: 5, buffer_days: 6 };
  view.rerender(<Fixture />);
  expect(screen.getByLabelText('Lead time (days)')).toHaveValue('21');
  expect(screen.getByLabelText('Safety buffer (days)')).toHaveValue('3');
  expect(mockSave).not.toHaveBeenCalled();
});
it('updates untouched fields when the same owner receives fresher settings', () => {
  const view = render(<Fixture />);
  mockData = { lead_days: 5, buffer_days: 6 };
  view.rerender(<Fixture />);
  expect(screen.getByLabelText('Lead time (days)')).toHaveValue('5');
  expect(screen.getByLabelText('Safety buffer (days)')).toHaveValue('6');
});
it('keeps failed-save fields intact and retries only after another explicit Save', async () => {
  mockSave.mockRejectedValueOnce(new Error('Private service error'));
  render(<Fixture />);
  edit('Lead time (days)', '19');
  save();
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save reorder defaults.'
    )
  );
  expect(screen.getByLabelText('Lead time (days)')).toHaveValue('19');
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Private service error')).not.toBeInTheDocument();
  save();
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reorder defaults saved.'
    )
  );
  expect(mockSave).toHaveBeenCalledTimes(2);
});
it('disables inputs and prevents repeated submission while a save is pending', async () => {
  const pending = deferred();
  mockSave.mockReturnValue(pending.promise);
  render(<Fixture />);
  save();
  expect(screen.getByLabelText('Lead time (days)')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(mockSave).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ lead_days: 14, buffer_days: 3 }));
});
it.each(['resolve', 'reject'] as const)(
  'ignores late %s from the previous authoritative owner and starts the new scope from its own data',
  async (settle) => {
    const pending = deferred();
    mockSave.mockReturnValue(pending.promise);
    const view = render(<Fixture />);
    edit('Lead time (days)', '19');
    save();
    mockScopeKey = 'new-actor:self:2';
    mockData = { lead_days: 6, buffer_days: 7 };
    view.rerender(<Fixture />);
    await act(async () => {
      if (settle === 'resolve')
        pending.resolve({ lead_days: 99, buffer_days: 99 });
      else pending.reject(new Error('Late result'));
    });
    expect(screen.getByLabelText('Lead time (days)')).toHaveValue('6');
    expect(screen.getByLabelText('Safety buffer (days)')).toHaveValue('7');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }
);
it('hides cached preferences while self-owner identity is unproven or delegated', () => {
  mockReady = false;
  render(<Fixture />);
  expect(
    screen.queryByText('Medication reorder defaults')
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Lead time (days)')).not.toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
it('rechecks current identity at the click rather than relying on the render', () => {
  render(<Fixture />);
  mockCurrent = false;
  save();
  expect(mockSave).not.toHaveBeenCalled();
});
it('shows loading without inventing saved values and supports an explicit failed-read retry', () => {
  mockData = undefined;
  mockQuery.isLoading = true;
  const view = render(<Fixture />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading reorder defaults…'
  );
  expect(screen.queryByLabelText('Lead time (days)')).not.toBeInTheDocument();
  mockQuery.isLoading = false;
  mockQuery.isError = true;
  view.rerender(<Fixture />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not load reorder defaults.'
  );
  expect(mockRefetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
