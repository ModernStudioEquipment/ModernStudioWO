// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { callerIsStaff } from "../../lib/apiAuth.js";
import { GET as resyncGET, POST as resyncPOST } from "../../api/shopify-resync.js";
import { GET as syncGET, POST as syncPOST, DELETE as syncDELETE } from "../../api/conductor-sync.js";

// These routes read and write the board. Until this was added, anyone with the
// URL could pull a customer's name off any order number, re-sync an order, or —
// with ?reset=quickbooks — delete every QuickBooks-sourced order on it. Nothing
// checked who was asking.

const env = { VITE_SUPABASE_URL: "https://db.example.co", VITE_SUPABASE_ANON_KEY: "anon" };
const req = (url, opts = {}) => new Request(url, opts);
const okUser = () =>
  vi.fn(async (u) =>
    String(u).includes("/auth/v1/user")
      ? new Response(JSON.stringify({ id: "u1" }), { status: 200 })
      : new Response("{}", { status: 200 }));

describe("who may call the sync routes", () => {
  beforeEach(() => Object.assign(process.env, env));
  afterEach(() => {
    vi.unstubAllGlobals();
    ["SYNC_SECRET", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].forEach((k) => delete process.env[k]);
  });

  it("turns away a caller with no token", async () => {
    expect(await callerIsStaff(req("https://x/api/y"))).toBe(false);
  });

  it("turns away a token Supabase doesn't recognise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    expect(await callerIsStaff(req("https://x/api/y", { headers: { authorization: "Bearer nope" } }))).toBe(false);
  });

  it("lets a signed-in staffer through", async () => {
    vi.stubGlobal("fetch", okUser());
    expect(await callerIsStaff(req("https://x/api/y", { headers: { authorization: "Bearer good" } }))).toBe(true);
  });

  // A machine can be let in, but only deliberately.
  it("accepts the shared secret only when one is set", async () => {
    expect(await callerIsStaff(req("https://x/api/y", { headers: { "x-sync-secret": "" } }))).toBe(false);
    process.env.SYNC_SECRET = "s3cret";
    expect(await callerIsStaff(req("https://x/api/y", { headers: { "x-sync-secret": "s3cret" } }))).toBe(true);
    expect(await callerIsStaff(req("https://x/api/y", { headers: { "x-sync-secret": "wrong" } }))).toBe(false);
    expect(await callerIsStaff(req("https://x/api/y", { headers: { "x-sync-secret": "s3cret-longer" } }))).toBe(false);
  });

  // The routes themselves, unauthenticated, must refuse before doing anything.
  it("refuses every verb on both sync routes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not reach the network"); }));
    for (const [name, call] of [
      ["shopify-resync GET", () => resyncGET(req("https://x/api/shopify-resync?order=34615"))],
      ["shopify-resync POST", () => resyncPOST(req("https://x/api/shopify-resync?order=34615", { method: "POST" }))],
      ["conductor-sync GET", () => syncGET(req("https://x/api/conductor-sync"))],
      ["conductor-sync POST", () => syncPOST(req("https://x/api/conductor-sync", { method: "POST" }))],
      ["conductor-sync DELETE", () => syncDELETE(req("https://x/api/conductor-sync?reset=quickbooks", { method: "DELETE" }))],
    ]) {
      const r = await call();
      expect(r.status, name).toBe(401);
      expect(await r.text()).toMatch(/not signed in/i);
    }
  });
});
