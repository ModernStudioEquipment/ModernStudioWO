import { useEffect, useMemo, useState } from "react";
import { FLOOR_DEPTS, exitMonitor } from "./depts.js";
import { fetchFloorQueue, fetchFloorPhotos, fetchFloorArrangement, fetchCncParts, matchCncPart, fetchFloorNotes, completeItem, fetchCncMachines } from "./floorData.js";

// Order the queue the way the office set it: items in the arrangement come
// first, in the dragged order. Anything not yet arranged (a brand-new arrival)
// falls in behind, rush-first, then oldest.
function applyOrder(items, arrangement) {
  const rank = new Map(arrangement.map((id, i) => [id, i]));
  return items.slice().sort((a, b) => {
    const ai = rank.has(a.item_id) ? rank.get(a.item_id) : Infinity;
    const bi = rank.has(b.item_id) ? rank.get(b.item_id) : Infinity;
    if (ai !== bi) return ai - bi;
    return (
      Number(b.is_rush) - Number(a.is_rush) ||
      new Date(a.received_at) - new Date(b.received_at)
    );
  });
}

const POLL_MS = 25000; // refresh every 25s — plenty for a shop wall, and easy on the free tier
const STATIC_EVERY = 12; // re-fetch photos / CNC parts only every ~5 min (they rarely change)
const MAX_QUEUE = 6; // rows visible under the NOW card

// CNC monitor is split by machine — clickable tabs at the top of the screen.
const MACHINES = [
  { key: "vf4", short: "VF-4" },
  { key: "st10", short: "ST-10" },
  { key: "ds30ssy", short: "DS-30SSY" },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mos = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = now.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, "0");
  return { t: `${h}:${m} ${ap}`, d: `${days[now.getDay()]} · ${mos[now.getMonth()]} ${now.getDate()}` };
}

function photoFor(item, photos) {
  return item.image_url || (item.sku ? photos[item.sku] : null) || null;
}

