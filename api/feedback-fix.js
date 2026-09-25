// Close a report and tell the person who filed it what was done.
//
//   GET  /api/feedback-fix?id=…&sig=…   -> a box to type what you did
//   POST same URL (the form)            -> saves it, emails them, done
//
// The link arrives in the notification mail and has to work from a phone with no
// login, so it carries a signature instead (lib/signedId.js). Without a valid
// one this route does nothing at all.
//
// Why bother: someone reports a thing, hears nothing, and stops reporting
// things. The button is only worth having if using it visibly leads somewhere.
//
// Env: RESEND_API_KEY, VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, and
// FEEDBACK_EMAIL_FROM / FEEDBACK_EMAIL_TO as the other feedback mail uses them.
// FEEDBACK_SIGN_AS sets the name the reply is signed with.

import { verifyId } from "../lib/signedId.js";
import { callerStaff } from "../lib/apiAuth.js";

export async function GET(request) {
  const ctx = await load(request);
  if (ctx.error) return page(ctx.status, ctx.error);
  const { fb, id, sig } = ctx;

  if (fb.fixed_at) {
    return page(200,
      `<p>Already closed on ${date(fb.fixed_at)}${fb.fixed_by ? ` by ${esc(fb.fixed_by)}` : ""}.</p>` +
      quote(fb.body) +
      (fb.fixed_note ? `<p><b>What was done:</b> ${esc(fb.fixed_note)}</p>` : ""));
  }

  return page(200,
    `<p>${esc(fb.author || "Someone")} reported this on ${date(fb.created_at)}:</p>` +
    quote(fb.body) +
    `<form method="POST" action="/api/feedback-fix?id=${esc(id)}&sig=${esc(sig)}">` +
    `<label style="display:block;font-weight:600;margin:18px 0 6px">What did you do about it?</label>` +
    `<textarea name="note" rows="4" required style="${INPUT}" placeholder="Plain words. They get sent as you write them."></textarea>` +
    `<label style="display:block;font-weight:600;margin:18px 0 6px">From</label>` +
    `<input name="from" value="${esc(process.env.FEEDBACK_SIGN_AS || "Maddox")}" style="${INPUT}">` +
    `<button type="submit" style="${BUTTON}">Send it and close this</button>` +
    `</form>`);
}

export async function POST(request) {
  // From the board: a signed-in staffer closing one out of the list, which is
  // the only way to close the reports filed before the email carried a link.
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return closeAsStaff(request);
  }

  const ctx = await load(request);
  if (ctx.error) return page(ctx.status, ctx.error);
  const { fb, id, url, serviceKey } = ctx;

  const form = await request.formData().catch(() => null);
  const note = String((form && form.get("note")) || "").trim();
  const from = String((form && form.get("from")) || process.env.FEEDBACK_SIGN_AS || "Maddox").trim();
  if (!note) return page(400, "<p>Nothing was typed, so nothing was sent.</p>");

  // Record it first. The email is the notification; the row is the record.
  await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done", fixed_note: note, fixed_by: from, fixed_at: new Date().toISOString() }),
  }).catch(() => null);

  // Who filed it. The board stores the name, not the address, so ask Supabase.
  const email = fb.author_id ? await emailOf(fb.author_id, url, serviceKey) : null;
  if (!email) {
    return page(200,
      `<p>Closed, and saved against the report. No email though: there's no address on file for ${esc(fb.author || "them")}.</p>` +
      quote(fb.body));
  }

  const sent = await sendReply({ to: email, from_name: from, fb, note });
  return page(sent.ok ? 200 : 502,
    sent.ok
      ? `<p>Closed, and ${esc(email)} has been told.</p>${quote(note)}`
      : `<p>Closed and saved, but the email bounced off Resend: ${esc(sent.detail || "no reason given")}</p>`);
}

