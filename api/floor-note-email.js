// Email the CNC desk whenever a note is put on a job in the Floor section.
//
//   POST /api/floor-note-email  { itemId, noteId }
//
// WHAT IT DOES NOT TAKE: the note text, the product, the recipient. It takes two
// ids and reads everything else back out of the database itself. That matters —
// this endpoint can send mail, so the worst anyone who finds it can do is cause
// a second copy of a note that genuinely exists to be sent to an address they
// can't choose. There is no path here to put words of their own into an email
// from modernstudio.com.
//
// It also reads through the floor's own client-free views, so the mail carries
// what the wall monitors carry — W/O number, department, product, the note — and
// physically cannot carry a customer name, price or address.
//
// Caller must be signed in: the browser sends its Supabase access token and this
// checks it with Supabase before doing anything.
//
// Env (Vercel): RESEND_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SECRET_KEY, and optionally FLOOR_NOTE_EMAIL_TO / _FROM to change the
// addresses without a deploy.

const DEFAULT_ADDRESS = "cnc@modernstudio.com";

export async function POST(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.FLOOR_NOTE_EMAIL_TO || DEFAULT_ADDRESS;
  const from = process.env.FLOOR_NOTE_EMAIL_FROM || DEFAULT_ADDRESS;

  const missing = [
    !resendKey && "RESEND_API_KEY",
    !url && "VITE_SUPABASE_URL",
    !anonKey && "VITE_SUPABASE_ANON_KEY",
    !serviceKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) return json(503, { ok: false, error: `Not configured: ${missing.join(", ")}` });

  // --- who's asking -------------------------------------------------------
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { ok: false, error: "Not signed in." });
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who || !who.id) return json(401, { ok: false, error: "Not signed in." });

  // --- what happened ------------------------------------------------------
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const noteId = String(body.noteId || "").trim();
  const itemId = String(body.itemId || "").trim();
  if (!isUuid(noteId) || !isUuid(itemId)) return json(400, { ok: false, error: "Need a noteId and an itemId." });

  const rest = (path) =>
    fetch(`${url}/rest/v1/${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  // The note as it was actually written — never the caller's copy of it.
  const notes = await rest(`floor_note_log?id=eq.${noteId}&select=id,item_id,body,author,created_at`);
  const note = Array.isArray(notes) ? notes[0] : null;
  if (!note) return json(404, { ok: false, error: "No such note." });
  if (note.item_id !== itemId) return json(400, { ok: false, error: "That note isn't on that job." });

  // The job it's on, from the client-free queue the monitors read.
  const rows = await rest(`floor_queue?item_id=eq.${itemId}&select=order_no,dept,product,qty`);
  const job = (Array.isArray(rows) && rows[0]) || {};
  const heading = [job.dept, job.order_no && `WO #${job.order_no}`, job.product].filter(Boolean).join(" · ")
    || "a job on the floor";

  // --- send ---------------------------------------------------------------
  const when = note.created_at ? new Date(note.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "";
  const by = note.author || "someone";
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: who.email || undefined,
      subject: `Floor note · ${heading}`,
      text: [
        note.body,
        "",
        `— ${by}${when ? `, ${when}` : ""}`,
        "",
        [job.dept && `Department: ${job.dept}`,
         job.order_no && `Work order: #${job.order_no}`,
         job.product && `Product: ${job.product}`,
         job.qty && `Quantity: ${job.qty}`].filter(Boolean).join("\n"),
      ].join("\n"),
    }),
  }).then(async (r) => ({ ok: r.ok, detail: r.ok ? null : await r.text().catch(() => "") }))
    .catch((e) => ({ ok: false, detail: String(e && e.message) }));

  if (!sent.ok) return json(502, { ok: false, error: "Resend rejected it.", detail: trim(sent.detail) });
  return json(200, { ok: true, to });
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const trim = (s) => String(s || "").slice(0, 300);
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
