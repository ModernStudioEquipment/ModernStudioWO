import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Upload, ImageOff, Check, Copy, GripVertical } from "lucide-react";
import Sortable from "sortablejs";
import { db } from "../lib/db.js";
import { duplicatePart, isSkuTaken, cleanPhotos, MAX_PHOTOS, moveStep, splitPrograms, joinPrograms } from "./cncParts.js";
import "./cncLibrary.css";

const BLANK = { id: null, sku: "", name: "", material: "", notes: "", blueprintUrl: null, photos: [], steps: [""], productNo: "", programNo: "" };
// The editor works on a list of programs; the part stores them joined.
const toDraft = (p) => ({ ...p, steps: p.steps && p.steps.length ? p.steps : [""], programs: splitPrograms(p.programNo) });
const fromDraft = (d) => ({ ...d, programNo: joinPrograms(d.programs) });

// A step box that grows to show the whole step instead of cutting it off.
function StepBox({ value, onChange, placeholder }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} onChange={onChange} placeholder={placeholder} />;
}

export default function CncLibrary({ onClose, embedded = false }) {
  const [parts, setParts] = useState([]);
  const [draft, setDraft] = useState(toDraft(BLANK));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function reload(selectId) {
    const list = await db.getCncParts();
    setParts(list);
    if (selectId) {
      const found = list.find((p) => p.id === selectId);
      if (found) setDraft(toDraft(found));
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const filtered = parts.filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()));

  const edit = (p) => setDraft(toDraft(p));
  const newPart = () => setDraft(toDraft(BLANK));
  // Opens a copy in the editor, unsaved. See cncParts.js for what changes.
  const duplicate = () => { setDraft(toDraft(duplicatePart(fromDraft(draft)))); setSavedAt(0); setErr(""); };
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setStep = (i, v) => setDraft((d) => { const s = d.steps.slice(); s[i] = v; return { ...d, steps: s }; });
  const addStep = () => setDraft((d) => ({ ...d, steps: [...d.steps, ""] }));
  const setProgram = (i, v) => setDraft((d) => { const l = d.programs.slice(); l[i] = v; return { ...d, programs: l }; });
  const addProgram = () => setDraft((d) => ({ ...d, programs: [...d.programs, ""] }));
  const removeProgram = (i) => setDraft((d) => { const l = d.programs.filter((_, j) => j !== i); return { ...d, programs: l.length ? l : [""] }; });
  const removeStep = (i) => setDraft((d) => { const s = d.steps.filter((_, j) => j !== i); return { ...d, steps: s.length ? s : [""] }; });

  // Drag a step by its grip to reorder. Sortable moves the DOM node; we put it
  // back and let React re-render from the reordered state.
  // Must be a stable callback: a fresh function each render makes React
  // detach/re-attach the ref, destroying Sortable mid-drag whenever the parent
  // re-renders (live floor data refreshes). The drop then moves the DOM but
  // never reaches onEnd, so the numbers and the saved order go stale.
  const stepSortRef = useRef(null);
  const attachSteps = useCallback((el) => {
    if (stepSortRef.current) { stepSortRef.current.destroy(); stepSortRef.current = null; }
    if (!el) return;
    stepSortRef.current = Sortable.create(el, {
      handle: ".cl-grip",
      animation: 150,
      ghostClass: "cl-step-ghost",
      onEnd: ({ oldIndex, newIndex, item, from }) => {
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] || null);
        setDraft((d) => ({ ...d, steps: moveStep(d.steps, oldIndex, newIndex) }));
      },
    });
  }, []);

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

  // Extra pictures, beyond the blueprint. Several can be picked at once; each
  // goes up through the same upload the blueprint uses, and they keep the
  // order they were added in. Nothing is saved to the part until Save.
  const photos = cleanPhotos(draft.photos);
  async function onPhotos(e) {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (!files.length) return;
    setPhotoBusy(true);
    setErr("");
    try {
      const urls = [];
      for (const f of files) urls.push(await db.uploadBlueprint(draft.id, f));
      setDraft((d) => ({ ...d, photos: cleanPhotos([...(d.photos || []), ...urls]) }));
    } catch (e2) {
      setErr(`Couldn't upload that picture${e2?.message ? ` — ${e2.message}` : ""}.`);
    } finally {
      setPhotoBusy(false);
    }
  }
  const removePhoto = (u) => setDraft((d) => ({ ...d, photos: cleanPhotos(d.photos).filter((x) => x !== u) }));
  const firstPhoto = (u) => setDraft((d) => ({ ...d, photos: [u, ...cleanPhotos(d.photos).filter((x) => x !== u)] }));

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const id = await db.saveCncPart(fromDraft(draft));
      await reload(id);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(isSkuTaken(e) ? `SKU ${draft.sku} is already on another part. Change it and save again.`
        : /photos/.test(e?.message || "") ? "Extra photos need migration 0065 run first. Everything else on the part is fine."
        : /cnc_parts/.test(e?.message || "") ? "Run migration 0041 to enable the CNC library." : e?.message || "Couldn't save.");
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
            <b>CNC&nbsp;CATALOG</b>
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
              <div className="cl-field">
                <span className="cl-lab">CNC program number{draft.programs.length > 1 ? "s" : ""}</span>
                <div className="cl-progs">
                  {draft.programs.map((pg, i) => (
                    <div className="cl-prog" key={i}>
                      <input value={pg} onChange={(e) => setProgram(i, e.target.value)} placeholder={i ? "Another program" : "e.g. O41207"} aria-label={`Program ${i + 1}`} />
                      {draft.programs.length > 1 && (
                        <button className="cl-x" onClick={() => removeProgram(i)} title="Remove program">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button className="cl-addstep cl-addprog" onClick={addProgram}>
                    <Plus size={15} /> Add program
                  </button>
                </div>
              </div>
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

                <span className="cl-lab" style={{ marginTop: 14 }}>More photos{photos.length ? ` · ${photos.length}` : ""}</span>
                {photos.length > 0 && (
                  <div className="cl-photos">
                    {photos.map((u, i) => (
                      <div className="cl-photo" key={u}>
                        <a href={u} target="_blank" rel="noopener noreferrer" title="Open full size"><img src={u} alt={`photo ${i + 1}`} /></a>
                        <div className="cl-photobtns">
                          {i > 0 && <button onClick={() => firstPhoto(u)} title="Show this one first">First</button>}
                          <button onClick={() => removePhoto(u)} title="Remove this photo" aria-label="Remove this photo"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="cl-bpbtns">
                  <button className="cl-btn" onClick={() => photoRef.current?.click()} disabled={photoBusy || photos.length >= MAX_PHOTOS}>
                    <Plus size={15} /> {photoBusy ? "Uploading…" : photos.length >= MAX_PHOTOS ? `${MAX_PHOTOS} is the most` : "Add photos"}
                  </button>
                  <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={onPhotos} />
                </div>
                <label className="cl-field" style={{ marginTop: 14 }}>
                  <span className="cl-lab">Material</span>
                  <input value={draft.material} onChange={(e) => setField("material", e.target.value)} placeholder="e.g. 6061‑T6 · 2.75″ bar" />
                </label>
              </div>

              <div className="cl-steps">
                <span className="cl-lab">How to make it — steps</span>
                <div className="cl-steplist" ref={attachSteps}>
                  {draft.steps.map((s, i) => (
                    <div className="cl-step" key={i}>
                      <span className="cl-grip" title="Drag to reorder" aria-label={`Drag step ${i + 1} to reorder`}>
                        <GripVertical size={16} />
                      </span>
                      <span className="n">{i + 1}</span>
                      <StepBox value={s} onChange={(e) => setStep(i, e.target.value)} placeholder={`Step ${i + 1}`} />
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
              {!draft.id && draft.copiedFrom && !err && (
                <span className="cl-saved">Copy of {draft.copiedFrom}, not saved yet</span>
              )}
              <div className="cl-spacer" />
              {draft.id && (
                <button className="cl-del cl-dup" onClick={duplicate} title="Open a copy of this part to edit">
                  <Copy size={15} /> Duplicate
                </button>
              )}
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
