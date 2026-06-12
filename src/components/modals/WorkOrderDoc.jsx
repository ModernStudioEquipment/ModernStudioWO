import React, { useState } from "react";
import { Printer, Camera } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { Wordmark } from "../Logo.jsx";

// The printable work order for a Shopify (customer-order) item — editable in
// place. Product / Total / Color are inputs that save back to the order item;
// Save & Print persists then prints. Order #, Ordered By/On come from the order.
export function WorkOrderDoc({ order, item, onSave, onClose }) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.qty));
  const [color, setColor] = useState(item.color || "");
  const [completedBy, setCompletedBy] = useState(item.completedBy || "");
  const [saving, setSaving] = useState(false);

  const orderedOn = new Date(order.receivedAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const save = async (thenPrint) => {
    if (saving) return;
    setSaving(true);
    try {
      if (onSave) await onSave({ name, qty, color, completedBy });
      if (thenPrint) setTimeout(() => window.print(), 50);
    } finally {
      setSaving(false);
    }
  };

  const FieldRow = ({ label, children }) => (
    <div className="flex items-center gap-3 mb-2">
      <span className="inline-block px-2 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft, background: C.grayBg, width: 130, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "96vw" }}>
        <div className="flex gap-2 mb-2 justify-end no-print">
          {onSave && <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>}
          <Btn kind="brass" onClick={() => save(true)} disabled={saving}><Printer size={15} />Save &amp; Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div id="wo" style={{ background: "#fff", border: `1px solid ${C.line}`, padding: "32px 36px" }}>
          <div className="flex items-start justify-between" style={{ marginBottom: 22 }}>
            <div>
              <Wordmark height={36} variant="dark" subText="WORK ORDER" subAlign="left" />
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div className="flex items-center justify-end gap-2 mb-1"><span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Due date:</span><span style={{ display: "inline-block", width: 90, borderBottom: `1px solid ${C.ink}` }}>&nbsp;</span></div>
              <div className="flex items-center justify-end gap-2 mb-1"><span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Order #:</span><span className="font-bold" style={{ fontFamily: "ui-monospace,monospace" }}>{order.orderNo}</span></div>
              <div className="flex items-center justify-end gap-2"><span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>Total:</span>
                <input className="wo-edit" value={qty} onChange={(e) => setQty(e.target.value)} style={{ font: "inherit", fontFamily: "ui-monospace,monospace", fontSize: 16, fontWeight: 700, width: 56, textAlign: "right" }} />
              </div>
            </div>
          </div>

          {/* RUSH/High orders print their priority loud. */}
          {order.priority !== "Normal" && (
            <div className="inline-block px-3 py-1 mb-4" style={{ background: order.priority === "RUSH" ? C.rush : C.high, color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>
              {order.priority} — prioritize
            </div>
          )}

          <div className="flex items-start justify-between">
            <div style={{ flex: 1 }}>
              <FieldRow label="Product">
                <input className="wo-edit" value={name} onChange={(e) => setName(e.target.value)} style={{ font: "inherit", fontSize: 16, fontWeight: 700, width: "100%" }} />
              </FieldRow>
              <FieldRow label="Ordered by">
                <span className="font-bold" style={{ fontSize: 16 }}>{order.contact}</span>
              </FieldRow>
              <FieldRow label="Ordered on">
                <span className="font-bold" style={{ fontSize: 16 }}>{orderedOn}</span>
              </FieldRow>
            </div>
            <div style={{ width: 170, textAlign: "right", paddingTop: 4 }}>
              <div className="flex items-center justify-end gap-2">
                <span className="font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft }}>Color:</span>
                <input className="wo-edit" value={color} onChange={(e) => setColor(e.target.value)} placeholder="—" style={{ font: "inherit", fontSize: 16, fontWeight: 700, fontStyle: "italic", width: 96, textAlign: "right" }} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center" style={{ margin: "26px 0", minHeight: 320, border: `1px dashed ${C.line}`, borderRadius: 4, background: "#FAFBFC", flexDirection: "column", gap: 8, color: C.gray }}>
            <Camera size={42} />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Product photo</div>
            <div style={{ fontSize: 12 }}>Attach the reference photo for this part (parts photo library — later phase)</div>
          </div>

          <div className="flex items-center gap-3" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
            <span className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: C.inkSoft }}>Completed by:</span>
            <input className="wo-sign" value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} style={{ flex: 1, fontWeight: 700, fontSize: 16 }} />
            <span style={{ fontSize: 11, letterSpacing: 1.5, color: C.gray, fontWeight: 700 }}>MODERN STUDIO EQUIPMENT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
