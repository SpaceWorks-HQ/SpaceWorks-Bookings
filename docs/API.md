# REST API and webhooks

Other apps (the Space Works membership platform, Inventory, Machines, or your own scripts) link to Space Works
Bookings only through this API and outbound webhooks. The machine-readable reference is the OpenAPI 3.1 document at
`/api/v1/openapi.json` (`lib/api/openapi.ts`; a unit test checks it lists exactly the routes that exist).

## Keys

Bookings managers create keys under **Settings → Integrations** (`integrations.manage`). A key belongs to one
makerspace and looks like `swb_<12-character prefix>_<secret>`; it is shown once. Only a SHA-256 of the secret is
stored. Revoke a key there at any time; a key also stops working while the makerspace isn't active.

| Scope | Allows |
| --- | --- |
| `read` | spaces and their rates, availability, bookings |
| `write` | creating bookings, cancelling them for the customer, keeping the member-rate list |

Send it as `Authorization: Bearer swb_…`. Writes act as the person who created the key, with the bookings manager's
booking capabilities and never a rule override: the space's rules apply as for the front desk.

Limits per key: 600 reads and 60 writes a minute (plus the platform's per-address limit). Answers are JSON;
amounts are integer minor units in the booking's currency; times are ISO 8601 in UTC.

Errors look like `{ "error": { "code": "SLOT_TAKEN", "message": "That time was just taken.", "fields": {} } }`:
401 `INVALID_KEY`, 403 `INSUFFICIENT_SCOPE` or `FORBIDDEN`, 404 `NOT_FOUND` (also for anything of another
makerspace), 409 `SLOT_TAKEN` or `INVALID_STATE`, 422 `INVALID_INPUT`, 429 `RATE_LIMITED`.

## Endpoints

| Method and path | Scope | What it does |
| --- | --- | --- |
| `GET /api/v1/spaces` | read | Published spaces with capacity, units, amenities and rates |
| `GET /api/v1/spaces/{spaceId}/availability?date=YYYY-MM-DD&duration=60&quantity=1` | read | Free start times on a local date |
| `GET /api/v1/bookings?from&to&status&cursor&limit` | read | Submitted bookings, newest first; `nextCursor` pages on |
| `GET /api/v1/bookings/{reference}` | read | One booking with its times and money |
| `POST /api/v1/bookings` | write | Book a space for a customer (`spaceId`, `start`, `end`, `customer { name, email }`, optional `quantity`, `attendees`, `purpose`, `payLater`) |
| `POST /api/v1/bookings/{reference}/cancel` | write | Cancel for the customer; the booking's cancellation policy applies and refunds follow |
| `PUT /api/v1/members` | write | Add or update a member-rate entry (`email`, `name`, optional `validUntil`, `note`) |
| `DELETE /api/v1/members?email=` | write | Remove a member-rate entry |

A paid space booked through the API ends up as it would at the desk: held awaiting payment, confirmed with a due date
(pay later), or requested when the space needs approval. The customer pays from the link in their email.

## Webhooks

Add endpoints under **Settings → Integrations**: a public `https://` URL and the events it wants. Each endpoint gets
a signing secret, shown once (rotate it there). Space Works Bookings POSTs JSON:

```json
{ "id": "<event id>", "type": "booking.confirmed", "createdAt": "2026-10-24T09:30:00.000Z", "makerspace": "tinkerspace",
  "data": { "occurrenceId": null, "booking": { "id": "…", "reference": "BK-7Q2M9X", "status": "CONFIRMED", "space": { "id": "…", "slug": "meeting-room" },
    "quantity": 1, "attendees": 4, "currency": "INR", "totalMinor": 100000, "chargeMinor": 100000, "paidMinor": 0, "refundedMinor": 0,
    "paymentState": "UNPAID", "paymentDueAt": "…", "occurrences": [ … ], "startsAt": "…" } } }
```

Payloads carry ids, times and amounts only, never names, emails, phone numbers or notes; fetch the booking through
the API when you need the customer.

Events: `booking.requested`, `booking.confirmed`, `booking.declined`, `booking.expired`, `booking.cancelled`,
`booking.rescheduled`, `booking.moved`, `booking.checked_in`, `booking.no_show`, `booking.completed`,
`payment.received`, `refund.created`, `booking.written_off`, and `ping` (the test button).

Headers: `X-SpaceWorks-Event`, `X-SpaceWorks-Delivery` (unique per delivery; deliveries can repeat after a timeout, so
de-duplicate on the body's `id`), and `X-SpaceWorks-Signature: t=<unix seconds>,v1=<hex>` where `v1` is
HMAC-SHA256 of `<t>.<raw body>` with the endpoint secret. Verify it, and refuse old `t` values:

```js
const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(request.headers["x-spaceworks-signature"]);
const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
if (!fresh || !crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"))) reject();
```

Answer 2xx within 10 seconds. Anything else is retried after 1 minute, 5 minutes, 30 minutes, 2, 6, 12 and 24 hours,
then marked failed. Only public addresses are called (no private or internal hosts, no redirects). An endpoint that
fails 25 deliveries in a row is switched off (audited); switch it back on after fixing it. The last 30 deliveries are
listed on the Integrations page.

How it works: the booking timeline (`BookingEvent`, written in each change's own transaction) is the outbox. The
`webhooks-relay` job turns new events into `WebhookDelivery` rows (unique per endpoint and event) and
`webhooks-deliver` sends them (`lib/integrations/webhooks/*`).
