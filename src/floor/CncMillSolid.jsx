import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { metalFor } from "./cncSolid.js";

// A milled part as a real solid: the block in a vise, cut away as the program
// plays, with the cutter where the program has it. All the working-out is in
// cncMill.js; this file only puts it on screen. (The lathe's is CncSolid.jsx,
// and the two are built the same way.)
//
// World axes: the program's X is across, its Z is up, and its Y goes away from
// you, so a part looks the way it does standing at the front of the machine.

const W = (x, y, z) => [x, z, -y]; // program (X, Y, Z) -> world

export default function CncMillSolid({ mill, upTo, total, material = "", view = "3d", viewNonce = 0, showStock = true, playing = false, onFail, height = 420 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const api = useRef(null);
  const gl = useRef(null);
  const [glReady, setGlReady] = useState(0);

  // ---- the renderer: once, for as long as the canvas is on the page ----
  // (Kept apart from the scene for the same reason as the lathe view: a canvas
  // only ever gets one graphics context, and rebuilding the scene mustn't lose it.)
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
    renderer.toneMappingExposure = 1.25;
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
      setTimeout(() => { if (!canvas.isConnected) renderer.forceContextLoss?.(); }, 0);
    };
  }, []);

  // ---- build the scene once per part ----
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !mill || !gl.current) return;
    const { renderer, envMap } = gl.current;
    const scene = new THREE.Scene();
    scene.background = backdrop();
    scene.environment = envMap;
    const disposables = [scene.background];
    const own = (x) => { disposables.push(x); return x; };

    const { nx, ny, cell, x0, y0, x1, y1, top, bottom } = mill;
    const bw = x1 - x0;             // across
    const bd = y1 - y0;             // front to back
    const bt = top - bottom;        // thick
    const big = Math.max(bw, bd);
    const metal = metalFor(material);
    const centre = new THREE.Vector3(...W((x0 + x1) / 2, (y0 + y1) / 2, (top + bottom) / 2));

    // -- the top of the block: one point per square of the grid, moved down as it's cut
    const px = (i) => (i === 0 ? x0 : i === nx - 1 ? x1 : x0 + (i + 0.5) * cell);   // the edge points sit on the block's real edge
    const py = (j) => (j === 0 ? y0 : j === ny - 1 ? y1 : y0 + (j + 0.5) * cell);
    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      const p = W(px(i), py(j), top);
      pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let q = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
    const topGeo = own(new THREE.BufferGeometry());
    topGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    topGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    topGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Flat faces, not smoothed: a pocket wall should look like a wall, and a
    // machined floor like a floor.
    const partMat = own(new THREE.MeshStandardMaterial({ color: "#FFFFFF", vertexColors: true, metalness: metal.plastic ? 0 : 1, roughness: metal.rough + 0.06, envMapIntensity: 1.1, flatShading: true, side: THREE.DoubleSide }));
    const topMesh = new THREE.Mesh(topGeo, partMat);
    topMesh.castShadow = true; topMesh.receiveShadow = true;
    topMesh.frustumCulled = false;

    // -- the four sides: a skirt from the top edge down to the bottom of the block
    const ring = [];
    for (let i = 0; i < nx; i++) ring.push([i, 0]);
    for (let j = 1; j < ny; j++) ring.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) ring.push([i, ny - 1]);
    for (let j = ny - 2; j >= 1; j--) ring.push([0, j]);
    const sidePos = new Float32Array(ring.length * 2 * 3);
    ring.forEach(([i, j], n) => {
      const a = W(px(i), py(j), top);
      const b = W(px(i), py(j), bottom);
      sidePos.set(a, n * 6); sidePos.set(b, n * 6 + 3);
    });
    const sideIdx = new Uint32Array(ring.length * 6);
    for (let n = 0; n < ring.length; n++) {
      const a = n * 2, b = a + 1, c = ((n + 1) % ring.length) * 2, d = c + 1;
      sideIdx.set([a, c, b, c, d, b], n * 6);
    }
    const sideGeo = own(new THREE.BufferGeometry());
    sideGeo.setAttribute("position", new THREE.BufferAttribute(sidePos, 3));
    sideGeo.setIndex(new THREE.BufferAttribute(sideIdx, 1));
    const sideMat = own(new THREE.MeshStandardMaterial({ color: new THREE.Color(metal.color).multiplyScalar(0.8), metalness: metal.plastic ? 0 : 1, roughness: metal.rough + 0.14, envMapIntensity: 1, flatShading: true, side: THREE.DoubleSide }));
    const sideMesh = new THREE.Mesh(sideGeo, sideMat);
    sideMesh.castShadow = true; sideMesh.frustumCulled = false;
    scene.add(topMesh, sideMesh);

    // -- the block as it started, faint, so what's been cut away can be seen
    const ghostBox = own(new THREE.BoxGeometry(bw, bt, bd));
    const ghost = new THREE.LineSegments(own(new THREE.EdgesGeometry(ghostBox)), own(new THREE.LineBasicMaterial({ color: "#7FB2FF", transparent: true, opacity: 0.45 })));
    ghost.position.copy(centre);
    scene.add(ghost);

    // -- a vise: a body, and two jaws on the front and back of the block, gripping its lower half
    const dark = own(new THREE.MeshStandardMaterial({ color: "#4A5560", metalness: 1, roughness: 0.42, envMapIntensity: 0.9 }));
    const jawMat = own(new THREE.MeshStandardMaterial({ color: "#8B97A4", metalness: 1, roughness: 0.3, envMapIntensity: 1 }));
    const jawT = Math.max(bd * 0.2, big * 0.07);          // how thick a jaw is
    const grip = bt * 0.5;                                // how much of the block's side it covers
    const jawH = grip + bt * 0.5;
    const jawW = bw * 1.12;
    const bodyH = Math.max(bt * 0.9, big * 0.1);
    const jawGeo = own(new THREE.BoxGeometry(jawW, jawH, jawT));
    for (const side of [-1, 1]) {
      const jaw = new THREE.Mesh(jawGeo, jawMat);
      const yy = side < 0 ? y0 - jawT / 2 : y1 + jawT / 2;
      jaw.position.set(...W((x0 + x1) / 2, yy, bottom + grip - jawH / 2));
      jaw.castShadow = true; jaw.receiveShadow = true;
      scene.add(jaw);
    }
    const body = new THREE.Mesh(own(new THREE.BoxGeometry(bw * 1.18, bodyH, bd + jawT * 2 + big * 0.22)), dark);
    body.position.set(...W((x0 + x1) / 2, (y0 + y1) / 2, bottom - bt * 0.5 - bodyH / 2));
    body.castShadow = true; body.receiveShadow = true;
    scene.add(body);
    const floorZ = bottom - bt * 0.5 - bodyH;

    // -- the cutter: a unit cylinder, sized to whichever tool is in
    const tool = new THREE.Group();
    const cutter = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 0.5, 1, 40)), own(new THREE.MeshStandardMaterial({ color: "#D9DEE4", metalness: 1, roughness: 0.22, envMapIntensity: 1.3, emissive: "#201400", emissiveIntensity: 0.5 })));
    cutter.position.y = 0.5;   // its bottom face is the tool's tip, at the group's origin
    cutter.castShadow = true;
    const holder = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 0.5, 1, 40)), own(new THREE.MeshStandardMaterial({ color: "#39414B", metalness: 0.9, roughness: 0.45 })));
    holder.castShadow = true;
    const band = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 0.5, 1, 40)), own(new THREE.MeshStandardMaterial({ color: "#E0A82E", metalness: 0.85, roughness: 0.3 })));
    const glow = new THREE.PointLight("#FFB24D", 0, big * 2, 2);
    tool.add(cutter, holder, band, glow);
    scene.add(tool);
    const sizeTool = (dia) => {
      const len = Math.max(dia * 3.2, bt * 1.6, big * 0.12);
      cutter.scale.set(dia, len, dia);
      cutter.position.y = len / 2;
      const hd = Math.max(dia * 1.7, big * 0.07);
      const hl = Math.max(len * 0.9, big * 0.14);
      holder.scale.set(hd, hl, hd);
      holder.position.y = len + hl / 2;
      band.scale.set(hd * 1.04, hl * 0.08, hd * 1.04);
      band.position.y = len + hl * 0.12;
      glow.position.set(0, dia * 0.3, dia * 0.6);
    };

    // -- chips: hot specks thrown from the cutter while the program is playing
    const CHIPS = 110;
    const chipPos = new Float32Array(CHIPS * 3);
    const chipVel = new Float32Array(CHIPS * 3);
    const chipLife = new Float32Array(CHIPS);
    const chipGeo = own(new THREE.BufferGeometry());
    chipGeo.setAttribute("position", new THREE.BufferAttribute(chipPos, 3));
    const chips = new THREE.Points(chipGeo, own(new THREE.PointsMaterial({ color: "#FFC56B", size: big * 0.012, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })));
    chips.frustumCulled = false;
    chips.visible = false;
    scene.add(chips);
    let chipNext = 0;
    let cutting = false;
    let spinR = big * 0.05;
    const chipTick = (dt, on) => {
      chips.visible = on;
      if (!on) return;
      if (cutting) {
        for (let k = 0; k < 4; k++) {
          const i = chipNext; chipNext = (chipNext + 1) % CHIPS;
          const a = Math.random() * Math.PI * 2;
          chipPos[i * 3] = tool.position.x + Math.cos(a) * spinR; chipPos[i * 3 + 1] = tool.position.y + big * 0.01; chipPos[i * 3 + 2] = tool.position.z + Math.sin(a) * spinR;
          const v = (0.5 + Math.random() * 0.9) * big;
          chipVel[i * 3] = Math.cos(a) * v; chipVel[i * 3 + 1] = (0.5 + Math.random() * 0.8) * big; chipVel[i * 3 + 2] = Math.sin(a) * v;
          chipLife[i] = 0.35 + Math.random() * 0.35;
        }
      }
      for (let i = 0; i < CHIPS; i++) {
        if (chipLife[i] <= 0) { chipPos[i * 3 + 1] = -1e6; continue; }
        chipLife[i] -= dt;
        chipVel[i * 3 + 1] -= 6 * big * dt;
        chipPos[i * 3] += chipVel[i * 3] * dt; chipPos[i * 3 + 1] += chipVel[i * 3 + 1] * dt; chipPos[i * 3 + 2] += chipVel[i * 3 + 2] * dt;
      }
      chipGeo.attributes.position.needsUpdate = true;
    };

    // -- light, and a table to sit on
    scene.add(new THREE.HemisphereLight("#E6EEFF", "#1A2230", 0.95));
    const reach = Math.hypot(bw, bd) * 1.1 + bt;
    const key = new THREE.DirectionalLight("#FFFFFF", 3.0);
    key.position.copy(centre).add(new THREE.Vector3(reach * 0.55, reach * 1.25, reach * 0.8));
    key.target.position.copy(centre);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach;
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach;
    key.shadow.camera.near = 0.01; key.shadow.camera.far = reach * 6;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight("#7FB2FF", 1.4);
    rim.position.copy(centre).add(new THREE.Vector3(-reach, reach * 0.5, -reach));
    scene.add(rim);
    const table = new THREE.Mesh(own(new THREE.PlaneGeometry(reach * 10, reach * 10)), own(new THREE.ShadowMaterial({ opacity: 0.42 })));
    table.rotation.x = -Math.PI / 2;
    table.position.set(centre.x, floorZ, centre.z);
    table.receiveShadow = true;
    scene.add(table);
    const step_ = niceStep(reach / 5);
    const grid = new THREE.GridHelper(step_ * 40, 40, "#2B4C6F", "#17212C");
    grid.position.set(Math.round(centre.x / step_) * step_, floorZ + 1e-4 * reach, Math.round(centre.z / step_) * step_);
    grid.material.transparent = true;
    grid.material.opacity = 0.75;
    disposables.push(grid.geometry, grid.material);
    scene.add(grid);

    // -- camera
    const camera = new THREE.PerspectiveCamera(30, 1, reach / 200, reach * 60);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    const look = centre.clone();
    look.y = top - bt * 0.3;
    controls.target.copy(look);
    controls.minDistance = reach * 0.2;
    controls.maxDistance = reach * 14;
    controls.maxPolarAngle = Math.PI * 0.93;
    const fit = Math.hypot(bw, bd, bt) * 0.52 + jawT * 0.5;
    const setView = (v) => {
      const d = (fit / Math.sin((camera.fov * Math.PI) / 360)) * Math.max(1, 1.3 / camera.aspect) * 0.95;
      const dir = v === "top" ? new THREE.Vector3(0, 1, 0.0001) : v === "front" ? new THREE.Vector3(0, 0.12, 1) : v === "side" ? new THREE.Vector3(1, 0.12, 0.0001) : new THREE.Vector3(0.55, 0.62, 0.8);
      camera.position.copy(dir.normalize().multiplyScalar(d)).add(look);
      controls.target.copy(look);
      controls.update();
    };

    let frame = 0;
    const render = () => { frame = 0; renderer.render(scene, camera); };
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

    // -- put the block and the cutter where the program has them after n moves
    // Untouched stock is a little duller than a freshly cut face, which is what
    // makes the cuts read as cuts.
    const base = new THREE.Color(metal.color);
    const raw = base.clone().multiplyScalar(0.74);
    const cutC = base.clone().lerp(new THREE.Color("#FFFFFF"), 0.12);
    const eps = Math.max(bt * 1e-4, 1e-6);
    const sidePosAttr = sideGeo.attributes.position;
    const step = (at, totalMoves) => {
      const n = Math.min(totalMoves, Math.floor(at + 1e-9));
      const along = n < totalMoves ? Math.max(0, at - n) : 0;
      const h = mill.heightsAt(n, along);
      for (let k = 0; k < h.length; k++) {
        pos[k * 3 + 1] = h[k];
        const c = h[k] < top - eps ? cutC : raw;
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
      topGeo.attributes.position.needsUpdate = true;
      topGeo.attributes.color.needsUpdate = true;
      ring.forEach(([i, j], m) => { sidePos[m * 6 + 1] = h[j * nx + i]; });
      sidePosAttr.needsUpdate = true;

      const t = mill.toolAt(n, along);
      const done = n >= totalMoves;
      tool.visible = !!t && !done;
      if (t) {
        sizeTool(t.dia);
        tool.position.set(...W(t.x, t.y, t.z));
        spinR = t.dia / 2;
        glow.intensity = t.type === "rapid" ? 0 : big * big * 1.6;
      }
      cutting = !!t && !done && t.type !== "rapid";
      queue();
    };

    api.current = {
      step, setView: (v) => { setView(v); queue(); }, queue, chipTick,
      setStock: (on) => { ghost.visible = on; queue(); },
    };
    canvas.dataset.ready = "1";   // for tests and screenshots: a frame has really been drawn

    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      controls.removeEventListener("change", queue);
      controls.dispose();
      for (const d of disposables) d.dispose?.();
      delete canvas.dataset.ready;
      api.current = null;
    };
  }, [mill, material, glReady]);

  // ---- follow the program ----
  useEffect(() => { api.current?.step(upTo, total); }, [upTo, total, mill, material, glReady]);
  useEffect(() => { api.current?.setView(view); }, [view, viewNonce, mill, material, glReady]);
  useEffect(() => { api.current?.setStock(showStock); }, [showStock, mill, material, glReady]);

  // Chips fly while the program is playing.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    let last = performance.now();
    const tick = (now) => {
      const a = api.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      if (a) { a.chipTick(dt, true); a.queue(); }
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); api.current?.chipTick(0, false); api.current?.queue(); };
  }, [playing, mill, material, glReady]);

  return (
    <div ref={wrapRef} style={{ height, width: "100%", position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }} role="img" aria-label="The part as a solid, cut from the block" />
    </div>
  );
}

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

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
