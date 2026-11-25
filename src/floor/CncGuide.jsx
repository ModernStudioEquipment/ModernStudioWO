import { useState } from "react";
import { Check, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { catalogProgress } from "./cncPack.js";

// "Where are we, and what's next?" for the whole CNC Catalog: four steps, each
// with a live count and a button that goes to the place the work is done.
//
// It folds away once people know the drill, and remembers that on this device.
const KEY = "mse_cnc_guide_closed_v1";
// Folded by default: one line with the percentage and what's next. Opening it
// shows all four steps.
const recall = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };

export default function CncGuide({ parts, programIndex, machineFacts, onGo }) {
  const [closed, setClosed] = useState(recall);
  const p = catalogProgress(parts, programIndex, machineFacts);
  const toggle = () => setClosed((c) => { try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* fine */ } return !c; });
  const go = { import: "Import programs", machines: "Open Machines", setup: "Show me which", prove: "Show me which" };

  return (
    <section className={`gd${closed ? " closed" : ""}`} aria-label="CNC setup progress">
      <button className="gd-head" onClick={toggle} aria-expanded={!closed}>
        <span className="gd-ring" style={{ "--p": p.percent }} aria-hidden="true"><b>{p.percent}%</b></span>
        <span className="gd-title">
          <b>{p.percent === 100 ? "The catalogue is set up" : "Getting the CNC programs set up"}</b>
          <span>{p.empty ? "Start by importing the programs off the machines." : closed ? nextLine(p) : "Four steps, in order."}</span>
        </span>
        {closed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>

      {!closed && (
        <ol className="gd-steps">
          {p.steps.map((s, i) => {
            const done = !p.empty && s.done >= s.of;
            const now = p.current === s.key || (p.empty && s.key === "import");
            return (
              <li key={s.key} className={done ? "done" : now ? "now" : ""}>
                <span className="gd-num">{done ? <Check size={15} /> : i + 1}</span>
                <span className="gd-body">
                  <b>{s.title}</b>
                  <span>{s.what}</span>
                  <span className="gd-bar" aria-hidden="true"><i style={{ width: `${p.empty ? 0 : Math.min(100, Math.round((s.done / s.of) * 100))}%` }} /></span>
                </span>
                <span className="gd-count">{p.empty ? "" : `${Math.min(s.done, s.of)} of ${s.of}`}</span>
                {!done && (
                  <button className="cl-btn" onClick={() => onGo(s.key)} aria-label={`${go[s.key]}: ${s.title}`}>
                    {go[s.key]} <ArrowRight size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const nextLine = (p) => {
  const s = p.steps.find((x) => x.key === p.current);
  return s ? `Next: ${s.title.toLowerCase()} (${Math.min(s.done, s.of)} of ${s.of}).` : "Every program is proven.";
};
