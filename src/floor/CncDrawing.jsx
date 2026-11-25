import { useMemo } from "react";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, simplifyOutline, outlinePoints, partSizes, sizeLabel, sizeText, zText } from "./cncSolid.js";

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
      sizes: partSizes(sim), units: path.units === "mm" ? "mm" : "in",
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
    // Sizes on the drawing. The text has to come out a readable size on paper
    // whatever the part's proportions, so work out how big one printed point is
    // in the drawing's own units (the sheet is about 660 px wide inside).
    const steps = d.sizes?.steps || [];
    const room = steps.length ? 62 : 0;                          // px kept for the labels, above and below
    const px = Math.max((w + pad * 2) / 660, (h + pad * 2) / Math.max(60, maxHeight - room));
    const fs = 11 * px;
    const topRoom = steps.length ? fs * 3.3 : 0;
    const botRoom = steps.length ? fs * 2.4 : 0;
    const textW = (t) => t.length * fs * 0.62;
    // one row above the part; a label that would run into its neighbour goes up a row, then is left to the list
    const placed = [];
    const labels = [];
    for (const st of steps.slice().sort((a, b) => (b.len ?? 0) - (a.len ?? 0))) {
      const text = sizeLabel(st, d.units).main;
      const tw = textW(text);
      const x = Math.min(d.face + pad - tw / 2, Math.max(d.from - pad + tw / 2, st.mid));
      for (let tier = 0; tier < 2; tier++) {
        const box = { x0: x - tw / 2 - fs * 0.3, x1: x + tw / 2 + fs * 0.3, tier };
        if (placed.some((q) => q.tier === tier && box.x0 < q.x1 && q.x0 < box.x1)) continue;
        placed.push(box);
        labels.push({ text, x, y: -d.rMax - pad * 0.4 - fs * 0.5 - tier * fs * 1.35, to: st });
        break;
      }
    }
    const dimY = d.rMax + pad * 0.4 + fs * 0.7;
    return (
      <figure className="rs-drawing">
        <svg viewBox={`${n4(d.from - pad)} ${n4(-d.rMax - pad - topRoom)} ${n4(w + pad * 2)} ${n4(h + pad * 2 + topRoom + botRoom)}`} style={{ maxHeight, width: "100%" }} role="img" aria-label="Drawing of the finished part from the side">
          <polygon points={[...top, ...bottom].join(" ")} fill="#ECEFF2" stroke="#111" strokeWidth={sw} strokeLinejoin="round" />
          {shoulders.map((p, i) => <line key={i} x1={n4(p.z)} x2={n4(p.z)} y1={n4(-p.r)} y2={n4(p.r)} stroke="#111" strokeWidth={sw * 0.6} />)}
          <line x1={d.from - pad * 0.6} x2={d.face + pad * 0.6} y1={0} y2={0} stroke="#555" strokeWidth={sw * 0.6} strokeDasharray={`${sw * 9} ${sw * 3} ${sw * 2} ${sw * 3}`} />
          {labels.map((l, i) => (
            <g key={`s${i}`}>
              <line x1={n4(l.to.mid)} x2={n4(l.to.mid)} y1={n4(-l.to.r)} y2={n4(l.y + fs * 0.25)} stroke="#111" strokeWidth={px * 0.7} />
              <circle cx={n4(l.to.mid)} cy={n4(-l.to.r)} r={n4(px * 1.6)} fill="#111" />
              {/* drawn at 11 and scaled down: a font size far below 1 doesn't set its letters properly */}
              <text transform={`translate(${n4(l.x)} ${n4(l.y)}) scale(${px})`} fontSize="11" fontWeight="700" textAnchor="middle" fill="#111" fontFamily="ui-monospace, Menlo, monospace">{l.text}</text>
            </g>
          ))}
          {steps.length > 0 && (
            <g stroke="#111" strokeWidth={px * 0.7}>
              <line x1={n4(d.from)} x2={n4(d.face)} y1={n4(dimY)} y2={n4(dimY)} />
              <line x1={n4(d.from)} x2={n4(d.from)} y1={n4(dimY - fs * 0.45)} y2={n4(dimY + fs * 0.45)} />
              <line x1={n4(d.face)} x2={n4(d.face)} y1={n4(dimY - fs * 0.45)} y2={n4(dimY + fs * 0.45)} />
              <text transform={`translate(${n4((d.from + d.face) / 2)} ${n4(dimY + fs * 1.25)}) scale(${px})`} fontSize="11" fontWeight="700" textAnchor="middle" fill="#111" stroke="none" fontFamily="ui-monospace, Menlo, monospace">{sizeText(d.sizes.length, d.units)} cut length</text>
            </g>
          )}
        </svg>
        <figcaption>{steps.length ? "Chuck side on the left." : `${d.caption}. Chuck side on the left.`}</figcaption>
        {steps.length > 0 && (
          <div className="rs-sizes">
            <b>Sizes the program cuts, from the face:</b>{" "}
            {steps.map((st) => { const t = sizeLabel(st, d.units); return `${t.main}${t.sub ? ` ${t.sub}` : ""} (${st.groove ? `at ${zText(st.mid, d.units)}` : `${zText(st.z1, d.units)} to ${zText(st.z0, d.units)}`})`; }).join("  \u2022  ")}
            <i>From the program, not the drawing. Measure the first part against the drawing.</i>
          </div>
        )}
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
