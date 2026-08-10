import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// These tests exercise the in-memory limiter (no Upstash env vars set), which
// is the path a default deploy runs on. The point under test is bucket
// isolation: spending the AI allowance must not be able to 429 a save.

const AI_MAX = 10;
const SUBMIT_MAX = 30;

function reqFrom(ip, method = "POST") {
  return { method, headers: { "x-forwarded-for": ip }, socket: {} };
}

let guard, guardSubmit, getClientIp;

beforeEach(async () => {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  // Fresh module instance per test so the in-memory window map starts empty.
  ({ guard, guardSubmit, getClientIp } = await import("./_guards.js"));
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("getClientIp", () => {
  it("takes the left-most X-Forwarded-For entry", () => {
    expect(getClientIp({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, socket: {} })).toBe("1.1.1.1");
  });

  it("falls back to the socket address", () => {
    expect(getClientIp({ headers: {}, socket: { remoteAddress: "9.9.9.9" } })).toBe("9.9.9.9");
  });
});

describe("guard (AI routes)", () => {
  it("rejects non-POST", async () => {
    expect(await guard(reqFrom("1.2.3.4", "GET"))).toMatchObject({ status: 405 });
  });

  it("500s when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await guard(reqFrom("1.2.3.4"))).toMatchObject({ status: 500 });
  });

  it("allows up to the AI limit, then 429s", async () => {
    for (let i = 0; i < AI_MAX; i++) {
      expect(await guard(reqFrom("5.5.5.5"))).toBeNull();
    }
    expect(await guard(reqFrom("5.5.5.5"))).toMatchObject({ status: 429 });
  });
});

describe("guardSubmit", () => {
  it("rejects non-POST", async () => {
    expect(await guardSubmit(reqFrom("1.2.3.4", "GET"))).toMatchObject({ status: 405 });
  });

  it("does NOT require ANTHROPIC_API_KEY", async () => {
    // The regression this whole change exists to prevent: a deploy without an
    // Anthropic key used to 500 on the one endpoint that builds the dataset.
    delete process.env.ANTHROPIC_API_KEY;
    expect(await guardSubmit(reqFrom("1.2.3.4"))).toBeNull();
  });

  it("is not consumed by AI traffic from the same IP", async () => {
    // Exhaust the AI bucket entirely...
    for (let i = 0; i < AI_MAX + 5; i++) await guard(reqFrom("7.7.7.7"));
    expect(await guard(reqFrom("7.7.7.7"))).toMatchObject({ status: 429 });
    // ...the save must still go through.
    expect(await guardSubmit(reqFrom("7.7.7.7"))).toBeNull();
  });

  it("still enforces its own, roomier limit", async () => {
    for (let i = 0; i < SUBMIT_MAX; i++) {
      expect(await guardSubmit(reqFrom("8.8.8.8"))).toBeNull();
    }
    expect(await guardSubmit(reqFrom("8.8.8.8"))).toMatchObject({ status: 429 });
  });

  it("limits per IP, not globally", async () => {
    for (let i = 0; i < SUBMIT_MAX; i++) await guardSubmit(reqFrom("8.8.8.8"));
    expect(await guardSubmit(reqFrom("8.8.8.9"))).toBeNull();
  });
});
