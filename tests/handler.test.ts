import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handler } from "../src/handler.js";

const originalFetch = globalThis.fetch;

function mockFetchOk(html: string) {
  globalThis.fetch = (async () => ({
      ok: true,
      text: async () => html,
  } as any)) as unknown as typeof fetch;
}

function mockFetchFail(status = 500, statusText = "Internal Server Error") {
  globalThis.fetch = (async () => ({
      ok: false,
      status,
      statusText,
      text: async () => "",
  } as any)) as unknown as typeof fetch;
}

function mockFetchThrow(err: unknown) {
  globalThis.fetch = (async () => {
      throw err;
  }) as unknown as typeof fetch;
}

describe("handler", () => {
  beforeEach(() => {
    // Ensure no email is actually attempted
    process.env.TO_EMAIL = "";
    process.env.FROM_EMAIL = "";
  });

  afterEach(() => {
    // restore fetch after each test
    globalThis.fetch = originalFetch;
  });

  it("notifies when Add to Cart button exists, says Add to Cart, and is not locked", async () => {
    const html = `
      <html>
        <body>
          <button id="add"> Add to Cart </button>
        </body>
      </html>
    `;
    mockFetchOk(html);

    const res = await handler();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.exists).toBe(true);
      expect(res.saysAddToCart).toBe(true);
      expect(res.locked).toBe(false);
      expect(res.notified).toBe(true);
    }
  });

  it("does not notify when button is disabled/locked", async () => {
    const html = `
      <html>
        <body>
          <button id="add" disabled> Add to Cart </button>
        </body>
      </html>
    `;
    mockFetchOk(html);

    const res = await handler();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.exists).toBe(true);
      expect(res.saysAddToCart).toBe(true);
      expect(res.locked).toBe(true);
      expect(res.notified).toBe(false);
    }
  });

  it("does not notify when button is missing", async () => {
    const html = `
      <html>
        <body>
          <div>No add button here</div>
        </body>
      </html>
    `;
    mockFetchOk(html);

    const res = await handler();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.exists).toBe(false);
      expect(res.saysAddToCart).toBe(false);
      expect(res.locked).toBe(true); // when element missing, treated as locked
      expect(res.notified).toBe(false);
    }
  });

  it("returns failure when fetch responds with non-OK", async () => {
    mockFetchFail(500, "Internal Server Error");

    const res = await handler();

    expect(res.ok).toBe(false);
    if (!res.ok && "message" in res) {
      expect(typeof res.message).toBe("string");
      expect(res.message).toContain("Fetch failed 500");
    }
  });

  it("returns failure when fetch throws", async () => {
    mockFetchThrow(new Error("Network down"));

    const res = await handler();

    expect(res.ok).toBe(false);
    if (!res.ok && "error" in res) {
      expect(typeof res.error).toBe("string");
      expect(res.error).toContain("Network down");
    }
  });
});
