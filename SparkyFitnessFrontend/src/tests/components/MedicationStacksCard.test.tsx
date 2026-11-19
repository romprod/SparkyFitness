import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationStacksCard from '@/pages/Medications/MedicationStacksCard';
import {
  useDeleteStackMutation,
  useMedicationStacks,
  useSaveStackMutation,
} from '@/hooks/Medications/useMedicationStacks';
import { useMedications } from '@/hooks/useMedications';

jest.mock('@/hooks/Medications/useMedicationStacks', () => ({
  useMedicationStacks: jest.fn(),
  useDeleteStackMutation: jest.fn(),
  useSaveStackMutation: jest.fn(),
}));
jest.mock('@/hooks/useMedications', () => ({ useMedications: jest.fn() }));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (n: number, name: string, extra: object = {}) => ({
  medication_id: id(n),
  name,
  is_supplement: false,
  is_active: true,
  ...extra,
});
const stack = {
  id: id(100),
  name: 'Morning stack',
  notes: null,
  created_at: '2026-11-19T00:00:00.000Z',
  members: [
    member(1, 'Omega 3', { is_supplement: true }),
    member(2, 'Magnesium', { is_supplement: true }),
    member(3, 'Retatrutide'),
    member(4, 'Vitamin D', { is_supplement: true }),
  ],
};
type Due = { key: string; medication: { id: string }; hard?: boolean };
const dues: Due[] = [
  { key: 'a', medication: { id: id(1) } },
  { key: 'done-b', medication: { id: id(2) } },
  { key: 'c', medication: { id: id(3) }, hard: true },
];

const setup = (
  logDues = jest.fn(async (list: Due[]) => ({
    logged: list.length,
    failed: [] as string[],
  })),
  canWrite = true,
  stacks = [stack]
) => {
  jest.mocked(useMedicationStacks).mockReturnValue({
    scope: { ready: true, isCurrent: () => true, key: ['k'] },
    query: { isError: false },
    data: { stacks },
  } as unknown as ReturnType<typeof useMedicationStacks>);
  jest.mocked(useDeleteStackMutation).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteStackMutation>);
  jest.mocked(useSaveStackMutation).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSaveStackMutation>);
  jest.mocked(useMedications).mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useMedications>);
  render(
    <MedicationStacksCard
      dues={dues}
      isLogged={(d: Due) => d.key.startsWith('done')}
      isSimple={(d: Due) => !d.hard}
      canWrite={canWrite}
      logDues={logDues}
    />
  );
  return logDues;
};

it('shows each member’s state for the day and how many are logged', () => {
  setup();
  const section = screen.getByRole('region', { name: 'Morning stack' });
  expect(section).toHaveTextContent('1 of 3 logged today');
  expect(section).toHaveTextContent(/Omega 3\s*Due/);
  expect(section).toHaveTextContent(/Magnesium\s*Logged/);
  expect(section).toHaveTextContent(/Retatrutide\s*Log separately/);
  expect(section).toHaveTextContent(/Vitamin D\s*Not due today/);
  expect(section).toHaveTextContent(
    'Log separately from its own row: Retatrutide.'
  );
});

it('logs only the doses the stack can log, then reports the result', async () => {
  const logDues = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Log stack (1 dose)' }));
  await waitFor(() => expect(logDues).toHaveBeenCalledTimes(1));
  expect(logDues.mock.calls[0]![0].map((d: Due) => d.key)).toEqual(['a']);
  expect(await screen.findByRole('status')).toHaveTextContent('Logged 1 dose.');
});

it('names anything that failed to log', async () => {
  setup(jest.fn(async (_list: Due[]) => ({ logged: 0, failed: ['Omega 3'] })));
  fireEvent.click(screen.getByRole('button', { name: 'Log stack (1 dose)' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Logged 0 doses. Could not log: Omega 3.'
  );
});

it('has no log button for read-only access and hides when empty', () => {
  setup(undefined, false);
  expect(
    screen.queryByRole('button', { name: /Log stack/ })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'New stack' })
  ).not.toBeInTheDocument();
});

it('opens the new-stack dialog from the header', () => {
  setup(undefined, true, []);
  expect(screen.getByText(/No stacks yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New stack' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('New stack');
});
