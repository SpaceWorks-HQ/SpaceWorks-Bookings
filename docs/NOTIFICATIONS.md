# Email and chat notifications

## Email

Two kinds of email go out, through two routes.

| Kind | Examples | Sent through |
|---|---|---|
| Account emails | password reset, email verification, sign-in codes, new-device alerts, owner invites, makerspace review notices, monthly report digest | the platform's SMTP (Super admin → Settings, or `SMTP_*`) |
| Member emails | membership notices and reminders, receipts and credit notes, member invites, ID cards, refund and erasure replies | the makerspace's own SMTP when set up and on; otherwise the platform's |

**A makerspace's own email** lives in Settings → Email (owners and managers): sender name and address,
reply-to, SMTP host, port (587 or 2525 STARTTLS, 465 TLS, 25), login and password. The password is stored
encrypted (`PAYMENT_SECRETS_KEY`, a key derived for email). **Send test email** sends to the person testing and
records when it last went through. In production TLS is required and the host must resolve to public addresses.

Without its own settings a makerspace's member emails come from the platform address but in the
makerspace's name (`"Kunj Company" <noreply@platform>`), with replies going to its contact email.

Code: `sendBrandedEmail({ makerspaceId, … })` in `lib/email/message.ts` picks the route through
`makerspaceEmailTransport` (`lib/email/makerspaceTransport.ts`); emails without `makerspaceId` use the platform.

## Chat alerts

Settings → Notifications (owners and managers) holds up to ten chat channels per makerspace. Each picks
its alerts:

| Alert | When |
|---|---|
| New application to review | someone applies to a plan that needs approval |
| Payment received | a gateway or offline payment settles |
| Payment waiting to be confirmed | a member submits a UPI or bank reference, or a recorded payment needs a second person |
| Member asked for a refund | a refund request is opened |
| Member asked to erase their details | an erasure request is opened |
| Member left | a member leaves from their account |
| Monthly summary | the first scheduler pass of each month: active members, joined, lapsed, waiting |

Alerts are team-only and short: what happened, member number, plan, amount, and a link to the dashboard.
Member names appear only when the channel turns on **Show member names**; erasure requests never carry a name.
Alerts are queued in the same transaction as the event and sent by the scheduler with retries. A channel the
provider no longer accepts (deleted webhook, removed bot, revoked token) is switched off and its error shown.

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
