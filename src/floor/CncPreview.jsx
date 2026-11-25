import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut, AlertOctagon, Timer, SkipBack, SkipForward, CheckCircle2 } from "lucide-react";
import { toolpath, project, VIEWS } from "./cncPath.js";
import { simulateLathe, parseStock, partSizes, sizeLabel, sizeText, zText } from "./cncSolid.js";
import { simulateMill } from "./cncMill.js";
import { estimateTime, fmtDuration, playClock } from "./cncTime.js";

// What a program does, shown two ways that share one slider:
//
//   Part       the bar in the chuck, cut down move by move into the finished
//              part (lathe programs). Loaded on demand: it needs a 3D library.
//   Tool path  the line the tool follows. Works for every program, and is the
//              view that shows a move in the wrong place.
//
// Under both: a readout of where the tool is, about how long the program runs,
// and any rapid move that goes through the bar.
//
// None of it is a crash simulation. It doesn't know the fixture, the jaws or
// the size of the tools, and it says so on screen. Graphics on the Haas is
// still the check before a first run.

const CncSolid = lazy(() => import("./CncSolid.jsx"));
const CncMillSolid = lazy(() => import("./CncMillSolid.jsx"));

const SIZES_KEY = "mse_cnc_sizes_v1";
const TOOL_COLORS = ["#FFB224", "#4DA3FF", "#3DDC97", "#FF8A5C", "#C792EA", "#F5CE3A", "#5CD6D6", "#FF6B9D"];
const RAPID = "#6B7785";
const fmt = (n) => (Math.abs(n) < 0.00005 ? "0" : Number(n.toFixed(4)).toString());
const round3 = (n) => Number(n.toFixed(3)).toString();
const dro = (n) => `${n < 0 ? "-" : " "}${Math.abs(n).toFixed(4)}`;
const MOVE = { rapid: "Rapid", feed: "Cutting", profile: "Cutting", thread: "Threading", groove: "Grooving" };

