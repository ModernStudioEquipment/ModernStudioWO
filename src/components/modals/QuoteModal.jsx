import React, { useState } from "react";
import { X, Check } from "lucide-react";
import { C, stamp } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Flagging a material "quote requested" — with room to say what was actually
// asked for. The note is the material's own note (not a separate field), so the
// context carries forward and is already there when someone marks it ordered.
export function QuoteModal({ material, count = 1, now = Date.now(), onConfirm, onClear, onClose }) {
  const bulk = count > 1;
  // Already flagged: this is now a read/edit view of the existing note rather
  // than a fresh request, so it keeps the original "requested" stamp.
  const flagged = !bulk && !!material?.progress;
  // Pre-fill ONLY when flagging a single material — then this is that material's
  // own note and editing it is the point. Flagging a whole order used to pre-fill
  // from whichever material happened to be first and then write it onto all of
  // them, which is how one material's note ended up on a dozen unrelated ones.
  const [note, setNote] = useState(bulk ? "" : material?.note || "");
  const [by, setBy] = useState("");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm({ note: note.trim() || null, by: by.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };
  const label = { fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <Check size={17} />Quote requested
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
            {bulk ? `${count} materials on this order` : material?.name}
          </div>
          {flagged && (
            <div style={{ fontSize: 12, color: C.high, fontWeight: 700, marginBottom: 8 }}>
              Quote requested{material.progressBy ? ` by ${material.progressBy}` : ""}
              {material.progressAt ? ` · ${stamp(material.progressAt, now)}` : ""}
            </div>
          )}
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 14 }}>
            {bulk
              ? "Jot down what you asked for. This goes only on materials that don’t already have a note — anything already written stays as it is."
              : flagged
              ? "What was asked for. Edit it as you hear back — it stays on the material and is already filled in when you come to mark it ordered."
              : "Jot down what you asked for — it stays on the material and is already filled in when you come back to mark it ordered."}
          </div>

          <div className="mb-3">
            <div style={label}>Notes</div>
            <textarea
              autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="e.g. asked Tube Service for 20 ft, waiting on price"
              className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }}
            />
          </div>

          <div className="mb-4">
            <div style={label}>Who’s chasing it</div>
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name (optional)" className="w-full px-2 py-2 outline-none" style={inp} />
          </div>

          <Btn kind="dark" onClick={confirm} disabled={saving}>
            <Check size={15} />
            {saving ? "Saving…" : bulk ? `Mark all ${count} quote requested` : flagged ? "Save note" : "Mark quote requested"}
          </Btn>

          {/* Clearing lives here, not on the row's button — deliberate rather
              than one stray tap, and it says what it actually does. */}
          {flagged && onClear && (
            <button
              onClick={onClear} disabled={saving}
              style={{ display: "block", marginTop: 12, background: "none", border: "none", padding: 0,
                cursor: "pointer", fontSize: 12, color: C.gray, textDecoration: "underline" }}
            >
              No quote was requested after all — clear this
            </button>
          )}
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
