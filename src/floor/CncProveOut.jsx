import { useState } from "react";
import { Check } from "lucide-react";
import { PROVE_STEPS } from "./cncPack.js";
import { sizeText } from "./cncSolid.js";

// Stamping a program proven: three things done at the machine, ticked in
// order, and a name. Used on the part's overview and in its full details.
//
// For a lathe part the sizes the program cuts are listed with a box beside
// each for what the first part actually measured. Filling them in is optional,
// but what's written is kept with the stamp: it's the only record that the
// first part was checked, and against what.
//
// sizes = finishedSizes(...) for the program, or null. onStamp(by, record).
export default function CncProveOut({ stops = 0, sizes = null, onStamp, onCancel }) {
  const [done, setDone] = useState(PROVE_STEPS.map(() => false));
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState({});
  const rows = (sizes?.steps || []).filter((s) => !s.groove).map((s, i) => ({ key: `d${i}`, what: `Ø${sizeText(s.dia, sizes.units)}`, nominal: s.dia, where: s.len != null ? `${sizeText(s.len, sizes.units)} long` : "" }));
  const measured = rows
    .map((r) => ({ what: r.what, nominal: Number(r.nominal.toFixed(4)), got: parseFloat(String(got[r.key] ?? "").trim()) }))
    .filter((r) => Number.isFinite(r.got));
  const ready = by.trim() && done.every(Boolean) && !busy;
  const stamp = async () => {
    if (!ready) return;
    setBusy(true);
    try { await onStamp(by.trim(), measured.length ? { measured, units: sizes.units, at: Date.now() } : null); } finally { setBusy(false); }
  };
  return (
    <div className="cp-provebox">
      <b>Prove it out at the machine, in this order:</b>
      {PROVE_STEPS.map((s, i) => (
        <label key={i} className="cp-provestep">
          <input type="checkbox" checked={done[i]} onChange={(e) => setDone((d) => d.map((v, j) => (j === i ? e.target.checked : v)))} />
          <span>{s}</span>
        </label>
      ))}
      {rows.length > 0 && (
        <div className="cp-measure">
          <span className="cp-measurehead">What did the first part measure? <i>Optional, and kept with the stamp.</i></span>
          {rows.map((r) => {
            const v = parseFloat(String(got[r.key] ?? "").trim());
            const diff = Number.isFinite(v) ? v - r.nominal : null;
            return (
              <label key={r.key} className="cp-measurerow">
                <span><b>{r.what}</b>{r.where ? <i>{r.where}</i> : null}</span>
                <input inputMode="decimal" value={got[r.key] ?? ""} onChange={(e) => setGot((g) => ({ ...g, [r.key]: e.target.value }))} placeholder="measured" aria-label={`Measured ${r.what}`} />
                <em className={diff != null && Math.abs(diff) > 0.002 ? "off" : ""}>{diff == null ? "" : Math.abs(diff) < 0.00005 ? "on size" : `${diff > 0 ? "+" : "−"}${sizeText(Math.abs(diff), sizes.units)}`}</em>
              </label>
            );
          })}
        </div>
      )}
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

// "First part: Ø0.625 measured 0.6248 (−0.0002), …" for a stamped program.
export function proofLine(proof) {
  if (!proof?.measured?.length) return "";
  return `First part: ${proof.measured.map((m) => { const d = m.got - m.nominal; return `${m.what} measured ${sizeText(m.got, proof.units)}${Math.abs(d) < 0.00005 ? "" : ` (${d > 0 ? "+" : "−"}${sizeText(Math.abs(d), proof.units)})`}`; }).join(", ")}.`;
}
