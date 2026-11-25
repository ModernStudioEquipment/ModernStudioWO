import { ShieldCheck, ShieldAlert, FileQuestion } from "lucide-react";
import { MACHINES } from "./machines.js";
import { rankParts } from "./cncPack.js";
import { splitMachines } from "./cncParts.js";

// "Fix first": the catalogue ranked by how much hand work each part's program
// leaves behind. Minutes by hand per part, times how many are made per run, is
// what a better program gives back every run, so the top of this list is where
// reprogramming pays for itself soonest.
const fmt = (min) => (min >= 90 ? `${(min / 60).toFixed(1)} hours` : `${Math.round(min)} min`);

export default function CncPriorities({ parts, programIndex, onOpen }) {
  const ranked = rankParts(parts, programIndex);
  const total = ranked.reduce((n, r) => n + (r.perRunMin || 0), 0);
  const count = (s) => ranked.filter((r) => r.status === s).length;
  const measured = ranked.filter((r) => r.perRunMin != null).length;

  return (
    <div className="cm">
      <div className="pr-sum">
        <div><b>{ranked.length}</b><span>parts</span></div>
        <div className="ok"><b>{count("proven")}</b><span>proven programs</span></div>
        <div className="warn"><b>{count("unproven")}</b><span>not proven</span></div>
        <div><b>{count("none")}</b><span>no program on file</span></div>
        <div><b>{total ? fmt(total) : "—"}</b><span>hand work per run, {measured} part{measured === 1 ? "" : "s"} measured</span></div>
      </div>
      <div className="cp-sub">
        Ranked by hand work per run: minutes by hand per part, times how many per run. Fill those two boxes in on a part (under Program &amp; setup) and it takes its place here.
      </div>

      {!ranked.length && <div className="cp-note">No parts in the catalogue yet.</div>}
      <div className="pr-rows">
        {ranked.map((r, i) => {
          const machines = splitMachines(r.part.machine).map((k) => MACHINES.find((m) => m.key === k)?.short).filter(Boolean);
          return (
            <button className="pr-row" key={r.part.id} onClick={() => onOpen(r.part)} title="Open this part">
              <span className="pr-rank">{r.score > 0 ? i + 1 : "·"}</span>
              <span className="pr-name">
                <b>{r.part.name || "Untitled part"}</b>
                <span>
                  {[machines.join(" + "), r.byHand || (r.score > 0 ? "" : "no hand work recorded")].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="pr-time">
                {r.perRunMin != null ? (
                  <><b>{fmt(r.perRunMin)}</b><span>{r.min} min × {r.run ?? 1}{r.run == null ? " (per part)" : " per run"}</span></>
                ) : r.byHand ? <span>not timed yet</span> : null}
              </span>
              <span className={`cp-stamp${r.status === "proven" ? " ok" : r.status === "none" ? " none" : ""}`}>
                {r.status === "proven" ? <ShieldCheck size={14} /> : r.status === "none" ? <FileQuestion size={14} /> : <ShieldAlert size={14} />}
                {r.status === "proven" ? "Proven" : r.status === "none" ? "No program" : "Not proven"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
