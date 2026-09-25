// Who is calling an /api route?
//
// The sync routes were open to anyone who knew the URL. A GET handed back the
// customer's name for any order number; a POST re-synced or inserted orders;
// and DELETE ?reset=quickbooks removed every QuickBooks-sourced order on the
// board. None of that needed a password. The routes only ever authenticated
// themselves TO Supabase — nothing authenticated the caller.
//
// Two ways in, and no third:
//
//   * a signed-in member of staff — the browser sends its Supabase access token
//     and this checks it with Supabase, the same as the note and feedback mail;
//   * a machine, with the shared secret in `x-sync-secret`, and ONLY when
//     SYNC_SECRET is set. Unset means no machine access at all rather than a
//     blank password that matches an absent header.
//
// Lives outside /api on purpose: everything in that directory becomes a route.

import crypto from "node:crypto";

// The staffer behind the request, or null. `callerIsStaff` is the yes/no form.
export async function callerStaff(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !url || !anonKey) return null;
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return who && who.id ? who : null;
}

export async function callerIsStaff(request) {
  const secret = process.env.SYNC_SECRET;
  if (secret && sameSecret(request.headers.get("x-sync-secret"), secret)) return true;

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !url || !anonKey) return false;

  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return !!(who && who.id);
}

export const notSignedIn = () =>
  new Response(JSON.stringify({ error: "Not signed in. This endpoint is for the board, not the open web." }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Constant-time, and never throws on a length mismatch.
function sameSecret(given, expected) {
  if (!given) return false;
  const a = Buffer.from(String(given), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
