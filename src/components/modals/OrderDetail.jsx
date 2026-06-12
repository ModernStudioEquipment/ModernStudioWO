import React from "react";
import { X } from "lucide-react";
import { C, PRI, elapsed, itemStatusText } from "../../theme.js";
import { Pill, Info, Stepper, DeptBadge } from "../ui.jsx";

// The office "where's my order?" view — full detail with a per-product
// progress tracker. Items reconverge here even though they're triaged and
// routed independently.
export function OrderDetail({ order, status, now, onClose }) {
  const p = PRI[order.priority];
  const done = order.items.filter((i) => i.stage === "done").length;
  const total = order.items.length;
  const receivedOn = new Date(order.receivedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 580, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: C.ink, color: "#fff" }}>
          <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 16 }}>#{order.orderNo}</span>
          <span className="font-bold" style={{ fontSize: 15 }}>{order.customer}</span>
          <Pill c={p.c} bg={p.bg}>{order.priority}</Pill>
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div className="grid mb-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Info label="Company" value={order.customer} />
            <Info label="Ordered by" value={order.contact} />
            <Info label="Received" value={`${receivedOn} · ${elapsed(now - order.receivedAt)} ago`} />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <Pill c={status.c} bg={status.bg} Icon={status.Icon}>{status.label}</Pill>
            <span style={{ fontSize: 13, color: C.gray }}>{done} of {total} items done</span>
            {order.willCall && <Pill c={C.blue} bg={C.blueBg}>Will call</Pill>}
          </div>
          {order.fulfillment && (
            <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>
              {order.fulfillment === "shipping" ? "Staged at" : "Will call at"}: <b>{order.location || "—"}</b>
              {order.fulfillment === "shipping" && order.trackingNumber && <> · Tracking: <b>{order.trackingNumber}</b></>}
            </div>
          )}
          <div style={{ height: 6, background: C.line, borderRadius: 3, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: "100%", background: C.green }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Products ordered
          </div>
          {order.items.map((it) => (
            <div key={it.id} className="rounded mb-2 p-3" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2">
                <DeptBadge d={it.dept} />
                <span className="font-bold" style={{ fontSize: 14 }}>{it.name}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>×{it.qty}</span>
                <span className="ml-auto font-bold" style={{ fontSize: 12, color: it.stage === "done" ? C.green : C.inkSoft }}>
                  {itemStatusText(it)}
                </span>
              </div>
              <Stepper it={it} />
              {it.stage === "awaiting" && it.materials.some((m) => !m.received) && (
                <div style={{ fontSize: 12, color: C.high, marginTop: 10 }}>
                  Waiting on: {it.materials.filter((m) => !m.received).map((m) => `${m.name}${m.amount ? ` (${m.amount})` : ""}`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,20,20,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
