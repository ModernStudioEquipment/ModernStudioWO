// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "../../api/feedback-fix.js";
import { signId, verifyId } from "../../lib/signedId.js";

// Closing a report emails the person who filed it. The link lives in an inbox
// with no login behind it, so the signature is the only thing standing between
// a stranger and sending mail from modernstudio.com to a member of staff.

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "service_test_key";

const base = { VITE_SUPABASE_URL: "https://db.example.co", VITE_SUPABASE_ANON_KEY: "anon", SUPABASE_SECRET_KEY: KEY, RESEND_API_KEY: "re_test" };
const res = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

let sent = [];
let patched = [];

function stub({ row, email = "jiro@modernstudio.com", resendOk = true } = {}) {
  return vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/app_feedback") && init.method === "PATCH") {
      patched.push(JSON.parse(init.body));
      return res(204, "");
    }
    if (u.includes("/rest/v1/app_feedback")) return res(200, row ? [row] : []);
    if (u.includes("/auth/v1/admin/users/")) return email ? res(200, { email }) : res(404, {});
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(init.body));
      return resendOk ? res(200, { id: "e1" }) : res(422, "rejected");
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}

const row = {
  id: ID,
  kind: "problem",
  body: "mark ordered flips back to un-ordered on its own",
  author: "Jiro",
  author_id: "aaaaaaaa-1111-4111-8111-111111111111",
  created_at: "2026-09-16T17:02:00.000Z",
  fixed_at: null,
};

