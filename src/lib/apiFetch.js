import { supabase } from "./supabase.js";

// Call one of our own /api routes as the signed-in member of staff.
//
// Those routes read and write the board — a re-sync rewrites an order's items,
// and the QuickBooks reset removes every order that came from it — so they check
// who's asking (see lib/apiAuth.js). This is the half that answers: the same
// access token the browser already holds, on the request.
export async function apiFetch(url, opts = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch {
    /* signed out or local mode — the request goes without, and is refused */
  }
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : null),
    },
  });
}
