import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Accordion } from '@/components/ui/accordion';
import DoseReminderSettings from '@/pages/Settings/DoseReminderSettings';
import { useDoseReminders } from '@/hooks/Medications/useDoseReminders';
import * as device from '@/utils/pushDevice';

jest.mock('@/hooks/Medications/useDoseReminders', () => ({
  useDoseReminders: jest.fn(),
}));
jest.mock('@/utils/pushDevice', () => {
  class PushPermissionError extends Error {}
  class PushUnavailableError extends Error {}
  return {
    PushPermissionError,
    PushUnavailableError,
    pushSupport: jest.fn(),
    notificationPermission: jest.fn(),
    currentPushSubscription: jest.fn(),
    subscribeThisDevice: jest.fn(),
    unsubscribeThisDevice: jest.fn(),
  };
});

const endpoint = 'https://fcm.googleapis.com/fcm/send/this-device';
const settings = {
  untimed_time: '08:00',
  nag_enabled: true,
  nag_time: '18:00',
  include_supplements: true,
};
const state = (
  changes: Partial<ReturnType<typeof useDoseReminders>> = {},
  subscriptions: { endpoint: string }[] = []
) =>
  ({
    scope: { ready: true, isCurrent: () => true, key: ['k'] },
    query: { isError: false, isFetching: false, refetch: jest.fn() },
    data: {
      public_key: 'BPUBLIC',
      settings,
      subscriptions: subscriptions.map((row, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        endpoint: row.endpoint,
        user_agent: null,
        created_at: '2026-11-19T00:00:00.000Z',
        last_success_at: null,
      })),
    },
    saveSettings: jest.fn(async (body) => body),
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    sendTest: jest.fn(async () => ({ delivered: 1, devices: 1 })),
    ...changes,
  }) as unknown as ReturnType<typeof useDoseReminders>;

const renderCard = (value: ReturnType<typeof useDoseReminders>) => {
  jest.mocked(useDoseReminders).mockReturnValue(value);
  return render(
    <Accordion type="multiple" defaultValue={['dose-reminders']}>
      <DoseReminderSettings />
    </Accordion>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(device.pushSupport).mockReturnValue('supported');
  jest.mocked(device.notificationPermission).mockReturnValue('default');
  jest.mocked(device.currentPushSubscription).mockResolvedValue(null);
});

it('turns reminders on for this device with the server key', async () => {
  const value = state();
  jest.mocked(device.subscribeThisDevice).mockResolvedValue({
    endpoint,
    keys: { p256dh: 'p', auth: 'a' },
  });
  renderCard(value);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Turn on for this device' })
  );
  await waitFor(() =>
    expect(device.subscribeThisDevice).toHaveBeenCalledWith('BPUBLIC')
  );
  expect(value.register).toHaveBeenCalledWith({
    endpoint,
    keys: { p256dh: 'p', auth: 'a' },
  });
  expect(
    await screen.findByText('This device will now get dose reminders.')
  ).toBeInTheDocument();
});

it('shows test and turn-off when this device is already on', async () => {
  jest
    .mocked(device.currentPushSubscription)
    .mockResolvedValue({ endpoint } as PushSubscription);
  jest.mocked(device.unsubscribeThisDevice).mockResolvedValue(endpoint);
  const value = state({}, [{ endpoint }]);
  renderCard(value);
  expect(await screen.findByText('On for this device.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));
  expect(await screen.findByText(/Test sent to 1 device/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Turn off for this device' })
  );
  await waitFor(() => expect(value.unregister).toHaveBeenCalledWith(endpoint));
  expect(await screen.findByText('Off for this device.')).toBeInTheDocument();
});

it('explains a refused permission without registering', async () => {
  const value = state();
  jest
    .mocked(device.subscribeThisDevice)
    .mockRejectedValue(new device.PushPermissionError('no'));
  renderCard(value);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Turn on for this device' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /Notifications are blocked for this site/
  );
  expect(value.register).not.toHaveBeenCalled();
});

it('tells iPhone users to add the app to the Home Screen first', async () => {
  jest.mocked(device.pushSupport).mockReturnValue('needs-install');
  renderCard(state());
  expect(
    await screen.findByText(/add SparkyFitness to your Home Screen/)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Turn on for this device' })
  ).not.toBeInTheDocument();
});

it('saves reminder times and supplement choice', async () => {
  const value = state();
  renderCard(value);
  fireEvent.change(screen.getByLabelText('Doses with no set time remind at'), {
    target: { value: '07:30' },
  });
  fireEvent.click(screen.getByLabelText('Include supplements'));
  fireEvent.click(
    screen.getByLabelText(
      'Evening catch-up: one summary of doses still not logged'
    )
  );
  expect(screen.getByLabelText('Evening catch-up at')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(value.saveSettings).toHaveBeenCalledWith({
      untimed_time: '07:30',
      nag_enabled: false,
      nag_time: '18:00',
      include_supplements: false,
    })
  );
  expect(await screen.findByText('Reminder times saved.')).toBeInTheDocument();
});

it('shows nothing for a switched profile', () => {
  const { container } = renderCard(
    state({
      scope: {
        ready: false,
        isCurrent: () => false,
        key: ['k'],
      } as unknown as ReturnType<typeof useDoseReminders>['scope'],
    })
  );
  expect(container.firstElementChild).toBeEmptyDOMElement();
});
