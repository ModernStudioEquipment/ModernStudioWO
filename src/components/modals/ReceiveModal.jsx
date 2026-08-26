import React, { useState } from "react";
import { X, PackageCheck, Clock } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Purchasing: marking a material received — how many came in, an optional note,
// and, when this is the LAST one outstanding, which tab the product moves to.
//
// The destination used to be asked every time and then quietly dropped whenever
// another material was still outstanding: you picked "Pick List", the product
// stayed in Purchasing, and nothing said why. A question whose answer gets
// discarded is worse than no question. Now it's only asked when it will be
// honoured; otherwise the modal says what's still outstanding.
const DESTS = [
  { stage: "picklist", label: "Pick List" },
  { stage: "workorder", label: "Work Order" },
  { stage: "done", label: "Done" },
];

export function ReceiveModal({ material, stillWaiting = [], onConfirm, onClose }) {
  const isLast = stillWaiting.length === 0;
  const [stage, setStage] = useState("workorder");
  const [qty, setQty] = useState(material.amount || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm({ stage: isLast ? stage : undefined, qtyReceived: qty.trim() || null, note: note.trim() || null });
    } finally {
      setSaving(false);
    }
  };
  const label = { fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <PackageCheck size={17} />Received
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, marginBottom: 14 }}><span style={{ fontWeight: 700 }}>{material.name}</span></div>
          {isLast ? (
            <div className="mb-4">
              <div style={label}>Last one in — move the product to</div>
              <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
                {DESTS.map((d) => (
                  <button key={d.stage} onClick={() => setStage(d.stage)} className="px-4 py-2 text-sm font-bold"
                    style={stage === d.stage ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft }}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 mb-4" style={{ border: `1px solid ${C.gold}`, background: C.goldBg, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, color: C.inkSoft }}>
              <Clock size={14} style={{ color: C.gold, flexShrink: 0, marginTop: 1 }} />
              <span>
                This product still needs <b>{stillWaiting.join(", ")}</b>, so it stays in
                Purchasing for now. You'll pick where it goes when the last one comes in.
              </span>
            </div>
          )}
          <div className="mb-3">
            <div style={label}>Quantity received</div>
            <input autoFocus value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 20 ft, 12" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>
          <div className="mb-4">
            <div style={label}>Note</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything to note about what came in (optional)" className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
          </div>
          <Btn kind="dark" onClick={confirm} disabled={saving}>
            <PackageCheck size={15} />{saving ? "Saving…" : "Mark received"}
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