export default function FloorDisplay({ deptKey }) {
  const dept = FLOOR_DEPTS[deptKey];
  const isCnc = deptKey === "cnc";
  const [rawItems, setRawItems] = useState([]);
  const [deptArr, setDeptArr] = useState([]);
  const [machineMap, setMachineMap] = useState({}); // item_id -> machine (CNC)
  const [machineArr, setMachineArr] = useState({ vf4: [], st10: [], ds30ssy: [] });
  const [photos, setPhotos] = useState({});
  const [cncParts, setCncParts] = useState({ bySku: {}, byName: {} });
  const [notes, setNotes] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [machine, setMachine] = useState(() => {
    try {
      return sessionStorage.getItem("mse_floor_machine") || "vf4";
    } catch {
      return "vf4";
    }
  });
  const clock = useClock();

  useEffect(() => {
    try {
      sessionStorage.setItem("mse_floor_machine", machine);
    } catch {
      /* ignore */
    }
  }, [machine]);

  useEffect(() => {
    let alive = true;
    let tick = 0;
    const startedAt = Date.now();
    async function load() {
      // Only pull the heavy, rarely-changing data (photos, CNC parts) every ~5 min;
      // the queue / order / notes ride every poll. Cuts request volume by more than half.
      const refreshStatic = tick % STATIC_EVERY === 0;
      tick += 1;
      const [q, arr, nts, p, cnc, mMap, aVf4, aSt10, aDs] = await Promise.all([
        fetchFloorQueue(dept.db),
        fetchFloorArrangement(deptKey),
        fetchFloorNotes(),
        refreshStatic ? fetchFloorPhotos() : Promise.resolve(null),
        refreshStatic && isCnc ? fetchCncParts() : Promise.resolve(null),
        isCnc ? fetchCncMachines() : Promise.resolve(null),
        isCnc ? fetchFloorArrangement("cnc_vf4") : Promise.resolve(null),
        isCnc ? fetchFloorArrangement("cnc_st10") : Promise.resolve(null),
        isCnc ? fetchFloorArrangement("cnc_ds30ssy") : Promise.resolve(null),
      ]);
      if (!alive) return;
      if (p) setPhotos(p);
      if (cnc) setCncParts(cnc);
      if (q === null) {
        setOnline(false); // fetch failed — keep the last-good queue on screen, flag "reconnecting"
        return;
      }
      setRawItems(q);
      setDeptArr(arr || []);
      if (isCnc) {
        if (mMap) setMachineMap(mMap);
        setMachineArr({ vf4: aVf4 || [], st10: aSt10 || [], ds30ssy: aDs || [] });
      }
      setNotes(nts || {});
      setOnline(true);
      setLoaded(true);
      // Nightly self-reload (~3am, once/day) so a monitor left on for weeks
      // picks up new deploys and clears memory. Guarded via localStorage.
      try {
        const today = new Date().toDateString();
        if (new Date().getHours() === 3 && Date.now() - startedAt > 3600000 && localStorage.getItem("mse_floor_reload") !== today) {
          localStorage.setItem("mse_floor_reload", today);
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dept.db, deptKey, isCnc]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") exitMonitor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The displayed queue: for CNC, only the selected machine's items in its order;
  // for other departments, the whole department queue.
  const queue = useMemo(() => {
    if (isCnc) {
      const forM = rawItems.filter((it) => machineMap[it.item_id] === machine);
      return applyOrder(forM, machineArr[machine] || []);
    }
    return applyOrder(rawItems, deptArr);
  }, [isCnc, rawItems, deptArr, machineMap, machineArr, machine]);

  const machineCounts = {};
  MACHINES.forEach((m) => (machineCounts[m.key] = rawItems.filter((it) => machineMap[it.item_id] === m.key).length));
  const unassignedCount = isCnc ? rawItems.filter((it) => !machineMap[it.item_id]).length : 0;

  const stageStyle = useMemo(() => ({ "--accent": dept.accent, "--draw": dept.draw }), [dept]);
  const qtyLabel = deptKey === "saw" ? "Cuts" : "Pieces";

  const handleDone = async (id) => {
    setRawItems((r) => r.filter((i) => i.item_id !== id)); // optimistic — the next job slides up to NOW
    await completeItem(id);
  };

  const now = queue[0] || null;
  const rest = queue.slice(1, 1 + MAX_QUEUE);
  const overflow = Math.max(0, queue.length - 1 - rest.length);
  const rushCount = queue.filter((i) => i.is_rush).length;

  return (
    <div className="floor-root">
      <div className="floor-stage" style={stageStyle}>
        <button className="floor-exit" onClick={exitMonitor} title="Exit monitor (Esc)">
          ✕ Exit
        </button>
        <header className="floor-top">
          <div className="floor-logo" role="img" aria-label="Modern Studio Equipment" />
          <div className="floor-dept">
            <i className="dot" />
            <b>{dept.label.toUpperCase()}</b>
          </div>
          {isCnc && (
            <div className="floor-mtabs">
              {MACHINES.map((m) => (
                <button key={m.key} className={`floor-mtab${machine === m.key ? " on" : ""}`} onClick={() => setMachine(m.key)}>
                  <b>{m.short}</b>
                  <span className="mc">{machineCounts[m.key]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="spacer" />
          <div className="floor-stat">
            <div className="n">{queue.length}</div>
            <div className="l">In queue</div>
          </div>
          <div className="floor-stat">
            <div className="n">{rushCount}</div>
            <div className="l">Rush</div>
          </div>
          <div className="floor-clock">
            <div className="t">{clock.t}</div>
            <div className="d">{clock.d}</div>
            <div className={`floor-live${online ? "" : " off"}`}>
              <i />
              {online ? "LIVE" : "RECONNECTING"}
            </div>
          </div>
        </header>

        {now ? (
          <>
            <div className="floor-main">
              <NowCard key={now.item_id} item={now} photos={photos} qtyLabel={qtyLabel} deptLabel={dept.label} part={matchCncPart(cncParts, now)} note={notes[now.item_id]} onDone={handleDone} />
              <aside className="floor-queue">
                <h2>
                  <i className="c" />
                  Up next · {Math.max(0, queue.length - 1)} waiting
                </h2>
                <div className="floor-qlist">
                  {rest.map((it, idx) => (
                    <QueueRow key={it.item_id} item={it} pos={idx + 2} photos={photos} qtyLabel={qtyLabel} />
                  ))}
                  {rest.length === 0 && <div className="floor-qmore">Nothing else queued.</div>}
                </div>
                {overflow > 0 && <div className="floor-qmore">+ {overflow} more waiting</div>}
              </aside>
            </div>
            <footer className="floor-ticker">
              <span className="badge">Work top → bottom</span>
              <span>
                Queue order is set by the <b>production office</b> — the top card is always next up.
              </span>
              <span className="grip">No customer data on this display · synced live from work orders</span>
            </footer>
          </>
        ) : (
          <IdleCard dept={dept} loaded={loaded} online={online} unassignedCount={unassignedCount} />
        )}
      </div>
    </div>
  );
}

function DoneButton({ onDone }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000); // disarm if not confirmed
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`floor-done${armed ? " armed" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onDone();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? "Tap to confirm ✓" : "Mark done"}
    </button>
  );
}

function NowCard({ item, photos, qtyLabel, deptLabel, part, note, onDone }) {
  const hasSteps = part && part.steps && part.steps.length > 0;
  const hasNotes = !!(part && part.notes);
  const rich = hasSteps || hasNotes || !!(part && part.blueprint);
  const src = (part && part.blueprint) || photoFor(item, photos);
  return (
    <section className="floor-now">
      <div className="floor-nowhead">
        <div className="floor-rank">
          <span className="lab">NEXT UP</span>
          <span className="num">1</span>
        </div>
        <div className="floor-wo">
          <div className="floor-tagrow">
            <span className="floor-no">WO&nbsp;#{item.order_no}</span>
            {item.in_progress && <span className="floor-chip floor">On the floor</span>}
            {item.is_rush && <span className="floor-chip rush">Rush</span>}
          </div>
          <h1>{item.product}</h1>
        </div>
        <div className="floor-qty">
          <div className="n">{item.qty}</div>
          <div className="l">{qtyLabel}</div>
          {onDone && <DoneButton onDone={() => onDone(item.item_id)} />}
        </div>
      </div>
      <div className="floor-nowbody">
        <div className="floor-photo">
          <span className="tag">{part && part.blueprint ? "Blueprint" : src ? "Product photo" : "No photo"}</span>
          {src ? <img src={src} alt={item.product} /> : <span className="mono">{initials(item.product)}</span>}
        </div>
        {rich ? (
          <div className="floor-detail">
            {note && (
              <div className="floor-jobnote">
                <span className="k">Note</span>
                <span className="v">{note}</span>
              </div>
            )}
            {hasSteps && (
              <>
                <div className="h">How to make it</div>
                <ol className="floor-mksteps">
                  {part.steps.slice(0, 6).map((s, i) => (
                    <li key={i}>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {hasNotes && (
              <div className="floor-heads">
                <span className="k">Before you start</span>
                <span className="v">{part.notes}</span>
              </div>
            )}
            <div className="floor-note">
              {part.material ? `Material: ${part.material}` : "Full spec in the CNC library."}
            </div>
          </div>
        ) : (
          <div className="floor-detail">
            {note && (
              <div className="floor-jobnote">
                <span className="k">Note</span>
                <span className="v">{note}</span>
              </div>
            )}
            <div className="h">Details</div>
            <div className="floor-facts">
              <div className="floor-fact">
                <span className="k">Department</span>
                <span className="v">{deptLabel}</span>
              </div>
              {item.color && (
                <div className="floor-fact">
                  <span className="k">Color</span>
                  <span className="v">{item.color}</span>
                </div>
              )}
              <div className="floor-fact">
                <span className="k">Quantity</span>
                <span className="v">
                  {item.qty} {qtyLabel.toLowerCase()}
                </span>
              </div>
              {item.due_date && (
                <div className="floor-fact">
                  <span className="k">Due</span>
                  <span className="v">{fmtDue(item.due_date)}</span>
                </div>
              )}
            </div>
            <div className="floor-note">
              {deptLabel === "CNC" ? "Add steps & a blueprint in the CNC library." : "Build steps come from the work-order sheet."}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function QueueRow({ item, pos, photos, qtyLabel }) {
  const src = photoFor(item, photos);
  return (
    <div className="floor-qrow">
      <div className="pos">{pos}</div>
      <div className="floor-qthumb">
        {src ? <img src={src} alt="" /> : <span className="mono">{initials(item.product)}</span>}
      </div>
      <div className="floor-qmeta">
        <div className="no">WO&nbsp;#{item.order_no}</div>
        <div className="nm">{item.product}</div>
        {item.color && <div className="mt">{item.color}</div>}
      </div>
      <div className="floor-qright">
        <div className="q">{item.qty}</div>
        <div className="ql">{qtyLabel.toLowerCase()}</div>
        {item.is_rush && <span className="floor-chip rush">Rush</span>}
      </div>
    </div>
  );
}

function IdleCard({ dept, loaded, online, unassignedCount = 0 }) {
  if (!loaded && !online) {
    return (
      <div className="floor-idle">
        <div className="ring err">!</div>
        <div className="big">Can’t reach the board</div>
        <div className="sub">Trying to reconnect…</div>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="floor-idle">
        <div className="ring">…</div>
        <div className="big">Loading…</div>
        <div className="sub">Fetching the {dept.label} queue…</div>
      </div>
    );
  }
  return (
    <div className="floor-idle">
      <div className="ring">✓</div>
      <div className="big">All caught up</div>
      <div className="sub">Nothing queued for {dept.label} right now.</div>
      {unassignedCount > 0 && (
        <div className="sub" style={{ color: "var(--accent)" }}>
          {unassignedCount} CNC job{unassignedCount === 1 ? "" : "s"} waiting to be assigned to a machine.
        </div>
      )}
    </div>
  );
}

function initials(name = "") {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return (words[0]?.[0] || "?").toUpperCase() + (words[1]?.[0] || "").toUpperCase();
}

function fmtDue(d) {
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  const mos = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${mos[dt.getMonth()]} ${dt.getDate()}`;
}
