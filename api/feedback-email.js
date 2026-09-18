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
// The subject leads with what it is — URGENT, FIX or IDEA — then who, then the
// first line of what they wrote, so the inbox is triageable without opening
// anything.
//
// Env (Vercel): FEEDBACK_EMAIL_TO redirects it; FEEDBACK_EMAIL_FROM overrides the
// sender (which must stay on the verified domain). RESEND_API_KEY,
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY are the same
// variables the floor-note mail uses.

const DEFAULT_TO = "maddoxleach@yahoo.com";
const DEFAULT_FROM = "cnc@modernstudio.com";

export async function POST(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  // `?? `, not `||`: unset means the default address, and set-to-empty is the
  // way to turn the mail off without touching the code.
  const to = (process.env.FEEDBACK_EMAIL_TO ?? DEFAULT_TO).trim();
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

  // Redirected to nowhere on purpose (FEEDBACK_EMAIL_TO=""). The row is saved
  // either way, so this is information, not a failure.
  if (!to) return json(200, { ok: true, emailed: false, why: "FEEDBACK_EMAIL_TO is empty." });

  const rows = await fetch(`${url}/rest/v1/app_feedback?id=eq.${id}&select=kind,urgent,body,author,context,created_at`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fb = Array.isArray(rows) ? rows[0] : null;
  if (!fb) return json(404, { ok: false, error: "No such feedback." });

  const ctx = fb.context && typeof fb.context === "object" ? fb.context : {};
  const when = fb.created_at ? new Date(fb.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "";
  // URGENT only when someone said the app is stopping them working. It stays
  // worth reading precisely because it isn't on everything.
  const tag = fb.urgent ? "URGENT" : fb.kind === "idea" ? "IDEA" : "FIX";
  // The first line of what they wrote, so the subject says something.
  const gist = String(fb.body || "").replace(/\s+/g, " ").trim().slice(0, 60);

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: who.email || undefined,
      subject: `${tag} · ${fb.author || "someone"}: ${gist}${String(fb.body || "").length > 60 ? "…" : ""}`,
      text: [
        fb.body,
        "",
        `— ${fb.author || "someone"}${when ? `, ${when}` : ""}`,
        "",
        [fb.urgent ? "Marked: stopping me working" : null,
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
