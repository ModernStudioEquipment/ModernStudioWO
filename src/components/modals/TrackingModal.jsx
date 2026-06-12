import React, { useEffect, useRef, useState } from "react";
import { X, Truck, Package } from "lucide-react";
import { C } from "../../theme.js";

// Second stage of shipping: the order is staged (has a warehouse location) and
// now actually goes out the door. Record the carrier tracking number.
export function TrackingModal({ order, onConfirm, onClose }) {
  const [tracking, setTracking] = useState(order.trackingNumber || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const confirm = async () => {
    if (!tracking.trim() || saving) return;
    setSaving(true);
    try {
      await onConfirm(tracking.trim());
    } finally {
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: "#fff", fontSize: 14, borderRadius: 6 };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.ink, color: "#fff" }}>
          <Truck size={17} />
          Mark shipped · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, color: C.gray, marginBottom: 12 }}>
            {order.customer}{order.location ? ` — staged at ${order.location}` : ""}.
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Tracking number
          </div>
          <div className="flex items-center gap-2 mb-4 px-2" style={inp}>
            <Package size={16} color={C.gray} />
            <input
              ref={inputRef}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              placeholder="Carrier tracking #…"
              className="flex-1 py-2 outline-none"
              style={{ background: "transparent", fontSize: 14, border: "none" }}
            />
          </div>
          <button
            onClick={confirm}
            disabled={!tracking.trim() || saving}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.ink, color: "#fff", opacity: tracking.trim() && !saving ? 1 : 0.5 }}
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
