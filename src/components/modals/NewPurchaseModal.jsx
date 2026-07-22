import React, { useEffect, useState } from "react";
import { X, Plus, Trash2, ShoppingCart } from "lucide-react";
import { C, DEPTS } from "../../theme.js";
import { DeptIcon } from "../ui.jsx";

// Log a purchase straight from the Purchasing tab — just the material(s) you're
// buying and which department they're for. No customer order: it's stored as a
// standalone purchase that shows only in Purchasing.
const blankMat = () => ({ name: "", amount: "" });

// Persist an in-progress purchase so nothing is lost if the modal closes, the
// live board refetches under you, or the tab reloads mid-entry. Cleared the
// moment a purchase is successfully added.
const DRAFT_KEY = "modern.newPurchaseDraft.v1";
const loadDraft = () => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
};

export function NewPurchaseModal({ getNextOrderNo, onCreate, onClose }) {
  const [orderNo, setOrderNo] = useState("");
  const [draft] = useState(loadDraft); // read once on mount
  const [dept, setDept] = useState(draft?.dept || "Shop");
  const [mats, setMats] = useState(() => (draft?.mats?.length ? draft.mats : [blankMat()]));
  const [forInventory, setForInventory] = useState(draft?.forInventory ?? true); // standalone purchases default to restock
  const [note, setNote] = useState(draft?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A standalone purchase still needs an order number under the hood; grab the
  // next one silently — the buyer just logs what they're buying.
  useEffect(() => {
    getNextOrderNo().then(setOrderNo).catch(() => setOrderNo(""));
  }, [getNextOrderNo]);

  // Mirror what's typed into localStorage on every change, so a stray click,
  // a realtime refetch, or an accidental reload can't wipe the work.
  useEffect(() => {
    try {
      if (mats.some((m) => m.name.trim() || m.amount.trim()) || note.trim()) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ dept, mats, forInventory, note }));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* private mode / quota — just skip persistence */ }
  }, [dept, mats, forInventory, note]);

  const updMat = (i, k, v) => setMats((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addMat = () => setMats((rows) => [...rows, blankMat()]);
  const removeMat = (i) => setMats((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows));

  const validMats = mats.filter((m) => m.name.trim());
  const canSave = validMats.length && !saving;
  // If anything's been typed, a stray click on the backdrop shouldn't nuke it.
  const dirty = !!(mats.some((m) => m.name.trim() || m.amount.trim()) || note.trim());

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        orderNo: orderNo.trim() || String(Date.now()),
        dept,
        materials: validMats.map((m) => ({ name: m.name.trim(), amount: m.amount.trim() || null, note: note.trim() || null, forInventory })),
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          New purchase
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4" style={{ maxHeight: "78vh", overflowY: "auto" }}>
          <div className="mb-4">
            <div style={label}>Department</div>
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
            <div style={label}>This purchase is for</div>
            <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
              {[[false, "An order"], [true, "Inventory"]].map(([val, lbl]) => (
                <button key={String(val)} type="button" onClick={() => setForInventory(val)} className="px-4 py-2 text-sm font-bold"
                  style={forInventory === val ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...label, marginBottom: 8 }}>What to buy</div>
          {mats.map((m, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-2 items-center">
              <input autoFocus={i === 0} value={m.name} onChange={(e) => updMat(i, "name", e.target.value)} placeholder="Material (e.g. 1in aluminum bar)" className="flex-1 px-2 py-2 outline-none" style={inp} />
              <input value={m.amount} onChange={(e) => updMat(i, "amount", e.target.value)} onKeyDown={(e) => e.key === "Enter" && canSave && submit()} placeholder="Amount (e.g. 20 ft)" className="px-2 py-2 outline-none" style={{ ...inp, width: 160 }} />
              <button onClick={() => removeMat(i)} disabled={mats.length === 1} style={{ color: mats.length === 1 ? C.line : C.gray, padding: 6 }} title="Remove line">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button onClick={addMat} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide mb-4"
            style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
            <Plus size={13} />Add line
          </button>

          <div className="mb-4">
            <div style={label}>Notes</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. why this is being ordered, stock on hand…" rows={2} className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
          </div>

          {error && <div style={{ fontSize: 13, color: C.rush, marginBottom: 10 }}>{error}</div>}

          <button onClick={submit} disabled={!canSave} className="w-full py-2.5 rounded font-bold uppercase tracking-wide flex items-center justify-center gap-2"
            style={{ background: C.fill, color: "#fff", opacity: canSave ? 1 : 0.5 }}>
            <ShoppingCart size={15} />{saving ? "Saving…" : "Add purchase"}
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
