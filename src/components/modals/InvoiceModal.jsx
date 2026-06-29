import React, { useState } from "react";
import { X, FileText } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Popup shown when you check "Invoiced" on a sales order — asks for the invoice
// number QuickBooks gave it.
export function InvoiceModal({ order, onConfirm, onClose }) {
  const [num, setNum] = useState(order.invoiceNumber || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await onConfirm(num.trim() || null); } finally { setSaving(false); }
  };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden", marginTop: "12vh" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.ink, color: "#fff" }}>
          <FileText size={16} />Mark invoiced · #{order.orderNo}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Invoice number</div>
          <input
            autoFocus value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. 472980"
            className="w-full px-2 py-2 outline-none mb-3"
            style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: "#fff" }}
          />
          <Btn kind="dark" onClick={save} disabled={saving}>{saving ? "Saving…" : "Mark invoiced"}</Btn>
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
