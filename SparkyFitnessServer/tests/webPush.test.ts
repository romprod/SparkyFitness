import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  validVapidKeys,
  vapidAuthorization,
} from '../services/webPush.js';

/** RFC 8291 receiver side, written independently of the sender. */
function decrypt(body: Buffer, ua: crypto.ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPublic);
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    ua.getPublicKey(),
    asPublic,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, info, 32));
  const cek = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: aes128gcm\0'),
      16
    )
  );
  const nonce = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: nonce\0'),
      12
    )
  );
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

const receiver = () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ua,
    auth,
    target: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
};

describe('web push encryption (RFC 8291)', () => {
  it('matches a fixed vector that the http_ece reference decryptor accepts', () => {
    // Vector produced once and decrypted with http_ece 1.2.0 (aes128gcm).
    const ua = crypto.createECDH('prime256v1');
    ua.setPrivateKey(Buffer.alloc(32, 7));
    const body = encryptPushPayload(
      Buffer.from('Sertraline is due'),
      {
        p256dh: ua.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16, 9).toString('base64url'),
      },
      { salt: Buffer.alloc(16, 3), senderPrivateKey: Buffer.alloc(32, 5) }
    );
    expect(body.toString('base64url')).toBe(
      'AwMDAwMDAwMDAwMDAwMDAwAAEABBBAeBDql0zqV3PmO4l_N-O-mgnnpf6blxpE0QZawqOpMRY35HpPmUZKD9zkSojsfXA6kYPB0GVS2eLWt2BpSBxXeZedcia45jgRNOZ4pW0oa5STvfzAmnKogiBAM_8ETsEKzv'
    );
  });

  it('round-trips through an independent receiver with a fresh key and salt each time', () => {
    const { ua, auth, target } = receiver();
    const a = encryptPushPayload(Buffer.from('{"title":"Due"}'), target);
    const b = encryptPushPayload(Buffer.from('{"title":"Due"}'), target);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, ua, auth)).toBe('{"title":"Due"}');
    expect(a.readUInt32BE(16)).toBe(4096);
  });

  it('rejects malformed subscription keys and oversized payloads', () => {
    const { target } = receiver();
    expect(() =>
      encryptPushPayload(Buffer.from('x'), { ...target, auth: 'AAAA' })
    ).toThrow(/16 bytes/);
    expect(() =>
      encryptPushPayload(Buffer.from('x'), { ...target, p256dh: 'AAAA' })
    ).toThrow(/P-256/);
    expect(() => encryptPushPayload(Buffer.alloc(4080), target)).toThrow(
      /too large/
    );
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 token for the push service origin', () => {
    const keys = generateVapidKeys();
    expect(validVapidKeys(keys)).toBe(true);
    expect(
      validVapidKeys({ ...keys, publicKey: generateVapidKeys().publicKey })
    ).toBe(false);
    const value = vapidAuthorization(
      'https://web.push.apple.com/QH1/abc',
      keys,
      'https://health.example',
      new Date('2026-11-19T00:00:00Z')
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(value);
    expect(match).not.toBeNull();
    const [, header, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      aud: 'https://web.push.apple.com',
      exp: Date.parse('2026-11-19T12:00:00Z') / 1000,
      sub: 'https://health.example',
    });
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature!, 'base64url')
      )
    ).toBe(true);
  });
});

describe('push endpoints', () => {
  it('accepts only known browser push services over https', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://web.push.apple.com/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ])
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://evil.example/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://10.0.0.1/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ])
      expect(isAllowedPushEndpoint(bad)).toBe(false);
  });

  it('posts an encrypted body with VAPID headers and reports gone subscriptions', async () => {
    const { ua, auth, target } = receiver();
    const keys = generateVapidKeys();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    const first = await sendWebPush(
      target,
      { title: 'Due' },
      keys,
      'https://h',
      {
        fetchImpl,
      }
    );
    expect(first).toEqual({ ok: true, status: 201, gone: false });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(target.endpoint);
    expect(init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(init.headers.TTL).toBe('3600');
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(init.redirect).toBe('error');
    expect(JSON.parse(decrypt(Buffer.from(init.body), ua, auth))).toEqual({
      title: 'Due',
    });
    expect(
      await sendWebPush(target, { title: 'Due' }, keys, 'https://h', {
        fetchImpl,
      })
    ).toEqual({ ok: false, status: 410, gone: true });
    await expect(
      sendWebPush(
        { ...target, endpoint: 'https://evil.example/x' },
        {},
        keys,
        'https://h',
        {
          fetchImpl,
        }
      )
    ).rejects.toThrow(/not a known push service/);
  });
});
