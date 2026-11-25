import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { toolpath, project, VIEWS } from "./cncPath.js";

// A drawing of where a program takes the tool: drag to turn it, scroll or
// pinch to zoom, and step through it one move at a time with the slider.
//
// It's a drawing, not a simulation. It doesn't know the stock, the fixture or
// the size of the tools, so it can show a move in the wrong place but it can't
// promise a program is safe. Graphics on the Haas is still the check.

const TOOL_COLORS = ["#FFB224", "#4DA3FF", "#3DDC97", "#FF8A5C", "#C792EA", "#F5CE3A", "#5CD6D6", "#FF6B9D"];
const RAPID = "#6B7785";
const fmt = (n) => (Math.abs(n) < 0.00005 ? "0" : Number(n.toFixed(4)).toString());

export default function CncPreview({ content, kind = "", toolNames = {}, height = 380 }) {
  const path = useMemo(() => toolpath(content, { kind }), [content, kind]);
  const lineText = useMemo(() => String(content || "").replace(/\r\n?/g, "\n").split("\n"), [content]);
  const views = VIEWS[path.kind] || VIEWS.mill;
  const [view, setView] = useState({ yaw: views[0].yaw, pitch: views[0].pitch, zoom: 1, panX: 0, panY: 0, key: views[0].key });
  const [upTo, setUpTo] = useState(path.segs.length);
  const [showRapids, setShowRapids] = useState(true);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: height });

  // A new program: show all of it, from its first view.
  useEffect(() => {
    setUpTo(path.segs.length);
    setPlaying(false);
    setView({ yaw: views[0].yaw, pitch: views[0].pitch, zoom: 1, panX: 0, panY: 0, key: views[0].key });
  }, [path]);

  // The lathe profile spun round the Z axis: a ring at each corner of what's
  // cut, so the side view reads as a turned part and the 3D view has a body.
  const rings = useMemo(() => {
    if (path.kind !== "lathe") return [];
    // One ring where each program line starts and ends. An arc is many short
    // segments from one line; a ring at every one of them piles up into a blur.
    const seen = new Map();
    const cut = path.segs.filter((s) => s.type !== "rapid");
    cut.forEach((s, i) => {
      const ends = [];
      if (i === 0 || cut[i - 1].line !== s.line) ends.push(s.a);
      if (i === cut.length - 1 || cut[i + 1].line !== s.line) ends.push(s.b);
      for (const p of ends) { const k = `${p[0].toFixed(4)}|${p[2].toFixed(4)}`; if (p[2] > 1e-6 && !seen.has(k)) seen.set(k, p); }
    });
    const all = [...seen.values()];
    const step = Math.max(1, Math.ceil(all.length / 70));
    return all.filter((_, i) => i % step === 0);
  }, [path]);

  // Everything that gets drawn, so the picture is fitted to all of it.
  const extent = useMemo(() => {
    const pts = [];
    for (const s of path.segs) { pts.push(s.a, s.b); if (path.kind === "lathe") pts.push([s.a[0], 0, -s.a[2]], [s.b[0], 0, -s.b[2]]); }
    for (const r of rings) pts.push([r[0], r[2], 0], [r[0], -r[2], 0]);
    return pts;
  }, [path, rings]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(240, el.clientWidth), h: height });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // ---- drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#07090C";
    ctx.fillRect(0, 0, size.w, size.h);
    if (!path.segs.length) return;

    // fit to the canvas, then the user's zoom and pan on top
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of extent) {
      const q = project(p, view.yaw, view.pitch);
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    }
    const pad = 28;
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((size.w - pad * 2) / spanX, (size.h - pad * 2) / spanY) * view.zoom;
    const cx = size.w / 2 + view.panX;
    const cy = size.h / 2 + view.panY;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const S = (p) => { const q = project(p, view.yaw, view.pitch); return [cx + (q[0] - midX) * scale, cy - (q[1] - midY) * scale]; };
    const strokeBatch = (list, color, width, dash, alpha = 1) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const [a, b] of list) { const p = S(a); const q = S(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    };

    if (path.kind === "lathe") {
      // centre line, then the turned shape (rings + the mirrored half), faint
      const b = path.bounds;
      strokeBatch([[[b.min[0], 0, 0], [b.max[0], 0, 0]]], "#3A4450", 1, [6, 5]);
      const ringLines = [];
      for (const r of rings) {
        let prev = null;
        for (let i = 0; i <= 36; i++) {
          const t = (i / 36) * Math.PI * 2;
          const p = [r[0], r[2] * Math.sin(t), r[2] * Math.cos(t)];
          if (prev) ringLines.push([prev, p]);
          prev = p;
        }
      }
      strokeBatch(ringLines, "#8FA3B8", 1, null, 0.22);
      const mirror = path.segs.slice(0, upTo).filter((s) => s.type !== "rapid").map((s) => [[s.a[0], 0, -s.a[2]], [s.b[0], 0, -s.b[2]]]);
      strokeBatch(mirror, "#8FA3B8", 1.2, null, 0.45);
    } else {
      // the three axes at the part's zero
      const len = Math.max(spanX, spanY) * 0.08;
      strokeBatch([[[0, 0, 0], [len, 0, 0]]], "#FF5C5C", 2);
      strokeBatch([[[0, 0, 0], [0, len, 0]]], "#3DDC97", 2);
      strokeBatch([[[0, 0, 0], [0, 0, len]]], "#4DA3FF", 2);
    }

    // the path so far: rapids dashed and grey, cuts in the tool's colour
    const shown = path.segs.slice(0, upTo);
    if (showRapids) strokeBatch(shown.filter((s) => s.type === "rapid").map((s) => [s.a, s.b]), RAPID, 1, [4, 4], 0.9);
    const byTool = new Map();
    for (const s of shown) {
      if (s.type === "rapid") continue;
      const key = `${s.tool}|${s.type}`;
      if (!byTool.has(key)) byTool.set(key, []);
      byTool.get(key).push([s.a, s.b]);
    }
    for (const [key, list] of byTool) {
      const [tool, type] = key.split("|");
      strokeBatch(list, colorOf(path.tools, Number(tool)), type === "thread" ? 2.4 : 1.8, type === "thread" ? [2, 3] : null);
    }
    // where the tool is now
    const last = shown[shown.length - 1];
    if (last && upTo < path.segs.length) {
      const p = S(last.b);
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }, [path, extent, rings, view, upTo, showRapids, size]);

  // ---- play through it ----
  useEffect(() => {
    if (!playing) return;
    const total = path.segs.length;
    const step = Math.max(1, Math.round(total / 240)); // the whole program in about 8 seconds
    const id = setInterval(() => setUpTo((n) => { if (n >= total) { setPlaying(false); return total; } return Math.min(total, n + step); }), 33);
    return () => clearInterval(id);
  }, [playing, path]);

  // ---- turning, panning, zooming ----
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    drag.current = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 || e.button === 2, pinch: null };
  };
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) { // two fingers: pinch to zoom
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (drag.current?.pinch) setView((v) => ({ ...v, zoom: clampZoom(v.zoom * (d / drag.current.pinch)) }));
      if (drag.current) drag.current.pinch = d;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (d.pan) setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else setView((v) => ({ ...v, key: "", yaw: v.yaw + dx * 0.5, pitch: Math.max(0, Math.min(180, v.pitch - dy * 0.5)) }));
  };
  const onUp = (e) => { pointers.current.delete(e.pointerId); if (!pointers.current.size) drag.current = null; else if (drag.current) drag.current.pinch = null; };
  // The wheel must not scroll the page while it's zooming the drawing, which
  // needs a non-passive listener (React's onWheel can't cancel the scroll).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => { e.preventDefault(); setView((v) => ({ ...v, zoom: clampZoom(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)) })); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (!path.segs.length) {
    return <div className="cp-note">Nothing to draw: this program has no moves the preview understands.</div>;
  }

  const touch = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const cur = upTo > 0 ? path.segs[Math.min(upTo, path.segs.length) - 1] : null;
  const st = path.stats;
  const u = path.units === "mm" ? " mm" : path.units === "in" ? "″" : "";

  return (
    <div className="pv">
      <div className="pv-bar">
        <div className="pv-views" role="group" aria-label="View">
          {views.map((v) => (
            <button key={v.key} className={view.key === v.key ? "on" : ""} onClick={() => setView((s) => ({ ...s, key: v.key, yaw: v.yaw, pitch: v.pitch, panX: 0, panY: 0 }))}>{v.label}</button>
          ))}
        </div>
        <button className="pv-icon" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom * 1.25) }))} aria-label="Zoom in"><ZoomIn size={15} /></button>
        <button className="pv-icon" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom / 1.25) }))} aria-label="Zoom out"><ZoomOut size={15} /></button>
        <button className="pv-icon" onClick={() => setView((v) => ({ ...v, zoom: 1, panX: 0, panY: 0 }))} aria-label="Fit to the window"><RotateCcw size={15} /></button>
        <label className="pv-check"><input type="checkbox" checked={showRapids} onChange={(e) => setShowRapids(e.target.checked)} /> Show rapid moves</label>
      </div>

      <div ref={wrapRef} className="pv-stage" style={{ height }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", touchAction: "none", cursor: "grab", display: "block" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          role="img"
          aria-label={`Drawing of the tool path: ${st ? `${st.cuts} cutting moves` : "no cutting moves"}`}
        />
        <div className="pv-hint">{touch ? "Drag to turn · pinch to zoom" : "Drag to turn · Shift-drag to move · scroll to zoom"}</div>
      </div>

      <div className="pv-scrub">
        <button className="pv-icon" onClick={() => { if (upTo >= path.segs.length) setUpTo(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play the program"}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input
          type="range" min={0} max={path.segs.length} value={upTo}
          onChange={(e) => { setPlaying(false); setUpTo(Number(e.target.value)); }}
          aria-label="Step through the program"
        />
        <span className="pv-pos">{upTo >= path.segs.length ? "Whole program" : cur ? `Line ${cur.line}` : "Start"}</span>
      </div>
      {cur && upTo < path.segs.length && (
        <div className="pv-line"><b>Line {cur.line}</b><code>{(lineText[cur.line - 1] || "").trim()}</code></div>
      )}

      <div className="pv-legend">
        {path.tools.map((t) => (
          <span key={t}><i style={{ background: colorOf(path.tools, t) }} />T{t}{toolNames[t] ? ` ${toolNames[t]}` : ""}</span>
        ))}
        {showRapids && <span><i className="dash" />Rapid (not cutting)</span>}
      </div>

      {st && (
        <div className="pv-stats">
          {st.kind === "lathe" ? (
            <>
              <span>The tool cuts from diameter <b>{fmt(Math.max(0, st.minDia))}{u}</b> out to <b>{fmt(st.maxDia)}{u}</b></span>
              <span>Along the part <b>Z{fmt(st.zMin)}</b> to <b>Z{fmt(st.zMax)}</b></span>
            </>
          ) : (
            <>
              <span>Cuts span X <b>{fmt(st.x[0])}</b> to <b>{fmt(st.x[1])}{u}</b></span>
              <span>Y <b>{fmt(st.y[0])}</b> to <b>{fmt(st.y[1])}{u}</b></span>
              <span>Deepest <b>Z{fmt(st.zMin)}{u}</b></span>
            </>
          )}
          <span>{st.cuts} cutting move{st.cuts === 1 ? "" : "s"}</span>
        </div>
      )}
      <ul className="pv-notes">
        <li>This is a drawing of the tool path. It can't see the stock, the fixture or tool sizes, so check these numbers against the part and still run it in Graphics on the machine.</li>
        {path.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}

const clampZoom = (z) => Math.max(0.2, Math.min(40, z));
const colorOf = (tools, t) => TOOL_COLORS[Math.max(0, tools.indexOf(t)) % TOOL_COLORS.length];
