// @vitest-environment node
//
// A server route, tested as one: no DOM, and Request/Response come from Node
// rather than jsdom's partial versions.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "../../api/floor-note-email.js";

// This endpoint can send mail from modernstudio.com, so what it refuses matters
// as much as what it sends. It takes two ids and reads the wording out of the
// database itself: there is no way to hand it a sentence and have that sentence
// arrive in someone's inbox.

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

const env = {
  RESEND_API_KEY: "re_test",
  VITE_SUPABASE_URL: "https://db.example.co",
  VITE_SUPABASE_ANON_KEY: "anon_test",
  SUPABASE_SECRET_KEY: "service_test",
};

let sentTo = [];

function stubFetch({ user = { id: "u1", email: "jiro@modernstudio.com" }, note, job, resendOk = true } = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return user ? res(200, user) : res(401, { error: "bad token" });
    }
    if (u.includes("floor_note_log")) return res(200, note ? [note] : []);
    if (u.includes("floor_queue")) return res(200, job ? [job] : []);
    if (u.includes("api.resend.com")) {
      sentTo.push(JSON.parse(init.body));
      return resendOk ? res(200, { id: "email_1" }) : res(422, { message: "domain not verified" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const post = (body, headers = { authorization: "Bearer good" }) =>
  POST(new Request("http://x/api/floor-note-email", { method: "POST", headers, body: JSON.stringify(body) }));

const note = { id: NOTE_ID, item_id: ITEM_ID, body: "use the black thread, not navy", author: "Jiro", created_at: "2026-09-14T20:21:52.000Z" };
const job = { order_no: "100005", dept: "CNC", product: "Pin (TEST)", qty: "100" };

describe("POST /api/floor-note-email", () => {
  beforeEach(() => {
    sentTo = [];
    Object.assign(process.env, env);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    ["FLOOR_NOTE_EMAIL_TO", "FLOOR_NOTE_EMAIL_FROM"].forEach((k) => delete process.env[k]);
  });

  it("refuses when nobody is signed in", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job }));
    const r = await post({ itemId: ITEM_ID, noteId: NOTE_ID }, {});
    expect(r.status).toBe(401);
    expect(sentTo).toHaveLength(0);
  });

  it("refuses a token Supabase doesn't recognise", async () => {
    vi.stubGlobal("fetch", stubFetch({ user: null, note, job }));
    expect((await post({ itemId: ITEM_ID, noteId: NOTE_ID })).status).toBe(401);
    expect(sentTo).toHaveLength(0);
  });

  it("refuses anything that isn't a pair of ids", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job }));
    expect((await post({ itemId: ITEM_ID, noteId: "'; drop table notes--" })).status).toBe(400);
    expect((await post({ body: "send this instead" })).status).toBe(400);
    expect(sentTo).toHaveLength(0);
  });

  it("refuses a note that doesn't exist, or that isn't on that job", async () => {
    vi.stubGlobal("fetch", stubFetch({ note: null, job }));
    expect((await post({ itemId: ITEM_ID, noteId: NOTE_ID })).status).toBe(404);

    vi.stubGlobal("fetch", stubFetch({ note: { ...note, item_id: OTHER_ID }, job }));
    expect((await post({ itemId: ITEM_ID, noteId: NOTE_ID })).status).toBe(400);
    expect(sentTo).toHaveLength(0);
  });

  it("sends the note as it was written, to the CNC desk", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job }));
    const r = await post({ itemId: ITEM_ID, noteId: NOTE_ID });
    expect(r.status).toBe(200);
    expect(sentTo).toHaveLength(1);
    const mail = sentTo[0];
    expect(mail.from).toBe("cnc@modernstudio.com");
    expect(mail.to).toEqual(["cnc@modernstudio.com"]);
    expect(mail.subject).toBe("Floor note · CNC · WO #100005 · Pin (TEST)");
    expect(mail.text).toContain("use the black thread, not navy");
    expect(mail.text).toContain("Jiro");
    expect(mail.text).toContain("#100005");
  });

  it("carries nothing the caller put in the request", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job }));
    await post({ itemId: ITEM_ID, noteId: NOTE_ID, body: "WIRE $50,000 TO", to: "attacker@example.com", from: "ceo@modernstudio.com" });
    const mail = sentTo[0];
    expect(JSON.stringify(mail)).not.toContain("WIRE");
    expect(JSON.stringify(mail)).not.toContain("attacker@example.com");
    expect(mail.from).toBe("cnc@modernstudio.com");
  });

  it("honours the addresses set in the environment", async () => {
    process.env.FLOOR_NOTE_EMAIL_TO = "shop@modernstudio.com";
    process.env.FLOOR_NOTE_EMAIL_FROM = "floor@modernstudio.com";
    vi.stubGlobal("fetch", stubFetch({ note, job }));
    await post({ itemId: ITEM_ID, noteId: NOTE_ID });
    expect(sentTo[0].to).toEqual(["shop@modernstudio.com"]);
    expect(sentTo[0].from).toBe("floor@modernstudio.com");
  });

  it("says so when Resend rejects it, rather than claiming success", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job, resendOk: false }));
    const r = await post({ itemId: ITEM_ID, noteId: NOTE_ID });
    expect(r.status).toBe(502);
    expect((await r.json()).detail).toContain("domain not verified");
  });

  it("still sends when the job has dropped off the queue", async () => {
    vi.stubGlobal("fetch", stubFetch({ note, job: null }));
    const r = await post({ itemId: ITEM_ID, noteId: NOTE_ID });
    expect(r.status).toBe(200);
    expect(sentTo[0].subject).toBe("Floor note · a job on the floor");
  });
});
