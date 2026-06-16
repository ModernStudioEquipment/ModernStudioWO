import React, { useState } from "react";
import { X, ShoppingCart } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Purchasing: when a material is marked ordered, record who placed the order,
// the vendor it was ordered from, and the PO number.
export function OrderedModal({ material, onConfirm, onClose }) {
  const [orderedBy, setOrderedBy] = useState(material.orderedBy || "");
  const [vendor, setVendor] = useState(material.vendor || "");
  const [poNumber, setPoNumber] = useState(material.poNumber || "");
  const [saving, setSaving] = useState(false);
  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm({ orderedBy: orderedBy.trim(), vendor: vendor.trim(), poNumber: poNumber.trim() });
    } finally {
      setSaving(false);
    }
  };
  const label = { fontSize: 12, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: "#fff" };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.ink, color: "#fff" }}>
          Mark ordered
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, marginBottom: 14 }}>
            <span style={{ fontWeight: 700 }}>{material.name}</span>
            {material.amount ? <span style={{ color: C.gray }}> · {material.amount}</span> : null}
          </div>
          <div className="mb-3">
            <div style={label}>Ordered by</div>
            <input autoFocus value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Who placed the order" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>
          <div className="mb-3">
            <div style={label}>Vendor</div>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Where it was ordered from" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>
          <div className="mb-4">
            <div style={label}>PO number</div>
            <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirm()} placeholder="Purchase order #" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>
          <Btn kind="dark" onClick={confirm} disabled={saving}>
            <ShoppingCart size={15} />{saving ? "Saving…" : "Mark ordered"}
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
