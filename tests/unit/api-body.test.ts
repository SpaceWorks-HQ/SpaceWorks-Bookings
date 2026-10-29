import { describe, expect, it } from "vitest";
import { jsonBody } from "@/lib/api/handler";

describe("bounded API request bodies", () => {
  it("reads JSON and treats absent bodies as empty objects", async () => {
    expect(await jsonBody(new Request("https://example.test"))).toEqual({});
    expect(await jsonBody(new Request("https://example.test", { method: "POST", body: '{"name":"Room"}' }))).toEqual({ name: "Room" });
  });

  it("rejects invalid JSON without exposing the body", async () => {
    await expect(jsonBody(new Request("https://example.test", { method: "POST", body: "secret invalid input" })))
      .rejects.toMatchObject({ code: "INVALID_INPUT", message: "The request body isn't valid JSON." });
  });

  it("stops consuming a chunked upload once the byte limit is exceeded", async () => {
    let cancelled = false;
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(32_768)); },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://example.test", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(jsonBody(request)).rejects.toMatchObject({ code: "INVALID_INPUT", message: "The request body is too large." });
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThanOrEqual(4);
  });

  it("bounds bytes rather than UTF-16 characters", async () => {
    const body = JSON.stringify({ value: "अ".repeat(25_000) });
    expect(body.length).toBeLessThan(65_536);
    await expect(jsonBody(new Request("https://example.test", { method: "POST", body })))
      .rejects.toMatchObject({ message: "The request body is too large." });
  });
});
