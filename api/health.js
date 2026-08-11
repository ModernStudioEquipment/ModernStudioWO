// Is the QuickBooks pipeline actually alive?
//
// The Web Connector lives on an office Windows PC and isn't a real service — if
// that machine sleeps, logs out, or QuickBooks closes, syncing stops silently.
// It sat dead for ELEVEN DAYS before anyone noticed, because nothing watched it
// and a board with no new orders looks the same as a quiet day.
//
// Strictly read-only: one tiny QuickBooks read and one tiny database read. It
// writes nothing, and it never throws — a monitor needs a status, not a stack
// trace. Point any uptime checker at this and alert on ok:false.
//
//   GET /api/health -> { ok, quickbooks, database, lastOrderAgeHours, detail, checkedAt }

const CONDUCTOR_BASE = "https://api.conductor.is/v1/quickbooks-desktop";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const conductorKey = process.env.CONDUCTOR_SECRET_KEY;
  const endUserId = process.env.CONDUCTOR_END_USER_ID;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  const missing = [
    !conductorKey && "CONDUCTOR_SECRET_KEY",
    !endUserId && "CONDUCTOR_END_USER_ID",
    !url && "VITE_SUPABASE_URL",
    !serviceKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) {
    return json(503, { ok: false, quickbooks: "unknown", database: "unknown", detail: `Not configured: ${missing.join(", ")}`, checkedAt });
  }

  // --- QuickBooks, via Conductor. Ask for a single record: cheap, and it fails
  //     the same way a real sync would if the Web Connector is down.
  let quickbooks = "down";
  let detail = null;
  try {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await fetch(`${CONDUCTOR_BASE}/sales-orders?limit=1&transactionDateFrom=${since}`, {
      headers: { Authorization: `Bearer ${conductorKey}`, "Conductor-End-User-Id": endUserId },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      quickbooks = "connected";
    } else {
      const body = await res.text().catch(() => "");
      // Conductor spells out "connection is not active / Web Connector is not
      // running" — pass that straight through, it's the actionable bit.
      detail = body.slice(0, 300) || `Conductor returned ${res.status}`;
    }
  } catch (e) {
    detail = e?.name === "TimeoutError" ? "QuickBooks did not respond within 20s" : String(e?.message || e);
  }

  // --- Database + how fresh the board is. A long gap since the newest synced
  //     order is the symptom people actually feel, so surface it directly.
  let database = "down";
  let lastOrderAgeHours = null;
  try {
    const res = await fetch(
      `${url}/rest/v1/orders?select=received_at&source=eq.QuickBooks&order=received_at.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      database = "connected";
      const rows = await res.json().catch(() => []);
      const newest = Array.isArray(rows) && rows[0]?.received_at ? new Date(rows[0].received_at).getTime() : null;
      if (newest) lastOrderAgeHours = Math.round(((Date.now() - newest) / 3600000) * 10) / 10;
    } else if (!detail) {
      detail = `Database returned ${res.status}`;
    }
  } catch (e) {
    if (!detail) detail = `Database unreachable: ${String(e?.message || e)}`;
  }

  const ok = quickbooks === "connected" && database === "connected";
  return json(ok ? 200 : 503, { ok, quickbooks, database, lastOrderAgeHours, detail, checkedAt });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
