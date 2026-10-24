# Email and chat notifications

## Email

Two kinds of email go out, through two routes.

| Kind | Examples | Sent through |
|---|---|---|
| Account emails | password reset, email verification, sign-in links, sign-in codes, new-device alerts, first-manager invites, makerspace review notices | the platform's SMTP (Super admin → Settings, or `SMTP_*`) |
| Customer emails | payment received (with the receipt), offline payment not confirmed, refund processed (with the credit note); Phase 1 adds the booking emails | the makerspace's own SMTP when set up and on; otherwise the platform's |

**A makerspace's own email** lives in Settings → Email (bookings managers): sender name and address,
reply-to, SMTP host, port (587 or 2525 STARTTLS, 465 TLS, 25), login and password. The password is stored
encrypted (`PAYMENT_SECRETS_KEY`, a key derived for email). **Send test email** sends to the person testing and
records when it last went through. In production TLS is required and the host must resolve to public addresses.

Without its own settings a makerspace's customer emails come from the platform address but in the
makerspace's name (`"Kunj Company" <noreply@platform>`), with replies going to its contact email.

Code: `sendBrandedEmail({ makerspaceId, … })` in `lib/email/message.ts` picks the route through
`makerspaceEmailTransport` (`lib/email/makerspaceTransport.ts`); emails without `makerspaceId` use the platform.

## Delivery

Every email and chat alert is a row in the database outbox (`OutboxMessage`), written in the same transaction
as the event, with ids rather than content where it can. The BullMQ worker delivers it (the `outbox-relay` job
enqueues due rows by id every five seconds), retries with backoff and records the last error. Rows that carry a
bearer link (password reset, verification, sign-in link, invites) are deleted once sent. Failed rows show in
Super admin → Operations and failed queue jobs in Super admin → Jobs.

## Chat alerts

Settings → Notifications (bookings managers) holds up to ten chat channels per makerspace. Each picks
its alerts:

| Alert | When |
|---|---|
| Payment received | a gateway or offline payment settles |
| Payment waiting to be confirmed | a recorded offline payment needs a second person |

Phase 1 adds booking alerts. Alerts are team-only and short: what happened, the amount and a link to the
dashboard. Customer names appear only when the channel turns on **Show customer names**. A channel the provider
no longer accepts (deleted webhook, removed bot, revoked token) is switched off and its error shown. The database
accepts only the event names in `lib/chat/events.ts`.

### Setting up each service

- **Slack:** add the *Incoming Webhooks* app to a channel and paste its URL (`https://hooks.slack.com/services/…`).
- **Discord:** channel settings → Integrations → Webhooks → New webhook → *Copy webhook URL*
  (`https://discord.com/api/webhooks/…`). Mentions are disabled in every alert.
- **Mattermost:** Integrations → Incoming webhooks → Add, then paste the URL (`https://your-server/hooks/…`).
  The server must be reachable over HTTPS at a public address.
- **Telegram:** create a bot with @BotFather, add it to your group or channel, and use the bot token and the
  chat's numeric ID (or `@channelname` for a public channel).
- **WhatsApp:** uses the WhatsApp Business Cloud API (Meta). In WhatsApp Manager create a *Utility* template
  named `team_alert`, language English (`en`), whose body is exactly `{{1}}`, and get it approved. Then enter the
  phone number ID, a permanent access token (a system user token), and up to five recipient numbers with the
  country code. Business-started WhatsApp messages can only use approved templates; each alert is sent as that
  template's one parameter, on a single line.

Destinations are stored encrypted (`PAYMENT_SECRETS_KEY`, a key derived for chat). Slack, Discord, Telegram and
WhatsApp only ever post to their own provider's address; nothing follows redirects.

Code: `lib/chat/*` (`events.ts`, `config.ts`, `send.ts`, `message.ts`, `notify.ts`); `queueChatAlerts` is called
where each event happens.
