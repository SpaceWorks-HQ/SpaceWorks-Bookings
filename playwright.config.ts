import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3000);
const testBaseUrl = `http://127.0.0.1:${testPort}`;
const defaultServerCommand = process.env.PLAYWRIGHT_PRODUCTION_SERVER === "1"
  ? `PORT=${testPort} node .next/standalone/server.js`
  : `PORT=${testPort} npm run dev`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Signed-in journeys share the seeded demo makerspaces, so files run one after another.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The development server compiles each route on first visit, which is slow on CI runners.
  timeout: process.env.CI ? 120_000 : 60_000,
  use: {
    // Use IPv4 explicitly: on this workstation localhost/::1 is served by a
    // separate development app while SpaceWorks Bookings is bound on 127.0.0.1.
    baseURL: testBaseUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_COMMAND || defaultServerCommand,
    url: `${testBaseUrl}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
