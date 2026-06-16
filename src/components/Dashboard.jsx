import React from "react";
import { C, elapsed, effectivePriority, sittingLevel, stageEnteredAt, stagedTooLong } from "../theme.js";

// The shop's home screen — a live at-a-glance view computed from the same orders
// + work orders the rest of the app uses. Cards and pipeline stages click
// through to their tab; order rows open the order.
export function Dashboard({ orders = [], workOrders = [], now, onNavigate, onOpenOrder }) {
  const ts = now || Date.now();
  const items = orders.flatMap((o) => o.items);
  const fulfilled = (o) => !!o.fulfillment;
  const active = (it) => it.stage !== "done";
  const orderActive = (o) => o.items.length > 0 && o.items.some(active) && !fulfilled(o);

  // ---- KPIs ----
  const rushCount = orders.filter((o) => effectivePriority(o, ts) === "RUSH" && orderActive(o)).length;
  const inProgItems = items.filter((it) => it.stage === "workorder").length;
  const inProgOrders = orders.filter((o) => o.items.some((it) => it.stage === "workorder")).length;
  const awaitingCount = items.filter((it) => it.stage === "awaiting").length;
  const readyCount = orders.filter((o) => !fulfilled(o) && o.items.length > 0 && o.items.every((it) => it.stage === "done")).length;
  const fulfillingCount = orders.filter((o) => o.fulfillment === "willcall" || o.fulfillment === "shipping").length;
  const openOrders = orders.filter((o) => !fulfilled(o)).length;

  // ---- pipeline (mirrors the tab badges) ----
  const pNew = orders.filter((o) => o.items.some((it) => it.stage === "new")).length;
  const pPick = items.filter((it) => it.stage === "picklist").length;
  const pWork = inProgItems;
  const pBuy = orders.reduce((n, o) => n + o.items.reduce((s, it) => s + (it.needsMaterial ? it.materials.filter((m) => !m.received).length : 0), 0), 0);
  const pFul = fulfillingCount;

  // ---- needs attention: RUSH, then blocked-on-material, then HIGH; oldest first; deduped ----
  const seen = new Set();
  const attn = [];
  const add = (o, tag, kind, t) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    attn.push({ id: o.id, no: o.orderNo, name: o.customer, tag, kind, t: t ?? o.receivedAt });
  };
  // When the longest-sitting flagged item entered its stage (so the time column
  // on "sitting"/"stale" rows shows how long it's been sitting, not order age).
  const idleSince = (o) => {
    let oldest = Infinity;
    o.items.forEach((it) => {
      if (!sittingLevel(it, ts)) return;
      const t = stageEnteredAt(it);
      if (t != null) oldest = Math.min(oldest, t);
    });
    return oldest === Infinity ? o.receivedAt : oldest;
  };
  const hasLevel = (o, lvl) => orderActive(o) && o.items.some((it) => active(it) && sittingLevel(it, ts) === lvl);
  orders.filter((o) => effectivePriority(o, ts) === "RUSH" && orderActive(o)).sort((a, b) => a.receivedAt - b.receivedAt).forEach((o) => add(o, "URGENT", "rush"));
  orders.filter((o) => hasLevel(o, "stale")).sort((a, b) => idleSince(a) - idleSince(b)).forEach((o) => add(o, "STALE", "stale", idleSince(o)));
  orders.filter((o) => stagedTooLong(o, ts)).sort((a, b) => new Date(a.fulfilledAt) - new Date(b.fulfilledAt)).forEach((o) => add(o, "TO SHIP", "ship", new Date(o.fulfilledAt).getTime()));
  orders.forEach((o) => {
    if (o.items.some((it) => it.stage === "awaiting" && it.materials.some((m) => !m.received))) add(o, "BLOCKED", "high");
  });
  orders.filter((o) => effectivePriority(o, ts) === "High" && orderActive(o)).sort((a, b) => a.receivedAt - b.receivedAt).forEach((o) => add(o, "HIGH", "high"));
  orders.filter((o) => hasLevel(o, "warn")).sort((a, b) => idleSince(a) - idleSince(b)).forEach((o) => add(o, "SITTING", "sitting", idleSince(o)));
  const attention = attn.slice(0, 8);

  // ---- workload by department (active items + open work orders of that dept) ----
  const dept = ["Shop", "CNC", "Sewing", "Saw"].map((name) => ({
    name,
    n: items.filter((it) => active(it) && it.dept === name).length +
       workOrders.filter((w) => !w.done && w.type === name.toLowerCase()).length,
  }));
  const deptMax = Math.max(1, ...dept.map((dd) => dd.n));

  // ---- order source ----
  const shopify = orders.filter((o) => o.source === "Shopify").length;
  const phone = orders.length - shopify;
  const srcTotal = orders.length || 1;

  // ---- recent orders feed ----
  const statusOf = (o) => {
    if (o.fulfillment === "shipping" && o.trackingNumber) return { label: "Shipped", c: C.gray, bg: C.grayBg };
    if (o.fulfillment === "shipping") return { label: "Staged", c: C.blue, bg: C.blueBg };
    if (o.fulfillment === "willcall") return { label: "Will call", c: C.gold, bg: C.goldBg };
    if (o.items.some((it) => it.stage === "new")) return { label: "Needs triage", c: C.gray, bg: C.grayBg };
    if (o.items.length > 0 && o.items.every((it) => it.stage === "done")) return { label: "Ready", c: C.green, bg: C.greenBg };
    return { label: "In progress", c: C.blue, bg: C.blueBg };
  };
  const recent = [...orders].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 8);

  const d = new Date(ts);
  const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");

  const card = { background: C.surface, border: `0.5px solid ${C.line}`, borderRadius: 8 };
  const tagStyle = { rush: { c: C.rush, bg: C.rushBg }, high: { c: C.high, bg: C.highBg }, stale: { c: C.rush, bg: C.rushBg }, sitting: { c: C.high, bg: C.highBg }, ship: { c: C.gold, bg: C.goldBg } };
  const sectionLabel = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 };

  const Kpi = ({ label, value, accent, sub, hot, to }) => (
    <div onClick={() => onNavigate(to)} style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 6, padding: "13px 15px", cursor: "pointer" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: C.gray }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 30, fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: hot && value ? accent : C.gray, fontWeight: hot && value ? 600 : 400 }}>{sub}</div>
    </div>
  );

  const Stage = ({ n, label, to }) => (
    <div onClick={() => onNavigate(to)} style={{ flex: 1, textAlign: "center", cursor: "pointer", padding: "4px 0" }}>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 24, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.gray }}>{label}</div>
    </div>
  );
  const Arrow = () => <span style={{ color: "#C9C7C2", fontSize: 16 }}>→</span>;

  return (
    <div>
      <div className="flex items-center mb-3 flex-wrap gap-2">
        <div>
          <div className="font-bold" style={{ fontSize: 17, textTransform: "uppercase", letterSpacing: 0.5 }}>Shop dashboard</div>
        </div>
        <div className="ml-auto flex items-center gap-3" style={{ fontSize: 12.5, color: C.gray }}>
          <span className="flex items-center gap-1.5"><span style={{ width: 7, height: 7, borderRadius: 4, background: C.green }} />Live</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{dateStr} · {timeStr}</span>
        </div>
      </div>

      <div className="grid mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Kpi label="Urgent orders" value={rushCount} accent={C.rush} sub={rushCount ? "need attention now" : "none right now"} hot to="orders" />
        <Kpi label="In progress" value={pWork} accent={C.blue} sub={`across ${inProgOrders} order${inProgOrders === 1 ? "" : "s"}`} to="work" />
        <Kpi label="Awaiting material" value={awaitingCount} accent={C.high} sub={awaitingCount ? "in purchasing" : "nothing waiting"} hot to="buy" />
        <Kpi label="Ready to ship" value={readyCount} accent={C.green} sub={readyCount ? "ready to fulfill" : "none yet"} hot to="orders" />
        <Kpi label="Out for fulfillment" value={fulfillingCount} accent={C.gold} sub="will call + shipping" to="shipping" />
        <Kpi label="Open orders" value={openOrders} accent={C.ink} sub={`${shopify} from Shopify`} to="orders" />
      </div>

      <div className="mb-3" style={{ ...card, padding: "13px 10px" }}>
        <div className="flex items-center">
          <Stage n={pNew} label="New orders" to="new" />
          <Arrow />
          <Stage n={pPick} label="Pick list" to="pick" />
          <Arrow />
          <Stage n={pWork} label="Work order" to="work" />
          <Arrow />
          <Stage n={pBuy} label="Purchasing" to="buy" />
          <Arrow />
          <Stage n={pFul} label="Fulfillment" to="shipping" />
        </div>
      </div>

      <div className="grid mb-3" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 12, alignItems: "start" }}>
        <div style={{ ...card, overflow: "hidden" }}>
          <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: `0.5px solid ${C.concrete}` }}>
            <span style={sectionLabel}>Needs attention</span>
            <span style={{ fontSize: 11, color: C.gray }}>{attention.length} flagged</span>
          </div>
          {attention.length === 0 && (
            <div style={{ padding: "28px 14px", textAlign: "center", color: C.gray, fontSize: 13 }}>All clear — nothing flagged right now.</div>
          )}
          {attention.map((a, i) => {
            const tg = tagStyle[a.kind];
            return (
              <div key={a.id} onClick={() => onOpenOrder(a.id)} className="flex items-center gap-2"
                style={{ padding: "9px 14px", borderBottom: i < attention.length - 1 ? `0.5px solid ${C.concrete}` : "none", cursor: "pointer" }}>
                <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, fontSize: 12.5, color: C.inkSoft }}>#{a.no}</span>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, color: tg.c, background: tg.bg, padding: "2px 5px", borderRadius: 3 }}>{a.tag}</span>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <span className="ml-auto" style={{ fontSize: 11.5, color: C.gray, whiteSpace: "nowrap" }}>{elapsed(ts - a.t)}</span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col" style={{ gap: 12 }}>
          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ ...sectionLabel, marginBottom: 11 }}>Workload by dept</div>
            <div className="flex flex-col" style={{ gap: 10 }}>
              {dept.map((dp) => (
                <div key={dp.name}>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{dp.name}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>{dp.n}</span>
                  </div>
                  <div style={{ height: 8, background: C.concrete, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((dp.n / deptMax) * 100)}%`, background: C.ink }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ ...sectionLabel, marginBottom: 10 }}>Where orders come from</div>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: C.concrete }}>
              <div style={{ width: `${(shopify / srcTotal) * 100}%`, background: C.blue }} />
              <div style={{ width: `${(phone / srcTotal) * 100}%`, background: C.ink }} />
            </div>
            <div className="flex items-center gap-4" style={{ marginTop: 10, fontSize: 12 }}>
              <span className="flex items-center gap-1.5"><span style={{ width: 9, height: 9, borderRadius: 2, background: C.blue }} /> Shopify <b style={{ fontFamily: "ui-monospace,monospace", marginLeft: 2 }}>{shopify}</b></span>
              <span className="flex items-center gap-1.5"><span style={{ width: 9, height: 9, borderRadius: 2, background: C.ink }} /> Phone <b style={{ fontFamily: "ui-monospace,monospace", marginLeft: 2 }}>{phone}</b></span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: `0.5px solid ${C.concrete}` }}>
          <span style={sectionLabel}>Recent orders</span>
          <span onClick={() => onNavigate("orders")} style={{ fontSize: 11.5, color: C.blue, cursor: "pointer", fontWeight: 600 }}>View all →</span>
        </div>
        {recent.length === 0 && <div style={{ padding: "24px 14px", textAlign: "center", color: C.gray, fontSize: 13 }}>No orders yet.</div>}
        {recent.map((o, i) => {
          const st = statusOf(o);
          const done = o.items.filter((it) => it.stage === "done").length;
          return (
            <div key={o.id} onClick={() => onOpenOrder(o.id)} className="flex items-center gap-3"
              style={{ padding: "9px 14px", borderBottom: i < recent.length - 1 ? `0.5px solid ${C.concrete}` : "none", cursor: "pointer" }}>
              <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, fontSize: 13, width: 46 }}>#{o.orderNo}</span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, flex: "0 1 220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customer}</span>
              {o.source === "Shopify" && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: C.blue, background: C.blueBg, padding: "2px 5px", borderRadius: 3 }}>SHOPIFY</span>
              )}
              <span className="flex items-center gap-1" style={{ marginLeft: "auto" }}>
                {o.items.map((it) => (
                  <span key={it.id} style={{ width: 16, height: 7, borderRadius: 2, background: it.stage === "done" ? C.green : (it.needsMaterial && it.materials.some((m) => !m.received)) ? C.high : C.line }} />
                ))}
                <span style={{ fontSize: 11, color: C.gray, marginLeft: 4, marginRight: 4, whiteSpace: "nowrap" }}>{done}/{o.items.length}</span>
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: st.c, background: st.bg, padding: "3px 7px", borderRadius: 3, whiteSpace: "nowrap" }}>{st.label}</span>
              <span style={{ fontSize: 11.5, color: C.gray, width: 56, textAlign: "right", whiteSpace: "nowrap" }}>{elapsed(ts - o.receivedAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
