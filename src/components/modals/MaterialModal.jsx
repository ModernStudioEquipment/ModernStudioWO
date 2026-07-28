import React, { useEffect, useRef, useState } from "react";
import { X, Plus, AlertTriangle } from "lucide-react";
import { C } from "../../theme.js";

// Capture the material(s) a make-item needs bought. Amount is FREE TEXT
// ("20 ft", "2 sheets", "20 in") — the shop does not track numeric stock.
// `openFor(name)` reports anything already sitting in Purchasing un-ordered, so
// the same thing doesn't get bought twice — a warning, not a block, since two
// orders legitimately needing the same material is normal.
export function MaterialModal({ onClose, onCommit, openFor }) {
  const [rows, setRows] = useState([{ name: "", amount: "" }]);
  const [focusIdx, setFocusIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const inputs = useRef([]);

  useEffect(() => {
    inputs.current[focusIdx]?.focus();
  }, [focusIdx]);

  const upd = (i, k, v) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addRow = () => {
    setRows((r) => [...r, { name: "", amount: "" }]);
    setFocusIdx(rows.length);
  };
  const valid = rows.filter((r) => r.name.trim());
  const inp = { border: `1px solid ${C.line}`, background: C.surface, fontSize: 13, borderRadius: 6 };

  // Anything typed here that's ALREADY waiting to be bought, so the buyer doesn't
  // order it twice. Recomputed as you type; any edit re-arms the confirmation.
  const dupes = openFor
    ? valid.flatMap((r) => (openFor(r.name) || []).map((d) => ({ ...d, typed: r.name.trim() })))
    : [];

  const commit = async () => {
    if (!valid.length || saving) return;
    if (dupes.length && !confirmed) { setConfirmed(true); return; } // warn once, then allow
    setSaving(true);
    try {
      await onCommit(valid.map((r) => ({ name: r.name.trim(), amount: r.amount.trim() })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          What material is needed?
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 8 }}>
            Each material drops onto the Purchasing tab. Amount can be anything — 20 ft, 20 in, 2 sheets.
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                ref={(el) => (inputs.current[i] = el)}
                placeholder="Material (e.g. 1in aluminum bar)"
                value={r.name}
                onChange={(e) => { setConfirmed(false); upd(i, "name", e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
                className="flex-1 px-2 py-2 outline-none"
                style={inp}
              />
              <input
                placeholder="Amount"
                value={r.amount}
                onChange={(e) => upd(i, "amount", e.target.value)}
                className="px-2 py-2 outline-none"
                style={{ ...inp, width: 110 }}
              />
            </div>
          ))}
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide mb-3"
            style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
          >
            <Plus size={13} />More material needed
          </button>
          {!!dupes.length && (
            <div className="mb-3" style={{ border: `1px solid ${C.high}`, background: C.highBg, borderRadius: 6, padding: "8px 10px" }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 800, color: C.high, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <AlertTriangle size={13} />Already waiting to be bought
              </div>
              {dupes.map((d) => (
                <div key={d.id} style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4 }}>
                  <b>{d.typed}</b> — on #{d.orderNo}
                  {d.standalone ? " (stock purchase)" : d.customer ? ` (${d.customer})` : ""}
                  {d.amount ? `, ${d.amount}` : ""}, not ordered yet
                </div>
              ))}
              <div style={{ fontSize: 12, color: C.gray, marginTop: 6 }}>
                Add it anyway only if this order needs its own — the buyer sees the combined total when ordering.
              </div>
            </div>
          )}
          <button
            onClick={commit}
            disabled={!valid.length || saving}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: dupes.length && confirmed ? C.high : C.fill, color: "#fff", opacity: valid.length && !saving ? 1 : 0.5 }}
          >
            {saving ? "Sending…" : dupes.length ? (confirmed ? "Add anyway" : "Send to Purchasing") : "Send to Purchasing"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
};
