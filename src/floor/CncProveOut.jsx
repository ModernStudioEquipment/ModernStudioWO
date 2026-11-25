import { useState } from "react";
import { Check } from "lucide-react";
import { PROVE_STEPS } from "./cncPack.js";

// Stamping a program proven: three things done at the machine, ticked in
// order, and a name. Used on the part's overview and in its full details.
export default function CncProveOut({ stops = 0, onStamp, onCancel }) {
  const [done, setDone] = useState(PROVE_STEPS.map(() => false));
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = by.trim() && done.every(Boolean) && !busy;
  const stamp = async () => { if (!ready) return; setBusy(true); try { await onStamp(by.trim()); } finally { setBusy(false); } };
  return (
    <div className="cp-provebox">
      <b>Prove it out at the machine, in this order:</b>
      {PROVE_STEPS.map((s, i) => (
        <label key={i} className="cp-provestep">
          <input type="checkbox" checked={done[i]} onChange={(e) => setDone((d) => d.map((v, j) => (j === i ? e.target.checked : v)))} />
          <span>{s}</span>
        </label>
      ))}
      {stops > 0 && <div className="cp-warn">The checker still has {stops} thing{stops === 1 ? "" : "s"} to fix on this program.</div>}
      <div className="cp-prove">
        <input
          value={by} placeholder="Who proved it out?" aria-label="Who proved it out"
          onChange={(e) => setBy(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") stamp(); if (e.key === "Escape") onCancel?.(); }}
        />
        <button className="cl-btn" disabled={!ready} onClick={stamp}><Check size={14} /> Stamp it proven</button>
        <button className="cl-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
