import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiaryNutritionTrendsSetting from '@/pages/Settings/DiaryNutritionTrendsSetting';
import { dashboardLayoutKeys } from '@/api/keys/dashboardLayouts';
import {
  getDashboardLayout,
  saveDashboardLayout,
  type SavedDashboardLayout,
} from '@/api/Settings/dashboardLayouts';
let mockUser = { id: 'owner' };
let mockActive = 'owner';
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockActive,
    isActingOnBehalf: mockActive !== mockUser.id,
  }),
}));
jest.mock('@/api/Settings/dashboardLayouts', () => ({
  getDashboardLayout: jest.fn(),
  saveDashboardLayout: jest.fn(),
}));
const get = jest.mocked(getDashboardLayout),
  save = jest.mocked(saveDashboardLayout);
const label = 'Show 14-day nutrition trends in Diary';
const layout: SavedDashboardLayout = {
  layout: {
    lg: [{ i: 'nutrition', x: 0, y: 17, w: 6, h: 10 }],
    md: [],
    sm: [],
    xs: [],
  },
  hidden: ['water'],
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(<DiaryNutritionTrendsSetting />, { wrapper }) };
}
beforeEach(() => {
  mockUser = { id: 'owner' };
  mockActive = 'owner';
  get.mockReset();
  save.mockReset();
  get.mockResolvedValue(layout);
  save.mockImplementation(async (_key, payload) => payload);
});
it('waits for the saved layout and preserves all positions and other hidden keys', async () => {
  const pending = deferred<SavedDashboardLayout | null>();
  get.mockReturnValue(pending.promise);
  const { client } = setup();
  expect(screen.getByRole('switch', { name: label })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  await act(async () => pending.resolve(layout));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith('diary', {
      layout: layout.layout,
      hidden: ['water', 'nutrition-trends'],
    })
  );
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).not.toBeChecked()
  );
  expect(client.getQueryData(dashboardLayoutKeys.byPage('diary'))).toEqual({
    layout: layout.layout,
    hidden: ['water', 'nutrition-trends'],
  });
});
it('defaults on without a saved layout, reads persisted off, and treats reset as on', async () => {
  get.mockResolvedValue(null);
  const first = setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  expect(screen.getByRole('switch', { name: label })).toBeChecked();
  expect(save).not.toHaveBeenCalled();
  first.unmount();
  get.mockResolvedValue({ ...layout, hidden: ['nutrition-trends', 'water'] });
  const second = setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).not.toBeChecked()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith('diary', {
      layout: layout.layout,
      hidden: ['water'],
    })
  );
  second.unmount();
  get.mockResolvedValue(null);
  setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  expect(screen.getByRole('switch', { name: label })).toBeChecked();
});
it('leaves the saved visibility honest after a failed save or load', async () => {
  save.mockRejectedValue(new Error('offline'));
  const view = setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await screen.findByRole('alert');
  expect(screen.getByRole('switch', { name: label })).toBeChecked();
  expect(
    view.client.getQueryData(dashboardLayoutKeys.byPage('diary'))
  ).toBeUndefined();
  view.unmount();
  get.mockRejectedValue(new Error('offline'));
  setup();
  await screen.findByRole('alert');
  expect(screen.getByRole('switch', { name: label })).toBeDisabled();
});
it('shows the active profile setting read-only and waits for a fresh self read on switching', async () => {
  mockActive = 'delegate';
  get.mockResolvedValue({ ...layout, hidden: ['nutrition-trends'] });
  const view = setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).not.toBeChecked()
  );
  expect(screen.getByRole('switch', { name: label })).toBeDisabled();
  fireEvent.click(screen.getByRole('switch', { name: label }));
  expect(save).not.toHaveBeenCalled();
  const pending = deferred<SavedDashboardLayout | null>();
  get.mockReturnValue(pending.promise);
  mockActive = 'owner';
  view.rerender(<DiaryNutritionTrendsSetting />);
  expect(screen.getByRole('switch', { name: label })).toBeDisabled();
  await act(async () => pending.resolve(layout));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith('diary', {
      layout: layout.layout,
      hidden: ['water', 'nutrition-trends'],
    })
  );
});
it('does not publish a late previous-profile save into the current profile cache', async () => {
  const pending = deferred<SavedDashboardLayout>();
  save.mockReturnValue(pending.promise);
  const view = setup();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  mockActive = 'delegate';
  view.rerender(<DiaryNutritionTrendsSetting />);
  const delegate = { ...layout, hidden: ['energy'] };
  view.client.setQueryData(dashboardLayoutKeys.byPage('diary'), delegate);
  await act(async () =>
    pending.resolve({ ...layout, hidden: ['water', 'nutrition-trends'] })
  );
  expect(view.client.getQueryData(dashboardLayoutKeys.byPage('diary'))).toEqual(
    delegate
  );
});

it('prevents an older Diary read from replacing a confirmed visibility save', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const older = deferred<SavedDashboardLayout>();
  const oldRead = client
    .fetchQuery({
      queryKey: dashboardLayoutKeys.byPage('diary'),
      queryFn: () => older.promise,
    })
    .catch(() => null);
  setup(client);
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('switch', { name: label }));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).not.toBeChecked()
  );
  await act(async () => {
    older.resolve(layout);
    await oldRead;
  });
  expect(client.getQueryData(dashboardLayoutKeys.byPage('diary'))).toEqual({
    layout: layout.layout,
    hidden: ['water', 'nutrition-trends'],
  });
});
