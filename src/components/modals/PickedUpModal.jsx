import React, { useState } from "react";
import { X, Check } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Will Call pickup: record who collected the order. The name is optional.
export function PickedUpModal({ order, onConfirm, onClose }) {
  const [by, setBy] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try { await onConfirm(by.trim()); } finally { setSaving(false); }
  };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.ink, color: "#fff" }}>
          Picked up — #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 12, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Picked up by (optional)
          </div>
          <input
            autoFocus
            value={by}
            onChange={(e) => setBy(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            placeholder="Name of who collected it"
            className="w-full px-2 py-2 outline-none mb-4"
            style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: "#fff" }}
          />
          <Btn kind="gold" onClick={confirm} disabled={saving}>
            <Check size={15} />{saving ? "Saving…" : "Confirm pickup"}
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
