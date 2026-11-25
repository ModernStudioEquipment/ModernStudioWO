import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { db } from "../lib/db.js";
import { Btn } from "../components/ui.jsx";
import { Wordmark } from "../components/Logo.jsx";
import { runSheet } from "./cncPack.js";
import CncDrawing from "./CncDrawing.jsx";
import { toolpath } from "./cncPath.js";
import { estimateTime, fmtDuration } from "./cncTime.js";
import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";
import "./runSheet.css";

// The run sheet for a part: one page for whoever is at the machine. Which tool
// goes in which pocket, how the part is held, where the program stops and why,
// and whether the program has been proven. All of it comes from the catalogue;
// nothing is typed here.
//
// Given a `program` it sheets that version. Without one it loads the part's
// newest (that's how the floor opens it). The tool lists load themselves when
// they aren't handed in.
export default function CncRunSheet({ part, program = null, machineFacts = null, onClose }) {
  const [prog, setProg] = useState(program);
  const [facts, setFacts] = useState(machineFacts);
  const [loading, setLoading] = useState(!program || !machineFacts);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, mf] = await Promise.all([
          program ? null : db.getCncPrograms(part.id),
          machineFacts ? null : db.getMachineFacts(),
        ]);
        if (!alive) return;
        // Newest proven version if there is one, else the newest.
        if (list) setProg(list.find((p) => p.status === "proven") || list[0] || null);
        if (mf) setFacts(mf);
      } catch { /* the sheet still prints what it has */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [part?.id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = runSheet(part, prog, facts || {});
  const p = s.program;
  const machineKind = MACHINES.find((m) => m.key === splitMachines(part?.machine)[0])?.kind || "";
  const time = prog ? estimateTime(toolpath(prog.content, { kind: machineKind })) : null;
  const perRun = Number(/\d+/.exec(String(part?.facts?.perRun || ""))?.[0] || 0);

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={onClose}>
      <div className="wo-sheetwrap" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "96vw" }}>
        <div className="wo-toolbar flex gap-2 mb-2 items-center no-print">
          <span className="flex-1" />
          <Btn kind="brass" onClick={() => window.print()} disabled={loading}><Printer size={15} />Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </div>

        <div id="wo" className="rs-sheet" aria-label={`Run sheet for ${s.name}`}>
          <div className="rs-top">
            <div>
              <Wordmark height={34} variant="dark" subText="CNC RUN SHEET" subAlign="left" />
              <h1 className="rs-title">{s.name}</h1>
              <div className="rs-sub">
                {[s.sku && `SKU ${s.sku}`, p?.number, p?.name, s.machines.map((m) => m.label).join(" + ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            {loading ? null : p ? (
              <div className={`rs-stamp${p.proven ? "" : " no"}`}>
                {p.proven ? "Proven" : "Not proven"}
                <small>
                  {p.proven
                    ? [p.provenBy, p.provenAt && new Date(p.provenAt).toLocaleDateString()].filter(Boolean).join(" · ")
                    : "Get a lead before running"}
                </small>
              </div>
            ) : (
              <div className="rs-stamp no">No program<small>None on file for this part</small></div>
            )}
          </div>

          <div className="rs-band">Setup</div>
          <div className="rs-facts">
            <Fact label="Material" value={s.material} />
            <Fact label="Stock" value={s.stock} />
            <Fact label="How it's held" value={s.holding} wide />
            {p && <Fact label="Work offset" value={p.offsets.join(", ") || "None called. Uses whichever is active."} />}
            {p && <Fact label="Program" value={[p.number, `${p.lines} lines`].filter(Boolean).join(" · ")} />}
            {time && time.seconds > 0 && (
              <Fact
                label="Run time"
                value={`About ${fmtDuration(time.seconds)} a part${perRun > 1 ? `, ${fmtDuration(time.seconds * perRun)} for ${perRun}` : ""}${time.stops ? `, plus ${time.stops} stop${time.stops === 1 ? "" : "s"}` : ""} (estimate)`}
                wide
              />
            )}
          </div>

          {(s.machines.length ? s.machines : [{ key: "none", label: "", hasList: false, tools: s.tools || [] }]).map((m) => (
            m.tools.length > 0 && (
              <div key={m.key}>
                <div className="rs-band">Tools to load{m.label ? ` · ${m.label}` : ""}</div>
                <table className="rs-table">
                  <thead><tr><th>Pocket</th><th>The program expects</th><th>The tool list says</th></tr></thead>
                  <tbody>
                    {m.tools.map((t) => (
                      <tr key={t.t}>
                        <td>T{t.t}</td>
                        <td>{t.called || "(not named in the program)"}</td>
                        <td>{t.listed === null ? <span className="rs-flag">{m.hasList ? "NOT ON THE TOOL LIST" : "tool list not filled in"}</span> : t.listed || "(listed with no description)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ))}

          {p && p.stops.length > 0 && (
            <>
              <div className="rs-band">The program stops {p.stops.length} time{p.stops.length === 1 ? "" : "s"}</div>
              <ul className="rs-list dot">
                {p.stops.map((x) => (
                  <li key={x.line}>
                    Line {x.line}: {x.why || "no reason written in the program"}
                    {x.optional ? " (only when Optional Stop is on)" : ". Press Cycle Start to carry on."}
                  </li>
                ))}
              </ul>
            </>
          )}

          {s.steps.length > 0 && (
            <>
              <div className="rs-band">How to make it</div>
              <ol className="rs-list num">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </>
          )}

          {(s.byHand || s.problems || s.notes) && (
            <>
              <div className="rs-band">After the machine, and what to watch</div>
              <div className="rs-facts">
                <Fact label="By hand" value={s.byHand} wide />
                <Fact label="Watch for" value={s.problems} wide />
                <Fact label="Notes" value={s.notes} wide />
              </div>
            </>
          )}

          {p && !p.proven && (
            <div className="rs-warn">
              Not proven. Before a full run: run it in Graphics, then single block with the rapids turned down, then measure the first part.
            </div>
          )}

          {prog && (
            <>
              <div className="rs-band">What the program makes</div>
              <CncDrawing content={prog.content} kind={machineKind} stockText={part?.facts?.stock || ""} />
            </>
          )}

          {(s.drawing || s.photo) && (
            <>
              <div className="rs-band">Drawing</div>
              <div className="rs-pics">
                {s.drawing && <img src={s.drawing} alt="drawing" />}
                {s.photo && <img src={s.photo} alt="part" />}
              </div>
            </>
          )}

          <div className="rs-foot">Built from the CNC Catalog on {new Date().toLocaleDateString()}. If the machine and this sheet disagree, stop and ask.</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fact({ label, value, wide }) {
  if (!String(value || "").trim()) return null;
  return <div className={`rs-fact${wide ? " wide" : ""}`}><b>{label}</b><span>{value}</span></div>;
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
