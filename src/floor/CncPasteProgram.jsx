import { useState } from "react";
import { ClipboardPaste, Check, X } from "lucide-react";
import { programInfo, programLine, looksLikeProgram } from "./cncPack.js";
import { cleanProgramText } from "./cncGcode.js";

// Paste a program's text instead of uploading a file: copied out of an email,
// a text file, Mastercam's editor or another screen. As soon as it's pasted it
// says what it read (the O-number, the tools, how long it is), or that it
// isn't a program. It's handed on as a file, so it goes through exactly the
// same checks as an upload.
//
// onAdd(file) is given a File named from the program (O-number and title,
// e.g. "O00636 - 006-1596.nc"), or from what was typed in the name box.
export const pastedName = (text, typed = "") => {
  const t = String(typed || "").trim();
  if (t) return /\.[a-z0-9]{1,4}$/i.test(t) ? t : `${t}.nc`;
  const info = programInfo(text);
  const title = String(info.title || "").replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${[info.number || "Pasted program", title].filter(Boolean).join(" - ")}.nc`;
};

export default function CncPasteProgram({ onAdd, busy = false, label = "Paste a program", startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const clean = cleanProgramText(text).text;
  const has = clean.trim().length > 0;
  const ok = has && looksLikeProgram(clean);
  const info = ok ? programInfo(clean) : null;

  async function add() {
    if (!ok || busy) return;
    const file = new File([clean], pastedName(clean, name), { type: "text/plain" });
    const done = await onAdd(file);
    if (done !== false) { setText(""); setName(""); setOpen(false); }
  }

  if (!open) {
    return <button type="button" className="cl-btn" onClick={() => setOpen(true)} disabled={busy}><ClipboardPaste size={15} /> {label}</button>;
  }
  return (
    <div className="pp-box">
      <label className="cl-field">
        <span className="cl-lab">The program's text</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} autoFocus
          placeholder={"%\nO00636 (006-1596)\nG20\nT0101\n…\nM30\n%"} aria-label="Program text" />
      </label>
      {has && (ok
        ? <span className="pp-read"><Check size={14} /> {programLine(info)}</span>
        : <span className="cl-err">That doesn't read like a program. Paste the G-code the Haas runs, from the first line to the M30.</span>)}
      <label className="cl-field">
        <span className="cl-lab">File name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={ok ? pastedName(clean) : "e.g. CNC-0240 - STACK 6"} aria-label="File name" />
      </label>
      <div className="pp-btns">
        <button type="button" className="cl-btn ghost" onClick={() => { setOpen(false); setText(""); setName(""); }}><X size={14} /> Cancel</button>
        <button type="button" className="cl-btn pp-add" onClick={add} disabled={!ok || busy}><Check size={14} /> {busy ? "Adding…" : "Add this program"}</button>
      </div>
    </div>
  );
}
