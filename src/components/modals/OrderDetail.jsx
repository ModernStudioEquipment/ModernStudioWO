import React, { useState, useRef, useEffect } from "react";
import { X, Trash2, Clock, ChevronDown, ExternalLink, Check, Store, Truck } from "lucide-react";
import { C, PRI, elapsed, itemStatusText, trackingUrl } from "../../theme.js";
import { Pill, Info, Stepper, DeptBadge, DuePill, CompletionPill, MethodBadge, InvoicedBadge, SittingBadge, MoveMenu, Btn } from "../ui.jsx";
import { ItemTimeline } from "../ItemTimeline.jsx";

// The office "where's my order?" view — full detail with a per-product
// progress tracker. Items reconverge here even though they're triaged and
// routed independently.
export function OrderDetail({ order, status, now, onDueDate, onCompletion, onInvoice, onMethod, onSaveNotes, onUpdateItem, onMoveItem, onFulfill, onSendOrderBack, onCancel, onWalkInPickup, onPartialPickup, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("Customer cancelled");
  const [openTimeline, setOpenTimeline] = useState(null); // item id whose timeline is expanded
  const [notes, setNotes] = useState(order.notes || "");
  const [savedNotes, setSavedNotes] = useState(order.notes || "");
  // Grow the notes box to fit its content (no inner scroll).
  const notesRef = useRef(null);
  const growNotes = (el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { growNotes(notesRef.current); }, []);
  const done = order.items.filter((i) => i.stage === "done").length;
  const total = order.items.length;
  const receivedOn = new Date(order.receivedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 580, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="px-4 py-3" style={{ background: C.fill, color: "#fff" }}>
          <div className="flex items-start gap-3">
            <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 16, flexShrink: 0 }}>#{order.orderNo}</span>
            <span className="font-bold flex-1 min-w-0" style={{ fontSize: 15 }}>{order.customer}</span>
            <button onClick={onClose} style={{ color: "#fff", flexShrink: 0 }}><X size={18} /></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <MethodBadge m={order.fulfillmentMethod} onChange={onMethod} />
            <DuePill o={order} now={now} onChange={onDueDate} />
            <CompletionPill o={order} onChange={onCompletion} showEmpty />
            <InvoicedBadge o={order} onClick={onInvoice} />
          </div>
        </div>
        <div className="p-4">
          <div className="grid mb-4 grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
            <Info label="Company" value={order.customer} />
            <Info label="Ordered by" value={order.contact} />
            <Info label="Received" value={`${receivedOn} · ${elapsed(now - order.receivedAt)} ago`} />
            {order.shipTo && <Info label="Ship to" value={order.shipTo} />}
            {order.shipVia && <Info label="Ship via" value={order.shipVia} />}
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
          {onSaveNotes && (
            <div className="mb-4">
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Order notes</div>
              <textarea
                ref={notesRef}
                value={notes}
                onChange={(e) => { setNotes(e.target.value); growNotes(e.target); }}
                rows={2}
                placeholder="Notes about this order…"
                className="w-full px-2 py-2 outline-none"
                style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, background: C.surface, resize: "none", overflow: "hidden", minHeight: 52 }}
              />
              {notes !== savedNotes && (
                <button onClick={async () => { await onSaveNotes(notes.trim() || null); setSavedNotes(notes); }}
                  className="mt-2 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide" style={{ background: C.fill, color: "#fff" }}>
                  Save note
                </button>
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
            <div key={it.id} className="rounded mb-2 p-3" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
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
                {it.stage === "done" && onMoveItem && (
                  <MoveMenu stage={it.stage} onMove={(s) => onMoveItem(it.id, s)} label="Send back to" />
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

          {status.key === "ready" && onFulfill && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>This order is ready — send the whole order to fulfillment:</div>
              <div className="flex items-center gap-2 flex-wrap">
                {order.fulfillmentMethod !== "shipping" && (
                  <Btn kind="gold" onClick={() => onFulfill("willcall")}><Store size={13} />Will call</Btn>
                )}
                {order.fulfillmentMethod !== "willcall" && (
                  <Btn kind="brass" onClick={() => onFulfill("shipping")}><Truck size={13} />Ship</Btn>
                )}
              </div>
            </div>
          )}

          {onSendOrderBack && order.items.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>Send the whole order somewhere else — every item moves at once{order.fulfillment ? " (or switch it straight to Will Call / Shipping)" : ""}:</div>
              <MoveMenu
                stage="done"
                label="Send whole order to"
                extraTargets={order.fulfillment ? [
                  ...(order.fulfillment !== "willcall" ? [{ stage: "willcall", label: "Will Call" }] : []),
                  ...(order.fulfillment !== "shipping" ? [{ stage: "shipping", label: "Shipping" }] : []),
                ] : []}
                onMove={(s) => (s === "willcall" || s === "shipping") ? (onFulfill && onFulfill(s)) : onSendOrderBack(s)}
              />
            </div>
          )}

          {(onWalkInPickup || onPartialPickup) && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>Customer came in for this order? Complete it (skips the stages, straight to Completed), or record a partial pickup — the rest stays live.</div>
              <div className="flex items-center gap-2 flex-wrap">
                {onWalkInPickup && (
                  <button onClick={onWalkInPickup} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.green, color: "#fff", letterSpacing: 0.5 }}>
                    <Check size={13} />Picked up — complete order
                  </button>
                )}
                {onPartialPickup && (
                  <button onClick={onPartialPickup} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.surface, color: C.green, border: `1px solid ${C.green}`, letterSpacing: 0.5 }}>
                    <Check size={13} />Picked up partial
                  </button>
                )}
              </div>
            </div>
          )}

          {onCancel && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              {confirming ? (
                <div>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 8 }}>Cancel this order? It's kept on record with a reason.</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className="px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, background: C.surface }}>
                      <option>Customer cancelled</option>
                      <option>Duplicate order</option>
                      <option>Entered by mistake</option>
                      <option>Other</option>
                    </select>
                    <button onClick={async () => { await onCancel(reason); onClose(); }} className="px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.rush, color: "#fff", letterSpacing: 0.5 }}>
                      Cancel order
                    </button>
                    <button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, letterSpacing: 0.5 }}>
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-bold uppercase tracking-wide" style={{ fontSize: 12, background: C.surface, color: C.rush, border: `1px solid ${C.rush}`, letterSpacing: 0.5 }}>
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
