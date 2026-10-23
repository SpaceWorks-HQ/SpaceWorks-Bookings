import { test as base, expect } from "@playwright/test";

/**
 * Every test signs in from its own client address. Test servers trust the header named in
 * PLAYWRIGHT_TRUSTED_IP_HEADER (the split and whole-VPS runs set it), so one test's sign-ins and bookings never use
 * up another's rate limits (10 sign-in requests a minute per address). Without the variable nothing is sent.
 */
let counter = 0;
const clientAddress = () => `198.51.100.${(process.pid + counter++) % 250 + 1}`;

export const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    const header = process.env.PLAYWRIGHT_TRUSTED_IP_HEADER;
    await provide(header ? { [header]: clientAddress() } : {});
  },
});

export { expect };
