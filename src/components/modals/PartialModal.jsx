import React, { useState } from "react";
import { X, Store, Truck, Package } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Record a partial (or full) pickup/shipment: per item, how many went out this
// time, plus who collected it (pickup) or carrier + tracking (shipment). The
// order stays live until every item is fully out, then it auto-completes.
const numQty = (q) => Math.max(parseInt(q, 10) || 1, 1);

export function PartialModal({ order, kind, onConfirm, onClose }) {
  const isPickup = kind === "pickup";
  const items = order.items.map((it) => ({ id: it.id, name: it.name, ordered: numQty(it.qty), out: it.fulfilledQty || 0 }))
    .map((it) => ({ ...it, remaining: Math.max(it.ordered - it.out, 0) }));
  const [qtys, setQtys] = useState(() => Object.fromEntries(items.map((it) => [it.id, String(it.remaining)])));
  const [person, setPerson] = useState("");
  const [carrier, setCarrier] = useState(order.carrier || "");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const lines = items.map((it) => ({ itemId: it.id, name: it.name, qty: parseInt(qtys[it.id], 10) || 0 })).filter((l) => l.qty > 0);
  const canSave = lines.length > 0 && !saving;

  const confirm = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onConfirm({ kind, person: person.trim() || null, carrier: carrier.trim() || null, tracking: tracking.trim() || null, note: note.trim() || null, lines });
    } finally { setSaving(false); }
  };

  const label = { fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          {isPickup ? <Store size={17} /> : <Truck size={17} />}
          {isPickup ? "Record pickup" : "Record shipment"} · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4" style={{ maxHeight: "82vh", overflowY: "auto" }}>
          <div style={{ ...label, marginBottom: 8 }}>How many {isPickup ? "picked up" : "shipped"} this time</div>
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 mb-2">
              <span className="flex-1" style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{it.name}</span>
              <span style={{ fontSize: 11, color: it.remaining <= 0 ? C.green : C.gray, whiteSpace: "nowrap" }}>
                {it.remaining <= 0 ? "all out" : `${it.out}/${it.ordered} out`}
              </span>
              <input type="number" min="0" value={qtys[it.id]} disabled={it.remaining <= 0}
                onChange={(e) => setQtys((q) => ({ ...q, [it.id]: e.target.value }))}
                className="px-2 py-1.5 outline-none text-center" style={{ ...inp, width: 70, opacity: it.remaining <= 0 ? 0.5 : 1 }} />
            </div>
          ))}

          <div className="mt-4">
            {isPickup ? (
              <div className="mb-3">
                <div style={label}>Picked up by</div>
                <input autoFocus value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Who collected it" className="w-full px-2 py-2 outline-none" style={inp} />
              </div>
            ) : (
              <div className="flex gap-3 mb-3">
                <div className="flex-1">
                  <div style={label}>Carrier</div>
                  <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, FedEx…" className="w-full px-2 py-2 outline-none" style={inp} />
                </div>
                <div className="flex-1">
                  <div style={label}>Tracking #</div>
                  <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="This shipment's tracking" className="w-full px-2 py-2 outline-none" style={inp} />
                </div>
              </div>
            )}
            <div className="mb-4">
              <div style={label}>Note</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional" className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
            </div>
          </div>

          <Btn kind="brass" onClick={confirm} disabled={!canSave}>
            <Package size={15} />{saving ? "Saving…" : isPickup ? "Record pickup" : "Record shipment"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