const link = (sig = signId(ID, KEY)) => `https://modern-fulfillment.com/api/feedback-fix?id=${ID}&sig=${sig}`;
const form = (fields) => {
  const body = new URLSearchParams(fields);
  return new Request(link(), { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
};

describe("/api/feedback-fix", () => {
  beforeEach(() => { sent = []; patched = []; Object.assign(process.env, base); });
  afterEach(() => {
    vi.unstubAllGlobals();
    ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "RESEND_API_KEY", "FEEDBACK_SIGN_AS", "FEEDBACK_EMAIL_FROM"].forEach((k) => delete process.env[k]);
  });

  it("signs and verifies an id, and rejects a tampered one", () => {
    const sig = signId(ID, KEY);
    expect(verifyId(ID, sig, KEY)).toBe(true);
    expect(verifyId("22222222-2222-4222-8222-222222222222", sig, KEY)).toBe(false);
    expect(verifyId(ID, sig, "another_key")).toBe(false);
    expect(verifyId(ID, "", KEY)).toBe(false);
  });

  it("turns away an unsigned or badly signed link", async () => {
    vi.stubGlobal("fetch", stub({ row }));
    expect((await GET(new Request(`https://x/api/feedback-fix?id=${ID}`))).status).toBe(401);
    expect((await GET(new Request(link("deadbeef")))).status).toBe(401);
    const forged = new Request(`https://x/api/feedback-fix?id=${ID}&sig=nope`, { method: "POST", body: new URLSearchParams({ note: "let me in" }) });
    expect((await POST(forged)).status).toBe(401);
    expect(sent).toHaveLength(0);
    expect(patched).toHaveLength(0);
  });

  it("shows the report and a box to answer it", async () => {
    vi.stubGlobal("fetch", stub({ row }));
    const html = await (await GET(new Request(link()))).text();
    expect(html).toContain("Jiro");
    expect(html).toContain("mark ordered flips back");
    expect(html).toContain("What did you do about it?");
  });

  // The words in the reply are the ones typed, with nothing added around them.
  it("emails the person who filed it, in plain words", async () => {
    vi.stubGlobal("fetch", stub({ row }));
    const r = await POST(form({ note: "The button was writing the old value back. Fixed and live.", from: "Maddox" }));
    expect(r.status).toBe(200);

    expect(patched[0]).toMatchObject({ status: "done", fixed_by: "Maddox" });
    expect(patched[0].fixed_note).toContain("writing the old value back");

    const mail = sent[0];
    expect(mail.to).toEqual(["jiro@modernstudio.com"]);
    expect(mail.subject).toBe("Fixed: mark ordered flips back to un-ordered on its own");
    expect(mail.text).toContain("You reported this on 09/16");
    expect(mail.text).toContain("mark ordered flips back to un-ordered on its own");
    expect(mail.text).toContain("The button was writing the old value back.");
    expect(mail.text.trim().endsWith("Maddox")).toBe(true);
    // No slop: none of the usual padding.
    expect(mail.text).not.toMatch(/thank you for|we apologize|reach out|any further questions|valued/i);
  });

  it("calls an idea done rather than fixed", async () => {
    vi.stubGlobal("fetch", stub({ row: { ...row, kind: "idea", body: "ask how many when marking done" } }));
    await POST(form({ note: "Added it.", from: "Maddox" }));
    expect(sent[0].subject).toBe("Done: ask how many when marking done");
  });

  it("closes it anyway when there's no address for them", async () => {
    vi.stubGlobal("fetch", stub({ row: { ...row, author_id: null } }));
    const r = await POST(form({ note: "Sorted." }));
    expect(r.status).toBe(200);
    expect(patched).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(await r.text()).toMatch(/no address on file/i);
  });

  it("won't send an empty reply", async () => {
    vi.stubGlobal("fetch", stub({ row }));
    const r = await POST(form({ note: "   " }));
    expect(r.status).toBe(400);
    expect(sent).toHaveLength(0);
    expect(patched).toHaveLength(0);
  });

  // Closing from the board itself, by a signed-in staffer. This is the only way
  // to close the reports that were filed before the email carried a link.
  describe("closed from the board", () => {
    const json = (body, headers = { authorization: "Bearer good", "content-type": "application/json" }) =>
      new Request("https://modern-fulfillment.com/api/feedback-fix", { method: "POST", headers, body: JSON.stringify(body) });

    const withUser = (opts = {}) => {
      const inner = stub(opts);
      return vi.fn(async (url, init) => {
        if (String(url).includes("/auth/v1/user")) {
          return opts.signedIn === false
            ? res(401, {})
            : res(200, { id: "u9", email: "maddox@modernstudio.com" });
        }
        return inner(url, init);
      });
    };

    it("refuses anyone who isn't signed in", async () => {
      vi.stubGlobal("fetch", withUser({ row, signedIn: false }));
      expect((await POST(json({ id: ID, note: "did it" }))).status).toBe(401);
      expect(patched).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it("wants to know what was done", async () => {
      vi.stubGlobal("fetch", withUser({ row }));
      expect((await POST(json({ id: ID, note: "  " }))).status).toBe(400);
      expect(sent).toHaveLength(0);
    });

    it("signs the reply with the closer's own name, from their login", async () => {
      vi.stubGlobal("fetch", withUser({ row }));
      const out = await (await POST(json({ id: ID, note: "Fixed and live." }))).json();
      expect(out).toMatchObject({ ok: true, by: "Maddox", emailed: true, to: "jiro@modernstudio.com" });
      expect(patched[0]).toMatchObject({ status: "done", fixed_by: "Maddox" });
      expect(sent[0].text.trim().endsWith("Maddox")).toBe(true);
    });

    it("won't close the same report twice", async () => {
      vi.stubGlobal("fetch", withUser({ row: { ...row, fixed_at: "2026-09-24T12:00:00Z" } }));
      const out = await (await POST(json({ id: ID, note: "again" }))).json();
      expect(out).toMatchObject({ ok: true, already: true });
      expect(patched).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });
  });

  it("says a report is already closed instead of asking twice", async () => {
    vi.stubGlobal("fetch", stub({ row: { ...row, fixed_at: "2026-09-20T18:00:00.000Z", fixed_by: "Maddox", fixed_note: "Sorted." } }));
    const html = await (await GET(new Request(link()))).text();
    expect(html).toMatch(/already closed on 09\/20/i);
    expect(html).toContain("Sorted.");
  });
});
