import React, { useEffect, useRef, useState } from "react";
import { X, Truck, Package } from "lucide-react";
import { C } from "../../theme.js";

// Second stage of shipping: the order is staged (has a warehouse location) and
// now actually goes out the door. Record the carrier, tracking number, and any
// shipping notes.
export function TrackingModal({ order, onConfirm, onClose }) {
  const [tracking, setTracking] = useState(order.trackingNumber || "");
  const [carrier, setCarrier] = useState(order.carrier || "");
  const [notes, setNotes] = useState(order.shipNotes || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const confirm = async () => {
    if (!tracking.trim() || saving) return;
    setSaving(true);
    try {
      await onConfirm({ tracking: tracking.trim(), carrier: carrier.trim() || null, notes: notes.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: C.surface, fontSize: 14, borderRadius: 6 };
  const label = { fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <Truck size={17} />
          Mark shipped · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, color: C.gray, marginBottom: 12 }}>
            {order.customer}{order.location ? ` — staged at ${order.location}` : ""}.
          </div>
          <div className="mb-3">
            <div style={label}>Carrier</div>
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, FedEx, USPS…" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>
          <div className="mb-3">
            <div style={label}>Tracking number</div>
            <div className="flex items-center gap-2 px-2" style={inp}>
              <Package size={16} color={C.gray} />
              <input
                ref={inputRef}
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Carrier tracking #…"
                className="flex-1 py-2 outline-none"
                style={{ background: "transparent", fontSize: 14, border: "none" }}
              />
            </div>
          </div>
          <div className="mb-4">
            <div style={label}>Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) confirm(); }} placeholder="Anything to note about this shipment (optional)" rows={2} className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
          </div>
          <button
            onClick={confirm}
            disabled={!tracking.trim() || saving}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.fill, color: "#fff", opacity: tracking.trim() && !saving ? 1 : 0.5 }}
          >
            {saving ? "Saving…" : "Mark shipped"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60,
};
