import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Save, Send } from 'lucide-react';
import {
  doseReminderSettingsSchema,
  type DoseReminderSettings as Settings,
  type DoseReminderStatus,
} from '@workspace/shared';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useDoseReminders } from '@/hooks/Medications/useDoseReminders';
import {
  currentPushSubscription,
  notificationPermission,
  pushSupport,
  PushPermissionError,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from '@/utils/pushDevice';

type State = ReturnType<typeof useDoseReminders>;
type DeviceState = 'checking' | 'on' | 'off' | 'blocked' | 'unavailable';

function ThisDevice({
  state,
  status,
}: {
  state: State;
  status: DoseReminderStatus;
}) {
  const { t } = useTranslation();
  const support = pushSupport();
  const [device, setDevice] = useState<DeviceState>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (support !== 'supported' || !status.public_key) {
        if (live) setDevice('unavailable');
        return;
      }
      if (notificationPermission() === 'denied') {
        if (live) setDevice('blocked');
        return;
      }
      try {
        const subscription = await currentPushSubscription();
        const known =
          !!subscription &&
          status.subscriptions.some(
            (row) => row.endpoint === subscription.endpoint
          );
        if (live) setDevice(known ? 'on' : 'off');
      } catch {
        if (live) setDevice('unavailable');
      }
    })();
    return () => {
      live = false;
    };
  }, [support, status]);

  const turnOn = async () => {
    if (!status.public_key) return;
    setBusy(true);
    setMessage(null);
    try {
      await state.register(await subscribeThisDevice(status.public_key));
      setDevice('on');
      setMessage({
        tone: 'ok',
        text: t(
          'medications.reminders.turnedOn',
          'This device will now get dose reminders.'
        ),
      });
    } catch (error) {
      if (error instanceof PushPermissionError) setDevice('blocked');
      setMessage({
        tone: 'error',
        text:
          error instanceof PushPermissionError
            ? t(
                'medications.reminders.permissionDenied',
                'Notifications are blocked for this site. Allow them in your browser or system settings, then try again.'
              )
            : t(
                'medications.reminders.turnOnFailed',
                'Could not turn on reminders for this device.'
              ),
      });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await state.unregister(endpoint);
      setDevice('off');
    } catch {
      setMessage({
        tone: 'error',
        text: t(
          'medications.reminders.turnOffFailed',
          'Could not turn off reminders for this device.'
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await state.sendTest();
      setMessage(
        result.delivered > 0
          ? {
              tone: 'ok',
              text: t('medications.reminders.testSent', {
                defaultValue: 'Test sent to {{count}} device(s).',
                count: result.delivered,
              }),
            }
          : {
              tone: 'error',
              text: t(
                'medications.reminders.testNotDelivered',
                'The test could not be delivered. Turn reminders off and on again on this device.'
              ),
            }
      );
    } catch {
      setMessage({
        tone: 'error',
        text: t(
          'medications.reminders.testFailed',
          'Could not send a test reminder.'
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const explanation: Record<DeviceState, string> = {
    checking: t('medications.reminders.checking', 'Checking this device…'),
    on: t('medications.reminders.deviceOn', 'On for this device.'),
    off: t('medications.reminders.deviceOff', 'Off for this device.'),
    blocked: t(
      'medications.reminders.deviceBlocked',
      'Notifications are blocked for this site on this device. Allow them in your browser or system settings.'
    ),
    unavailable:
      support === 'needs-install'
        ? t(
            'medications.reminders.needsInstall',
            'On iPhone and iPad, add SparkyFitness to your Home Screen, open it from there, then turn reminders on.'
          )
        : status.public_key
          ? t(
              'medications.reminders.unsupported',
              'This browser cannot receive push notifications.'
            )
          : t(
              'medications.reminders.serverUnavailable',
              'Push notifications are not available on this server right now.'
            ),
  };

  return (
    <section
      className="space-y-3"
      aria-labelledby="dose-reminders-device-heading"
    >
      <h3 id="dose-reminders-device-heading" className="text-sm font-medium">
        {t('medications.reminders.thisDevice', 'This device')}
      </h3>
      <p role="status" className="text-sm text-muted-foreground">
        {explanation[device]}
      </p>
      <div className="flex flex-wrap gap-2">
        {device === 'off' && (
          <Button onClick={turnOn} disabled={busy}>
            <Bell className="mr-2 h-4 w-4" />
            {t('medications.reminders.turnOn', 'Turn on for this device')}
          </Button>
        )}
        {device === 'on' && (
          <>
            <Button variant="outline" onClick={test} disabled={busy}>
              <Send className="mr-2 h-4 w-4" />
              {t('medications.reminders.test', 'Send a test')}
            </Button>
            <Button variant="outline" onClick={turnOff} disabled={busy}>
              <BellOff className="mr-2 h-4 w-4" />
              {t('medications.reminders.turnOff', 'Turn off for this device')}
            </Button>
          </>
        )}
      </div>
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={
            message.tone === 'error' ? 'text-sm text-destructive' : 'text-sm'
          }
        >
          {message.text}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t('medications.reminders.devices', {
          defaultValue: 'Reminders are on for {{count}} device(s) in total.',
          count: status.subscriptions.length,
        })}
      </p>
    </section>
  );
}

function TimesForm({ state, settings }: { state: State; settings: Settings }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'invalid' | 'failed' | null>(
    null
  );
  const edit = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setResult(null);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = doseReminderSettingsSchema.safeParse(draft);
    if (!parsed.success) return setResult('invalid');
    setSaving(true);
    try {
      setDraft(await state.saveSettings(parsed.data));
      setResult('saved');
    } catch {
      setResult('failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-labelledby="dose-reminders-times-heading"
    >
      <h3 id="dose-reminders-times-heading" className="text-sm font-medium">
        {t('medications.reminders.times', 'Reminder times')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.reminders.timesHelp',
          'Doses with a set time remind at that time. Doses already logged or skipped do not remind. Notifications never show dose amounts.'
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dose-reminder-untimed">
            {t(
              'medications.reminders.untimedTime',
              'Doses with no set time remind at'
            )}
          </Label>
          <Input
            id="dose-reminder-untimed"
            type="time"
            value={draft.untimed_time}
            onChange={(event) => edit({ untimed_time: event.target.value })}
            disabled={saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dose-reminder-nag">
            {t('medications.reminders.nagTime', 'Evening catch-up at')}
          </Label>
          <Input
            id="dose-reminder-nag"
            type="time"
            value={draft.nag_time}
            onChange={(event) => edit({ nag_time: event.target.value })}
            disabled={saving || !draft.nag_enabled}
          />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="dose-reminder-nag-enabled"
          checked={draft.nag_enabled}
          onCheckedChange={(value) => edit({ nag_enabled: value === true })}
          disabled={saving}
        />
        <Label htmlFor="dose-reminder-nag-enabled" className="font-normal">
          {t(
            'medications.reminders.nagEnabled',
            'Evening catch-up: one summary of doses still not logged'
          )}
        </Label>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="dose-reminder-supplements"
          checked={draft.include_supplements}
          onCheckedChange={(value) =>
            edit({ include_supplements: value === true })
          }
          disabled={saving}
        />
        <Label htmlFor="dose-reminder-supplements" className="font-normal">
          {t('medications.reminders.includeSupplements', 'Include supplements')}
        </Label>
      </div>
      {result === 'invalid' && (
        <p role="alert" className="text-sm text-destructive">
          {t(
            'medications.reminders.invalidTimes',
            'Enter times as hours and minutes, for example 08:00.'
          )}
        </p>
      )}
      {result === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {t(
            'medications.reminders.saveFailed',
            'Could not save reminder times. Please try again.'
          )}
        </p>
      )}
      {result === 'saved' && (
        <p role="status" className="text-sm">
          {t('medications.reminders.saved', 'Reminder times saved.')}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving
          ? t('medications.reminders.saving', 'Saving…')
          : t('medications.reminders.save', 'Save')}
      </Button>
    </form>
  );
}

export default function DoseReminderSettings() {
  const { t } = useTranslation();
  const state = useDoseReminders();
  if (!state.scope.ready || !state.scope.isCurrent()) return null;
  return (
    <AccordionItem value="dose-reminders" className="border rounded-lg mb-4">
      <AccordionTrigger
        className="flex items-center gap-2 p-4 hover:no-underline"
        description={t(
          'medications.reminders.description',
          'Notifications on this device when a dose or supplement is due'
        )}
      >
        <Bell className="h-5 w-5" />
        {t('medications.reminders.title', 'Dose reminders')}
      </AccordionTrigger>
      <AccordionContent className="space-y-6 p-4 pt-0">
        {state.data ? (
          <>
            <ThisDevice state={state} status={state.data} />
            <TimesForm
              key={state.scope.key}
              state={state}
              settings={state.data.settings}
            />
          </>
        ) : state.query.isError ? (
          <div className="space-y-3">
            <p role="alert">
              {t(
                'medications.reminders.loadFailed',
                'Could not load dose reminders.'
              )}
            </p>
            <Button
              variant="outline"
              disabled={state.query.isFetching}
              onClick={() => void state.query.refetch()}
            >
              {t('medications.reminders.retry', 'Try again')}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('medications.reminders.loading', 'Loading dose reminders…')}
          </p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
