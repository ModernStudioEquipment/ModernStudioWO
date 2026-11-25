import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { ArrowLeft, Plus, Trash2, Upload, ImageOff, Check, Copy, GripVertical, ChevronLeft, ChevronRight, ClipboardList, FolderInput, Box, Sparkles } from "lucide-react";
import Sortable from "sortablejs";
import { db } from "../lib/db.js";
import { duplicatePart, isSkuTaken, cleanPhotos, MAX_PHOTOS, moveStep, splitPrograms, joinPrograms, splitMachines, joinMachines } from "./cncParts.js";
import { MACHINES } from "./machines.js";
import CncPrograms, { flash } from "./CncPrograms.jsx";
import CncMachines from "./CncMachines.jsx";
import CncImport from "./CncImport.jsx";
import CncPriorities from "./CncPriorities.jsx";
import CncGuide from "./CncGuide.jsx";
import CncWizard from "./CncWizard.jsx";
import CncPartOverview from "./CncPartOverview.jsx";
import { usePartPrograms } from "./usePartPrograms.js";
import { recall, remember } from "./remember.js";
import { PART_STEPS, rankParts, wizardSteps, fileLabel } from "./cncPack.js";
import CncChat from "./CncChat.jsx";
import "./cncLibrary.css";

const BLANK = { id: null, sku: "", name: "", material: "", notes: "", blueprintUrl: null, photos: [], steps: [""], productNo: "", programNo: "", machine: "", facts: {} };
// The editor works on a list of programs; the part stores them joined.
const toDraft = (p) => ({ ...p, steps: p.steps && p.steps.length ? p.steps : [""], programs: splitPrograms(p.programNo), facts: { ...(p.facts || {}) } });
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

