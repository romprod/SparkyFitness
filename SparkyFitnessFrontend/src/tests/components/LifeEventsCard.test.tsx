import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { LifeEvent } from '@workspace/shared';
import LifeEventsCard from '@/pages/Reports/LifeEventsCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
}));
let mockEvents: LifeEvent[] | undefined = [];
let mockLoadFailed = false;
const mockAdd = jest.fn();
const mockRemove = jest.fn();
let mockAddPending = false;
jest.mock('@/hooks/Medications/useLifeEvents', () => ({
  useLifeEvents: () => ({
    data: mockEvents,
    query: { isError: mockLoadFailed },
  }),
  useAddLifeEventMutation: () => ({
    mutateAsync: mockAdd,
    isPending: mockAddPending,
  }),
  useDeleteLifeEventMutation: () => ({ mutate: mockRemove }),
}));

const event = (patch: Partial<LifeEvent> = {}): LifeEvent => ({
  id: '00000000-0000-4000-a000-0000000000e1',
  kind: 'illness',
  start_day: '2026-11-10',
  end_day: '2026-11-14',
  label: 'flu',
  notes: null,
  ...patch,
});
const renderCard = () =>
  render(<LifeEventsCard startDate="2026-11-01" endDate="2026-11-30" />);
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockEvents = [];
  mockLoadFailed = false;
  mockAddPending = false;
  mockAdd.mockReset().mockResolvedValue({ id: 'new' });
  mockRemove.mockReset();
});

it('explains that a window is context, not an explanation', () => {
  renderCard();
  expect(
    screen.getByText(/never an explanation of a change/)
  ).toBeInTheDocument();
  expect(screen.getByText('No windows tagged yet.')).toBeInTheDocument();
});

it('lists each window with its kind, label and days, and counts the days in range', () => {
  mockEvents = [
    event(),
    event({
      id: 'trip',
      kind: 'travel',
      label: null,
      start_day: '2026-11-20',
      end_day: '2026-11-20',
      notes: 'Work trip',
    }),
  ];
  renderCard();
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Illness');
  expect(items[0]).toHaveTextContent('flu');
  expect(items[0]).toHaveTextContent('UK:2026-11-10 → UK:2026-11-14');
  // One day shows as a single date, with its notes beneath.
  expect(items[1]).toHaveTextContent('Travel');
  expect(items[1]).toHaveTextContent('UK:2026-11-20');
  expect(items[1]).not.toHaveTextContent('→');
  expect(items[1]).toHaveTextContent('Work trip');
  expect(
    screen.getByText(
      'Days inside windows in this range: illness 5, travel 1, other 0.'
    )
  ).toBeInTheDocument();
});

it('does not count windows outside the report’s range', () => {
  mockEvents = [event({ start_day: '2026-09-01', end_day: '2026-09-03' })];
  renderCard();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryByText(/Days inside windows/)).not.toBeInTheDocument();
});

it('adds a window, reading a blank end day as the start day, then clears the form', async () => {
  renderCard();
  fill('Label', 'flu');
  fill('Start day', '2026-11-10');
  fill('Notes', 'in bed');
  fireEvent.click(screen.getByRole('button', { name: /Add window/ }));
  await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
  expect(mockAdd).toHaveBeenCalledWith({
    kind: 'illness',
    start_day: '2026-11-10',
    end_day: null,
    label: 'flu',
    notes: 'in bed',
  });
  expect(await screen.findByText('Window saved.')).toBeInTheDocument();
  expect(screen.getByLabelText('Start day')).toHaveValue('');
  expect(screen.getByLabelText('Label')).toHaveValue('');
});

it('sends the chosen kind and end day', async () => {
  renderCard();
  fireEvent.change(screen.getByLabelText('Kind'), {
    target: { value: 'travel' },
  });
  fill('Start day', '2026-11-20');
  fill('End day (inclusive)', '2026-11-25');
  fireEvent.click(screen.getByRole('button', { name: /Add window/ }));
  await waitFor(() => expect(mockAdd).toHaveBeenCalled());
  expect(mockAdd).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'travel',
      start_day: '2026-11-20',
      end_day: '2026-11-25',
    })
  );
});

it('needs a start day before it can be added', () => {
  renderCard();
  expect(screen.getByRole('button', { name: /Add window/ })).toBeDisabled();
  fill('Start day', '2026-11-10');
  expect(screen.getByRole('button', { name: /Add window/ })).toBeEnabled();
});

it('says what is wrong with the dates and saves nothing', async () => {
  renderCard();
  fill('Start day', '2026-11-10');
  fill('End day (inclusive)', '2026-11-09');
  // The date field's own minimum stops a click in a browser; submit directly to reach our check.
  fireEvent.submit(
    screen.getByRole('form', { name: 'Add an illness or travel window' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The end day must be on or after the start day'
  );
  expect(mockAdd).not.toHaveBeenCalled();
});

it('refuses a window longer than 120 days', async () => {
  renderCard();
  fill('Start day', '2026-01-01');
  fill('End day (inclusive)', '2026-05-01');
  fireEvent.click(screen.getByRole('button', { name: /Add window/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'at most 120 days'
  );
  expect(mockAdd).not.toHaveBeenCalled();
});

it('shows why a save failed and keeps what was typed', async () => {
  mockAdd.mockRejectedValue(new Error('The server said no'));
  renderCard();
  fill('Label', 'flu');
  fill('Start day', '2026-11-10');
  fireEvent.click(screen.getByRole('button', { name: /Add window/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server said no'
  );
  expect(screen.getByLabelText('Label')).toHaveValue('flu');
  expect(screen.queryByText('Window saved.')).not.toBeInTheDocument();
});

it('asks before deleting a window, and deletes it only when confirmed', async () => {
  mockEvents = [event()];
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: /Delete window flu/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Delete this window?')).toBeInTheDocument();
  expect(mockRemove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  expect(mockRemove).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /Delete window flu/ }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Delete',
    })
  );
  expect(mockRemove).toHaveBeenCalledWith(
    '00000000-0000-4000-a000-0000000000e1',
    expect.objectContaining({ onError: expect.any(Function) })
  );
});

it('says when the windows could not be loaded', () => {
  mockEvents = undefined;
  mockLoadFailed = true;
  renderCard();
  expect(screen.getByText('Could not load the windows.')).toBeInTheDocument();
});
