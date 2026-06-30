import React, { useEffect, useRef, useState } from "react";
import { X, MapPin, Truck, Store } from "lucide-react";
import { C } from "../../theme.js";

// Closes out a completed order: pick Ship or Will Call, record where it's going,
// and the order moves to the matching top tab.
export function FulfillModal({ order, method, onConfirm, onClose }) {
  const isShip = method === "shipping";
  const [location, setLocation] = useState(order.location || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const confirm = async () => {
    if (!location.trim() || saving) return;
    setSaving(true);
    try {
      await onConfirm(location.trim());
    } finally {
      setSaving(false);
    }
  };

  const Icon = isShip ? Truck : Store;
  const inp = { border: `1px solid ${C.line}`, background: C.surface, fontSize: 14, borderRadius: 6 };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <Icon size={17} />
          {isShip ? "Ship order" : "Will call"} · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, color: C.gray, marginBottom: 12 }}>
            {order.customer} — {order.items.length} item{order.items.length === 1 ? "" : "s"}, all done.
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            {isShip ? "Warehouse location" : "Pickup location"}
          </div>
          <div className="flex items-center gap-2 mb-4 px-2" style={inp}>
            <MapPin size={16} color={C.gray} />
            <input
              ref={inputRef}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              placeholder={isShip ? "Shelf, rack, staging area…" : "Front counter, will-call shelf B…"}
              className="flex-1 py-2 outline-none"
              style={{ background: "transparent", fontSize: 14, border: "none" }}
            />
          </div>
          <button
            onClick={confirm}
            disabled={!location.trim() || saving}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.fill, color: "#fff", opacity: location.trim() && !saving ? 1 : 0.5 }}
          >
            {saving ? "Completing…" : "Complete"}
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
