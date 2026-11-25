import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { outlinePoints, simplifyOutline, metalFor, sizeLabel, sizeText } from "./cncSolid.js";

// The turned part as a real solid: the bar held in a chuck, cut down as the
// program plays, with the tool where the program has it. All the working-out
// is in cncSolid.js; this file only puts it on screen.
//
// It loads on demand (three.js is big), so nothing here costs the rest of the
// app anything until someone opens a preview.
//
// World axes: the bar lies along X (the program's Z), radius goes up in Y. The
// tool comes down from above, the way it does on a rear-turret Haas.

const SEGMENTS = 88;

export default function CncSolid({ sim, upTo, total, material = "", view = "3d", viewNonce = 0, showStock = true, playing = false, sizes = null, units = "in", onFail, height = 420 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const api = useRef(null);
  const dimsRef = useRef(null);   // the size labels, laid over the picture
  const sizesRef = useRef(sizes); // what they say, for the drawing loop to read
  sizesRef.current = sizes;
  const [glReady, setGlReady] = useState(0); // bumps when the renderer exists, so the scene builds after it

  const gl = useRef(null); // the renderer and its reflections: made once per canvas

  // ---- the renderer: once, for as long as the canvas is on the page ----
  //
  // Kept apart from the scene on purpose. The scene is rebuilt whenever the
  // part changes (someone edits the stock size), and rebuilding must not throw
  // the graphics context away: a canvas only ever gets one, and a new renderer
  // on a canvas whose context was destroyed has nothing to draw with.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const lost = (e) => { e.preventDefault(); onFail?.(); };
    canvas.addEventListener("webglcontextlost", lost);
    gl.current = { renderer, envMap };
    setGlReady((n) => n + 1);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      gl.current = null;
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      // Give the context back only once the canvas has really left the page
      // (not on React's development re-run of this effect, where it's reused).
      setTimeout(() => { if (!canvas.isConnected) renderer.forceContextLoss?.(); }, 0);
    };
  }, []);

  // ---- build the scene once per part ----
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !sim || !gl.current) return;
    const { renderer, envMap } = gl.current;

    const scene = new THREE.Scene();
    scene.background = backdrop();
    scene.environment = envMap;

    // sizes all hang off the bar, so a 1/4 inch pin and a 3 inch bar both fill the view
    const R = sim.stockR;
    const L = sim.face - sim.back;
    const mid = (sim.face + sim.back) / 2;
    const metal = metalFor(material);
    const disposables = [scene.background];
    const own = (x) => { disposables.push(x); return x; };

    // the part: rebuilt as the program steps
    const partMat = own(new THREE.MeshStandardMaterial({
      color: metal.color, metalness: metal.plastic ? 0 : 1, roughness: metal.rough, envMapIntensity: 1.15,
    }));
    const part = new THREE.Mesh(new THREE.BufferGeometry(), partMat);
    part.rotation.z = -Math.PI / 2; // the lathe's axis (Y in LatheGeometry) lies along world X
    part.castShadow = true;
    part.receiveShadow = true;

    // the bar as it started, faint, so what's been cut away can be seen
    const stock = new THREE.Mesh(
      own(new THREE.CylinderGeometry(R, R, L, 48, 1, true)),
      own(new THREE.MeshBasicMaterial({ color: "#7FB2FF", transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })),
    );
    stock.rotation.z = -Math.PI / 2;
    stock.position.x = mid;
    const stockEdges = new THREE.LineSegments(
      own(new THREE.EdgesGeometry(new THREE.CylinderGeometry(R, R, L, 48, 1, true), 60)),
      own(new THREE.LineBasicMaterial({ color: "#7FB2FF", transparent: true, opacity: 0.28 })),
    );
    stockEdges.rotation.z = -Math.PI / 2;
    stockEdges.position.x = mid;

    // the chuck: a body and three jaws gripping the uncut end of the bar
    const spin = new THREE.Group();
    const chuckR = Math.min(R * 2.5, Math.max(R * 1.7, L * 0.7));
    const bodyLen = chuckR * 0.5;
    const jawLen = Math.min((sim.face - sim.length - sim.back) * 0.75, R * 1.1);
    const dark = own(new THREE.MeshStandardMaterial({ color: "#59636F", metalness: 1, roughness: 0.4, envMapIntensity: 0.9 }));
    const plateMat = own(new THREE.MeshStandardMaterial({ color: "#7A8693", metalness: 1, roughness: 0.3, envMapIntensity: 1 }));
    const jawMat = own(new THREE.MeshStandardMaterial({ color: "#8B97A4", metalness: 1, roughness: 0.32, envMapIntensity: 1 }));
    const body = new THREE.Mesh(own(new THREE.CylinderGeometry(chuckR, chuckR, bodyLen, 64)), dark);
    body.rotation.z = -Math.PI / 2;
    body.position.x = sim.back - bodyLen / 2 - bodyLen * 0.08;
    body.castShadow = true; body.receiveShadow = true;
    const plate = new THREE.Mesh(own(new THREE.CylinderGeometry(chuckR * 0.94, chuckR * 0.97, bodyLen * 0.16, 64)), plateMat);
    plate.rotation.z = -Math.PI / 2;
    plate.position.x = sim.back - bodyLen * 0.08;
    plate.receiveShadow = true;
    spin.add(body, plate);
    // each jaw is a base and a narrower step on top of it, like a real hard jaw
    const jawH = chuckR * 0.86 - R;
    const baseGeo = own(new THREE.BoxGeometry(jawLen, jawH, R * 0.95));
    const stepGeo = own(new THREE.BoxGeometry(jawLen * 0.55, jawH * 0.55, R * 0.95));
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      const base = new THREE.Mesh(baseGeo, jawMat);
      base.position.set(sim.back + jawLen / 2, R + jawH / 2, 0);
      const stepUp = new THREE.Mesh(stepGeo, jawMat);
      stepUp.position.set(sim.back + jawLen + jawLen * 0.275, R + jawH * 0.725, 0);
      base.castShadow = true; stepUp.castShadow = true;
      holder.add(base, stepUp);
      holder.rotation.x = (i * Math.PI * 2) / 3 + Math.PI / 2;
      spin.add(holder);
    }
    spin.add(part);
    scene.add(spin, stock, stockEdges);

    // the tool: an insert on a shank, tip at the group's origin, coming from above
    const tool = new THREE.Group();
    const tipSize = Math.max(R * 0.46, L * 0.045);
    const insertMat = own(new THREE.MeshStandardMaterial({ color: "#E0A82E", metalness: 0.85, roughness: 0.28, emissive: "#3A2600", emissiveIntensity: 0.6 }));
    const shankMat = own(new THREE.MeshStandardMaterial({ color: "#39414B", metalness: 0.9, roughness: 0.45 }));
    const shapes = {};
    const diamond = new THREE.Shape();           // an 80 degree turning insert, nose down
    diamond.moveTo(0, 0); diamond.lineTo(tipSize * 0.64, tipSize * 0.77); diamond.lineTo(0, tipSize * 1.54); diamond.lineTo(-tipSize * 0.64, tipSize * 0.77); diamond.closePath();
    const tri = new THREE.Shape();               // a threading insert: a 60 degree point
    tri.moveTo(0, 0); tri.lineTo(tipSize * 0.58, tipSize); tri.lineTo(-tipSize * 0.58, tipSize); tri.closePath();
    const blade = new THREE.Shape();             // a grooving blade
    blade.moveTo(-tipSize * 0.14, 0); blade.lineTo(tipSize * 0.14, 0); blade.lineTo(tipSize * 0.14, tipSize * 1.4); blade.lineTo(-tipSize * 0.14, tipSize * 1.4); blade.closePath();
    for (const [key, shape] of [["turn", diamond], ["thread", tri], ["groove", blade]]) {
      const m = new THREE.Mesh(own(new THREE.ExtrudeGeometry(shape, { depth: tipSize * 0.3, bevelEnabled: false })), insertMat);
      m.position.z = -tipSize * 0.15;
      m.castShadow = true;
      m.visible = false;
      shapes[key] = m;
      tool.add(m);
    }
    const shank = new THREE.Mesh(own(new THREE.BoxGeometry(tipSize * 1.25, tipSize * 3.4, tipSize * 0.9)), shankMat);
    shank.position.set(tipSize * 0.15, tipSize * 1.3 + tipSize * 1.7, 0);
    shank.castShadow = true;
    tool.add(shank);
    const glow = new THREE.PointLight("#FFB24D", 0, R * 6, 2);   // lights up while it's cutting
    glow.position.set(0, tipSize * 0.1, tipSize * 0.5);
    tool.add(glow);
    scene.add(tool);

    // where a rapid goes through the bar: a red marker on the spot
    // Drawn on top of everything (no depth test): the point of it is to be seen
    // even where it's buried in the bar.
    const hitMat = own(new THREE.MeshBasicMaterial({ color: "#FF3B3B", transparent: true, opacity: 0.95, depthTest: false }));
    const hitGeo = own(new THREE.SphereGeometry(Math.max(R * 0.1, L * 0.016), 24, 16));
    const moveR = Math.max(R * 0.028, L * 0.005);
    for (const c of sim.collisions) {
      const dot = new THREE.Mesh(hitGeo, hitMat);
      dot.position.set(c.z, c.r, 0);
      dot.renderOrder = 10;
      scene.add(dot);
      const ring = new THREE.Mesh(own(new THREE.TorusGeometry(Math.max(c.r, R * 0.1), moveR * 1.2, 10, 72)), hitMat);   // a band round the bar at that point
      ring.rotation.y = Math.PI / 2;
      ring.position.x = c.z;
      ring.renderOrder = 10;
      scene.add(ring);
      // the move itself, as a red rod from where it starts to where it ends
      const a = new THREE.Vector3(c.from[0], c.from[1], 0);
      const b = new THREE.Vector3(c.to[0], c.to[1], 0);
      const len = a.distanceTo(b);
      if (len > 1e-9) {
        const rod = new THREE.Mesh(own(new THREE.CylinderGeometry(moveR, moveR, len, 10)), hitMat);
        rod.position.copy(a).add(b).multiplyScalar(0.5);
        rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        rod.renderOrder = 10;
        scene.add(rod);
      }
    }

    // chips: a spray of hot specks from the tool while the program is playing
    const CHIPS = 90;
    const chipPos = new Float32Array(CHIPS * 3);
    const chipVel = new Float32Array(CHIPS * 3);
    const chipLife = new Float32Array(CHIPS);
    const chipGeo = own(new THREE.BufferGeometry());
    chipGeo.setAttribute("position", new THREE.BufferAttribute(chipPos, 3));
    const chips = new THREE.Points(chipGeo, own(new THREE.PointsMaterial({ color: "#FFC56B", size: Math.max(R * 0.06, L * 0.008), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })));
    chips.frustumCulled = false;
    chips.visible = false;
    scene.add(chips);
    let chipNext = 0;
    let cutting = false;
    const chipTick = (dt, on) => {
      chips.visible = on;
      if (!on) return;
      if (cutting) {
        for (let k = 0; k < 3; k++) { // a few new ones each frame, thrown up and toward the viewer
          const i = chipNext; chipNext = (chipNext + 1) % CHIPS;
          chipPos[i * 3] = tool.position.x; chipPos[i * 3 + 1] = tool.position.y; chipPos[i * 3 + 2] = 0;
          chipVel[i * 3] = (Math.random() * 1.6 + 0.2) * R; chipVel[i * 3 + 1] = (Math.random() * 2.2 + 0.6) * R; chipVel[i * 3 + 2] = (Math.random() * 3 + 0.8) * R;
          chipLife[i] = 0.5 + Math.random() * 0.4;
        }
      }
      for (let i = 0; i < CHIPS; i++) {
        if (chipLife[i] <= 0) { chipPos[i * 3 + 1] = -1e6; continue; } // spent: parked out of sight
        chipLife[i] -= dt;
        chipVel[i * 3 + 1] -= 9 * R * dt;
        chipPos[i * 3] += chipVel[i * 3] * dt; chipPos[i * 3 + 1] += chipVel[i * 3 + 1] * dt; chipPos[i * 3 + 2] += chipVel[i * 3 + 2] * dt;
      }
      chipGeo.attributes.position.needsUpdate = true;
    };

    // light and a floor to sit on
    scene.add(new THREE.HemisphereLight("#E6EEFF", "#1A2230", 0.95));
    const key = new THREE.DirectionalLight("#FFFFFF", 3.1);
    const reach = Math.max(L, chuckR * 2) * 1.4;
    key.position.set(mid + reach * 0.5, reach * 1.2, reach * 0.9);
    key.target.position.set(mid, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach;
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach;
    key.shadow.camera.near = 0.01; key.shadow.camera.far = reach * 5;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight("#7FB2FF", 1.5);
    rim.position.set(mid - reach, reach * 0.4, -reach);
    scene.add(rim);
    const floorY = -chuckR * 1.08;
    const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(reach * 8, reach * 8)), own(new THREE.ShadowMaterial({ opacity: 0.42 })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(mid, floorY, 0);
    floor.receiveShadow = true;
    scene.add(floor);
    const cell = niceStep(reach / 6);
    const grid = new THREE.GridHelper(cell * 40, 40, "#2B4C6F", "#17212C");
    grid.position.set(Math.round(mid / cell) * cell, floorY + 1e-4 * reach, 0);
    grid.material.transparent = true;
    grid.material.opacity = 0.75;
    disposables.push(grid.geometry, grid.material);
    scene.add(grid);

    // camera
    const camera = new THREE.PerspectiveCamera(30, 1, reach / 200, reach * 60);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    // Look at the part: from the face back to a little past the jaws.
    const lookX = (sim.face + (sim.back + jawLen)) / 2;
    controls.target.set(lookX, 0, 0);
    controls.minDistance = reach * 0.25;
    controls.maxDistance = reach * 14;
    controls.maxPolarAngle = Math.PI * 0.93;
    const fitRadius = Math.hypot((sim.face - sim.back) / 2 + jawLen * 0.6, chuckR * 0.9);
    const setView = (v) => {
      // A narrow screen sees less from side to side, so it stands further back.
      const d = (fitRadius / Math.sin((camera.fov * Math.PI) / 360)) * Math.max(1, 1.3 / camera.aspect) * 0.92;
      const dir = v === "side" ? new THREE.Vector3(0, 0.0001, 1) : v === "end" ? new THREE.Vector3(1, 0.12, 0.0001) : new THREE.Vector3(0.62, 0.42, 0.78);
      camera.position.copy(dir.normalize().multiplyScalar(d)).add(new THREE.Vector3(lookX, 0, 0));
      controls.target.set(lookX, 0, 0);
      controls.update();
    };

    // ---- the size labels ----
    //
    // Plain page elements over the picture, moved to follow the part each time
    // it's drawn. One row above the part, each with a line down to the surface
    // it measures. Where two would sit on top of each other the shorter length
    // moves up a row, and past three rows it's left to the list underneath.
    const v3 = new THREE.Vector3();
    const placeSizes = () => {
      const box = dimsRef.current;
      const sz = sizesRef.current;
      if (!box || !sz) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const P = (x, y) => { v3.set(x, y, 0).project(camera); return { x: (v3.x * 0.5 + 0.5) * w, y: (-v3.y * 0.5 + 0.5) * h, ok: v3.z > -1 && v3.z < 1 }; };
      const els = [...box.querySelectorAll(".pv-dim[data-i]")];
      const leads = box.querySelectorAll("line[data-i]");
      const dots = box.querySelectorAll("circle[data-i]");
      // measure everything first, then move everything: no layout in between
      const items = els.map((el, i) => ({ el, i, w: el.offsetWidth, h: el.offsetHeight, s: sz.steps[i], a: sz.steps[i] ? P(sz.steps[i].mid, sz.steps[i].r) : null }));
      const lenEl = box.querySelector(".pv-dim.len");
      const lenW = lenEl ? lenEl.offsetWidth : 0;
      const rowY = Math.min(...items.filter((it) => it.a?.ok).map((it) => it.a.y), h) - 18;
      const placed = [];
      const hits = (r) => placed.some((q) => r.x < q.x + q.w + 4 && q.x < r.x + r.w + 4 && r.y < q.y + q.h + 3 && q.y < r.y + r.h + 3);
      for (const it of items.slice().sort((p, q) => (q.s?.len ?? 0) - (p.s?.len ?? 0))) {
        let spot = null;
        if (it.a?.ok && it.a.x > 4 && it.a.x < w - 4 && it.a.y > 0 && it.a.y < h) {
          for (let tier = 0; tier < 3 && !spot; tier++) {
            const r = { x: Math.min(w - it.w - 6, Math.max(6, it.a.x - it.w / 2)), y: rowY - it.h - tier * (it.h + 7), w: it.w, h: it.h };
            if (r.y >= 6 && !hits(r)) spot = r;
          }
        }
        const lead = leads[it.i];
        const dot = dots[it.i];
        if (!spot) { it.el.style.visibility = "hidden"; lead?.setAttribute("visibility", "hidden"); dot?.setAttribute("visibility", "hidden"); continue; }
        placed.push(spot);
        it.el.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
        it.el.style.visibility = "visible";
        if (lead) { lead.setAttribute("x1", it.a.x); lead.setAttribute("y1", it.a.y); lead.setAttribute("x2", Math.min(spot.x + spot.w - 8, Math.max(spot.x + 8, it.a.x))); lead.setAttribute("y2", spot.y + spot.h); lead.setAttribute("visibility", "visible"); }
        if (dot) { dot.setAttribute("cx", it.a.x); dot.setAttribute("cy", it.a.y); dot.setAttribute("visibility", "visible"); }
      }
      // the cut length: a line under the part from the face to where cutting stops
      const under = Math.max(...sz.steps.map((s) => s.r), R * 0.4);
      const set = (key, a, b, show) => {
        const ln = box.querySelector(`line[data-o="${key}"]`);
        if (!ln) return;
        ln.setAttribute("visibility", show ? "visible" : "hidden");
        if (show) { ln.setAttribute("x1", a.x); ln.setAttribute("y1", a.y); ln.setAttribute("x2", b.x); ln.setAttribute("y2", b.y); }
      };
      const A = P(sz.face, -(under + R * 0.34));
      const B = P(sz.from, -(under + R * 0.34));
      // Looking along the bar, its length is a line going away from you: no place for a length.
      const c0 = P((sz.face + sz.from) / 2, 0);
      const c1 = P((sz.face + sz.from) / 2, R);
      const across = Math.hypot(c0.x - c1.x, c0.y - c1.y) / R;                       // px per unit, across the bar
      const along = Math.hypot(A.x - B.x, A.y - B.y) / Math.max(sz.length, 1e-9);   // px per unit, along it
      const showLen = A.ok && B.ok && Math.hypot(A.x - B.x, A.y - B.y) > 46 && along > across * 0.35;
      set("m", A, B, showLen);
      set("a", P(sz.face, -(under + R * 0.14)), P(sz.face, -(under + R * 0.46)), showLen);
      set("b", P(sz.from, -(under + R * 0.14)), P(sz.from, -(under + R * 0.46)), showLen);
      if (lenEl) {
        const x = Math.min(w - lenW - 6, Math.max(6, (A.x + B.x) / 2 - lenW / 2));
        const y = Math.min(h - lenEl.offsetHeight - 22, Math.max(A.y, B.y) + 7);
        lenEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        lenEl.style.visibility = showLen ? "visible" : "hidden";
      }
    };

    let frame = 0;
    const render = () => { frame = 0; renderer.render(scene, camera); placeSizes(); };
    const queue = () => { if (!frame) frame = requestAnimationFrame(render); };
    controls.addEventListener("change", queue);

    const resize = () => {
      const w = Math.max(200, wrap.clientWidth);
      const h = Math.max(160, wrap.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      queue();
    };
    resize();
    setView("3d");
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);

    // put the bar and the tool where the program has them after n moves
    let lastGeo = null;
    const step = (n, totalMoves) => {
      const pts = simplifyOutline(outlinePoints(sim, n));
      const geo = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(p[1], 0), p[0])), SEGMENTS);
      part.geometry = geo;
      lastGeo?.dispose();
      lastGeo = geo;
      const at = sim.toolAt(n);
      const done = n >= totalMoves;
      tool.visible = !!at && !done;
      if (at) {
        tool.position.set(at.z, at.r, 0);
        const which = at.type === "thread" ? "thread" : at.type === "groove" ? "groove" : "turn";
        for (const k of Object.keys(shapes)) shapes[k].visible = k === which;
        glow.intensity = at.type === "rapid" ? 0 : R * R * 14;
      }
      cutting = !!at && !done && at.type !== "rapid";
      queue();
    };

    api.current = {
      step, setView: (v) => { setView(v); queue(); }, queue, spin, chipTick,
      setStock: (on) => { stock.visible = on; stockEdges.visible = on; queue(); },
    };
    // for tests and screenshots: a way to know a frame has really been drawn
    canvas.dataset.ready = "1";

    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      controls.removeEventListener("change", queue);
      controls.dispose();
      lastGeo?.dispose();
      for (const d of disposables) d.dispose?.();
      delete canvas.dataset.ready;
      api.current = null;
    };
  }, [sim, material, glReady]);

  // ---- follow the program ----
  useEffect(() => { api.current?.step(upTo, total); }, [upTo, total, sim, material, glReady]);
  useEffect(() => { api.current?.setView(view); }, [view, viewNonce, sim, material, glReady]);
  useEffect(() => { api.current?.setStock(showStock); }, [showStock, sim, material, glReady]);
  // new sizes on the page: draw once more so they're put in place
  useEffect(() => { api.current?.queue(); }, [sizes, units, sim, material, glReady]);

  // The chuck turns while the program is playing, like the real thing.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    let last = performance.now();
    const tick = (now) => {
      const a = api.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      if (a) { a.spin.rotation.x += dt * 5; a.chipTick(dt, true); a.queue(); }
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); api.current?.chipTick(0, false); api.current?.queue(); };
  }, [playing, sim, material, glReady]);

  return (
    <div ref={wrapRef} style={{ height, width: "100%", position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }} role="img" aria-label="The part as a solid, cut from the bar" />
      {/* Sizes on the part. For the eye only: the list under the picture says the same in words. */}
      {sizes && (
        <div className="pv-dims" ref={dimsRef} aria-hidden="true">
          <svg>
            {sizes.steps.map((s, i) => <line key={`l${i}`} data-i={i} visibility="hidden" />)}
            {sizes.steps.map((s, i) => <circle key={`c${i}`} data-i={i} r="2.6" visibility="hidden" />)}
            <line data-o="m" visibility="hidden" /><line data-o="a" visibility="hidden" /><line data-o="b" visibility="hidden" />
          </svg>
          {sizes.steps.map((s, i) => {
            const t = sizeLabel(s, units);
            return <div className={`pv-dim${s.uncut ? " bar" : ""}`} data-i={i} key={i}><b>{t.main}</b>{t.sub && <span>{t.sub}</span>}</div>;
          })}
          <div className="pv-dim len"><b>{sizeText(sizes.length, units)}</b><span>cut length</span></div>
        </div>
      )}
    </div>
  );
}

// A dark backdrop that's lighter toward the top, so the part isn't floating in
// a black void.
function backdrop() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#1B2634");
  grad.addColorStop(0.55, "#0C1118");
  grad.addColorStop(1, "#05070A");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A round number near x, for a grid whose squares mean something (0.5, 1, 2…).
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
