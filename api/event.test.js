import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/event is the gate's data source, so its guarantees are worth pinning:
//   - always 204, whatever happens
//   - unknown event names are never written (not an open write channel)
//   - free-form user text can never land in props

const inserted = [];

vi.mock("./_db.js", () => ({
  supabaseConfigured: true,
  db: {
    from: () => ({
      insert: (row) => { inserted.push(row); return Promise.resolve({ error: null }); },
    }),
  },
}));

let handler;

function mockRes() {
  return {
    statusCode: null,
    status(c) { this.statusCode = c; return this; },
    end() { return this; },
    json(b) { this.body = b; return this; },
  };
}

const req = (body, method = "POST") => ({ method, headers: { "x-forwarded-for": "1.2.3.4" }, socket: {}, body });

beforeEach(async () => {
  inserted.length = 0;
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  handler = (await import("./event.js")).default;
});

describe("POST /api/event", () => {
  it("writes an allowlisted event with its session id and props", async () => {
    const res = mockRes();
    await handler(req({ name: "estimate_run", session_id: "abc123ef", visitor_id: "beef1234cafe", props: { schools: 3 } }), res);
    expect(res.statusCode).toBe(204);
    expect(inserted).toEqual([{
      name: "estimate_run", session_id: "abc123ef", visitor_id: "beef1234cafe", props: { schools: 3 },
    }]);
  });

  it("drops an unknown event name without writing", async () => {
    const res = mockRes();
    await handler(req({ name: "arbitrary_write", session_id: "abc123ef", props: { x: 1 } }), res);
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(0);
  });

  it("nulls a malformed session id rather than storing it", async () => {
    const res = mockRes();
    await handler(req({ name: "returned", session_id: "not-a-hex-id!" }), res);
    expect(inserted[0].session_id).toBeNull();
  });

  it("clamps long strings and drops nested objects from props", async () => {
    await handler(req({
      name: "save_failed",
      session_id: "abc123ef",
      props: { reason: "x".repeat(500), nested: { a: 1 }, list: [1, 2], ok: true, n: 4, bad: NaN },
    }), mockRes());
    const p = inserted[0].props;
    expect(p.reason).toHaveLength(80);
    expect(p).not.toHaveProperty("nested");
    expect(p).not.toHaveProperty("list");
    expect(p).not.toHaveProperty("bad");   // NaN is not finite
    expect(p).toMatchObject({ ok: true, n: 4 });
  });

  it("caps the number of props", async () => {
    const props = {};
    for (let i = 0; i < 40; i++) props[`k${i}`] = i;
    await handler(req({ name: "session_start", session_id: "abc123ef", props }), mockRes());
    expect(Object.keys(inserted[0].props)).toHaveLength(10);
  });

  it("returns 204 (not 405) on a GET, and writes nothing", async () => {
    const res = mockRes();
    await handler(req({ name: "returned" }, "GET"), res);
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(0);
  });

  it("returns 204 on an empty body", async () => {
    const res = mockRes();
    await handler(req(undefined), res);
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(0);
  });
});
