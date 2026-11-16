import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMedicationCourses,
  useMedicationCourseScope,
} from '@/hooks/Medications/useMedicationCourses';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import { listMedicationCourses } from '@/api/Medications/courseService';
import { courseFixture, courseIds } from '@/tests/fixtures/medicationCourses';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner;
let mockRead = true;
let mockWrite = true;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockActive,
    hasPermission: () => mockRead,
    hasWritePermission: () => mockWrite,
  }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
}));
jest.mock('@/api/Medications/courseService', () => ({
  listMedicationCourses: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity),
  list = jest.mocked(listMedicationCourses);
let oldScope: ReturnType<typeof useMedicationCourseScope>;
function Probe() {
  const { scope, data } = useMedicationCourses(courseIds.med);
  useEffect(() => {
    if (!oldScope) oldScope = scope;
  }, [scope]);
  return (
    <p>
      {scope.ready
        ? `${scope.canWrite ? 'write' : 'read'}:${data?.courses.length ?? 'loading'}`
        : 'private'}
    </p>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  return { client, tree, ...render(tree()) };
}
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockRead = true;
  mockWrite = true;
  oldScope = undefined as unknown as ReturnType<
    typeof useMedicationCourseScope
  >;
  identity.mockReset();
  list.mockReset();
  identity.mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  list.mockResolvedValue({
    courses: [courseFixture()],
    today: '2026-11-16',
    timezone: 'Europe/London',
  });
});
it('waits for authoritative actor/profile proof before course reads', async () => {
  let resolve!: (v: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  identity.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  setup();
  expect(list).not.toHaveBeenCalled();
  await act(async () =>
    resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await screen.findByText('write:1');
});
it('allows report-read views without write controls', async () => {
  mockWrite = false;
  setup();
  await screen.findByText('read:1');
});
it('requests nothing with Diary-only permission', () => {
  mockRead = false;
  mockWrite = false;
  setup();
  expect(identity).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});
it('invalidates a retained old scope closure on same-user active-profile flip', async () => {
  const { tree, rerender } = setup();
  await screen.findByText('write:1');
  const retained = oldScope;
  expect(retained.isCurrent()).toBe(true);
  mockActive = '00000000-0000-4000-8000-000000000099';
  rerender(tree());
  expect(retained.isCurrent()).toBe(false);
  await waitFor(() => expect(identity).toHaveBeenCalledTimes(2));
});
it('clears current same-UUID proof and ignores late older-profile data', async () => {
  let resolve!: (v: Awaited<ReturnType<typeof listMedicationCourses>>) => void;
  list.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(list).toHaveBeenCalled());
  act(() => client.clear());
  await act(async () =>
    resolve({
      courses: [courseFixture()],
      today: '2026-11-16',
      timezone: 'Europe/London',
    })
  );
  expect(screen.getByText('private')).toBeInTheDocument();
  rerender(tree());
  expect(list).toHaveBeenCalledTimes(1);
});
