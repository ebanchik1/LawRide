// Funnel telemetry client.
//
// Primary sink is our own /api/event → Supabase `events` table. Vercel Web
// Analytics is a secondary, best-effort ping only: it does not support custom
// events on Hobby, caps custom events at 2 properties on Pro, and keeps Hobby
// data for one month. It is fine as a convenience dashboard; it cannot be the
// source of truth for the gate.
//
// Rules this module enforces so call sites can't get them wrong:
//   1. Every event carries the session id, so estimate → save is joinable.
//   2. Telemetry never throws into the app and never blocks a user action.
//   3. sendBeacon when available, so events fired during navigation survive.

import { track } from "@vercel/analytics";

const ENDPOINT = "/api/event";

// Injected in tests; in the browser these come from globalThis.
function defaultDeps() {
  return {
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    fetch: typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined,
    BlobCtor: typeof Blob !== "undefined" ? Blob : undefined,
  };
}

// Fire-and-forget POST. Returns the transport actually used, which is what the
// tests assert on; callers ignore it.
//
// `ids` is { visitorId, sessionId } — see src/lib/session.js for why both.
export function sendEvent(name, ids, props, deps) {
  const d = { ...defaultDeps(), ...(deps || {}) };

  let payload;
  try {
    // Inside the try on purpose: JSON.stringify throws on BigInt and on
    // circular values, and this module's whole contract is that telemetry
    // cannot throw into the app. If it did, saveResults' catch would fire a
    // second terminal event and the funnel would double-count.
    payload = JSON.stringify({
      name,
      visitor_id: ids?.visitorId ?? null,
      session_id: ids?.sessionId ?? null,
      props: props || null,
    });
  } catch {
    return "none";
  }

  try {
    if (d.navigator && typeof d.navigator.sendBeacon === "function" && d.BlobCtor) {
      // A beacon survives the page being unloaded — important for events fired
      // as the user navigates away, which is precisely when drop-off happens.
      const blob = new d.BlobCtor([payload], { type: "application/json" });
      if (d.navigator.sendBeacon(ENDPOINT, blob)) return "beacon";
    }
  } catch { /* fall through to fetch */ }

  try {
    if (d.fetch) {
      // keepalive lets the request outlive the page too, on browsers where the
      // beacon path is unavailable.
      d.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
      return "fetch";
    }
  } catch { /* nothing left to try */ }

  return "none";
}

// Best-effort mirror to Vercel's dashboard. Name only — the 2-property cap on
// Pro makes passing our full prop set pointless, and Hobby drops it entirely.
export function mirrorToVercel(name, trackFn) {
  try {
    (trackFn || track)(name);
  } catch { /* analytics must never break the app */ }
}
