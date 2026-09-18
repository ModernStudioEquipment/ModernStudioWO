// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "../../api/feedback-email.js";

// The feedback button can send mail as modernstudio.com, so it takes one id and
// reads the words back out of the table. The row is saved before this runs —
// which is why "nowhere to send it" is a 200 with a reason, not an error: the
// feedback is filed either way and losing it would be the real failure.

const ID = "11111111-1111-4111-8111-111111111111";

const base = {
  RESEND_API_KEY: "re_test",
  VITE_SUPABASE_URL: "https://db.example.co",
  VITE_SUPABASE_ANON_KEY: "anon_test",
  SUPABASE_SECRET_KEY: "service_test",
};

let sent = [];
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch({ user = { id: "u1", email: "jiro@modernstudio.com" }, row, resendOk = true } = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return user ? res(200, user) : res(401, {});
    if (u.includes("app_feedback")) return res(200, row ? [row] : []);
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(init.body));
      return resendOk ? res(200, { id: "e1" }) : res(422, { message: "domain not verified" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}
const post = (body, headers = { authorization: "Bearer good" }) =>
  POST(new Request("http://x/api/feedback-email", { method: "POST", headers, body: JSON.stringify(body) }));

const row = {
  kind: "problem",
  urgent: false,
  body: "tapped Mark ordered and it went back to un-ordered on its own",
  author: "Jiro",
  created_at: "2026-09-16T17:02:00.000Z",
  context: { tab: "Purchasing", device: "phone or tablet", screen: "375×812" },
};

describe("POST /api/feedback-email", () => {
  beforeEach(() => {
    sent = [];
    Object.assign(process.env, base);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    ["FEEDBACK_EMAIL_TO", "FEEDBACK_EMAIL_FROM"].forEach((k) => delete process.env[k]);
  });

  it("refuses anyone who isn't signed in", async () => {
    vi.stubGlobal("fetch", stubFetch({ row }));
    expect((await post({ id: ID }, {})).status).toBe(401);
    vi.stubGlobal("fetch", stubFetch({ user: null, row }));
    expect((await post({ id: ID })).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("needs a real id", async () => {
    vi.stubGlobal("fetch", stubFetch({ row }));
    expect((await post({ id: "../../etc/passwd" })).status).toBe(400);
    expect((await post({ body: "send this" })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("sends what was filed, with the context the app collected", async () => {
    vi.stubGlobal("fetch", stubFetch({ row }));
    const r = await post({ id: ID });
    expect(r.status).toBe(200);
    expect((await r.json()).emailed).toBe(true);
    const mail = sent[0];
    expect(mail.to).toEqual(["maddoxleach@yahoo.com"]);   // where it goes by default
    expect(mail.text).toContain("went back to un-ordered");
    expect(mail.text).toContain("Device: phone or tablet");
    expect(mail.text).toContain("Screen: 375×812");
  });

  // The subject is the whole point of the inbox being usable: what it is, who
  // sent it, and enough of the words to know without opening it.
  it("leads the subject with FIX, IDEA or URGENT", async () => {
    vi.stubGlobal("fetch", stubFetch({ row }));
    await post({ id: ID });
    expect(sent[0].subject.startsWith("FIX · Jiro: tapped Mark ordered and it went back")).toBe(true);
    expect(sent[0].subject.endsWith("…")).toBe(true);          // trimmed, not endless
    expect(sent[0].subject.length).toBeLessThan(90);

    vi.stubGlobal("fetch", stubFetch({ row: { ...row, kind: "idea", body: "ask how many when marking done" } }));
    await post({ id: ID });
    expect(sent[1].subject).toBe("IDEA · Jiro: ask how many when marking done");

    vi.stubGlobal("fetch", stubFetch({ row: { ...row, urgent: true } }));
    await post({ id: ID });
    expect(sent[2].subject.startsWith("URGENT · Jiro:")).toBe(true);
    expect(sent[2].text).toContain("stopping me working");
  });

  it("only says URGENT when someone said it was", async () => {
    vi.stubGlobal("fetch", stubFetch({ row: { ...row, kind: "idea", urgent: false } }));
    await post({ id: ID });
    expect(sent[0].subject).not.toContain("URGENT");
    expect(sent[0].text).not.toContain("stopping me working");
  });

  it("carries nothing the caller put in the request", async () => {
    vi.stubGlobal("fetch", stubFetch({ row }));
    await post({ id: ID, body: "WIRE $50,000", to: "attacker@example.com", from: "ceo@modernstudio.com" });
    expect(JSON.stringify(sent[0])).not.toContain("WIRE");
    expect(JSON.stringify(sent[0])).not.toContain("attacker@example.com");
  });

  it("says plainly when it's been pointed at nowhere", async () => {
    process.env.FEEDBACK_EMAIL_TO = "";
    vi.stubGlobal("fetch", stubFetch({ row }));
    const r = await post({ id: ID });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out.emailed).toBe(false);
    expect(out.why).toContain("FEEDBACK_EMAIL_TO");
    expect(sent).toHaveLength(0);
  });

  it("reports a rejected send instead of claiming success", async () => {
    vi.stubGlobal("fetch", stubFetch({ row, resendOk: false }));
    expect((await post({ id: ID })).status).toBe(502);
  });

  it("404s on feedback that isn't there", async () => {
    vi.stubGlobal("fetch", stubFetch({ row: null }));
    expect((await post({ id: ID })).status).toBe(404);
  });
});
