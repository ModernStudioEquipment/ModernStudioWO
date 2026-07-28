import React, { useEffect, useRef, useState } from "react";
import { X, MapPin, Truck, Store } from "lucide-react";
import { C } from "../../theme.js";

// Closes out a completed order: pick Ship or Will Call, record where it's going,
// and the order moves to the matching top tab.
// `method` may be null — when an order is completed we open this WITHOUT a
// destination so it asks "where's it going?" first, then the location, in one
// pop-up instead of making the user hunt for the buttons.
export function FulfillModal({ order, method, onConfirm, onClose }) {
  const [pick, setPick] = useState(method || null);
  const isShip = pick === "shipping";
  const [location, setLocation] = useState(order.location || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (pick) inputRef.current?.focus(); }, [pick]);

  const confirm = async () => {
    if (!pick || !location.trim() || saving) return;
    setSaving(true);
    try {
      await onConfirm(location.trim(), pick);
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
          {pick ? (isShip ? "Ship order" : "Will call") : "Order complete"} · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          {/* Reachable from an order that ISN'T finished (sent early from the order
              view), so report what's actually done rather than assuming all of it. */}
          <div style={{ fontSize: 13, color: C.gray, marginBottom: 12 }}>
            {order.customer} — {order.items.length} item{order.items.length === 1 ? "" : "s"}
            {(() => {
              const done = order.items.filter((i) => i.stage === "done").length;
              return done === order.items.length
                ? ", all done."
                : ` · ${order.items.length - done} not finished yet.`;
            })()}
          </div>
          {/* Asked first when the caller didn't fix a destination (e.g. the order
              just became complete) — where's it going, then where is it. */}
          <div style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Where is it going?
          </div>
          <div className="flex gap-2 mb-4">
            {[
              // Selected state matches the Will call / Ship buttons everywhere else
              // (gold / brass), so the destination reads the same across the app.
              ["willcall", "Will call", Store, { background: C.goldBg, color: C.gold, border: `1px solid ${C.gold}` }],
              ["shipping", "Ship", Truck, { background: C.fill, color: "#fff", border: `1px solid ${C.fill}` }],
            ].map(([val, lbl, I, on]) => (
              <button
                key={val}
                onClick={() => setPick(val)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded font-bold uppercase tracking-wide text-xs"
                style={pick === val ? on : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
              >
                <I size={14} />{lbl}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, opacity: pick ? 1 : 0.5 }}>
            {isShip ? "Warehouse location" : "Pickup location"}
          </div>
          <div className="flex items-center gap-2 mb-4 px-2" style={{ ...inp, opacity: pick ? 1 : 0.5 }}>
            <MapPin size={16} color={C.gray} />
            <input
              ref={inputRef}
              value={location}
              disabled={!pick}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              placeholder={!pick ? "Pick a destination first…" : isShip ? "Shelf, rack, staging area…" : "Front counter, will-call shelf B…"}
              className="flex-1 py-2 outline-none"
              style={{ background: "transparent", fontSize: 14, border: "none" }}
            />
          </div>
          <button
            onClick={confirm}
            disabled={!pick || !location.trim() || saving}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.fill, color: "#fff", opacity: pick && location.trim() && !saving ? 1 : 0.5 }}
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
