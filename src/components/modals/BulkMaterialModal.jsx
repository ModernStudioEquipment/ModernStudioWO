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
//
// What is NOT shared: how much of each material was actually ordered, and
// anything that is true of one line only. The vendor had six of the eight you
// asked for; one line is back-ordered. Each row carries its own quantity box
// and its own note so that detail doesn't have to be chased one line at a time
// after the fact.
export function BulkMaterialModal({ materials = [], defaultBuyer = "", onConfirm, onClose }) {
  const [markOrdered, setMarkOrdered] = useState(true);
  const [orderedBy, setOrderedBy] = useState(defaultBuyer || "");
  const [vendor, setVendor] = useState("");
  const [contact, setContact] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Per-line overrides, keyed by material id: what's actually being ordered of
  // THIS one, and a note belonging to it alone. Blank means "as asked for" and
  // "nothing extra to say".
  const [lines, setLines] = useState({});
  const lineOf = (id) => lines[id] || { qty: "", note: "" };
  const setLine = (id, k, v) => setLines((p) => ({ ...p, [id]: { ...lineOf(id), [k]: v } }));

  const n = materials.length;
  const alreadyOrdered = materials.filter((m) => m.ordered).length;
  const perLine = Object.fromEntries(
    Object.entries(lines)
      .map(([id, l]) => [id, { qty: (l.qty || "").trim(), note: (l.note || "").trim() }])
      .filter(([, l]) => l.qty || l.note),
  );
  const anyLine = Object.keys(perLine).length > 0;
  const nothingToDo = !markOrdered && !vendor.trim() && !contact.trim() && !poNumber.trim() && !expectedAt && !note.trim() && !anyLine;

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
        lines: perLine,
      });
    } finally {
      setSaving(false);
    }
  };

  const label = { fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: "95vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <ShoppingCart size={17} />{n} material{n === 1 ? "" : "s"} selected
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>

        <div className="p-4" style={{ maxHeight: "80vh", overflowY: "auto" }}>
          {/* Say exactly what's about to be touched. A bulk action people can't
              see the extent of is how one material's note ended up on 13. */}
          <div className="mb-2" style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: C.surface, maxHeight: 300, overflowY: "auto" }}>
            {materials.map((m) => {
              const l = lineOf(m.id);
              return (
                <div key={m.id} className="px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                  {/* The name wraps rather than truncating: on a phone "1" x 1" Solid …"
                      and "1" x 1/4" Alumin…" are the same string, and you're about to
                      type a quantity against one of them. */}
                  <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12.5 }}>
                    <span className="font-bold" style={{ minWidth: 0 }}>{m.name}</span>
                    {m.amount && <span style={{ color: C.gray, flexShrink: 0 }}>asked for {m.amount}</span>}
                    {m.ordered && <span className="ml-auto" style={{ fontSize: 10.5, fontWeight: 800, color: C.blue, flexShrink: 0 }}>ALREADY ORDERED</span>}
                  </div>
                  {/* What's already on this line. A new note is added to it, never
                      over it, and seeing the existing one is how you know that. */}
                  {m.note && (
                    <div style={{ fontSize: 11.5, color: C.gray, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      note so far: {m.note}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      value={l.qty} onChange={(e) => setLine(m.id, "qty", e.target.value)}
                      placeholder={m.orderedQty || "Qty ordered"}
                      title="How much of this one is actually being ordered — blank means the same as asked for"
                      className="px-2 py-1 outline-none" style={{ ...inp, width: 124, flexShrink: 0, fontSize: 13 }}
                    />
                    <input
                      value={l.note} onChange={(e) => setLine(m.id, "note", e.target.value)}
                      placeholder="Note for this line only"
                      className="flex-1 min-w-0 px-2 py-1 outline-none" style={{ ...inp, fontSize: 13 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mb-3" style={{ fontSize: 12.5, color: C.gray }}>
            The quantity box is what you're actually ordering of that line — leave it blank
            if it's the same as what was asked for. Anything else left blank is left untouched
            on every line.
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
