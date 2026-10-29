import { createServer } from "node:http";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { isPrivateAddress, pinnedLookup, PrivateHostError, resolvePublicHost } from "@/lib/net/publicHost";
import { postPublicJson } from "@/lib/net/postJson";
import { makerspaceSmtpTransport } from "@/lib/email/makerspaceTransport";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  mocks.lookup.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("tenant outbound destinations", () => {
  it.each([
    "127.0.0.1", "169.254.169.254", "10.0.0.5", "100.100.100.200", "192.168.1.2",
    "::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1",
    "::ffff:169.254.169.254", "::7f00:1", "fec0::1", "fc00::1", "fe80::1", "ff02::1",
    "64:ff9b::7f00:1", "2002:7f00:1::", "2001::1", "2001:db8::1", "3fff::1", "invalid",
  ])("refuses non-public address %s", (address) => expect(isPrivateAddress(address)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"])(
    "accepts public address %s", (address) => expect(isPrivateAddress(address)).toBe(false),
  );

  it("refuses an entire mixed DNS answer before any connection", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(resolvePublicHost("tenant.example.test")).rejects.toBeInstanceOf(PrivateHostError);
    await expect(resolvePublicHost("[::1]")).rejects.toBeInstanceOf(PrivateHostError);
  });

  it("pins SMTP to a vetted literal while checking TLS against the original hostname", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const create = vi.spyOn(nodemailer, "createTransport");
    const transport = await makerspaceSmtpTransport({ smtpHost: "smtp.example.test", smtpPort: 587, smtpSecure: false, smtpUser: "fixture", password: "fixture-password" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      host: "8.8.8.8", requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: "smtp.example.test" },
      disableFileAccess: true, disableUrlAccess: true,
    }));
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    transport.close();
  });

  it("answers both socket lookup shapes without performing DNS again", () => {
    const addresses = [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }];
    const lookup = pinnedLookup(addresses);
    const callback = vi.fn();
    lookup("changed.example.test", { family: 4 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "8.8.8.8", 4);
    lookup("changed.example.test", { all: true } as never, callback);
    expect(callback).toHaveBeenLastCalledWith(null, addresses);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("connects only to the first vetted DNS result and never follows a redirect", async () => {
    vi.stubEnv("NODE_ENV", "test");
    mocks.lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(302, { location: "/private" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture port");
      expect(await postPublicJson(new URL(`http://rebind.example.test:${address.port}/hook`), "{}")).toBe(302);
      expect(mocks.lookup).toHaveBeenCalledTimes(1);
      expect(paths).toEqual(["/hook"]);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
