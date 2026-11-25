import { useRef, useState } from "react";
import { Upload, FolderOpen, Check, ArrowLeft } from "lucide-react";
import { db } from "../lib/db.js";
import { MACHINES } from "./machines.js";
import { planImport, importCounts, programLine, machineForKind } from "./cncPack.js";
import { readText } from "./CncPrograms.jsx";

// Import a whole USB stick of programs at once.
//
// A Haas backup is one file per program, often dozens of them. Uploading them
// one part at a time would take an afternoon, so this reads the lot, works out
// where each belongs (by the program number already on a part, then by name),
// and shows the plan. Nothing is written until Import is pressed.
export default function CncImport({ parts, onDone, onClose }) {
  const [rows, setRows] = useState(null);     // the plan, once files are read
  const [off, setOff] = useState(() => new Set()); // row indexes unticked
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy("Reading the files…");
    setErr("");
    setResult(null);
    try {
      const read = [];
      for (const f of files) {
        // Anything huge is not a program; don't pull it into memory to find out.
        read.push({ name: f.name, size: f.size, text: f.size > 3 * 1024 * 1024 ? "" : await readText(f) });
      }
      setRows(planImport(read, parts));
      setOff(new Set());
    } catch (e2) {
      setErr(`Couldn't read those files${e2?.message ? `: ${e2.message}` : "."}`);
    } finally {
      setBusy("");
    }
  }

  const chosen = (rows || []).filter((r, i) => r.action !== "skip" && !off.has(i));
  const counts = rows ? importCounts(rows) : null;

  async function run() {
    if (!chosen.length || busy) return;
    setErr("");
    setBusy("Checking…");
    try {
      if (!(await db.cncProgramsReady())) { setErr("Importing needs migration 0068 run first."); return; }
      const created = new Map();  // newKey -> part id
      const have = new Map();     // part id -> Set of program texts already there
      let added = 0;
      let dupes = 0;
      let newParts = 0;
      for (let i = 0; i < chosen.length; i++) {
        const r = chosen[i];
        setBusy(`Importing ${i + 1} of ${chosen.length}…`);
        let partId = r.partId;
        if (r.action === "new") {
          if (!created.has(r.newKey)) {
            const id = await db.saveCncPart({
              id: null, name: r.newName, sku: "", steps: [], material: "", notes: "", blueprintUrl: null,
              // The machine picked for the batch, or the only machine it could be:
              // a mill program can only be the VF-4.
              photos: [], productNo: "", programNo: r.info.number || "", machine: machine || machineForKind(r.info.kind), facts: {},
            });
            created.set(r.newKey, id);
            newParts += 1;
          }
          partId = created.get(r.newKey);
        }
        if (!have.has(partId)) have.set(partId, new Set((await db.getCncPrograms(partId)).map((p) => p.content)));
        if (have.get(partId).has(r.text)) { dupes += 1; continue; }
        await db.addCncProgram({ partId, name: r.file, content: r.text });
        have.get(partId).add(r.text);
        added += 1;
      }
      setResult({ added, dupes, newParts });
      setRows(null);
      onDone?.();
    } catch (e) {
      setErr(`The import stopped${e?.message ? `: ${e.message}` : "."} What was imported before that is saved; run it again to pick up the rest (files already in are skipped).`);
      onDone?.();
    } finally {
      setBusy("");
    }
  }

  const toggle = (i) => setOff((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="ci">
      <div className="cm-head">
        <b>Import programs</b>
        <span className="cl-spacer" />
        <button className="cl-btn ghost" onClick={onClose}><ArrowLeft size={14} /> Back to parts</button>
      </div>
      <div className="cp-sub">
        Pick all the program files from one machine. You'll see where each one goes before anything is saved.
      </div>

      <div className="cl-bpbtns">
        <button className="cl-btn" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload size={15} /> Pick program files</button>
        <button className="cl-btn" onClick={() => dirRef.current?.click()} disabled={!!busy}><FolderOpen size={15} /> Pick a whole folder</button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles} aria-label="Program files to import" />
        <input ref={dirRef} type="file" multiple hidden onChange={onFiles} webkitdirectory="" directory="" aria-label="Folder of programs to import" />
      </div>
      {busy && <div className="cp-note">{busy}</div>}
      {err && <div className="cl-err">{err}</div>}
      {result && (
        <div className="cp-clean">
          <Check size={14} /> Imported {result.added} program{result.added === 1 ? "" : "s"}
          {result.newParts ? `, made ${result.newParts} new part${result.newParts === 1 ? "" : "s"}` : ""}
          {result.dupes ? `, skipped ${result.dupes} already in the catalogue` : ""}.
        </div>
      )}

      {rows && (
        <>
          <label className="cl-field" style={{ maxWidth: 360 }}>
            <span className="cl-lab">Which machine are these from?</span>
            <select className="ci-select" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine these programs are from">
              <option value="">Not sure / mixed</option>
              {MACHINES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>

          <div className="ci-sum">
            {counts.add} onto parts you already have · {counts.new} new part{counts.new === 1 ? "" : "s"} · {counts.skip} skipped
          </div>
          <div className="ci-rows" role="list">
            {rows.map((r, i) => (
              <label className={`ci-row ${r.action}`} key={i} role="listitem">
                <input type="checkbox" disabled={r.action === "skip"} checked={r.action !== "skip" && !off.has(i)} onChange={() => toggle(i)} aria-label={`Import ${r.file}`} />
                <span className="ci-file">
                  <b>{r.file}</b>
                  <span>{r.info ? programLine(r.info) : r.why}</span>
                </span>
                <span className="ci-to">
                  {r.action === "add" && <>Add to <b>{r.partName}</b><em>matched by {r.matchedBy}</em></>}
                  {r.action === "new" && <>New part <b>{r.newName}</b>{(machine || machineForKind(r.info.kind)) ? <em>on the {MACHINES.find((m) => m.key === (machine || machineForKind(r.info.kind)))?.short}</em> : <em>machine not set: pick it on the part</em>}</>}
                  {r.action === "skip" && <em>Skipped</em>}
                </span>
              </label>
            ))}
          </div>
          <div className="cl-bpbtns">
            <button className="cl-save" onClick={run} disabled={!chosen.length || !!busy}>
              {busy || `Import ${chosen.length} program${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button className="cl-btn ghost" onClick={() => setRows(null)} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
