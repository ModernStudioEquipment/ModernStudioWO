// Shopify "Order creation" webhook receiver.
// Shopify POSTs the new order here; we verify its HMAC signature, then insert
// the order via the create_order SQL function. Supabase realtime pushes it
// onto every open board — no front-end work needed.
//
// Required environment variables (Vercel project settings):
//   VITE_SUPABASE_URL          — already set (shared with the front end)
//   SUPABASE_SECRET_KEY        — Supabase secret/service key (server-only!)
//   SHOPIFY_WEBHOOK_SECRET     — signing secret shown when the webhook is created

import crypto from "node:crypto";

export async function POST(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  const missing = [
    !url && "VITE_SUPABASE_URL",
    !serviceKey && "SUPABASE_SECRET_KEY",
    !webhookSecret && "SHOPIFY_WEBHOOK_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    return json(500, { error: "Server not configured", missing });
  }

  // --- 1. Verify the request is really from Shopify (HMAC over the raw body) ---
  const raw = await request.text();
  const theirHmac = request.headers.get("x-shopify-hmac-sha256") || "";
  const ourHmac = crypto.createHmac("sha256", webhookSecret).update(raw, "utf8").digest("base64");
  const a = Buffer.from(ourHmac);
  const b = Buffer.from(theirHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return json(401, { error: "Invalid signature" });
  }

  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // --- 2. Map the Shopify order to our schema ---
  const orderNo = String(order.order_number ?? order.number ?? order.id ?? "");
  if (!orderNo) return json(400, { error: "No order number" });

  const cust = order.customer || {};
  const addr = order.shipping_address || order.billing_address || {};
  const personName = [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim();
  const customer = addr.company || personName || "Shopify customer";
  const contact = personName || order.email || "—";
  // Shipping method the customer chose at checkout (Shopify's shipping line),
  // e.g. "UPS® Ground" or "Local pickup" — shown next to Ship To. Null if none.
  const shipVia = (order.shipping_lines || []).map((l) => String((l && l.title) || "").trim()).filter(Boolean).join(", ") || null;

  const items = (order.line_items || []).map((li, i) => ({
    name: li.variant_title ? `${li.title} — ${li.variant_title}` : li.title,
    qty: li.quantity || 1,
    dept: "Shop", // default; the office re-routes per item at triage
    color: null,
    position: i,
    product_id: li.product_id || null,
  }));
  if (!items.length) return json(200, { ok: true, skipped: "no line items" });

  // Best-effort: pull each product's photo from Shopify. Only runs when a
  // read_products Admin token is configured; any failure is swallowed so it can
  // never block the order from being created.
  try {
    const shop = request.headers.get("x-shopify-shop-domain");
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
    if (shop && adminToken) {
      const imgs = await fetchProductImages(shop, adminToken, items.map((it) => it.product_id));
      for (const it of items) if (it.product_id && imgs[it.product_id]) it.image_url = imgs[it.product_id];
    }
  } catch { /* photos are optional */ }

  const sb = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // --- 3. Dedupe: Shopify retries webhooks, so skip if we already have it ---
  const dupRes = await fetch(
    `${url}/rest/v1/orders?select=id&source=eq.Shopify&order_no=eq.${encodeURIComponent(orderNo)}&limit=1`,
    { headers: sb }
  );
  const dups = await dupRes.json();
  if (Array.isArray(dups) && dups.length) {
    return json(200, { ok: true, skipped: "duplicate" });
  }

  // --- 4. Insert atomically via the existing SQL function ---
  const ins = await fetch(`${url}/rest/v1/rpc/create_order`, {
    method: "POST",
    headers: sb,
    body: JSON.stringify({
      p_order: {
        order_no: orderNo,
        customer,
        contact,
        priority: "Normal",
        source: "Shopify",
        will_call: false,
        // Shopify orders are due 5 days after they're placed. This shows as a
        // due/past-due date on the board, but Shopify orders are kept OUT of the
        // urgent lane (see effectivePriority) — that's reserved for QuickBooks.
        due_date: dueFivePlacedDays(order.created_at),
      },
      p_items: items,
    }),
  });

  if (!ins.ok) {
    const detail = await ins.text();
    return json(502, { error: "Database insert failed", detail: detail.slice(0, 300) });
  }

  // Stamp the shipping method onto the order (shown next to Ship To). Best-effort:
  // never block the order on it, and tolerate the ship_via column not existing yet.
  if (shipVia) {
    await fetch(`${url}/rest/v1/orders?source=eq.Shopify&order_no=eq.${encodeURIComponent(orderNo)}`, {
      method: "PATCH", headers: sb, body: JSON.stringify({ ship_via: shipVia }),
    }).catch(() => {});
  }

  return json(200, { ok: true, order_no: orderNo, items: items.length });
}

// Shopify expects a fast 200; everything else (GET probes etc.) gets a hint.
export async function GET() {
  return json(405, { error: "POST only — this is the Shopify webhook endpoint" });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Due date = 5 days after the order was placed. Shopify's created_at is ISO-8601
// in the shop's own timezone (e.g. "2026-06-29T14:30:00-05:00"), so the first 10
// chars are the local placed-date; add 5 days with plain date math (anchored at
// UTC midnight) to avoid timezone drift. Returns "YYYY-MM-DD".
function dueFivePlacedDays(createdAt) {
  const datePart = String(createdAt || "").slice(0, 10);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(datePart)
    ? new Date(`${datePart}T00:00:00Z`)
    : new Date(); // fallback: today, if Shopify ever omits created_at
  base.setUTCDate(base.getUTCDate() + 5);
  return base.toISOString().slice(0, 10);
}

// Fetch each product's primary image from the Shopify Admin API. Returns a map
// of productId -> image URL. Needs SHOPIFY_ADMIN_TOKEN with read_products.
async function fetchProductImages(shop, token, productIds) {
  const out = {};
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return out;
  const ver = process.env.SHOPIFY_API_VERSION || "2025-10";
  await Promise.all(
    ids.map(async (pid) => {
      try {
        const r = await fetch(
          `https://${shop}/admin/api/${ver}/products/${pid}.json?fields=id,image,images`,
          { headers: { "X-Shopify-Access-Token": token } }
        );
        if (!r.ok) return;
        const d = await r.json();
        const src = d.product?.image?.src || d.product?.images?.[0]?.src || null;
        if (src) out[pid] = src;
      } catch {
        /* one product failing shouldn't affect the rest */
      }
    })
  );
  return out;
}
