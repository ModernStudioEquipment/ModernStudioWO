import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { Btn } from "../components/ui.jsx";
import { Wordmark } from "../components/Logo.jsx";
import { cleanMachineFacts } from "./cncPack.js";
import "./runSheet.css";

// A machine's tool list as one printed page, to tape up beside it: which tool
// is in which pocket, how the machine holds work, and what to know about it.
// It prints what's SAVED on the Machines page, so the paper and the programs
// are checked against the same list.
export default function CncToolSheet({ machine, facts, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const f = cleanMachineFacts(facts);
  const tools = f.tools.slice().sort((a, b) => Number(a.t) - Number(b.t));
  const about = [["Model", f.model], ["Holds work with", f.holding], ["Largest bar", f.maxBar], ["Live tools", f.liveTools], ["Notes", f.notes]].filter(([, v]) => v);

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={onClose}>
      <div className="wo-sheetwrap" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "96vw" }}>
        <div className="wo-toolbar flex gap-2 mb-2 items-center no-print">
          <span className="flex-1" />
          <Btn kind="brass" onClick={() => window.print()}><Printer size={15} />Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div id="wo" className="rs-sheet" aria-label={`Tool list for the ${machine.label}`}>
          <div className="rs-top">
            <div>
              <Wordmark height={34} variant="dark" subText="TOOL LIST" subAlign="left" />
              <h1 className="rs-title">{machine.label}</h1>
              <div className="rs-sub">{tools.length} tool{tools.length === 1 ? "" : "s"} listed · printed {new Date().toLocaleDateString()}</div>
            </div>
          </div>

          <div className="rs-band">What's in each pocket</div>
          {tools.length ? (
            <table className="rs-table">
              <thead><tr><th>Pocket</th><th>Tool</th><th style={{ width: "32%" }}>Changed? Write it here</th></tr></thead>
              <tbody>
                {tools.map((t, i) => <tr key={i}><td>T{Number(t.t) || t.t}</td><td>{t.what || "(no description)"}</td><td /></tr>)}
              </tbody>
            </table>
          ) : <p>No tools are listed for this machine yet.</p>}

          {about.length > 0 && (
            <>
              <div className="rs-band">About this machine</div>
              <div className="rs-facts">{about.map(([k, v]) => <div className="rs-fact wide" key={k}><b>{k}</b><span>{v}</span></div>)}</div>
            </>
          )}

          <div className="rs-warn">If a tool in a pocket is changed, change it on the Machines page too. Programs are checked against this list.</div>
          <div className="rs-foot">From the CNC Catalog. If the machine and this sheet disagree, the machine is right: fix the list.</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
