import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Upload, ImageOff, Check } from "lucide-react";
import { db } from "../lib/db.js";
import "./cncLibrary.css";

const BLANK = { id: null, sku: "", name: "", material: "", notes: "", blueprintUrl: null, steps: [""], productNo: "", programNo: "" };

export default function CncLibrary({ onClose, embedded = false }) {
  const [parts, setParts] = useState([]);
  const [draft, setDraft] = useState({ ...BLANK });
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  async function reload(selectId) {
    const list = await db.getCncParts();
    setParts(list);
    if (selectId) {
      const found = list.find((p) => p.id === selectId);
      if (found) setDraft({ ...found, steps: found.steps.length ? found.steps : [""] });
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const filtered = parts.filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()));

  const edit = (p) => setDraft({ ...p, steps: p.steps.length ? p.steps : [""] });
  const newPart = () => setDraft({ ...BLANK, steps: [""] });
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setStep = (i, v) => setDraft((d) => { const s = d.steps.slice(); s[i] = v; return { ...d, steps: s }; });
  const addStep = () => setDraft((d) => ({ ...d, steps: [...d.steps, ""] }));
  const removeStep = (i) => setDraft((d) => { const s = d.steps.filter((_, j) => j !== i); return { ...d, steps: s.length ? s : [""] }; });

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await db.uploadBlueprint(draft.id, file);
      setField("blueprintUrl", url);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const id = await db.saveCncPart(draft);
      await reload(id);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(/cnc_parts/.test(e?.message || "") ? "Run migration 0041 to enable the CNC library." : e?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return newPart();
    if (!window.confirm("Delete this part's instructions?")) return;
    await db.deleteCncPart(draft.id);
    newPart();
    reload();
  }

  return (
    <div className={embedded ? "cl-embed" : "cl-overlay"}>
      <div className="cl-wrap">
        <header className="cl-top">
          <div className="cl-brand">
            <b>CNC&nbsp;{embedded ? "BOOK" : "LIBRARY"}</b>
            <span>Every product · how to make it · blueprints · notes</span>
          </div>
          <div className="cl-spacer" />
          {!embedded && (
            <button className="cl-back" onClick={onClose}>
              <ArrowLeft size={16} /> Back to floor control
            </button>
          )}
        </header>

        <div className="cl-body">
          <aside className="cl-list">
            <input className="cl-search" placeholder="Search parts…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="cl-new" onClick={newPart}>
              <Plus size={16} /> New part
            </button>
            <div className="cl-items">
              {filtered.map((p) => (
                <button key={p.id} className={`cl-item${draft.id === p.id ? " on" : ""}`} onClick={() => edit(p)}>
                  <span className="nm">{p.name || "Untitled part"}</span>
                  <span className="sub">
                    {p.sku ? `SKU ${p.sku}` : "no SKU"} · {p.steps.length} step{p.steps.length === 1 ? "" : "s"}
                    {p.blueprintUrl ? " · blueprint" : ""}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="cl-none">No parts yet — add one to start the library.</div>}
            </div>
          </aside>

          <section className="cl-editor">
            <div className="cl-row2">
              <label className="cl-field grow">
                <span className="cl-lab">Part name</span>
                <input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="e.g. Junior Receiver — 1‑1/8″ Bore" />
              </label>
              <label className="cl-field">
                <span className="cl-lab">SKU (optional)</span>
                <input value={draft.sku} onChange={(e) => setField("sku", e.target.value)} placeholder="matches the item" />
              </label>
            </div>
            <div className="cl-row3">
              <label className="cl-field">
                <span className="cl-lab">Product number</span>
                <input value={draft.productNo} onChange={(e) => setField("productNo", e.target.value)} placeholder="e.g. JR-1125" />
              </label>
              <label className="cl-field">
                <span className="cl-lab">CNC program number</span>
                <input value={draft.programNo} onChange={(e) => setField("programNo", e.target.value)} placeholder="e.g. O41207" />
              </label>
            </div>

            <div className="cl-grid">
              <div className="cl-bp">
                <span className="cl-lab">Blueprint / drawing</span>
                <div className="cl-bpbox">
                  {draft.blueprintUrl ? (
                    <img src={draft.blueprintUrl} alt="blueprint" />
                  ) : (
                    <div className="cl-bpempty">
                      <ImageOff size={26} />
                      <span>No blueprint yet</span>
                    </div>
                  )}
                </div>
                <div className="cl-bpbtns">
                  <button className="cl-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={15} /> {uploading ? "Uploading…" : draft.blueprintUrl ? "Replace" : "Upload"}
                  </button>
                  {draft.blueprintUrl && (
                    <button className="cl-btn ghost" onClick={() => setField("blueprintUrl", null)}>
                      Remove
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
                </div>
                <label className="cl-field" style={{ marginTop: 14 }}>
                  <span className="cl-lab">Material</span>
                  <input value={draft.material} onChange={(e) => setField("material", e.target.value)} placeholder="e.g. 6061‑T6 · 2.75″ bar" />
                </label>
              </div>

              <div className="cl-steps">
                <span className="cl-lab">How to make it — steps</span>
                <div className="cl-steplist">
                  {draft.steps.map((s, i) => (
                    <div className="cl-step" key={i}>
                      <span className="n">{i + 1}</span>
                      <input value={s} onChange={(e) => setStep(i, e.target.value)} placeholder={`Step ${i + 1}`} />
                      <button className="cl-x" onClick={() => removeStep(i)} title="Remove step">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="cl-addstep" onClick={addStep}>
                  <Plus size={15} /> Add step
                </button>
                <label className="cl-field" style={{ marginTop: 16 }}>
                  <span className="cl-lab">Notes</span>
                  <textarea rows={3} value={draft.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Tolerances, fixtures, QC, gotchas…" />
                </label>
              </div>
            </div>

            <div className="cl-foot">
              <button className="cl-save" onClick={save} disabled={saving || !draft.name.trim()}>
                {saving ? "Saving…" : "Save part"}
              </button>
              {savedAt > 0 && !saving && !err && (
                <span className="cl-saved">
                  <Check size={14} /> Saved
                </span>
              )}
              {err && <span className="cl-err">{err}</span>}
              <div className="cl-spacer" />
              {draft.id && (
                <button className="cl-del" onClick={remove}>
                  <Trash2 size={15} /> Delete
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
