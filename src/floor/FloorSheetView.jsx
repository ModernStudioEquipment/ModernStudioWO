import { useEffect } from "react";
import { X, Flame } from "lucide-react";

// A work order, opened from a Floor Control card. Read-only by design: the
// floor asked to SEE the sheet, and was explicit that it must not be able to
// change it. Nothing here is an input. What it shows is decided in
// floorSheet.js, an allow-list, so customer details never reach this screen.
//
// When the part number matches a CNC Catalog part, the catalogue's own steps
// and blueprint come along — that's the "how to make it" the sheet points at.
export default function FloorSheetView({ sheet, part, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = [
    ["Qty", sheet.qty],
    ["Color", sheet.color],
    ["Part #", sheet.partNo],
    ["Due", sheet.dueDate],
    ["Bench", sheet.station],
  ].filter(([, v]) => v);
  const steps = sheet.steps.length ? sheet.steps : part?.steps || [];

  return (
    <div className="fcs-overlay" onClick={onClose}>
      <div className="fcs-sheet" role="dialog" aria-label={`Work order ${sheet.orderNo || ""}`} onClick={(e) => e.stopPropagation()}>
        <header className="fcs-head">
          <div>
            <div className="fcs-no">
              WO #{sheet.orderNo || "—"} · {sheet.dept}
              {sheet.rush && <span className="fcs-rush"><Flame size={12} /> Rush</span>}
            </div>
            <h2 className="fcs-title">{sheet.product}</h2>
          </div>
          <button className="fcs-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="fcs-body">
          {(sheet.image || part?.blueprintUrl || part?.photos?.length > 0) && (
            <div className="fcs-pics">
              {sheet.image && <img src={sheet.image} alt="product" />}
              {part?.blueprintUrl && <img src={part.blueprintUrl} alt="blueprint" />}
              {(part?.photos || []).map((u) => <img key={u} src={u} alt="part" />)}
            </div>
          )}

          {rows.length > 0 && (
            <dl className="fcs-facts">
              {rows.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}

          {sheet.lines.length > 0 && (
            <table className="fcs-lines">
              <thead><tr><th>What</th>{sheet.lines.some((l) => l.size) && <th>Size</th>}<th>Qty</th></tr></thead>
              <tbody>
                {sheet.lines.map((l, i) => (
                  <tr key={i}><td>{l.what || ""}</td>{sheet.lines.some((x) => x.size) && <td>{l.size || ""}</td>}<td>{l.qty || ""}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          {steps.length > 0 && (
            <div className="fcs-steps">
              <div className="fcs-lab">How to make it{!sheet.steps.length && part ? " · from the CNC Catalog" : ""}</div>
              <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
          {part?.material && <div className="fcs-note"><span className="fcs-lab">Material</span> {part.material}</div>}
          {part?.notes && <div className="fcs-note"><span className="fcs-lab">Catalog notes</span> {part.notes}</div>}

          <p className="fcs-ro">View only. Changes to this work order are made in the office.</p>
        </div>
      </div>
    </div>
  );
}
