import { bearerSecretMatches } from "@/lib/bearerSecret";

export const GATEWAY_HEADER = "x-swo-frontend-key";
export const CLIENT_IP_HEADER = "x-swo-frontend-client-ip";

export function isFrontendPeer(headers: Headers) {
  return bearerSecretMatches(headers.get(GATEWAY_HEADER) ? `Bearer ${headers.get(GATEWAY_HEADER)}` : null, process.env.FRONTEND_GATEWAY_SECRET);
}
