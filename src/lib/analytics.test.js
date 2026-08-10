import { describe, it, expect, vi } from "vitest";
import { sendEvent, mirrorToVercel } from "./analytics.js";

// Both ids travel on every event — per-visit and per-person conversion are
// different numbers and the funnel needs to separate them.
// Hex, because api/submit.js and api/event.js validate against /^[a-f0-9]{8,64}$/
// and silently null anything else.
const IDS = { sessionId: "dead5678f00d", visitorId: "beef1234cafe" };

class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts?.type; }
  text() { return this.parts.join(""); }
}

function deps({ beacon, fetchFn } = {}) {
  return {
    navigator: beacon ? { sendBeacon: beacon } : {},
    fetch: fetchFn,
    BlobCtor: FakeBlob,
  };
}

describe("sendEvent", () => {
  it("prefers sendBeacon and posts name, session id and props", () => {
    const beacon = vi.fn(() => true);
    expect(sendEvent("estimate_run", IDS, { schools: 3 }, deps({ beacon }))).toBe("beacon");

    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/event");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(blob.text())).toEqual({
      name: "estimate_run",
      session_id: "dead5678f00d",
      visitor_id: "beef1234cafe",
      props: { schools: 3 },
    });
  });

  it("falls back to fetch when sendBeacon reports failure", () => {
    const beacon = vi.fn(() => false);
    const fetchFn = vi.fn(() => Promise.resolve());
    expect(sendEvent("save_succeeded", IDS, null, deps({ beacon, fetchFn }))).toBe("fetch");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: "POST", keepalive: true });
  });

  it("falls back to fetch when sendBeacon throws", () => {
    const beacon = vi.fn(() => { throw new Error("blocked"); });
    const fetchFn = vi.fn(() => Promise.resolve());
    expect(sendEvent("save_failed", IDS, { reason: "network" }, deps({ beacon, fetchFn }))).toBe("fetch");
  });

  it("never throws when no transport exists", () => {
    expect(() => sendEvent("returned", IDS, null, { navigator: undefined, fetch: undefined, BlobCtor: undefined }))
      .not.toThrow();
    expect(sendEvent("returned", IDS, null, { navigator: undefined, fetch: undefined, BlobCtor: undefined }))
      .toBe("none");
  });

  it("swallows a rejected fetch instead of surfacing an unhandled rejection", () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("offline")));
    expect(() => sendEvent("estimate_run", IDS, null, deps({ fetchFn }))).not.toThrow();
  });

  it("sends props as null rather than undefined when omitted", () => {
    const beacon = vi.fn(() => true);
    sendEvent("session_start", IDS, undefined, deps({ beacon }));
    expect(JSON.parse(beacon.mock.calls[0][1].text()).props).toBeNull();
  });
});

describe("mirrorToVercel", () => {
  it("sends the bare event name only (Pro caps custom events at 2 properties)", () => {
    const trackFn = vi.fn();
    mirrorToVercel("estimate_run", trackFn);
    expect(trackFn).toHaveBeenCalledWith("estimate_run");
  });

  it("never lets a Vercel analytics failure reach the caller", () => {
    const trackFn = vi.fn(() => { throw new Error("blocked by adblocker"); });
    expect(() => mirrorToVercel("estimate_run", trackFn)).not.toThrow();
  });
});
