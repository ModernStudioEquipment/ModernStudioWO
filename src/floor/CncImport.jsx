import { useRef, useState } from "react";
import { Upload, FolderOpen, Check, ArrowLeft } from "lucide-react";
import { db } from "../lib/db.js";
import { MACHINES } from "./machines.js";
import { planImport, importCounts, programLine, machineForKind } from "./cncPack.js";
import { readText } from "./CncPrograms.jsx";
import { readZip, isZip } from "./unzip.js";

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
    await readFiles(files);
  }

  // Dropped on the page: files, a whole folder (opened all the way down), or zips.
  const [over, setOver] = useState(false);
  const depth = useRef(0);   // dragenter/leave fire for every child: count them
  const dragging = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  async function onDrop(e) {
    e.preventDefault();
    depth.current = 0; setOver(false);
    if (busy) return;
    setBusy("Reading the files…");
    try { await readFiles(await droppedFiles(e.dataTransfer)); }
    catch (e2) { setErr(`Couldn't read what was dropped${e2?.message ? `: ${e2.message}` : "."}`); setBusy(""); }
  }
  const dropProps = {
    onDragEnter: (e) => { if (!dragging(e)) return; e.preventDefault(); depth.current += 1; setOver(true); },
    onDragOver: (e) => { if (!dragging(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e) => { if (!dragging(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop,
  };

  async function readFiles(files) {
    if (!files.length) { setBusy(""); return; }
    setBusy("Reading the files…");
    setErr("");
    setResult(null);
    try {
      const read = [];
      const notes = [];
      for (const f of files) {
        // a zip: every file inside it, as if they'd been picked one by one
        if (isZip(f)) {
          setBusy(`Opening ${f.name}…`);
          const z = await readZip(f);
          for (const x of z.files) read.push({ name: x.name, size: x.size, text: x.text });
          for (const x of z.skipped) notes.push(`${x.name} in ${f.name}: ${x.why}`);
          if (!z.files.length && !z.skipped.length) notes.push(`${f.name} has nothing in it.`);
          continue;
        }
        // Anything huge is not a program; don't pull it into memory to find out.
        read.push({ name: f.name, size: f.size, text: f.size > 3 * 1024 * 1024 ? "" : await readText(f) });
      }
      setRows(planImport(read, parts));
      if (notes.length) setErr(notes.slice(0, 4).join(" ") + (notes.length > 4 ? ` And ${notes.length - 4} more.` : ""));
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
      const failed = [];          // files that couldn't be saved: the rest still go in
      for (let i = 0; i < chosen.length; i++) {
        const r = chosen[i];
        setBusy(`Importing ${i + 1} of ${chosen.length}…`);
        try {
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
        } catch (e) {
          // a lost connection stops the lot (nothing after it would save either); anything else is just this file
          if (/fetch|network|Failed to|Load failed/i.test(e?.message || "")) throw e;
          failed.push({ file: r.file, why: e?.message || "couldn't be saved" });
        }
      }
      setResult({ added, dupes, newParts, failed });
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
    <div className={`ci${over ? " ci-over" : ""}`} {...dropProps}>
      <div className="cm-head">
        <b>Import programs</b>
        <span className="cl-spacer" />
        <button className="cl-btn ghost" onClick={onClose}><ArrowLeft size={14} /> Back to parts</button>
      </div>
      <div className="cp-sub">
        Pick all the program files from one machine, a whole folder, or a .zip of them. You'll see where each one goes before anything is saved.
      </div>

      <div className={`ci-drop${over ? " on" : ""}`} aria-label="Drop program files, a folder or a zip here">
        <Upload size={22} />
        <b>{over ? "Let go to read them" : "Drag program files, a whole folder, or a .zip here"}</b>
        <span>or pick them:</span>
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
      {result?.failed?.length > 0 && (
        <div className="cl-err">
          {result.failed.length} file{result.failed.length === 1 ? "" : "s"} couldn't be saved and {result.failed.length === 1 ? "was" : "were"} left out: {result.failed.slice(0, 5).map((f) => `${f.file} (${f.why})`).join("; ")}{result.failed.length > 5 ? `, and ${result.failed.length - 5} more` : ""}.
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

// Everything dropped, as files: folders are opened all the way down (the
// browser hands over a folder as an entry to walk, not as its files). Hidden
// files are left out. Falls back to the plain file list where entries aren't
// offered.
export async function droppedFiles(dt) {
  const items = [...(dt?.items || [])].filter((i) => i.kind === "file");
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  if (!entries.length || entries.some((x) => !x)) return [...(dt?.files || [])];
  const out = [];
  const fileOf = (entry) => new Promise((res, rej) => entry.file(res, rej));
  const children = (dir) => new Promise((res, rej) => {
    const reader = dir.createReader();
    const all = [];
    const more = () => reader.readEntries((batch) => { if (!batch.length) res(all); else { all.push(...batch); more(); } }, rej);
    more();
  });
  const walk = async (entry, depth = 0) => {
    if (!entry || entry.name.startsWith(".") || depth > 12 || out.length > 5000) return;
    if (entry.isFile) out.push(await fileOf(entry));
    else if (entry.isDirectory) for (const c of await children(entry)) await walk(c, depth + 1);
  };
  for (const e of entries) await walk(e);
  return out;
}
