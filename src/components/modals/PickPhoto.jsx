import React from "react";
import { X, Camera, Check } from "lucide-react";
import { C } from "../../theme.js";
import { Btn, Info } from "../ui.jsx";

// Picker confirmation view. The parts photo library is a later phase, so this
// shows a graceful placeholder for now.
export function PickPhoto({ order, item, onPicked, onClose }) {
  const [saving, setSaving] = React.useState(false);
  const pick = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onPicked();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: C.ink, color: "#fff" }}>
          <span className="font-bold" style={{ fontSize: 15 }}>{item.name}</span>
          <span style={{ fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.7)" }}>×{item.qty}</span>
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-center" style={{ minHeight: 300, border: `1px dashed ${C.line}`, borderRadius: 6, background: "#fff", flexDirection: "column", gap: 8, color: C.gray }}>
            <Camera size={44} />
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Photo of {item.name}</div>
            <div style={{ fontSize: 12 }}>Pulled from the parts photo library in a later phase</div>
          </div>
          <div className="grid mt-4 mb-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Info label="Pick qty" value={`×${item.qty}`} />
            <Info label="Dept" value={item.dept} />
            <Info label="For" value={`#${order.orderNo} · ${order.customer}`} />
          </div>
          <Btn kind="brass" onClick={pick} disabled={saving}>
            <Check size={15} />{saving ? "Saving…" : "Item picked"}
          </Btn>
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