async function closeAsStaff(request) {
  const who = await callerStaff(request);
  if (!who) return json(401, { ok: false, error: "Not signed in." });

  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return json(503, { ok: false, error: "Not configured." });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const note = String(body.note || "").trim();
  if (!isUuid(id)) return json(400, { ok: false, error: "Which report?" });
  if (!note) return json(400, { ok: false, error: "Say what you did." });

  const rows = await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}&select=id,kind,body,author,author_id,created_at,fixed_at`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fb = Array.isArray(rows) ? rows[0] : null;
  if (!fb) return json(404, { ok: false, error: "No such report." });
  if (fb.fixed_at) return json(200, { ok: true, already: true });

  // Signed with the name of whoever actually closed it, from their login.
  const from = nameOf(who);
  await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done", fixed_note: note, fixed_by: from, fixed_at: new Date().toISOString() }),
  }).catch(() => null);

  const email = fb.author_id ? await emailOf(fb.author_id, url, serviceKey) : null;
  if (!email) return json(200, { ok: true, by: from, emailed: false, why: `No address on file for ${fb.author || "them"}.` });
  const sent = await sendReply({ to: email, from_name: from, fb, note });
  return json(200, { ok: true, by: from, emailed: sent.ok, to: email, why: sent.ok ? null : sent.detail });
}

// "anoush@modernstudio.com" -> "Anoush", the same rule the board's notes use.
function nameOf(user) {
  const named = user && user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name);
  if (named) return String(named).trim();
  const local = String((user && user.email) || "").split("@")[0];
  if (!local) return process.env.FEEDBACK_SIGN_AS || "the office";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// --- the reply itself -------------------------------------------------------
//
// Short, and in the words of whoever fixed it. No preamble, no thanks-for-your-
// patience, no invitation to reach out with further questions.
async function sendReply({ to, from_name, fb, note }) {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.FEEDBACK_EMAIL_FROM || "cnc@modernstudio.com";
  const replyTo = process.env.FEEDBACK_EMAIL_TO || undefined;
  if (!resendKey) return { ok: false, detail: "RESEND_API_KEY isn't set." };

  const gist = String(fb.body || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const subject = `${fb.kind === "idea" ? "Done" : "Fixed"}: ${gist}${String(fb.body || "").length > 50 ? "…" : ""}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject,
      text: [
        `You reported this on ${date(fb.created_at)}:`,
        "",
        `  ${String(fb.body || "").trim()}`,
        "",
        note,
        "",
        from_name,
      ].join("\n"),
    }),
  }).catch(() => null);

  if (!res || !res.ok) return { ok: false, detail: res ? `HTTP ${res.status}` : "no answer from Resend" };
  return { ok: true };
}

// --- shared plumbing --------------------------------------------------------

async function load(request) {
  const u = new URL(request.url);
  const id = String(u.searchParams.get("id") || "").trim();
  const sig = String(u.searchParams.get("sig") || "").trim();
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) return { error: "<p>Not configured: VITE_SUPABASE_URL and SUPABASE_SECRET_KEY.</p>", status: 503 };
  if (!isUuid(id) || !verifyId(id, sig, serviceKey)) {
    return { error: "<p>That link isn't valid. Use the one in the notification email.</p>", status: 401 };
  }

  const rows = await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}&select=id,kind,body,author,author_id,created_at,fixed_at,fixed_by,fixed_note`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fb = Array.isArray(rows) ? rows[0] : null;
  if (!fb) return { error: "<p>That report isn't there any more.</p>", status: 404 };
  return { fb, id, sig, url, serviceKey };
}

async function emailOf(userId, url, serviceKey) {
  const who = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return (who && who.email) || null;
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const date = (d) => (d ? new Date(d).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", year: "numeric" }) : "");
const quote = (text) => `<blockquote style="margin:14px 0;padding:10px 14px;border-left:3px solid #C8A227;background:#F7F8F9;white-space:pre-wrap">${esc(text)}</blockquote>`;

const INPUT = "width:100%;padding:10px;border:1px solid #DCE0E4;border-radius:8px;font:inherit;box-sizing:border-box";
const BUTTON = "margin-top:18px;padding:11px 18px;border:0;border-radius:8px;background:#16202B;color:#fff;font:inherit;font-weight:700;cursor:pointer";

const page = (status, inner) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Report</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:620px;margin:6vh auto;padding:0 20px;color:#16202B">${inner}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
