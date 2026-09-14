import React, { useState } from "react";
import { X, ShoppingCart, AlertTriangle } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Act on several purchasing lines at once.
//
// Buying is done by VENDOR, not by order: one trip to IMS covers materials
// spread across half a dozen jobs. Doing that one line at a time meant filling
// the same vendor, PO and buyer into an identical form ten or twenty times —
// order #800043 alone has 17 open materials.
//
// Only the fields actually filled in are written. A blank box means "leave this
// alone on every line", so this doubles as a bulk edit: set just a vendor, or
// just an expected date, without claiming anything was bought.
export function BulkMaterialModal({ materials = [], defaultBuyer = "", onConfirm, onClose }) {
  const [markOrdered, setMarkOrdered] = useState(true);
  const [orderedBy, setOrderedBy] = useState(defaultBuyer || "");
  const [vendor, setVendor] = useState("");
  const [contact, setContact] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const n = materials.length;
  const alreadyOrdered = materials.filter((m) => m.ordered).length;
  const nothingToDo = !markOrdered && !vendor.trim() && !contact.trim() && !poNumber.trim() && !expectedAt && !note.trim();

  const confirm = async () => {
    if (saving || nothingToDo) return;
    setSaving(true);
    try {
      await onConfirm({
        markOrdered,
        orderedBy: orderedBy.trim(),
        vendor: vendor.trim(),
        contact: contact.trim(),
        poNumber: poNumber.trim(),
        expectedAt: expectedAt || "",
        note: note.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  const label = { fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "95vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <ShoppingCart size={17} />{n} material{n === 1 ? "" : "s"} selected
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>

        <div className="p-4" style={{ maxHeight: "80vh", overflowY: "auto" }}>
          {/* Say exactly what's about to be touched. A bulk action people can't
              see the extent of is how one material's note ended up on 13. */}
          <div className="mb-3" style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: C.surface, maxHeight: 130, overflowY: "auto" }}>
            {materials.map((m) => (
              <div key={m.id} className="px-3 py-1.5 flex items-center gap-2" style={{ fontSize: 12.5, borderBottom: `1px solid ${C.line}` }}>
                <span className="font-bold">{m.name}</span>
                {m.amount && <span style={{ color: C.gray }}>{m.amount}</span>}
                {m.ordered && <span className="ml-auto" style={{ fontSize: 10.5, fontWeight: 800, color: C.blue }}>ALREADY ORDERED</span>}
              </div>
            ))}
          </div>

          <div className="mb-3" style={{ fontSize: 12.5, color: C.gray }}>
            Anything left blank is left untouched on every line.
          </div>

          <label className="flex items-center gap-2 mb-4" style={{ fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <input type="checkbox" checked={markOrdered} onChange={(e) => setMarkOrdered(e.target.checked)} />
            Mark all {n} as ordered
          </label>
          {markOrdered && alreadyOrdered > 0 && (
            <div className="flex items-start gap-2 mb-3" style={{ border: `1px solid ${C.high}`, background: C.highBg, borderRadius: 6, padding: "8px 10px", fontSize: 12.5, color: C.inkSoft }}>
              <AlertTriangle size={13} style={{ color: C.high, flexShrink: 0, marginTop: 1 }} />
              <span>{alreadyOrdered} of these {alreadyOrdered === 1 ? "is" : "are"} already marked ordered — their existing vendor and PO will be overwritten by whatever you set here.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <div style={label}>Ordered by</div>
              <input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Your name" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div>
              <div style={label}>PO number</div>
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div>
              <div style={label}>Vendor</div>
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. IMS" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div>
              <div style={label}>Who you spoke to</div>
              <input value={contact} onChange={(e) => setContact(e.target.value)} className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div>
              <div style={label}>Expected</div>
              <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
          </div>

          <div className="mb-4">
            <div style={label}>Add a note to all {n}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Optional — the SAME note is added to every line above"
              className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
            {!!note.trim() && (
              <div style={{ fontSize: 12, color: C.high, marginTop: 4 }}>
                This exact wording goes on all {n}. If it's really about one material, add it to that one instead.
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Btn kind="dark" onClick={confirm} disabled={saving || nothingToDo}>
              <ShoppingCart size={14} />{saving ? "Applying…" : `Apply to ${n}`}
            </Btn>
            <Btn onClick={onClose}>Cancel</Btn>
          </div>
          {nothingToDo && (
            <div style={{ fontSize: 12, color: C.gray, marginTop: 8 }}>Nothing selected to change yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 70, padding: "24px 12px",
};
