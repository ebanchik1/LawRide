import { describe, it, expect, beforeEach } from "vitest";
import { makeSessionId, getSession, _resetMemoryIds } from "./session.js";

// Minimal Storage stand-in.
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

// A storage that throws on every access (private mode / storage disabled).
const throwingStore = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
};

// Crypto stub: deterministic but advancing, so successive ids differ (the real
// thing does too, and a stub that returned one constant would hide bugs where
// the visitor and session ids collide).
let cryptoSeed = 0;
const fakeCrypto = {
  getRandomValues(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = (cryptoSeed + i) & 0xff;
    cryptoSeed += 17;
    return arr;
  },
};

const SERVER_RE = /^[a-f0-9]{8,64}$/; // must match api/submit.js + api/event.js

describe("makeSessionId", () => {
  it("returns 16 lowercase hex chars from crypto", () => {
    expect(makeSessionId({ getRandomValues: (a) => { a.forEach((_, i) => { a[i] = i; }); return a; } }))
      .toBe("0001020304050607");
  });

  it("falls back to a 16-hex-char id when crypto is unavailable", () => {
    expect(makeSessionId({})).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces ids the server-side validators accept", () => {
    // A mismatch here would silently null out every id server-side and break
    // the join this whole change exists for.
    for (let i = 0; i < 500; i++) expect(SERVER_RE.test(makeSessionId({}))).toBe(true);
    expect(SERVER_RE.test(makeSessionId(fakeCrypto))).toBe(true);
  });
});

describe("getSession", () => {
  beforeEach(() => { _resetMemoryIds(); cryptoSeed = 0; });

  const opts = (local, session) => ({ localStorage: local, sessionStorage: session, crypto: fakeCrypto });

  it("mints both ids on a first-ever visit and reports returning:false", () => {
    const local = fakeStore(), session = fakeStore();
    const s = getSession(opts(local, session));
    expect(s.returning).toBe(false);
    expect(local._data.lr_vid).toBe(s.visitorId);
    expect(session._data.lr_sid).toBe(s.sessionId);
  });

  it("reuses the visitor id and reports returning:true on a later visit", () => {
    // Second visit: visitor id survived in localStorage, sessionStorage (which
    // dies with the tab) is empty. That combination IS a return.
    const s = getSession(opts(fakeStore({ lr_vid: "aaaabbbbcccc" }), fakeStore()));
    expect(s.visitorId).toBe("aaaabbbbcccc");
    expect(s.returning).toBe(true);
  });

  it("gives a returning visitor a NEW session id", () => {
    // The distinction the whole two-id design exists for: same person, new
    // visit. Per-visit conversion and per-person conversion must be separable.
    const s = getSession(opts(fakeStore({ lr_vid: "aaaabbbbcccc" }), fakeStore()));
    expect(s.sessionId).not.toBe(s.visitorId);
  });

  it("keeps the session id stable within a visit (client-side nav, reload)", () => {
    const local = fakeStore(), session = fakeStore();
    const a = getSession(opts(local, session));
    const b = getSession(opts(local, session));
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.visitorId).toBe(a.visitorId);
  });

  it("does NOT call a reload within the same visit a return", () => {
    // The retention number is the one the roadmap calls the moat surface;
    // counting F5 as a return would quietly inflate it. A return requires a
    // known visitor AND a new session.
    const local = fakeStore(), session = fakeStore();
    getSession(opts(local, session));            // first ever load
    expect(getSession(opts(local, session)).returning).toBe(false); // reload
  });

  it("reports returning:false when sessionStorage is unusable", () => {
    // Without a durable session id every reload looks like a new visit, so the
    // return signal can't be trusted and must not be emitted.
    const local = fakeStore({ lr_vid: "aaaabbbbcccc" });
    const s = getSession(opts(local, throwingStore));
    expect(s.sessionPersisted).toBe(false);
    expect(s.returning).toBe(false);
  });

  it("does not throw when touching storage itself raises SecurityError", () => {
    // Chrome with cookies blocked, sandboxed iframes and Firefox with
    // dom.storage.enabled=false throw on the *property access*, not on
    // getItem. getSession runs at module scope in App.jsx, so a throw here is
    // a blank page, not a lost metric.
    const original = { l: globalThis.localStorage, s: globalThis.sessionStorage };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    try {
      const s = getSession({ crypto: fakeCrypto }); // no overrides → hits globals
      expect(s.visitorId).toMatch(/^[a-f0-9]{16}$/);
      expect(s.returning).toBe(false);
      expect(s.sessionPersisted).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original.l });
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: original.s });
    }
  });

  it("degrades to stable in-memory ids when storage throws", () => {
    const a = getSession(opts(throwingStore, throwingStore));
    const b = getSession(opts(throwingStore, throwingStore));
    expect(a.visitorId).toMatch(/^[a-f0-9]{16}$/);
    expect(b.visitorId).toBe(a.visitorId); // correlates within the page load...
    expect(b.sessionId).toBe(a.sessionId);
    expect(a.returning).toBe(false);       // ...but never claims a false return
  });

  it("degrades when there is no storage at all", () => {
    const a = getSession(opts(null, null));
    expect(getSession(opts(null, null)).visitorId).toBe(a.visitorId);
    expect(a.returning).toBe(false);
  });

  it("keeps the two ids distinct", () => {
    const s = getSession(opts(fakeStore(), fakeStore()));
    expect(s.visitorId).not.toBe(s.sessionId);
  });
});