export default function CncPreview({ content, kind = "", toolNames = {}, stockText = "", material = "", height = 400, compact = false }) {
  const path = useMemo(() => toolpath(content, { kind }), [content, kind]);
  const lineText = useMemo(() => String(content || "").replace(/\r\n?/g, "\n").split("\n"), [content]);
  const stock = useMemo(() => parseStock(stockText), [stockText]);
  const sim = useMemo(() => (path.kind === "lathe" ? simulateLathe(path, stock) : null), [path, stock]);
  // A mill part: the block, cut down by the tool. The tool sizes come from the
  // comments on the tool changes, so the names are part of what it depends on.
  const namesKey = JSON.stringify(toolNames);
  const mill = useMemo(() => (path.kind === "mill" ? simulateMill(path, { stockText, toolNames }) : null), [path, stockText, namesKey]);
  const solid = sim || mill;   // either way there's a "Part" view
  const time = useMemo(() => estimateTime(path), [path]);
  const total = path.segs.length;

  const [mode, setMode] = useState(solid ? "part" : "path");
  const [noGl, setNoGl] = useState(false);
  // Where the program has got to: moves done, with a fraction while it plays
  // (3.5 is half way along the fourth move). Everything that talks about "the
  // line it's on" uses the whole number; the picture uses all of it.
  const [pos, setPos] = useState(total);
  const upTo = Math.min(total, Math.floor(pos + 1e-9));
  const part = upTo < total ? Math.max(0, pos - upTo) : 0;
  const clock = useMemo(() => playClock(path), [path]);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [playing, setPlaying] = useState(false);
  const [showRapids, setShowRapids] = useState(true);
  const [showStock, setShowStock] = useState(true);
  const [showSizes, setShowSizes] = useState(() => { try { return localStorage.getItem(SIZES_KEY) === "1"; } catch { return false; } });
  const pickSizes = (on) => { setShowSizes(on); try { localStorage.setItem(SIZES_KEY, on ? "1" : "0"); } catch { /* it still works, it just isn't remembered */ } };
  // The finished part's sizes for the list, and the sizes of what's on screen
  // right now for the labels on the picture (the same thing at the end).
  const finished = useMemo(() => (showSizes && sim ? partSizes(sim) : null), [showSizes, sim]);
  const onScreen = useMemo(() => (!finished ? null : upTo >= total ? finished : partSizes(sim, upTo)), [finished, sim, upTo, total]);
  const views = VIEWS[path.kind] || VIEWS.mill;
  const [view, setView] = useState({ key: mode === "part" ? "3d" : views[0].key, nonce: 0 });

  // A new program: whole thing, best view for it. Done while rendering, not in
  // an effect, so the very first frame of the new program is already stopped at
  // the end. (As an effect, a playing program got one more tick in after the
  // switch and left the new part parked on some early line.)
  const [seen, setSeen] = useState({ path, hasSim: !!solid });
  if (seen.path !== path || seen.hasSim !== !!solid) {
    setSeen({ path, hasSim: !!solid });
    setPos(total);
    setPlaying(false);
    const m = solid && !noGl ? "part" : "path";
    setMode(m);
    setView({ key: m === "part" ? "3d" : (VIEWS[path.kind] || VIEWS.mill)[0].key, nonce: 0 });
  }

  const liveRef = useRef(null);            // the program that is playing right now, if one is
  liveRef.current = playing ? path : null;

  // ---- play through it ----
  useEffect(() => {
    if (!playing) return;
    // One step per screen refresh, by the clock: the tool travels along each
    // move at a steady pace instead of jumping to the end of it.
    let id = 0;
    let last = performance.now();
    let t = clock.timeOf(posRef.current);
    const tick = (now) => {
      // A tick already on its way when the program changed or was paused must
      // not move anything: React tidies this effect up a moment AFTER the
      // screen has changed, and a late tick would undo the change.
      if (liveRef.current !== path) return;
      t += Math.min(0.1, Math.max(0, (now - last) / 1000)); // a stalled tab picks up where it was, it doesn't leap ahead
      last = now;
      if (t >= clock.seconds) { setPos(total); setPlaying(false); return; }
      setPos(clock.posAt(t));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, clock, total, path]);

  if (!total) {
    return <div className="cp-note">Nothing to draw: this program has no moves the preview understands.</div>;
  }

  const moving = part > 0 ? path.segs[upTo] : null;                     // the move it's part way along, while playing
  const cur = moving || (upTo > 0 ? path.segs[Math.min(upTo, total) - 1] : null);
  const at = moving ? moving.a.map((v, i) => v + (moving.b[i] - v) * part) : cur?.b;
  const st = path.stats;
  const u = path.units === "mm" ? " mm" : path.units === "in" ? "″" : "";
  const lathe = path.kind === "lathe";
  const su = path.units === "mm" ? "mm" : "in";
  const hits = sim?.collisions || [];
  const pick = (m) => { setMode(m); setView({ key: m === "part" ? "3d" : (VIEWS[path.kind] || VIEWS.mill)[0].key, nonce: 0 }); };
  const jump = (n) => { setPlaying(false); setPos(Math.max(0, Math.min(total, Math.round(n)))); };

  return (
    <div className="pv">
      <div className="pv-bar">
        {solid && !noGl && (
          <div className="pv-views pv-modes" role="group" aria-label="What to show">
            <button className={mode === "part" ? "on" : ""} onClick={() => pick("part")}>Part</button>
            <button className={mode === "path" ? "on" : ""} onClick={() => pick("path")}>Tool path</button>
          </div>
        )}
        <div className="pv-views" role="group" aria-label="View">
          {views.map((v) => (
            <button key={v.key} className={view.key === v.key ? "on" : ""} onClick={() => setView((s) => ({ key: v.key, nonce: s.nonce + 1 }))}>{v.label}</button>
          ))}
        </div>
        {mode === "part"
          ? <>
              <label className="pv-check"><input type="checkbox" checked={showStock} onChange={(e) => setShowStock(e.target.checked)} /> {sim ? "Show the bar" : "Show the block"}</label>
              {sim && <label className="pv-check"><input type="checkbox" checked={showSizes} onChange={(e) => pickSizes(e.target.checked)} /> Show sizes</label>}
            </>
          : <label className="pv-check"><input type="checkbox" checked={showRapids} onChange={(e) => setShowRapids(e.target.checked)} /> Show rapid moves</label>}
      </div>

      <div className="pv-stage" style={{ height }}>
        {mode === "part" && mill ? (
          <Suspense fallback={<div className="pv-loading">Loading the 3D view…</div>}>
            <CncMillSolid
              mill={mill} upTo={pos} total={total} material={material}
              view={view.key} viewNonce={view.nonce} showStock={showStock} playing={playing}
              height={height} onFail={() => { setNoGl(true); setMode("path"); }}
            />
          </Suspense>
        ) : mode === "part" && sim ? (
          <Suspense fallback={<div className="pv-loading">Loading the 3D view…</div>}>
            <CncSolid
              sim={sim} upTo={pos} total={total} material={material}
              view={view.key} viewNonce={view.nonce} showStock={showStock} playing={playing}
              sizes={playing ? null : onScreen} units={path.units === "mm" ? "mm" : "in"}
              height={height} onFail={() => { setNoGl(true); setMode("path"); }}
            />
          </Suspense>
        ) : (
          <PathCanvas path={path} upTo={upTo} part={part} showRapids={showRapids} view={view} onTurn={() => setView((s) => (s.key ? { ...s, key: "" } : s))} height={height} />
        )}

        {/* where the tool is, like the position page on the machine */}
        {cur && (
          <div className={`pv-dro ${cur.type === "rapid" ? "rapid" : "cut"}`} aria-label="Tool position">
            <span className="t">T{cur.tool || "?"}</span>
            {lathe ? (
              <><span><i>X</i>{dro(at[2] * 2)}</span><span><i>Z</i>{dro(at[0])}</span></>
            ) : (
              <><span><i>X</i>{dro(at[0])}</span><span><i>Y</i>{dro(at[1])}</span><span><i>Z</i>{dro(at[2])}</span></>
            )}
            <span className="m">{upTo >= total ? "End" : MOVE[cur.type] || "Cutting"}</span>
          </div>
        )}
        <div className="pv-hint">{touchScreen() ? "Drag to turn · pinch to zoom" : "Drag to turn · scroll to zoom"}</div>
      </div>

      <div className="pv-scrub">
        <button className="pv-icon" onClick={() => jump(0)} aria-label="Back to the start"><SkipBack size={15} /></button>
        <button className="pv-icon pv-play" onClick={() => { if (pos >= total) setPos(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play the program"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="pv-icon" onClick={() => jump(total)} aria-label="Skip to the end"><SkipForward size={15} /></button>
        <input
          type="range" min={0} max={total} step="any" value={pos}
          onChange={(e) => jump(Number(e.target.value))}
          aria-label="Step through the program"
        />
        <span className="pv-pos">{upTo >= total ? "Whole program" : cur ? `Line ${cur.line}` : "Start"}</span>
      </div>
      {!compact && cur && upTo < total && (
        <div className="pv-line"><b>Line {cur.line}</b><code>{(lineText[cur.line - 1] || "").trim()}</code></div>
      )}

      {/* the same sizes in words: complete, where the picture only has room for some */}
      {mode === "part" && finished && (
        <div className="pv-sizes">
          <div className="pv-sizeshead">Sizes of the finished part <span>({path.units === "mm" ? "mm" : "inches"})</span></div>
          {finished.steps.length === 0 && <div className="pv-more">No straight diameter to measure in this program.</div>}
          {finished.steps.map((s, i) => {
            const t = sizeLabel(s, su);
            return (
              <div className="pv-size" key={i}>
                <b>{t.main}</b>
                <span>{t.sub}</span>
                <em>{s.groove ? `at ${zText(s.mid, su)}` : `${zText(s.z1, su)} to ${zText(s.z0, su)}`}</em>
              </div>
            );
          })}
          <div className="pv-size"><b>{sizeText(finished.length, su)}</b><span>cut length</span><em>{zText(finished.face, su)} to {zText(finished.from, su)}</em></div>
          <div className="pv-more">From the program, not the drawing. Measure the first part against the drawing.{sim.guessed ? " Bar size is a guess." : ""}</div>
        </div>
      )}

      {sim?.guessed && (
        <div className="pv-more pv-unchecked">Rapid moves aren't checked against the bar yet: the stock size isn't on this part. Add it in the part's setup and they will be.</div>
      )}
      {/* a rapid through the bar: the reason this view exists */}
      {hits.length > 0 && (
        <div className="pv-hits" role="alert">
          <div className="pv-hitshead"><AlertOctagon size={15} /> {hits.length === 1 ? (sim.unsure ? "A rapid move may go" : "A rapid move goes") : `${hits.length} rapid moves ${sim.unsure ? "may go" : "go"}`} through the bar</div>
          {sim.unsure && <div className="pv-more">Check these: {sim.unsure}.</div>}
          {hits.slice(0, 6).map((h) => (
            <button key={h.line} className="pv-hit" onClick={() => { if (sim && !noGl) setMode("part"); jump(h.index + 1); }}>
              <b>Line {h.line}</b>
              <span>{round3(h.depth)}{u} into the metal at Z{round3(h.z)}. <code>{(lineText[h.line - 1] || "").trim()}</code></span>
              <em>Show me</em>
            </button>
          ))}
          {hits.length > 6 && <div className="pv-more">and {hits.length - 6} more</div>}
        </div>
      )}

      {!compact && <div className="pv-legend">
        {path.tools.map((t) => (
          <span key={t}><i style={{ background: colorOf(path.tools, t) }} />T{t}{toolNames[t] ? ` ${toolNames[t]}` : ""}</span>
        ))}
        {mode === "path" && showRapids && <span><i className="dash" />Rapid (not cutting)</span>}
      </div>}

      {!compact && <div className="pv-stats">
        {time && time.seconds > 0 && (
          <span className="pv-time" title={timeBreakdown(time)}>
            <Timer size={13} /> About <b>{fmtDuration(time.seconds)}</b> a part
            {time.stops ? `, plus ${time.stops} stop${time.stops === 1 ? "" : "s"}` : ""}
            {time.unknown ? ", likely longer" : ""} (estimate)
          </span>
        )}
        {st && (lathe ? (
          <>
            <span>Cuts diameters <b>{fmt(Math.max(0, st.minDia))}{u}</b> to <b>{fmt(st.maxDia)}{u}</b></span>
            <span>from <b>Z{fmt(st.zMax)}</b> to <b>Z{fmt(st.zMin)}</b></span>
          </>
        ) : (
          <>
            <span>Cuts X <b>{fmt(st.x[0])}</b> to <b>{fmt(st.x[1])}{u}</b></span>
            <span>Y <b>{fmt(st.y[0])}</b> to <b>{fmt(st.y[1])}{u}</b></span>
            <span>deepest <b>Z{fmt(st.zMin)}{u}</b></span>
          </>
        ))}
      </div>}
      {!compact && lathe && sim && hits.length === 0 && !sim.guessed && <div className="cp-clean"><CheckCircle2 size={14} /> No rapid move goes through the bar.</div>}
      {!compact && <ul className="pv-notes">
        <li>A picture of what the program cuts. It can't see the jaws, the fixture or tool sizes, so still run it in Graphics first.</li>
        {(sim ? sim.notes : mill && mode === "part" ? mill.notes : []).concat(mode === "path" ? path.notes : path.notes.filter((n) => !/roughing/i.test(n))).map((n) => <li key={n}>{n}</li>)}
        {noGl && <li>This device can't show the 3D part, so the tool path is shown.</li>}
      </ul>}
    </div>
  );
}

const touchScreen = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const clampZoom = (z) => Math.max(0.2, Math.min(40, z));
const colorOf = (tools, t) => TOOL_COLORS[Math.max(0, tools.indexOf(t)) % TOOL_COLORS.length];
const timeBreakdown = (t) => Object.entries({ Cutting: t.parts.cutting, Roughing: t.parts.roughing, Threading: t.parts.threading, "Rapid moves": t.parts.rapids, "Tool changes": t.parts.toolChanges, Dwells: t.parts.dwell })
  .filter(([, v]) => v >= 0.5).map(([k, v]) => `${k}: ${fmtDuration(v)}`).join("\n");

// ---- the line drawing --------------------------------------------------------
function PathCanvas({ path, upTo, part = 0, showRapids, view, onTurn, height }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: height });
  const preset = (VIEWS[path.kind] || VIEWS.mill).find((v) => v.key === view.key);
  const [cam, setCam] = useState({ yaw: preset?.yaw ?? -30, pitch: preset?.pitch ?? 60, zoom: 1, panX: 0, panY: 0 });

  // a view button: snap to it and re-centre
  useEffect(() => {
    const v = (VIEWS[path.kind] || VIEWS.mill).find((x) => x.key === view.key);
    if (v) setCam((c) => ({ ...c, yaw: v.yaw, pitch: v.pitch, panX: 0, panY: 0, zoom: view.nonce ? c.zoom : 1 }));
  }, [view.key, view.nonce, path]);

  // The lathe profile spun round the Z axis: one ring where each program line
  // starts and ends, so the side view reads as a turned part.
  const rings = useMemo(() => {
    if (path.kind !== "lathe") return [];
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

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of extent) {
      const q = project(p, cam.yaw, cam.pitch);
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    }
    const pad = 28;
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((size.w - pad * 2) / spanX, (size.h - pad * 2) / spanY) * cam.zoom;
    const cx = size.w / 2 + cam.panX;
    const cy = size.h / 2 + cam.panY;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const S = (p) => { const q = project(p, cam.yaw, cam.pitch); return [cx + (q[0] - midX) * scale, cy - (q[1] - midY) * scale]; };
    const strokeBatch = (list, color, width, dash, alpha = 1) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const [a, b] of list) { const p = S(a); const q = S(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    };

    // everything done so far, and the move in hand only as far as the tool has got
    const soFar = path.segs.slice(0, upTo);
    const next = part > 0 ? path.segs[upTo] : null;
    if (next) soFar.push({ ...next, b: next.a.map((v, i) => v + (next.b[i] - v) * part) });

    if (path.kind === "lathe") {
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
      const mirror = soFar.filter((s) => s.type !== "rapid").map((s) => [[s.a[0], 0, -s.a[2]], [s.b[0], 0, -s.b[2]]]);
      strokeBatch(mirror, "#8FA3B8", 1.2, null, 0.45);
    } else {
      const len = Math.max(spanX, spanY) * 0.08;
      strokeBatch([[[0, 0, 0], [len, 0, 0]]], "#FF5C5C", 2);
      strokeBatch([[[0, 0, 0], [0, len, 0]]], "#3DDC97", 2);
      strokeBatch([[[0, 0, 0], [0, 0, len]]], "#4DA3FF", 2);
    }

    const shown = soFar;
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
    const last = shown[shown.length - 1];
    if (last && upTo < path.segs.length) {
      const p = S(last.b);
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }, [path, extent, rings, cam, upTo, part, showRapids, size]);

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
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (drag.current?.pinch) setCam((v) => ({ ...v, zoom: clampZoom(v.zoom * (d / drag.current.pinch)) }));
      if (drag.current) drag.current.pinch = d;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (d.pan) setCam((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else { setCam((v) => ({ ...v, yaw: v.yaw + dx * 0.5, pitch: Math.max(0, Math.min(180, v.pitch - dy * 0.5)) })); onTurn?.(); }
  };
  const onUp = (e) => { pointers.current.delete(e.pointerId); if (!pointers.current.size) drag.current = null; else if (drag.current) drag.current.pinch = null; };
  // The wheel must not scroll the page while it's zooming the drawing, which
  // needs a non-passive listener (React's onWheel can't cancel the scroll).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => { e.preventDefault(); setCam((v) => ({ ...v, zoom: clampZoom(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)) })); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wrapRef} style={{ height, width: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", touchAction: "none", cursor: "grab", display: "block" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={`Drawing of the tool path: ${path.stats ? `${path.stats.cuts} cutting moves` : "no cutting moves"}`}
      />
      <div className="pv-zoom">
        <button className="pv-icon" onClick={() => setCam((v) => ({ ...v, zoom: clampZoom(v.zoom * 1.25) }))} aria-label="Zoom in"><ZoomIn size={15} /></button>
        <button className="pv-icon" onClick={() => setCam((v) => ({ ...v, zoom: clampZoom(v.zoom / 1.25) }))} aria-label="Zoom out"><ZoomOut size={15} /></button>
        <button className="pv-icon" onClick={() => setCam((v) => ({ ...v, zoom: 1, panX: 0, panY: 0 }))} aria-label="Fit to the window"><RotateCcw size={15} /></button>
      </div>
    </div>
  );
}
