import { useEffect, useState } from "react";
import { db } from "../lib/db.js";
import CncChat from "./CncChat.jsx";
import { usePartPrograms } from "./usePartPrograms.js";
import "./cncLibrary.css";

// The assistant opened from a work order on the floor: the same conversation
// as on the part in the CNC Catalog, over the top of Floor Control.
export default function FloorAsk({ part, onClose }) {
  const [machineFacts, setMachineFacts] = useState({});
  const [parts, setParts] = useState([]);
  useEffect(() => {
    db.getMachineFacts?.().then((f) => setMachineFacts(f || {})).catch(() => {});
    db.getCncParts?.().then((p) => setParts(Array.isArray(p) ? p : [])).catch(() => {});
  }, []);
  const pp = usePartPrograms(part, machineFacts);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fcs-overlay fa-overlay" onClick={onClose}>
      <div className="cl-embed cl-editor fa-panel" role="dialog" aria-label={`Ask about ${part.name || "this part"}`} onClick={(e) => e.stopPropagation()}>
        <CncChat part={part} pp={pp} machineFacts={machineFacts} parts={parts} onClose={onClose} />
      </div>
    </div>
  );
}
