/** Team alerts a chat channel can receive. Client-safe; the database checks the same list (migration 0001_init). */
export const CHAT_EVENTS = ["payment", "payment-to-confirm"] as const;
export type ChatEvent = (typeof CHAT_EVENTS)[number];

export const CHAT_EVENT_LABELS: Record<ChatEvent, string> = {
  payment: "Payment received",
  "payment-to-confirm": "Payment waiting to be confirmed",
};

export const CHAT_KINDS = ["SLACK", "DISCORD", "MATTERMOST", "TELEGRAM", "WHATSAPP"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const CHAT_KIND_LABELS: Record<ChatKind, string> = {
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};

/** The WhatsApp message template makerspaces create and get approved in Meta's WhatsApp Manager. */
export const WHATSAPP_TEMPLATE = { name: "team_alert", language: "en", body: "{{1}}" } as const;
