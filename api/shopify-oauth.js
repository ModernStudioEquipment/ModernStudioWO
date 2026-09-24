// One-time handshake that turns a Shopify app's Client ID + Secret into a
// permanent Admin API token.
//
//   GET /api/shopify-oauth          -> sends you to Shopify to approve
//   GET /api/shopify-oauth?code=…   -> Shopify comes back here; shows the token
//
// WHY THIS EXISTS. Shopify retired the "create a custom app in your store admin"
// flow that handed over a shpat_ token. Apps made in the new Dev Dashboard only
// give a Client ID and Secret and expect an OAuth install — which normally means
// running an app server. This is that server, for the ninety seconds it takes:
// approve once, copy the token into Vercel, and nothing here is ever needed
// again. (It can stay; it does nothing until somebody with store-admin rights
// approves an install.)
//
// WHAT STOPS IT BEING ABUSED. The callback only proceeds when the query string
// carries a valid HMAC signed with our app secret — something only Shopify can
// produce — and only for the one store named in SHOPIFY_STORE. A stranger
// hitting the first URL gets bounced to a Shopify approval screen they have no
// rights to approve. The token is shown once, in the browser of whoever did the
// approving, and is never written to the database or the logs.
//
// Env (Vercel): SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE.
//
// In the Dev Dashboard the app's version must ALSO have:
//   * Allowed redirection URL:  https://modern-fulfillment.com/api/shopify-oauth
//   * "Use legacy install flow" ticked — the managed install hands a session
//     token to an app server instead of the code this exchanges.

import crypto from "node:crypto";

const SCOPES = "read_orders,read_products,read_all_orders";

export async function GET(request) {
  const u = new URL(request.url);
  const store = String(process.env.SHOPIFY_STORE || process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;

  const missing = [
    !store && "SHOPIFY_STORE",
    !clientId && "SHOPIFY_CLIENT_ID",
    !secret && "SHOPIFY_CLIENT_SECRET",
  ].filter(Boolean);
  if (missing.length) return page(503, `Not configured yet — add ${missing.join(", ")} in Vercel, redeploy, then come back to this page.`);

  const redirectUri = `${u.origin}${u.pathname}`;
  const code = u.searchParams.get("code");

  // --- step 1: nothing yet, so go and ask Shopify -------------------------
  if (!code) {
    const authorize =
      `https://${store}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(signState(secret))}`;
    return new Response(null, { status: 302, headers: { location: authorize } });
  }

  // --- step 2: Shopify came back. Is it really Shopify? -------------------
  if (!verifyHmac(u.searchParams, secret)) return page(400, "That didn't come from Shopify — the signature doesn't check out. Nothing was exchanged.");
  if (!verifyState(u.searchParams.get("state"), secret)) return page(400, "That approval is stale or wasn't started here. Open /api/shopify-oauth again.");
  const shop = String(u.searchParams.get("shop") || "");
  if (shop !== store) return page(400, `That approval was for ${shop}, and this is set up for ${store}. Nothing was exchanged.`);

  // --- step 3: swap the one-time code for the permanent token -------------
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
  }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  const token = body && body.access_token;
  if (!token) return page(502, `Shopify wouldn't swap that code${res ? ` (HTTP ${res.status})` : ""}. Nothing is broken — open /api/shopify-oauth and try once more.`);

  return tokenPage(token, body.scope || SCOPES);
}

// Shopify signs the query string: every param except `hmac`, sorted, joined
// k=v&k=v, HMAC-SHA256 with the app secret.
export function verifyHmac(params, secret) {
  const given = params.get("hmac");
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const mine = crypto.createHmac("sha256", secret).update(message).digest("hex");
  // Length-safe compare: timingSafeEqual throws on a mismatched length.
  const a = Buffer.from(mine, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// No session store here, so the state carries its own proof: a timestamp plus
// an HMAC of it. Good for ten minutes.
export function signState(secret, now = Date.now()) {
  const sig = crypto.createHmac("sha256", secret).update(String(now)).digest("hex").slice(0, 32);
  return `${now}.${sig}`;
}
export function verifyState(state, secret, now = Date.now()) {
  const [ts, sig] = String(state || "").split(".");
  if (!ts || !sig) return false;
  if (!/^\d+$/.test(ts)) return false;
  if (now - Number(ts) > 10 * 60 * 1000) return false;
  const mine = crypto.createHmac("sha256", secret).update(ts).digest("hex").slice(0, 32);
  return mine === sig;
}

const shell = (title, inner) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title>` +
  `<body style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:8vh auto;padding:0 20px;color:#16202B">${inner}</body>`;

const page = (status, message) =>
  new Response(shell("Shopify connection", `<h1 style="font-size:20px">Shopify connection</h1><p>${message}</p>`),
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const tokenPage = (token, scope) =>
  new Response(
    shell("Shopify token",
      `<h1 style="font-size:20px">Here's the token — copy it now</h1>` +
      `<p>It is shown once and nowhere else. Put it in Vercel as <b>SHOPIFY_ADMIN_TOKEN</b> (Production and Preview), then redeploy.</p>` +
      `<pre style="background:#F1F3F5;border:1px solid #DCE0E4;border-radius:8px;padding:14px;white-space:pre-wrap;word-break:break-all;font-size:15px">${String(token).replace(/[<&]/g, "")}</pre>` +
      `<p style="color:#5A6672;font-size:14px">Granted: ${String(scope).replace(/[<&]/g, "")}</p>` +
      `<p style="color:#5A6672;font-size:14px">Once it's in Vercel this page has no further use. If you ever think the token has leaked, uninstall the app in Shopify and run this again.</p>`),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
