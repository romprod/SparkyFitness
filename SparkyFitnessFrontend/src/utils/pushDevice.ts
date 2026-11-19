import type { WebPushSubscriptionInput } from '@workspace/shared';

/**
 * This browser's Web Push state. Reminders need a registered service worker
 * (the production build registers one), the Push API and notification
 * permission. iPhone and iPad allow push only from a Home Screen web app.
 */
export type PushSupport = 'supported' | 'needs-install' | 'unsupported';

const isAppleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const available =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  if (available) return 'supported';
  if (isAppleMobile() && !isStandalone()) return 'needs-install';
  return 'unsupported';
}

export const notificationPermission = (): NotificationPermission | null =>
  'Notification' in window ? Notification.permission : null;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const keyBytes = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const sameKey = (subscription: PushSubscription, publicKey: string) => {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
};

export class PushPermissionError extends Error {}
export class PushUnavailableError extends Error {}

/** Asks permission when needed and subscribes this browser. */
export async function subscribeThisDevice(
  publicKey: string
): Promise<WebPushSubscriptionInput> {
  const reg = await registration();
  if (!reg) throw new PushUnavailableError('No service worker is registered.');
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
  if (permission !== 'granted')
    throw new PushPermissionError('Notifications are not allowed.');
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.['p256dh'] ?? '',
      auth: json.keys?.['auth'] ?? '',
    },
    user_agent: navigator.userAgent.slice(0, 400),
  };
}

/** Unsubscribes this browser; returns the endpoint it had, if any. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const subscription = await currentPushSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
