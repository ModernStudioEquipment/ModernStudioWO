import React, { useState } from "react";
import { X, PackageSearch } from "lucide-react";
import { C, DEPTS } from "../../theme.js";
import { DeptIcon } from "../ui.jsx";

// Post a low-stock notice: "we're running low on this, someone needs to make
// more". Raised by whoever spots it (usually while picking an order) so they
// don't have to stop and write the work order themselves.
export function NewNoticeModal({ onCreate, onClose }) {
  const [name, setName] = useState("");
  const [qtyOnHand, setQtyOnHand] = useState("");
  const [dept, setDept] = useState("Shop");
  const [reportedBy, setReportedBy] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canSave = name.trim() && !saving;
  // Anything typed means a stray click on the backdrop shouldn't discard it.
  const dirty = !!(name.trim() || qtyOnHand.trim() || reportedBy.trim() || note.trim());

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        qtyOnHand: qtyOnHand.trim() || null,
        dept,
        reportedBy: reportedBy.trim() || null,
        note: note.trim() || null,
      });
      onClose();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: C.surface, fontSize: 13, borderRadius: 6 };
  const label = { fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };

  return (
    <div style={overlay} onClick={dirty ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <PackageSearch size={17} />Running low on…
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4" style={{ maxHeight: "78vh", overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 12 }}>
            Posts a notice for whoever makes this product — they turn it into a work order.
          </div>

          <div className="mb-3">
            <div style={label}>Product *</div>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grip head" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>

          <div className="flex gap-3 mb-3 flex-wrap">
            <div style={{ flex: "1 1 160px" }}>
              <div style={label}>Quantity on hand</div>
              <input value={qtyOnHand} onChange={(e) => setQtyOnHand(e.target.value)} placeholder="e.g. 3 left, half a box" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <div style={label}>Noticed by</div>
              <input value={reportedBy} onChange={(e) => setReportedBy(e.target.value)} placeholder="Your name" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
          </div>

          <div className="mb-3">
            <div style={label}>Who makes it</div>
            <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
              {DEPTS.map((d) => (
                <button key={d} onClick={() => setDept(d)} title={d} className="flex items-center gap-1.5 px-3 py-2"
                  style={dept === d ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft }}>
                  <DeptIcon d={d} size={14} /><span style={{ fontSize: 12, fontWeight: 700 }}>{d}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <div style={label}>Notes</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. down to the last few, big order coming…" rows={2} className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
          </div>

          {error && <div style={{ fontSize: 13, color: C.rush, marginBottom: 10 }}>{error}</div>}

          <button onClick={submit} disabled={!canSave} className="w-full py-2.5 rounded font-bold uppercase tracking-wide flex items-center justify-center gap-2"
            style={{ background: C.fill, color: "#fff", opacity: canSave ? 1 : 0.5 }}>
            <PackageSearch size={15} />{saving ? "Posting…" : "Post notice"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
