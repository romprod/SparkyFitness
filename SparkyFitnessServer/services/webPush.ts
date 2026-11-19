import crypto from 'node:crypto';

/**
 * Web Push delivery with Node's own crypto: no third-party package.
 *
 * - Message encryption: RFC 8291 (Message Encryption for Web Push) over the
 *   aes128gcm content coding of RFC 8188, single record.
 * - Sender identity: RFC 8292 VAPID, an ES256 JWT for the push service origin.
 *
 * Endpoints are posted to by the server, so they are restricted to the known
 * browser push services (see PUSH_SERVICE_HOSTS) to keep the subscription API
 * from becoming a request relay to arbitrary hosts.
 */

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  publicKey: string;
  /** P-256 private scalar (32 bytes), base64url. */
  privateKey: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  /** The push service accepted the message (2xx). */
  ok: boolean;
  status: number;
  /** The subscription no longer exists (404/410) and should be removed. */
  gone: boolean;
}

const b64url = (buffer: Buffer): string => buffer.toString('base64url');
const fromB64url = (value: string): Buffer =>
  Buffer.from(value.replace(/=+$/, ''), 'base64url');

/** Push services of Chrome/Android, Firefox, Safari/iOS and Edge. */
const PUSH_SERVICE_HOSTS: (string | RegExp)[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'web.push.apple.com',
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) =>
    typeof allowed === 'string' ? host === allowed : allowed.test(host)
  );
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/** Checks a key pair is a valid, matching P-256 pair. */
export function validVapidKeys(keys: VapidKeys): boolean {
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64url(keys.privateKey));
    return ecdh.getPublicKey().equals(fromB64url(keys.publicKey));
  } catch {
    return false;
  }
}

function vapidSigningKey(keys: VapidKeys): crypto.KeyObject {
  const pub = fromB64url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error('VAPID public key must be an uncompressed P-256 point');
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64url(fromB64url(keys.privateKey)),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

/** RFC 8292 Authorization header value for one push service origin. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: Date = new Date()
): string {
  const header = b64url(
    Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  );
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: subject,
      })
    )
  );
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidSigningKey(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

const RECORD_SIZE = 4096;

/**
 * RFC 8291 encryption of one message for one subscription. `salt` and
 * `senderPrivateKey` are injectable only so tests can use fixed vectors.
 */
export function encryptPushPayload(
  plaintext: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed: { salt?: Buffer; senderPrivateKey?: Buffer } = {}
): Buffer {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4)
    throw new Error(
      'Subscription key p256dh must be an uncompressed P-256 point'
    );
  if (authSecret.length !== 16)
    throw new Error('Subscription auth secret must be 16 bytes');
  // One record: payload + 0x02 delimiter + 16-byte tag must fit in rs.
  if (plaintext.length > RECORD_SIZE - 17)
    throw new Error('Push payload too large');

  const sender = crypto.createECDH('prime256v1');
  if (fixed.senderPrivateKey) sender.setPrivateKey(fixed.senderPrivateKey);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const ecdhSecret = sender.computeSecret(uaPublic);
  const salt = fixed.salt ?? crypto.randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'latin1'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(
    crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32)
  );
  const cek = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'),
      16
    )
  );
  const nonce = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: nonce\0', 'latin1'),
      12
    )
  );
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

/** Sends one notification. Never throws for HTTP failures; network errors propagate. */
export async function sendWebPush(
  target: PushTarget,
  message: object,
  keys: VapidKeys,
  subject: string,
  options: { ttlSeconds?: number; fetchImpl?: typeof fetch; now?: Date } = {}
): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(target.endpoint))
    throw new Error('Push endpoint is not a known push service');
  const body = encryptPushPayload(
    Buffer.from(JSON.stringify(message), 'utf8'),
    target
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(
          target.endpoint,
          keys,
          subject,
          options.now
        ),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds ?? 3600),
        Urgency: 'high',
      },
      body: new Uint8Array(body),
      signal: controller.signal,
      redirect: 'error',
    });
    return {
      ok: response.ok,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
    };
  } finally {
    clearTimeout(timer);
  }
}
