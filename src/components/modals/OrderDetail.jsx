import React, { useState } from "react";
import { X, Trash2, RotateCcw, Clock, ChevronDown, ExternalLink } from "lucide-react";
import { C, PRI, elapsed, itemStatusText, trackingUrl } from "../../theme.js";
import { Pill, Info, Stepper, DeptBadge, DuePill, SittingBadge } from "../ui.jsx";
import { ItemTimeline } from "../ItemTimeline.jsx";

// The office "where's my order?" view — full detail with a per-product
// progress tracker. Items reconverge here even though they're triaged and
// routed independently.
export function OrderDetail({ order, status, now, onPriority, onUpdateItem, onUnpick, onCancel, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("Customer cancelled");
  const [openTimeline, setOpenTimeline] = useState(null); // item id whose timeline is expanded
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
          <DuePill o={order} now={now} />
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
              {order.fulfillment === "shipping" && order.trackingNumber && (
                <>{order.carrier ? ` · ${order.carrier}` : ""} · Tracking:{" "}
                  <a href={trackingUrl(order.trackingNumber)} target="_blank" rel="noopener noreferrer" title="Track this shipment (opens the carrier's site)" style={{ color: C.blue, fontWeight: 700, textDecoration: "none" }}>
                    {order.trackingNumber}<ExternalLink size={11} style={{ marginLeft: 3, verticalAlign: "-1px" }} />
                  </a>
                  {order.shipNotes ? <> · Notes: <span style={{ color: C.inkSoft }}>{order.shipNotes}</span></> : null}
                </>
              )}
            </div>
          )}
          <div style={{ height: 6, background: C.line, borderRadius: 3, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: "100%", background: C.green }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Products ordered
          </div>
          {order.items.map((it) => {
            const open = openTimeline === it.id;
            return (
            <div key={it.id} className="rounded mb-2 p-3" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2">
                <DeptBadge d={it.dept} onChange={onUpdateItem ? (dep) => onUpdateItem(it.id, { dept: dep }) : undefined} />
                <span className="font-bold" style={{ fontSize: 14 }}>{it.name}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>×{it.qty}</span>
                <SittingBadge it={it} now={now} />
                <span className="ml-auto font-bold" style={{ fontSize: 12, color: it.stage === "done" ? C.green : C.inkSoft }}>
                  {itemStatusText(it)}
                </span>
              </div>
              <Stepper it={it} />
              <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                <button
                  onClick={() => setOpenTimeline(open ? null : it.id)}
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: 12, fontWeight: 700, color: C.blue }}
                  title="See where this product has been and how long"
                >
                  <Clock size={12} />{open ? "Hide timeline" : "View timeline"}
                  <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {it.stage === "done" && onUnpick && (
                  <button
                    onClick={() => onUnpick(it.id)}
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: 12, color: C.gray, fontWeight: 700 }}
                    title="Send this item back to the pick list"
                  >
                    <RotateCcw size={12} />Undo pick — back to pick list
                  </button>
                )}
              </div>
              {open && (
                <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                  <ItemTimeline events={it.events} now={now} currentStage={it.stage} />
                </div>
              )}
              {it.stage === "awaiting" && it.materials.some((m) => !m.received) && (
                <div style={{ fontSize: 12, color: C.high, marginTop: 10 }}>
                  Waiting on: {it.materials.filter((m) => !m.received).map((m) => `${m.name}${m.amount ? ` (${m.amount})` : ""}`).join(", ")}
                </div>
              )}
              {it.materials && it.materials.filter((m) => m.ordered).map((m) => (
                <div key={m.id} style={{ fontSize: 12, color: C.gray, marginTop: 8 }}>
                  <span style={{ fontWeight: 700, color: C.blue }}>Ordered</span> · {m.name}
                  {[m.vendor && `from ${m.vendor}`, m.poNumber && `PO ${m.poNumber}`, m.orderedBy && `by ${m.orderedBy}`].filter(Boolean).map((s) => ` · ${s}`).join("")}
                </div>
              ))}
            </div>
            );
          })}

          {onCancel && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              {confirming ? (
                <div>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>Cancel this order? It's kept on record with a reason.</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className="px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
                      <option>Customer cancelled</option>
                      <option>Duplicate order</option>
                      <option>Entered by mistake</option>
                      <option>Other</option>
                    </select>
                    <button onClick={async () => { await onCancel(reason); onClose(); }} className="px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.rush, color: "#fff", letterSpacing: 0.5 }}>
                      Cancel order
                    </button>
                    <button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}`, letterSpacing: 0.5 }}>
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: "#fff", color: C.rush, border: `1px solid ${C.rush}`, letterSpacing: 0.5 }}>
                  <Trash2 size={13} />Cancel order
                </button>
              )}
            </div>
          )}
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
