import { useEffect, useMemo, useState } from "react";
import { Download, FileText, ShieldCheck, ShieldAlert, MessageSquareWarning, Check } from "lucide-react";
import { db } from "../lib/db.js";
import CncPreview from "./CncPreview.jsx";
import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";
import { programInfo, addProblem } from "./cncPack.js";
import "./cncLibrary.css";

// The CNC program for the part on a work order, for whoever is at the machine:
// what the part looks like, whether the program is proven, the file to take to
// the machine, the run sheet, and a way to say something is wrong with it.
//
// It shows the proven version if there is one, otherwise the newest, the same
// choice the run sheet makes, so the picture, the file and the sheet agree.
//
// The work order itself stays read-only. The one thing that can be written
// here is a problem with the program, which goes on the catalogue part.

export default function FloorPartProgram({ part, onRunSheet, onPartChanged }) {
  const [programs, setPrograms] = useState(null);   // null while loading
  const [telling, setTelling] = useState(false);
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setPrograms(null);
    db.getCncPrograms(part.id).then((list) => { if (on) setPrograms(Array.isArray(list) ? list : []); }).catch(() => { if (on) setPrograms([]); });
    return () => { on = false; };
  }, [part.id]);

  const program = programs ? programs.find((p) => p.status === "proven") || programs[0] || null : null;
  const proven = program?.status === "proven";
  const kind = MACHINES.find((m) => m.key === splitMachines(part.machine)[0])?.kind || "";
  const toolNames = useMemo(() => (program ? Object.fromEntries(programInfo(program.content).tools.filter((t) => t.note).map((t) => [t.t, t.note])) : {}), [program]);

  async function tell() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      // the freshest copy of the part, so a problem someone else just added isn't written over
      const fresh = (await db.getCncParts()).find((p) => p.id === part.id) || part;
      await db.saveCncPart(addProblem(fresh, text, by));
      setSaid(true); setTelling(false); setText("");
      onPartChanged?.();
    } catch (e) {
      setErr(e?.message ? `Couldn't save that: ${e.message}` : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cl-embed fpp">
      <div className={`fcs-prog${proven ? " ok" : program ? "" : " none"}`}>
        <span className="fcs-progstat">
          {proven ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
          {programs === null ? "Looking for the program…"
            : proven ? `Program proven${program.provenBy ? ` by ${program.provenBy}` : ""}`
            : program ? "Program not proven. Get a lead before running."
            : "No program on file for this part"}
        </span>
        {program && <button className="fcs-runbtn" onClick={() => downloadProgram(program)} title="Save the program file, to put on a USB stick for the machine"><Download size={14} /> Download</button>}
        <button className="fcs-runbtn" onClick={onRunSheet}><FileText size={14} /> Run sheet</button>
      </div>

      {program && (
        <div className="pv-host">
          <CncPreview compact content={program.content} kind={kind} toolNames={toolNames} stockText={part.facts?.stock || ""} material={part.material || ""} height={280} />
        </div>
      )}

      {program && (
        said ? <div className="cp-clean"><Check size={14} /> Noted on the part. Thanks.</div>
        : !telling ? (
          <button className="fpp-tell" onClick={() => { setTelling(true); setSaid(false); }}><MessageSquareWarning size={15} /> Something wrong with this program?</button>
        ) : (
          <form className="fpp-form" onSubmit={(e) => { e.preventDefault(); tell(); }}>
            <label>What's wrong with it?
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. chatter on the long turn, the 0.625 comes out 0.002 big" aria-label="What's wrong with the program" autoFocus />
            </label>
            <div className="fpp-row">
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" aria-label="Your name" />
              <button type="submit" className="fcs-runbtn" disabled={!text.trim() || busy}>{busy ? "Saving…" : "Put it on the part"}</button>
              <button type="button" className="fcs-runbtn ghost" onClick={() => setTelling(false)}>Cancel</button>
            </div>
            {err && <div className="cl-err">{err}</div>}
          </form>
        )
      )}
    </div>
  );
}

// Save a program as a file, for the USB stick.
export function downloadProgram(program) {
  const url = URL.createObjectURL(new Blob([String(program?.content || "")], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = program?.name || "program.nc";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
