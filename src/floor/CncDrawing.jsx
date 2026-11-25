import { useMemo } from "react";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, simplifyOutline, outlinePoints } from "./cncSolid.js";

// A line drawing of what a program makes, for the run sheet. SVG rather than
// the 3D view on purpose: it prints sharp at any size, in black on white, and
// needs no graphics card.
//
//   lathe  the finished part from the side, with its centre line
//   mill   the cutting moves seen from above
//
// It's worked out from the program, so it shows what the program cuts, which
// is the point of putting it next to the setup.

const n4 = (v) => Number(v.toFixed(4)).toString();

export function drawingFor(content, { kind = "", stockText = "" } = {}) {
  const path = toolpath(content, { kind });
  if (!path.segs.length) return null;
  const unit = path.units === "mm" ? " mm" : "″";
  if (path.kind === "lathe") {
    const sim = simulateLathe(path, parseStock(stockText));
    if (!sim) return null;
    // the part only: from where cutting stops to the face (the rest is bar in the chuck)
    const from = sim.face - sim.length;
    const pts = simplifyOutline(outlinePoints(sim)).filter((p) => p[0] >= from - 1e-9);
    if (pts.length < 2) return null;
    const rs = pts.map((p) => p[1]).filter((r) => r > 1e-9);
    return {
      kind: "lathe", pts, from, face: sim.face,
      caption: `Cut length ${n4(sim.length)}${unit} · largest diameter ${n4(Math.max(...rs) * 2)}${unit} · smallest ${n4(Math.min(...rs) * 2)}${unit}`,
      rMax: Math.max(...rs),
    };
  }
  const cuts = path.segs.filter((s) => s.type !== "rapid");
  if (!cuts.length || !path.stats) return null;
  const st = path.stats;
  return {
    kind: "mill", cuts, x: st.x, y: st.y,
    caption: `Seen from above · X ${n4(st.x[0])} to ${n4(st.x[1])}${unit} · Y ${n4(st.y[0])} to ${n4(st.y[1])}${unit} · deepest Z${n4(st.zMin)}${unit}`,
  };
}

export default function CncDrawing({ content, kind = "", stockText = "", maxHeight = 220 }) {
  const d = useMemo(() => drawingFor(content, { kind, stockText }), [content, kind, stockText]);
  if (!d) return null;

  if (d.kind === "lathe") {
    const w = d.face - d.from;
    const h = d.rMax * 2;
    const pad = Math.max(w, h) * 0.06;
    // SVG's y runs down, so radius is flipped: the part's centre line is y = 0.
    const top = d.pts.map((p) => `${n4(p[0])},${n4(-p[1])}`);
    const bottom = d.pts.slice().reverse().map((p) => `${n4(p[0])},${n4(p[1])}`);
    const sw = Math.max(w, h) * 0.006;
    // every shoulder is a line across the part, the way a turned part is drawn
    const shoulders = [];
    for (let i = 1; i < d.pts.length; i++) {
      const a = d.pts[i - 1];
      const b = d.pts[i];
      // A real step in diameter, not one of the tiny steps a curve is made of.
      if (Math.abs(b[0] - a[0]) < w * 1e-3 && Math.abs(b[1] - a[1]) > d.rMax * 0.02) shoulders.push({ z: b[0], r: Math.max(a[1], b[1]) });
    }
    return (
      <figure className="rs-drawing">
        <svg viewBox={`${n4(d.from - pad)} ${n4(-d.rMax - pad)} ${n4(w + pad * 2)} ${n4(h + pad * 2)}`} style={{ maxHeight, width: "100%" }} role="img" aria-label="Drawing of the finished part from the side">
          <polygon points={[...top, ...bottom].join(" ")} fill="#ECEFF2" stroke="#111" strokeWidth={sw} strokeLinejoin="round" />
          {shoulders.map((p, i) => <line key={i} x1={n4(p.z)} x2={n4(p.z)} y1={n4(-p.r)} y2={n4(p.r)} stroke="#111" strokeWidth={sw * 0.6} />)}
          <line x1={d.from - pad * 0.6} x2={d.face + pad * 0.6} y1={0} y2={0} stroke="#555" strokeWidth={sw * 0.6} strokeDasharray={`${sw * 9} ${sw * 3} ${sw * 2} ${sw * 3}`} />
        </svg>
        <figcaption>{d.caption}. Chuck side on the left.</figcaption>
      </figure>
    );
  }

  const w = d.x[1] - d.x[0] || 1;
  const h = d.y[1] - d.y[0] || 1;
  const pad = Math.max(w, h) * 0.06;
  const sw = Math.max(w, h) * 0.005;
  return (
    <figure className="rs-drawing">
      <svg viewBox={`${n4(d.x[0] - pad)} ${n4(-d.y[1] - pad)} ${n4(w + pad * 2)} ${n4(h + pad * 2)}`} style={{ maxHeight, width: "100%" }} role="img" aria-label="Drawing of the cutting moves from above">
        <path d={d.cuts.map((s) => `M${n4(s.a[0])} ${n4(-s.a[1])}L${n4(s.b[0])} ${n4(-s.b[1])}`).join("")} fill="none" stroke="#111" strokeWidth={sw} strokeLinecap="round" />
        <path d={`M${n4(-pad * 0.5)} 0L${n4(pad * 0.5)} 0M0 ${n4(-pad * 0.5)}L0 ${n4(pad * 0.5)}`} stroke="#777" strokeWidth={sw * 0.7} />
      </svg>
      <figcaption>{d.caption}. The cross marks the program's zero.</figcaption>
    </figure>
  );
}
