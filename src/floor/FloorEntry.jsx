import { useEffect, useState } from "react";
import "./floor.css";
import { FLOOR_DEPTS, DEPT_ORDER, exitMonitor } from "./depts.js";
import FloorDisplay from "./FloorDisplay.jsx";

// Parse the department from the hash route, e.g. "#floor/cnc" -> "cnc".
function parseDept() {
  const m = (window.location.hash || "").match(/floor\/?([a-z]+)?/i);
  const key = m && m[1] ? m[1].toLowerCase() : null;
  return FLOOR_DEPTS[key] ? key : null;
}

export default function FloorEntry() {
  const [deptKey, setDeptKey] = useState(parseDept());
  useEffect(() => {
    const on = () => setDeptKey(parseDept());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (!deptKey) return <FloorPicker />;
  return <FloorDisplay deptKey={deptKey} />;
}

// Shown when the URL is just "#floor" with no department — pick a monitor.
function FloorPicker() {
  return (
    <div className="floor-picker">
      <button className="pk-exit" onClick={exitMonitor}>← Back to office</button>
      <div className="pk-brand">MODERN</div>
      <div className="pk-sub">Floor displays</div>
      <div className="pk-grid">
        {DEPT_ORDER.map((k) => {
          const d = FLOOR_DEPTS[k];
          return (
            <button
              key={k}
              className="pk-btn"
              style={{ "--a": d.accent }}
              onClick={() => {
                window.location.hash = `#floor/${k}`;
              }}
            >
              <span className="dot" />
              <span className="lbl">{d.label}</span>
              <span className="hint">Open the {d.label} monitor</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
