// Email whoever looks after the app when someone files feedback from inside it.
//
//   POST /api/feedback-email  { id }
//
// Same shape as the floor-note mail, and for the same reason: it takes ONE id
// and reads the words back out of the database itself. An endpoint that can send
// mail as modernstudio.com must never be able to send words handed to it.
//
// The row is already saved before this runs. Mail is the notification, not the
// record — if it doesn't go, the feedback is still filed and readable.
//
// Env (Vercel): FEEDBACK_EMAIL_TO decides where it goes. Without it, nothing is
// emailed and the endpoint says so — the feedback still lands in the table.
// RESEND_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY
// are the same variables the floor-note mail uses. FEEDBACK_EMAIL_FROM overrides
// the sender.

const DEFAULT_FROM = "cnc@modernstudio.com";

export async function POST(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const to = (process.env.FEEDBACK_EMAIL_TO || "").trim();
  const from = process.env.FEEDBACK_EMAIL_FROM || DEFAULT_FROM;

  const missing = [
    !resendKey && "RESEND_API_KEY",
    !url && "VITE_SUPABASE_URL",
    !anonKey && "VITE_SUPABASE_ANON_KEY",
    !serviceKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) return json(503, { ok: false, error: `Not configured: ${missing.join(", ")}` });

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { ok: false, error: "Not signed in." });
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who || !who.id) return json(401, { ok: false, error: "Not signed in." });

  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const id = String(body.id || "").trim();
  if (!isUuid(id)) return json(400, { ok: false, error: "Need the id of the feedback." });

  // Nobody to send it to. The row is saved either way, so this is information,
  // not a failure.
  if (!to) return json(200, { ok: true, emailed: false, why: "FEEDBACK_EMAIL_TO isn't set." });

  const rows = await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}&select=kind,body,where_at,author,context,created_at`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fb = Array.isArray(rows) ? rows[0] : null;
  if (!fb) return json(404, { ok: false, error: "No such feedback." });

  const ctx = fb.context && typeof fb.context === "object" ? fb.context : {};
  const when = fb.created_at ? new Date(fb.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "";
  const label = fb.kind === "idea" ? "Idea" : "Problem";

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: who.email || undefined,
      subject: `${label} · ${fb.author || "someone"}${fb.where_at ? ` · ${fb.where_at}` : ""}`,
      text: [
        fb.body,
        "",
        `— ${fb.author || "someone"}${when ? `, ${when}` : ""}`,
        "",
        [fb.where_at && `Where: ${fb.where_at}`,
         ctx.tab && `Tab: ${ctx.tab}`,
         ctx.device && `Device: ${ctx.device}`,
         ctx.screen && `Screen: ${ctx.screen}`,
         ctx.url && `URL: ${ctx.url}`].filter(Boolean).join("\n"),
      ].join("\n"),
    }),
  }).then(async (r) => ({ ok: r.ok, detail: r.ok ? null : await r.text().catch(() => "") }))
    .catch((e) => ({ ok: false, detail: String(e && e.message) }));

  if (!sent.ok) return json(502, { ok: false, error: "Resend rejected it.", detail: trim(sent.detail) });
  return json(200, { ok: true, emailed: true });
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const trim = (s) => String(s || "").slice(0, 300);
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
