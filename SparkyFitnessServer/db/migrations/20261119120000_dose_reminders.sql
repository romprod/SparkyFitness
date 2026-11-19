-- Dose reminders delivered as Web Push notifications (RFC 8030/8291/8292).
--
-- web_push_subscriptions: one row per browser or installed web app that turned
-- reminders on. The endpoint identifies one device, so the latest account to
-- enable a device owns it (writes go through the owner pool). Owner-only reads.
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user ON public.web_push_subscriptions(user_id);

-- Per-owner reminder preferences. Absent row means the defaults below.
CREATE TABLE IF NOT EXISTS public.medication_reminder_settings (
  user_id UUID PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  untimed_time TEXT NOT NULL DEFAULT '08:00' CHECK (untimed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  nag_enabled BOOLEAN NOT NULL DEFAULT true,
  nag_time TEXT NOT NULL DEFAULT '18:00' CHECK (nag_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  include_supplements BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly-once ledger: inserting the (owner, local day, key) row is the claim to
-- send that reminder. A claim is released only when nothing was delivered.
CREATE TABLE IF NOT EXISTS public.medication_reminder_sends (
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  reminder_day DATE NOT NULL,
  reminder_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'pending' CHECK (channel IN ('pending', 'webpush')),
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reminder_day, reminder_key)
);

-- The server's VAPID key pair, created on first use. The private key is
-- encrypted with the server's API encryption key. Owner pool only.
CREATE TABLE IF NOT EXISTS system.web_push_vapid (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  private_key_iv TEXT NOT NULL,
  private_key_tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