export default function CncLibrary({ onClose, embedded = false, onMakeWorkOrder = null }) {
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
  // "parts" is the catalogue; "machines" is each Haas's tool list and setup;
  // "priorities" ranks parts by hand work; "import" takes a USB stick of programs.
  const [view, setView] = useState(() => recall("mse_cl_view", ["parts", "machines", "priorities", "ask"], "parts"));
  useEffect(() => { remember("mse_cl_view", view === "import" ? "parts" : view); }, [view]);
  // Every program file without its text: who has one, and is it proven.
  const [programIndex, setProgramIndex] = useState([]);
  const loadProgramIndex = useCallback(async () => {
    try { setProgramIndex(await db.getCncProgramIndex()); } catch { /* badges just stay empty */ }
  }, []);
  useEffect(() => { loadProgramIndex(); }, [loadProgramIndex]);
  // The newest program file's name, read for its CNC number and title.
  const labelOf = useMemo(() => {
    const m = new Map();
    for (const x of programIndex) if (!m.has(x.partId)) m.set(x.partId, fileLabel(x.name, x.info));   // newest first already
    return m;
  }, [programIndex]);
  const programStatus = (partId) => {
    const mine = programIndex.filter((x) => x.partId === partId);
    if (!mine.length) return "";
    const newest = mine.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    return newest.status === "proven" ? "proven" : "unproven";
  };
  const [machineFacts, setMachineFacts] = useState({});
  const loadMachineFacts = useCallback(async () => {
    try { setMachineFacts(await db.getMachineFacts()); } catch { /* the page itself reports it */ }
  }, []);
  useEffect(() => { loadMachineFacts(); }, [loadMachineFacts]);
  // This part's program files, shared by the overview, the questions and the form.
  const pp = usePartPrograms(draft, machineFacts, { onChanged: loadProgramIndex });

  async function reload(selectId) {
    const list = await db.getCncParts();
    setParts(list);
    if (selectId) {
      const found = list.find((p) => p.id === selectId);
      if (found) setDraft(toDraft(found));
    }
  }
  // On opening the catalogue: back to the part that was open before a refresh.
  useEffect(() => {
    reload(recall("mse_cl_part") || undefined);
  }, []);
  useEffect(() => { remember("mse_cl_part", draft.id || ""); }, [draft.id]);

  // Search by anything someone at the machine would know it by: the name, SKU
  // and product number, the program numbers, and the names of its program
  // files (where the shop's CNC numbers live, like "CNC-0240 - STACK 6.nc").
  // A number matches however it's written: 240, 0240 and CNC-0240 all find it.
  const filesOf = useMemo(() => {
    const m = new Map();
    for (const x of programIndex) { const l = m.get(x.partId) || []; l.push(x.name, x.info?.number, x.info?.title); m.set(x.partId, l); }
    return m;
  }, [programIndex]);
  const filtered = parts.filter((p) => matchesSearch(q, [p.name, p.sku, p.productNo, p.programNo, ...(filesOf.get(p.id) || [])]));
  // What the open part needs next (reported up by its Program & setup section).
  const [partStep, setPartStep] = useState(null);
  const setupRef = useRef(null);
  // A checklist item on a part, clicked: go to the thing that answers it.
  const editorRef = useRef(null);
  const [focusMachine, setFocusMachine] = useState("");
  const goField = (key) => {
    const find = (sel) => editorRef.current?.querySelector(sel);
    const show = (el, focus) => { if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); focus?.focus({ preventScroll: true }); flash(el); };
    if (key === "tools") { // on the Machines page, at the machine this part runs on
      const missing = splitMachines(draft.machine).find((k) => !(machineFacts[k]?.tools || []).length);
      if (!splitMachines(draft.machine).length) { setTab("details"); return setTimeout(() => show(editorRef.current?.querySelector("[data-go=machine]")), 80); }
      setFocusMachine(`${missing || splitMachines(draft.machine)[0]}:${Date.now()}`);
      return setView("machines");
    }
    if (key === "name") { const el = find("[data-go=name] input"); return show(find("[data-go=name]"), el); }
    if (key === "material") { const el = find("[data-go=material] input"); return show(find("[data-go=material]"), el); }
    if (key === "machine") return show(find("[data-go=machine]"));
    if (key === "drawing") return show(find("[data-go=drawing]"));
  };

  // The guide's buttons: take people to where that step's work is done.
  const goStep = (key) => {
    if (key === "import") return setView("import");
    if (key === "machines") return setView("machines");
    // setup / prove: open the part that most needs it
    const ranked = rankParts(parts, programIndex);
    const pick = key === "prove"
      ? ranked.find((r) => r.status === "unproven") || ranked.find((r) => r.status === "none")
      : ranked.find((r) => !(r.part.facts?.stock && r.part.facts?.holding && r.part.facts?.byHand && r.part.machine));
    if (pick) { edit(pick.part); setView("parts"); }
    else setView("priorities");
  };

  // A part opens on its overview. "All details" is the full form; the questions
  // are the guided setup. Only one of the three is on screen at a time.
  const [tab, setTab] = useState("overview");
  const [wizard, setWizard] = useState(null); // { keys } while the questions are open
  const edit = (p) => { setDraft(toDraft(p)); setTab("overview"); setWizard(null); setErr(""); setSavedAt(0); };
  // A new part starts with the questions, beginning with its name.
  const newPart = () => { const blank = toDraft(BLANK); setDraft(blank); setTab("overview"); setErr(""); setSavedAt(0); setWizard({ keys: wizardSteps(blank, [], { all: true }) }); };
  const closeEditor = () => { setDraft(toDraft(BLANK)); setWizard(null); setTab("overview"); };
  // Opens a copy in the editor, unsaved. See cncParts.js for what changes.
  const duplicate = () => { setDraft(toDraft(duplicatePart(fromDraft(draft)))); setSavedAt(0); setErr(""); };
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setFact = (k, v) => setDraft((d) => ({ ...d, facts: { ...(d.facts || {}), [k]: v } }));
  const setStep = (i, v) => setDraft((d) => { const s = d.steps.slice(); s[i] = v; return { ...d, steps: s }; });
  const addStep = () => setDraft((d) => ({ ...d, steps: [...d.steps, ""] }));
  const setProgram = (i, v) => setDraft((d) => { const l = d.programs.slice(); l[i] = v; return { ...d, programs: l }; });
  const addProgram = () => setDraft((d) => ({ ...d, programs: [...d.programs, ""] }));
  const draftMachines = splitMachines(draft.machine);
  const toggleMachine = (k) => setDraft((d) => {
    const cur = splitMachines(d.machine);
    return { ...d, machine: joinMachines(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]) };
  });
  const [making, setMaking] = useState(false);
  async function makeWorkOrder() {
    if (!onMakeWorkOrder || making) return;
    setMaking(true);
    setErr("");
    try { await onMakeWorkOrder(fromDraft(draft)); }
    catch (e) { setErr(`Couldn't start the work order${e?.message ? ` — ${e.message}` : ""}.`); }
    finally { setMaking(false); }
  }
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
  // Pictures cycle in the main box like a product page: the drawing first,
  // then the extra photos. Clicking a photo shows it here instead of opening
  // a new browser tab.
  const pics = [...(draft.blueprintUrl ? [draft.blueprintUrl] : []), ...photos];
  const [shownUrl, setShownUrl] = useState(null);
  const shownIdx = Math.max(0, pics.indexOf(shownUrl));
  const shown = pics[shownIdx] || null;
  const showingDrawing = !!draft.blueprintUrl && shownIdx === 0;
  const step = (dir) => pics.length > 1 && setShownUrl(pics[(shownIdx + dir + pics.length) % pics.length]);
  useEffect(() => { setShownUrl(null); }, [draft.id]);
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

  // What the database said, in words.
  const saveMessage = (e, d = draft) => (isSkuTaken(e) ? `SKU ${d.sku} is already on another part. Use a different one.`
    : /photos/.test(e?.message || "") ? "Extra photos need migration 0065 run first. Everything else on the part is fine."
    : /machine/.test(e?.message || "") ? "Picking a machine needs migration 0066 run first."
    : /facts/.test(e?.message || "") ? "These answers need migration 0068 run first."
    : /cnc_parts/.test(e?.message || "") ? "Run migration 0041 to enable the CNC library." : e?.message || "Couldn't save.");

  // One answer from the guided setup: put it on the part and save straight
  // away, so there's no Save button to forget. Throws in plain words.
  async function commit(patch) {
    const next = { ...draft, ...(patch.field || {}), facts: { ...(draft.facts || {}), ...(patch.fact || {}) } };
    if (patch.machine !== undefined) next.machine = patch.machine;
    try {
      const id = await db.saveCncPart(fromDraft(next));
      await reload(id);
      return id;
    } catch (e) {
      throw new Error(saveMessage(e, next));
    }
  }
  const ask = ({ only, all } = {}) => {
    const keys = only || wizardSteps(draft, pp.programs, { all });
    if (keys.length) setWizard({ keys });
  };

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const id = await db.saveCncPart(fromDraft(draft));
      await reload(id);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(saveMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return closeEditor();
    if (!window.confirm("Delete this part's instructions?")) return;
    await db.deleteCncPart(draft.id);
    closeEditor();
    reload();
    loadProgramIndex();
  }

  return (
    <div className={embedded ? "cl-embed" : "cl-overlay"}>
      <div className="cl-wrap">
        <header className="cl-top">
          <div className="cl-brand">
            <b>CNC&nbsp;CATALOG</b>
            <span>Every product · how to make it · blueprints · notes</span>
          </div>
          <div className="cl-views" role="tablist" aria-label="Catalog section">
            <button role="tab" aria-selected={view === "parts"} className={view === "parts" ? "on" : ""} onClick={() => setView("parts")}>Parts</button>
            <button role="tab" aria-selected={view === "machines"} className={view === "machines" ? "on" : ""} onClick={() => setView("machines")}>Machines</button>
            <button role="tab" aria-selected={view === "priorities"} className={view === "priorities" ? "on" : ""} onClick={() => setView("priorities")}>Fix first</button>
            <button role="tab" aria-selected={view === "ask"} className={view === "ask" ? "on cl-asktab" : "cl-asktab"} onClick={() => setView("ask")}><Sparkles size={13} /> Ask</button>
          </div>
          <div className="cl-spacer" />
          {!embedded && (
            <button className="cl-back" onClick={onClose}>
              <ArrowLeft size={16} /> Back to floor control
            </button>
          )}
        </header>

        {/* Machines and Parts stay mounted while hidden, so half-typed work
            survives a look at another page. */}
        <div style={view === "machines" ? undefined : { display: "none" }}>
          <CncMachines onSaved={loadMachineFacts} parts={parts} programIndex={programIndex} focus={focusMachine} />
        </div>
        {view === "priorities" && (
          <CncPriorities parts={parts} programIndex={programIndex} onOpen={(p) => { edit(p); setView("parts"); }} />
        )}
        {view === "ask" && (
          <div className="cl-editor cl-askpage">
            <CncChat part={null} machineFacts={machineFacts} parts={parts} onClose={() => setView("parts")} />
          </div>
        )}
        {view === "import" && (
          <CncImport parts={parts} onDone={() => { reload(); loadProgramIndex(); }} onClose={() => setView("parts")} />
        )}
        {view === "parts" && (
          <div className={draft.id || wizard || draft.copiedFrom ? "cl-guide part-open" : "cl-guide"}>
            <CncGuide parts={parts} programIndex={programIndex} machineFacts={machineFacts} onGo={goStep} />
          </div>
        )}
        <div className={`cl-body${draft.id || wizard || draft.copiedFrom ? " has-part" : ""}`} style={view === "parts" ? undefined : { display: "none" }}>
          <aside className="cl-list">
            <input className="cl-search" placeholder="Search name, SKU, CNC or program #…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="cl-new" onClick={newPart}>
              <Plus size={16} /> New part
            </button>
            <button className="cl-new cl-import" onClick={() => setView("import")} title="Bring in a whole USB stick of programs at once">
              <FolderInput size={16} /> Import programs
            </button>
            <div className="cl-items">
              {filtered.map((p) => (
                <button key={p.id} className={`cl-item${draft.id === p.id ? " on" : ""}`} onClick={() => edit(p)}>
                  <span className="nm">{p.name || "Untitled part"}</span>
                  {(labelOf.get(p.id)?.cnc || labelOf.get(p.id)?.program || p.programNo) && (
                    <span className="cl-num">
                      {[labelOf.get(p.id)?.cnc, labelOf.get(p.id)?.title, labelOf.get(p.id)?.program || p.programNo].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {/* one quiet line: where it runs and where its program stands */}
                  <span className={`cl-stat ${programStatus(p.id) || "none"}`}>
                    <i />
                    {programStatus(p.id) === "proven" ? "Proven" : programStatus(p.id) === "unproven" ? "Not proven" : "No program"}
                    {splitMachines(p.machine).length ? ` · ${splitMachines(p.machine).map((k) => MACHINES.find((m) => m.key === k)?.short).join(" + ")}` : ""}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="cl-none">No parts yet — add one to start the library.</div>}
            </div>
          </aside>

          <section className="cl-editor" ref={editorRef}>
            {/* on a phone the list gives way to the part; this is the way back */}
            {(draft.id || wizard || draft.copiedFrom) && (
              <button className="cl-backlist" onClick={closeEditor}><ArrowLeft size={16} /> All parts</button>
            )}
            {wizard && (
              <CncWizard
                key={wizard.keys.join()}
                keys={wizard.keys} part={draft} pp={pp} machineFacts={machineFacts}
                onCommit={commit}
                onUploadDrawing={(file) => db.uploadBlueprint(draft.id, file)}
                onClose={() => { setWizard(null); if (!draft.id) closeEditor(); }}
                onOpenMachines={() => { setWizard(null); goField("tools"); }}
              />
            )}
            {!wizard && !draft.id && !draft.copiedFrom && (
              <div className="cl-pick">
                <Box size={44} />
                <b>{parts.length ? "Pick a part on the left" : "No parts yet"}</b>
                <span>{parts.length ? "Or start a new one." : "Import the programs off the machines, or add a part by hand."}</span>
                <div className="cl-pickbtns">
                  <button className="ov-go" onClick={newPart}><Plus size={18} /> New part</button>
                  <button className="cl-btn" onClick={() => setView("import")}><FolderInput size={15} /> Import programs</button>
                </div>
              </div>
            )}
            {!wizard && draft.id && (
              <div className="cl-tabs" role="tablist" aria-label="Part view">
                <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
                <button role="tab" aria-selected={tab === "details"} className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}>All details</button>
              </div>
            )}
            {!wizard && draft.id && tab === "overview" && (
              <CncPartOverview
                key={draft.id}
                part={draft} pp={pp} machineFacts={machineFacts}
                onAsk={ask}
                onDetails={() => setTab("details")}
                onMakeWorkOrder={onMakeWorkOrder ? makeWorkOrder : null}
                onOpenMachines={() => goField("tools")}
                onCommit={commit}
                allParts={parts}
              />
            )}
            {!wizard && (draft.copiedFrom || (draft.id && tab === "details")) && (<>
            {/* where this part is, and the one thing to do next */}
            {partStep && (
              <button className={`ps ${partStep.tone}`} onClick={() => setupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} title="Go to Program & setup">
                <span className="ps-steps" aria-hidden="true">
                  {PART_STEPS.map((name) => (
                    <span key={name} className={partStep.done[name] ? "done" : partStep.at === name ? "now" : ""}>{partStep.done[name] ? <Check size={12} /> : null}{name}</span>
                  ))}
                </span>
                <span className="ps-text"><b>{partStep.tone === "done" ? "Done" : "Next"}</b>{partStep.text}</span>
              </button>
            )}
            <div className="cl-row2">
              <label className="cl-field grow" data-go="name">
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

            <div className="cl-field" data-go="machine">
              <span className="cl-lab">CNC machine{draftMachines.length > 1 ? "s" : ""}</span>
              <div className="cl-machines">
                {MACHINES.map((m) => (
                  <button
                    key={m.key}
                    className={`cl-mchip${draftMachines.includes(m.key) ? " on" : ""}`}
                    style={{ "--m": m.color }}
                    onClick={() => toggleMachine(m.key)}
                    aria-pressed={draftMachines.includes(m.key)}
                    title={draftMachines.includes(m.key) ? `Not made on the ${m.label}` : `Made on the ${m.label}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cl-grid">
              <div className="cl-bp">
                <span className="cl-lab">
                  {shown && !showingDrawing ? "Photo" : "Blueprint / drawing"}
                  {pics.length > 1 ? ` · ${shownIdx + 1} of ${pics.length}` : ""}
                </span>
                <div className={`cl-bpbox${shown ? " has-img" : ""}`} data-go="drawing">
                  {shown ? (
                    <>
                      <img src={shown} alt={showingDrawing ? "blueprint" : `photo ${shownIdx + 1}`} />
                      {pics.length > 1 && (
                        <>
                          <button className="cl-nav prev" onClick={() => step(-1)} aria-label="Previous picture"><ChevronLeft size={20} /></button>
                          <button className="cl-nav next" onClick={() => step(1)} aria-label="Next picture"><ChevronRight size={20} /></button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="cl-bpempty">
                      <ImageOff size={26} />
                      <span>No blueprint yet</span>
                    </div>
                  )}
                </div>
                <div className="cl-bpbtns">
                  <button className="cl-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={15} /> {uploading ? "Uploading…" : draft.blueprintUrl ? (showingDrawing ? "Replace" : "Replace drawing") : "Upload drawing"}
                  </button>
                  {draft.blueprintUrl && (
                    <button className="cl-btn ghost" onClick={() => setField("blueprintUrl", null)}>
                      {showingDrawing ? "Remove" : "Remove drawing"}
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
                </div>

                <span className="cl-lab" style={{ marginTop: 14 }}>More photos{photos.length ? ` · ${photos.length}` : ""}</span>
                {photos.length > 0 && (
                  <div className="cl-photos">
                    {photos.map((u, i) => (
                      <div className={`cl-photo${shown === u ? " on" : ""}`} key={u}>
                        <button className="cl-photoshow" onClick={() => setShownUrl(u)} title="Show this one above"><img src={u} alt={`photo ${i + 1}`} /></button>
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
                <label className="cl-field" style={{ marginTop: 14 }} data-go="material">
                  <span className="cl-lab">Material</span>
                  <input value={draft.material} onChange={(e) => setField("material", e.target.value)} placeholder="e.g. 6061‑T6 · 2.75″ bar" />
                </label>
              </div>

              <div className="cl-steps">
                <span className="cl-lab">Operator steps: what the operator does at the machine</span>
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

            <div ref={setupRef} style={{ scrollMarginTop: 12 }} />
            <CncPrograms part={draft} pp={pp} onFact={setFact} machineFacts={machineFacts} onStep={setPartStep} onGoTo={goField} />

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
              {draft.id && onMakeWorkOrder && (
                <button className="cl-del cl-mkwo" onClick={makeWorkOrder} disabled={making} title="Open a new CNC work order filled in from this part">
                  <ClipboardList size={15} /> {making ? "Opening…" : "Make CNC work order"}
                </button>
              )}
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
            </>)}
          </section>
        </div>
      </div>
    </div>
  );
}

// Every word typed has to be found. A number matches a whole number on the
// part however it's written, with or without leading zeros or letters in front
// (240 finds CNC-0240 and O00240, 24 doesn't); anything else is looked for as
// written.
export function matchesSearch(q, fields) {
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.map((v) => String(v || "")).join(" ").toLowerCase();
  const numbers = new Set((text.match(/\d+/g) || []).map((n) => n.replace(/^0+(?=\d)/, "")));
  const isNumber = (n) => numbers.has(n.replace(/^0+(?=\d)/, ""));
  return words.every((w) => {
    // a bare number has to be a whole number on the part: 24 doesn't find CNC-0240
    if (/^\d+$/.test(w)) return isNumber(w);
    if (text.includes(w)) return true;
    const nums = w.match(/\d+/g);
    return !!nums && nums.every(isNumber);
  });
}
