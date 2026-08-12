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
  //
  //     This is a round trip to a PC in the office, not a cloud API call, so it
  //     is genuinely slow — 40s, well inside the function's own limit.
  let quickbooks = "down";
  let detail = null;
  try {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await fetch(`${CONDUCTOR_BASE}/sales-orders?limit=1&transactionDateFrom=${since}`, {
      headers: { Authorization: `Bearer ${conductorKey}`, "Conductor-End-User-Id": endUserId },
      signal: AbortSignal.timeout(40000),
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
    if (e?.name === "TimeoutError") {
      quickbooks = "no answer";
      detail = "QuickBooks didn't answer within 40s.";
    } else {
      detail = String(e?.message || e);
    }
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

  // --- The verdict. Deliberately NOT "both pinged fine". ---------------------
  // The Web Connector lives on an office PC that sleeps overnight and at
  // weekends, so a failed live ping is normal outside working hours and would
  // page someone every single night. What actually went wrong last time was
  // ELEVEN DAYS with no orders arriving — so a failed ping only counts as a
  // problem when nothing has synced in a day either.
  const stale = lastOrderAgeHours == null || lastOrderAgeHours > 24;
  const ok = database === "connected" && (quickbooks === "connected" || !stale);
  const hint =
    database !== "connected" ? "The board's database is unreachable — this is the urgent one."
      : quickbooks === "connected" ? null
      : stale ? "Nothing has synced from QuickBooks in over a day. Check that the office PC is on, signed in, and running QuickBooks with the Web Connector."
      : "QuickBooks didn't answer, but orders synced recently — most likely the office PC is just asleep. Worth a look if it repeats during working hours.";

  return json(ok ? 200 : 503, { ok, quickbooks, database, lastOrderAgeHours, stale, detail, hint, checkedAt });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
