// Correlation ids, so the funnel is joinable.
//
// Why this exists: analytics events and `submissions` rows were two disconnected
// datasets. You could count how many estimates ran and count how many rows
// landed in Supabase, but you could not answer the only question the gate
// actually asks — *of the people who ran an estimate, how many saved?* Stamping
// both sides with the same ids makes that a join instead of a guess.
//
// TWO ids, because one cannot answer both questions:
//
//   visitorId  — localStorage, never rotated. Answers "how many PEOPLE saved",
//                and is what makes a return visit attributable to the estimate
//                that person ran last week.
//   sessionId  — sessionStorage, one per visit (survives client-side navigation
//                and reloads within a tab, dies when the tab closes). Answers
//                "how many VISITS converted", which is the funnel proper.
//
// Collapsing these into one id silently mixes the two metrics: a person who
// runs an estimate on Monday without saving and returns Tuesday to save looks
// like 50% conversion by visit and 100% by person, and a single id cannot tell
// you which number you are reading.
//
// Both are first-party random ids, not fingerprints: no PII, no cross-site
// value, and they die when the user clears storage. If storage is unavailable
// (private mode, storage disabled) we fall back to ids held in memory — events
// still correlate within the page load, they just don't survive navigation.
// That degradation is silent by design; a thrown error here would take down the
// whole app for a metric.

const VISITOR_KEY = "lr_vid";
const SESSION_KEY = "lr_sid";

// Module-scoped fallbacks: one id per page load when storage is unusable.
let memoryVisitorId = null;
let memorySessionId = null;

// 16 hex chars from crypto when available, Math.random otherwise. Collision
// risk at this product's scale is irrelevant; unpredictability is not needed
// either — this is a correlation key, not a credential.
export function makeSessionId(cryptoObj) {
  const c = cryptoObj ?? (typeof globalThis !== "undefined" ? globalThis.crypto : undefined);
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(8);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16);
}

// Read-or-mint one id from one storage. Returns { id, existed }.
// `existed` distinguishes a returning visitor (localStorage) or a continuing
// visit (sessionStorage) from a fresh one.
function readOrMint(store, key, cryptoObj, memoGet, memoSet) {
  if (!store) {
    let m = memoGet();
    if (!m) { m = makeSessionId(cryptoObj); memoSet(m); }
    return { id: m, existed: false };
  }
  try {
    const existing = store.getItem(key);
    if (existing) return { id: existing, existed: true };
    const id = makeSessionId(cryptoObj);
    store.setItem(key, id);
    return { id, existed: false };
  } catch {
    let m = memoGet();
    if (!m) { m = makeSessionId(cryptoObj); memoSet(m); }
    return { id: m, existed: false };
  }
}

// `undefined` means "use the browser default"; an explicit `null` means "there
// is no storage" (the tests rely on that distinction, and so does any caller
// that wants to force the in-memory path).
//
// The property READ is inside the try, not just the method calls: with cookies
// blocked in Chrome, in a sandboxed iframe without allow-same-origin, or with
// dom.storage.enabled=false in Firefox, merely *touching* window.localStorage
// throws SecurityError. getSession() runs at module scope in App.jsx, so an
// unguarded throw here doesn't degrade a metric — it aborts module evaluation
// and renders a blank page.
function resolve(passed, globalName) {
  if (passed !== undefined) return passed;
  try {
    if (typeof globalThis === "undefined") return null;
    return globalThis[globalName] || null;
  } catch {
    return null;
  }
}

// Returns { visitorId, sessionId, returning, sessionPersisted }.
//
//   returning        — true only when a KNOWN visitor is starting a NEW visit:
//                      the visitor id was already on disk AND the session id
//                      was not. Keying off the visitor id alone would count a
//                      plain page reload as a return visit, which would inflate
//                      the one retention number the roadmap calls the moat.
//   sessionPersisted — false when sessionStorage is unusable. In that state
//                      every reload mints a fresh session id, so `returning`
//                      cannot be trusted and the caller should not report it.
export function getSession(opts) {
  const o = opts || {};
  const local = resolve(o.localStorage, "localStorage");
  const session = resolve(o.sessionStorage, "sessionStorage");
  const c = o.crypto;

  const visitor = readOrMint(local, VISITOR_KEY, c, () => memoryVisitorId, (v) => { memoryVisitorId = v; });
  const sess = readOrMint(session, SESSION_KEY, c, () => memorySessionId, (v) => { memorySessionId = v; });

  // Probe whether the session id actually survives: if the write didn't stick,
  // reloads look like new visits and the return signal is noise.
  let sessionPersisted = false;
  try {
    sessionPersisted = Boolean(session && session.getItem(SESSION_KEY));
  } catch { sessionPersisted = false; }

  return {
    visitorId: visitor.id,
    sessionId: sess.id,
    returning: visitor.existed && !sess.existed && sessionPersisted,
    sessionPersisted,
  };
}

// Test seam only — resets the in-memory fallbacks between cases.
export function _resetMemoryIds() {
  memoryVisitorId = null;
  memorySessionId = null;
}
