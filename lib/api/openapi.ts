import { WEBHOOK_EVENTS } from "@/lib/integrations/webhooks/events";

/** The OpenAPI 3.1 document served at `/api/v1/openapi.json` (kept beside the routes; a unit test checks they match). */

const error = { $ref: "#/components/responses/Error" };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
const read = [{ apiKey: ["read"] }];
const write = [{ apiKey: ["write"] }];
const referenceParam = { name: "reference", in: "path", required: true, schema: { type: "string", example: "BK-7Q2M9X" } };

export const API_PATHS = ["/spaces", "/spaces/{spaceId}/availability", "/bookings", "/bookings/{reference}", "/bookings/{reference}/cancel", "/members"] as const;

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Space Works Bookings API",
      version: "1",
      description: "Read a makerspace's spaces, availability and bookings, create and cancel bookings, and keep the member-rate list. Authenticate with an API key from Settings, Integrations: `Authorization: Bearer swb_…`. Keys have `read` and/or `write` scope. Amounts are integer minor units in the booking's currency; times are ISO 8601 in UTC.",
      license: { name: "AGPL-3.0-or-later", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
    },
    servers: [{ url: "/api/v1" }],
    security: [{ apiKey: [] }],
    paths: {
      "/spaces": { get: { summary: "Published spaces with their rates", security: read, responses: { 200: json({ type: "object", properties: { data: { type: "array", items: ref("Space") } } }), default: error } } },
      "/spaces/{spaceId}/availability": {
        get: {
          summary: "Free start times on a local date", security: read,
          parameters: [
            { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
            { name: "date", in: "query", required: true, schema: { type: "string", format: "date" }, description: "Local date in the makerspace's time zone" },
            { name: "duration", in: "query", required: true, schema: { type: "integer", minimum: 1 }, description: "Minutes" },
            { name: "quantity", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          ],
          responses: { 200: json({ type: "object", properties: { date: { type: "string" }, timeZone: { type: "string" }, durationMinutes: { type: "integer" }, starts: { type: "array", items: { type: "string", format: "date-time" } } } }), default: error },
        },
      },
      "/bookings": {
        get: {
          summary: "Submitted bookings, newest first", security: read,
          parameters: [
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } }, { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["HELD", "REQUESTED", "CONFIRMED", "DECLINED", "EXPIRED", "CANCELLED"] } },
            { name: "cursor", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: { 200: json({ type: "object", properties: { data: { type: "array", items: ref("Booking") }, nextCursor: { type: ["string", "null"] } } }), default: error },
        },
        post: {
          summary: "Book a space for a customer", description: "The space's rules apply as for the front desk (no overrides). Paid spaces end up held awaiting payment, confirmed with a due date (pay later), or requested for approval.", security: write,
          requestBody: { required: true, content: { "application/json": { schema: ref("NewBooking") } } },
          responses: { 201: json({ type: "object", properties: { data: ref("Booking") } }, "Created"), default: error },
        },
      },
      "/bookings/{reference}": { get: { summary: "One booking", security: read, parameters: [referenceParam], responses: { 200: json({ type: "object", properties: { data: ref("Booking") } }), default: error } } },
      "/bookings/{reference}/cancel": {
        post: {
          summary: "Cancel for the customer", description: "The booking's frozen cancellation policy applies; refunds of what was paid follow automatically.", security: write, parameters: [referenceParam],
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string", maxLength: 1000 } } } } } },
          responses: { 200: json({ type: "object", properties: { data: ref("Booking") } }), default: error },
        },
      },
      "/members": {
        put: { summary: "Add or update a member-rate entry", security: write, requestBody: { required: true, content: { "application/json": { schema: ref("Member") } } }, responses: { 200: json({ type: "object", properties: { data: ref("Member") } }), default: error } },
        delete: { summary: "Remove a member-rate entry", security: write, parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }], responses: { 204: { description: "Removed" }, default: error } },
      },
    },
    webhooks: Object.fromEntries(WEBHOOK_EVENTS.map((event) => [event, {
      post: {
        summary: event, description: "Signed with `X-SpaceWorks-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"<t>.<body>\">` using the endpoint secret. Answer 2xx within 10 seconds; anything else is retried with backoff for about two days.",
        requestBody: { content: { "application/json": { schema: ref("WebhookEvent") } } }, responses: { 200: { description: "Received" } },
      },
    }])),
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "swb_<prefix>_<secret>" } },
      responses: { Error: json({ type: "object", properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "object", additionalProperties: { type: "string" } } } } } }, "Error") },
      schemas: {
        Space: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["ROOM", "STUDIO", "DESK", "HALL", "OTHER"] }, summary: { type: "string" }, capacity: { type: "integer" }, units: { type: "integer" }, amenities: { type: "array", items: { type: "string" } }, rates: { type: "object", additionalProperties: { type: ["integer", "null"] } } } },
        Occurrence: { type: "object", properties: { id: { type: "string" }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" }, unit: { type: "integer" }, status: { type: "string" } } },
        Booking: {
          type: "object",
          properties: {
            id: { type: "string" }, reference: { type: "string" }, status: { type: "string" }, source: { type: "string" },
            space: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" } } },
            quantity: { type: "integer" }, attendees: { type: "integer" }, purpose: { type: "string" },
            customer: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: ["string", "null"] } } },
            rate: { type: "string", enum: ["PUBLIC", "MEMBER"] }, chargeMode: { type: "string" }, currency: { type: "string" },
            totalMinor: { type: "integer" }, chargeMinor: { type: "integer" }, paidMinor: { type: "integer" }, refundedMinor: { type: "integer" },
            paymentState: { type: "string", enum: ["NOT_REQUIRED", "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "WRITTEN_OFF", "REFUND_DUE", "REFUNDED"] },
            paymentDueAt: { type: ["string", "null"], format: "date-time" }, occurrences: { type: "array", items: ref("Occurrence") },
            createdAt: { type: "string", format: "date-time" }, confirmedAt: { type: ["string", "null"], format: "date-time" }, cancelledAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        NewBooking: {
          type: "object", required: ["spaceId", "start", "end", "customer"],
          properties: {
            spaceId: { type: "string" }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" }, quantity: { type: "integer", minimum: 1, default: 1 },
            attendees: { type: "integer", minimum: 1, default: 1 }, purpose: { type: "string" }, payLater: { type: "boolean" },
            customer: { type: "object", required: ["name", "email"], properties: { name: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: ["string", "null"] } } },
          },
        },
        Member: { type: "object", required: ["email", "name"], properties: { id: { type: "string" }, email: { type: "string", format: "email" }, name: { type: "string" }, validUntil: { type: ["string", "null"], format: "date" }, note: { type: "string" } } },
        WebhookEvent: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: [...WEBHOOK_EVENTS, "ping"] }, createdAt: { type: "string", format: "date-time" }, makerspace: { type: "string" }, data: { type: "object" } } },
      },
    },
  };
}
