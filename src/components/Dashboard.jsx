import React from "react";
import { C, elapsed } from "../theme.js";

// The shop's home screen — a live at-a-glance view computed from the same orders
// + work orders the rest of the app uses. Cards and pipeline stages click
// through to their tab; attention rows open the order.
export function Dashboard({ orders = [], workOrders = [], now, onNavigate, onOpenOrder }) {
  const ts = now || Date.now();
  const items = orders.flatMap((o) => o.items);
  const fulfilled = (o) => !!o.fulfillment;
  const orderActive = (o) => o.items.length > 0 && o.items.some((it) => it.stage !== "done") && !fulfilled(o);

  // ---- KPIs ----
  const rushCount = orders.filter((o) => o.priority === "RUSH" && orderActive(o)).length;
  const inProgItems = items.filter((it) => it.stage === "workorder").length;
  const inProgOrders = orders.filter((o) => o.items.some((it) => it.stage === "workorder")).length;
  const awaitingCount = items.filter((it) => it.stage === "awaiting").length;
  const readyCount = orders.filter((o) => !fulfilled(o) && o.items.length > 0 && o.items.every((it) => it.stage === "done")).length;

  // ---- pipeline (mirrors the tab badges) ----
  const pNew = orders.filter((o) => o.items.some((it) => it.stage === "new")).length;
  const pPick = items.filter((it) => it.stage === "picklist").length;
  const pWork = inProgItems;
  const pBuy = orders.reduce((n, o) => n + o.items.reduce((s, it) => s + (it.needsMaterial ? it.materials.filter((m) => !m.received).length : 0), 0), 0);
  const pFul = orders.filter((o) => o.fulfillment === "willcall" || o.fulfillment === "shipping").length;

  // ---- needs attention: RUSH, then blocked-on-material, then HIGH; oldest first; deduped ----
  const seen = new Set();
  const attn = [];
  const add = (o, tag, kind) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    attn.push({ id: o.id, no: o.orderNo, name: o.customer, tag, kind, t: o.receivedAt });
  };
  orders.filter((o) => o.priority === "RUSH" && orderActive(o)).sort((a, b) => a.receivedAt - b.receivedAt).forEach((o) => add(o, "RUSH", "rush"));
  orders.forEach((o) => {
    if (o.items.some((it) => it.stage === "awaiting" && it.materials.some((m) => !m.received))) add(o, "BLOCKED", "high");
  });
  orders.filter((o) => o.priority === "High" && orderActive(o)).sort((a, b) => a.receivedAt - b.receivedAt).forEach((o) => add(o, "HIGH", "high"));
  const attention = attn.slice(0, 6);

  // ---- workload by department ----
  const woActive = (t) => workOrders.filter((w) => !w.done && w.type === t).length;
  const active = (it) => it.stage !== "done";
  const dept = [
    { name: "Machine", n: items.filter((it) => active(it) && it.dept === "Machine").length + woActive("shop") },
    { name: "Sewing", n: items.filter((it) => active(it) && it.dept === "Sewing").length + woActive("sewing") },
    { name: "CNC", n: woActive("cnc") },
    { name: "Saw", n: woActive("saw") },
  ];
  const deptMax = Math.max(1, ...dept.map((d) => d.n));
  const openOrders = orders.filter((o) => !fulfilled(o)).length;
  const shopifyOrders = orders.filter((o) => o.source === "Shopify").length;

  const d = new Date(ts);
  const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");

  const card = { background: C.surface, border: `0.5px solid ${C.line}`, borderRadius: 8 };
  const tagStyle = { rush: { c: C.rush, bg: C.rushBg }, high: { c: C.high, bg: C.highBg } };

  const Kpi = ({ label, value, accent, sub, hot, to }) => (
    <div onClick={() => onNavigate(to)} style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 6, padding: "10px 13px", cursor: "pointer" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: C.gray }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 27, fontWeight: 800, lineHeight: 1.1, marginTop: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: hot && value ? accent : C.gray, fontWeight: hot && value ? 600 : 400 }}>{sub}</div>
    </div>
  );

  const Stage = ({ n, label, to }) => (
    <div onClick={() => onNavigate(to)} style={{ flex: 1, textAlign: "center", cursor: "pointer" }}>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 20, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.gray }}>{label}</div>
    </div>
  );
  const Arrow = () => <span style={{ color: "#C9C7C2", fontSize: 15 }}>→</span>;

  return (
    <div>
      <div className="flex items-center mb-3 flex-wrap gap-2">
        <div>
          <div className="font-bold" style={{ fontSize: 16 }}>Shop dashboard</div>
          <div style={{ fontSize: 13, color: C.gray }}>Everything live — updates as work moves.</div>
        </div>
        <div className="ml-auto flex items-center gap-3" style={{ fontSize: 12, color: C.gray }}>
          <span className="flex items-center gap-1.5"><span style={{ width: 7, height: 7, borderRadius: 4, background: C.green }} />Live</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{dateStr} · {timeStr}</span>
        </div>
      </div>

      <div className="grid mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))", gap: 10 }}>
        <Kpi label="Rush orders" value={rushCount} accent={C.rush} sub={rushCount ? "need attention now" : "none right now"} hot to="orders" />
        <Kpi label="In progress" value={pWork} accent={C.blue} sub={`across ${inProgOrders} order${inProgOrders === 1 ? "" : "s"}`} to="work" />
        <Kpi label="Awaiting material" value={awaitingCount} accent={C.high} sub={awaitingCount ? "in purchasing" : "nothing waiting"} hot to="buy" />
        <Kpi label="Ready to ship" value={readyCount} accent={C.green} sub={readyCount ? "ready to fulfill" : "none yet"} hot to="orders" />
      </div>

      <div className="mb-3" style={{ ...card, padding: "11px 8px" }}>
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

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <div style={{ ...card, overflow: "hidden" }}>
          <div className="flex items-center justify-between" style={{ padding: "9px 13px", borderBottom: `0.5px solid ${C.concrete}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 }}>Needs attention</span>
            <span style={{ fontSize: 11, color: C.gray }}>{attention.length} flagged</span>
          </div>
          {attention.length === 0 && (
            <div style={{ padding: "22px 13px", textAlign: "center", color: C.gray, fontSize: 13 }}>All clear — nothing flagged right now.</div>
          )}
          {attention.map((a, i) => {
            const tg = tagStyle[a.kind];
            return (
              <div key={a.id} onClick={() => onOpenOrder(a.id)} className="flex items-center gap-2"
                style={{ padding: "8px 13px", borderBottom: i < attention.length - 1 ? `0.5px solid ${C.concrete}` : "none", cursor: "pointer" }}>
                <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, fontSize: 12, color: C.inkSoft }}>#{a.no}</span>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, color: tg.c, background: tg.bg, padding: "2px 5px", borderRadius: 3 }}>{a.tag}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <span className="ml-auto" style={{ fontSize: 11, color: C.gray, whiteSpace: "nowrap" }}>{elapsed(ts - a.t)}</span>
              </div>
            );
          })}
        </div>

        <div style={{ ...card, padding: "11px 13px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Workload by dept</div>
          <div className="flex flex-col" style={{ gap: 9 }}>
            {dept.map((dp) => (
              <div key={dp.name}>
                <div className="flex justify-between" style={{ fontSize: 11.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{dp.name}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>{dp.n}</span>
                </div>
                <div style={{ height: 7, background: C.concrete, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((dp.n / deptMax) * 100)}%`, background: C.ink }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 13, paddingTop: 11, borderTop: `0.5px solid ${C.concrete}`, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 19, fontWeight: 800 }}>{openOrders}</span>
            <span style={{ fontSize: 11, color: C.gray }}>open orders · {shopifyOrders} from Shopify</span>
          </div>
        </div>
      </div>
    </div>
  );
}
