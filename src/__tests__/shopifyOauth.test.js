// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { GET, verifyHmac, signState, verifyState } from "../../api/shopify-oauth.js";

// This endpoint swaps a one-time code for a PERMANENT Admin API token. The only
// thing standing between it and a stranger is the signature check, so that's
// what these tests are mostly about.

const SECRET = "shpss_test_secret";
const STORE = "modern-studio-equipment.myshopify.com";

const signed = (params, secret = SECRET) => {
  const message = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const hmac = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...params, hmac });
};
const call = (qs = "") => GET(new Request(`https://modern-fulfillment.com/api/shopify-oauth${qs}`));

describe("GET /api/shopify-oauth", () => {
  beforeEach(() => {
    process.env.SHOPIFY_STORE = STORE;
    process.env.SHOPIFY_CLIENT_ID = "client_abc";
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    ["SHOPIFY_STORE", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"].forEach((k) => delete process.env[k]);
  });

  it("says what's missing rather than half-working", async () => {
    delete process.env.SHOPIFY_CLIENT_SECRET;
    const r = await call();
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("SHOPIFY_CLIENT_SECRET");
  });

  it("sends you to Shopify with the scopes we actually need", async () => {
    const r = await call();
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get("location"));
    expect(to.host).toBe(STORE);
    expect(to.pathname).toBe("/admin/oauth/authorize");
    expect(to.searchParams.get("scope")).toBe("read_orders,read_products,read_all_orders");
    expect(to.searchParams.get("redirect_uri")).toBe("https://modern-fulfillment.com/api/shopify-oauth");
    expect(verifyState(to.searchParams.get("state"), SECRET)).toBe(true);
  });

  // The whole security model: only Shopify can sign the callback.
  it("refuses a callback that isn't signed by Shopify", async () => {
    const qs = new URLSearchParams({ code: "c1", shop: STORE, state: signState(SECRET), hmac: "deadbeef" });
    const r = await call(`?${qs}`);
    expect(r.status).toBe(400);
    expect(await r.text()).toMatch(/signature/i);
  });

  it("refuses a callback signed with the wrong secret", async () => {
    const qs = signed({ code: "c1", shop: STORE, state: signState(SECRET) }, "not_our_secret");
    expect((await call(`?${qs}`)).status).toBe(400);
  });

  it("refuses an approval for somebody else's store", async () => {
    const qs = signed({ code: "c1", shop: "someone-else.myshopify.com", state: signState(SECRET) });
    const r = await call(`?${qs}`);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("someone-else.myshopify.com");
  });

  it("refuses a stale or foreign state", async () => {
    const old = signState(SECRET, Date.now() - 11 * 60 * 1000);
    expect((await call(`?${signed({ code: "c1", shop: STORE, state: old })}`)).status).toBe(400);
    expect((await call(`?${signed({ code: "c1", shop: STORE, state: "1.deadbeef" })}`)).status).toBe(400);
  });

  it("exchanges a good callback and shows the token once", async () => {
    let sentTo = null;
    let sentBody = null;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      sentTo = String(url);
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ access_token: "shpat_realtoken", scope: "read_orders,read_products" }), { status: 200 });
    }));
    const r = await call(`?${signed({ code: "the-code", shop: STORE, state: signState(SECRET) })}`);
    expect(r.status).toBe(200);
    expect(sentTo).toBe(`https://${STORE}/admin/oauth/access_token`);
    expect(sentBody).toMatchObject({ client_id: "client_abc", client_secret: SECRET, code: "the-code" });
    const html = await r.text();
    expect(html).toContain("shpat_realtoken");
    expect(html).toContain("SHOPIFY_ADMIN_TOKEN");
    expect(r.headers.get("cache-control")).toBe("no-store");   // not held in any cache
  });

  it("says so plainly when Shopify won't swap the code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    const r = await call(`?${signed({ code: "used-already", shop: STORE, state: signState(SECRET) })}`);
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/try once more/i);
  });

  it("verifies an hmac the way Shopify computes one", () => {
    const params = signed({ code: "c", shop: STORE, timestamp: "123" });
    expect(verifyHmac(params, SECRET)).toBe(true);
    params.set("shop", "tampered.myshopify.com");
    expect(verifyHmac(params, SECRET)).toBe(false);
    expect(verifyHmac(new URLSearchParams({ code: "c" }), SECRET)).toBe(false);
  });
});
