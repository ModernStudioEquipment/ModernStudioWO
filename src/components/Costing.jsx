import React, { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, Search, Package, Wrench, DollarSign, Check, Scissors, Cpu } from "lucide-react";
import { C, stamp } from "../theme.js";
import { Btn, Empty, InlineMenu, DeptIcon } from "./ui.jsx";

const usd = (n) =>
  n == null || isNaN(n) ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KINDS = [
  { key: "material", label: "Material", Icon: Package },
  { key: "labor", label: "Labor", Icon: Wrench },
  { key: "other", label: "Other", Icon: DollarSign },
];

// Departments double as the product sections — a product belongs to whoever makes
// it. Shop is labelled "Metal" here because that's what the shop calls the work.
const SECTIONS = [
  { dept: "Shop", label: "Metal" },
  { dept: "Sewing", label: "Sewing" },
  { dept: "CNC", label: "CNC" },
  { dept: "Saw", label: "Saw" },
];

// Slice colours for the cost breakdown — the floor accents, which stay legible in
// both light and dark.
const SLICE = ["#4EA3FF", "#7DD35B", "#FFB224", "#F472B6", "#A78BFA", "#FF8A5C", "#2DD4BF", "#F5CE3A"];

// Blunt on purpose: the point of this screen is spotting what isn't making money.
const marginColor = (m) => (m == null ? C.gray : m < 0 ? C.rush : m < 25 ? C.high : C.green);

const SORTS = [
  { value: "margin_desc", label: "Highest margin" },
  { value: "margin_asc", label: "Lowest margin" },
  { value: "cost_desc", label: "Costs the most" },
  { value: "name", label: "Name (A–Z)" },
];

export default function Costing({ costing, productNames = [], onClose }) {
  const [view, setView] = useState("overview"); // overview | products | inputs
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("margin_desc");
  const [section, setSection] = useState(null); // dept filter
  const [selected, setSelected] = useState(null); // product name

  // Every product, with its department and (if costed) its numbers.
  const rows = useMemo(() => {
    const byName = new Map();
    productNames.forEach((p) => byName.set(p.name, { name: p.name, dept: p.dept || "Shop", costed: null }));
    costing.products.forEach((p) => {
      const prev = byName.get(p.name);
      byName.set(p.name, { name: p.name, dept: prev?.dept || "Shop", costed: p });
    });
    return [...byName.values()].map((r) => ({ ...r, calc: r.costed ? costing.costOf(r.costed) : null }));
  }, [productNames, costing]);

  const selectedRow = rows.find((r) => r.name === selected) || null;

  const openSection = (dept) => { setSection(dept); setView("products"); setSelected(null); };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: C.concrete, overflowY: "auto" }}>
      <div className="flex items-center gap-3 px-5 py-3 flex-wrap" style={{ background: C.fill, color: "#fff", position: "sticky", top: 0, zIndex: 2 }}>
        <button onClick={onClose} className="inline-flex items-center gap-1.5" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          <ArrowLeft size={17} />Back to board
        </button>
        <span style={{ fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", fontSize: 13, marginLeft: 6 }}>Costing &amp; margins</span>
        <div className="flex items-center gap-1 ml-auto">
          {[["overview", "Overview"], ["products", "Products"], ["inputs", "Materials & labor"]].map(([k, lbl]) => (
            <button key={k} onClick={() => { setView(k); setSelected(null); }} className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
              style={view === k ? { background: "rgba(255,255,255,0.18)", color: "#fff", border: "none" } : { background: "transparent", color: "rgba(255,255,255,0.7)", border: "none" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        {view === "inputs" ? (
          <InputLibrary costing={costing} />
        ) : selectedRow ? (
          <ProductSheet row={selectedRow} costing={costing} onBack={() => setSelected(null)} />
        ) : view === "overview" ? (
          <Overview rows={rows} costing={costing} onSection={openSection} onPick={(n) => { setSelected(n); setView("products"); }} />
        ) : (
          <ProductList
            rows={rows} q={q} setQ={setQ} sort={sort} setSort={setSort}
            section={section} setSection={setSection} onPick={setSelected}
          />
        )}
      </div>
    </div>
  );
}

// ---- overview dashboard -----------------------------------------------------
function Overview({ rows, costing, onSection, onPick }) {
  const costed = rows.filter((r) => r.calc && r.calc.margin != null);
  const avg = costed.length ? costed.reduce((n, r) => n + r.calc.margin, 0) / costed.length : null;
  const sorted = [...costed].sort((a, b) => b.calc.margin - a.calc.margin);
  const best = sorted.slice(0, 5);
  const worst = [...sorted].reverse().slice(0, 5);

  const Kpi = ({ label, value, sub, color }) => (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${color || C.ink}`, padding: "13px 15px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: C.gray }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 28, fontWeight: 800, lineHeight: 1.15, marginTop: 2, color: color || C.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.gray }}>{sub}</div>
    </div>
  );

  return (
    <>
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Kpi label="Products costed" value={costing.products.length} sub={`of ${rows.length} products`} />
        <Kpi label="Average margin" value={avg == null ? "—" : `${avg.toFixed(1)}%`} sub={costed.length ? `across ${costed.length} priced` : "none priced yet"} color={marginColor(avg)} />
        <Kpi label="Best margin" value={best[0] ? `${best[0].calc.margin.toFixed(0)}%` : "—"} sub={best[0]?.name || "—"} color={C.green} />
        <Kpi label="Worst margin" value={worst[0] ? `${worst[0].calc.margin.toFixed(0)}%` : "—"} sub={worst[0]?.name || "—"} color={marginColor(worst[0]?.calc.margin)} />
        <Kpi label="Materials & labor" value={costing.inputs.length} sub="priced inputs" />
      </div>

      {/* clickable sections — a way in that isn't just one long product list */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 8 }}>By department</div>
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {SECTIONS.map(({ dept, label }) => {
          const mine = rows.filter((r) => r.dept === dept);
          const priced = mine.filter((r) => r.calc && r.calc.margin != null);
          const m = priced.length ? priced.reduce((n, r) => n + r.calc.margin, 0) / priced.length : null;
          return (
            <button key={dept} onClick={() => onSection(dept)} className="text-left card-pop"
              style={{ background: C.surface, border: `1px solid ${C.line}`, padding: "13px 15px", cursor: "pointer" }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.inkSoft }}>
                <DeptIcon d={dept} size={14} />{label}
              </div>
              <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 24, fontWeight: 800, marginTop: 4 }}>{mine.length}</div>
              <div style={{ fontSize: 11.5, color: C.gray }}>
                {priced.length ? <>avg <b style={{ color: marginColor(m) }}>{m.toFixed(0)}%</b> · {priced.length} priced</> : "none priced yet"}
              </div>
            </button>
          );
        })}
      </div>

      {!!costed.length && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <Leaderboard title="Best margins" rows={best} onPick={onPick} />
          <Leaderboard title="Thinnest margins" rows={worst} onPick={onPick} />
        </div>
      )}
    </>
  );
}

function Leaderboard({ title, rows, onPick }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}` }}>
      <div className="px-4 py-2" style={{ borderBottom: `1px solid ${C.line}`, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray }}>{title}</div>
      {rows.map((r) => (
        <button key={r.name} onClick={() => onPick(r.name)} className="w-full flex items-center gap-3 px-4 py-2 text-left"
          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
          <span className="min-w-0 flex-1" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: C.gray }}>{usd(r.calc.cost)}</span>
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13.5, fontWeight: 800, color: marginColor(r.calc.margin), width: 58, textAlign: "right" }}>
            {r.calc.margin.toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  );
}

// ---- product list -----------------------------------------------------------
function ProductList({ rows, q, setQ, sort, setSort, section, setSection, onPick }) {
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = rows;
    if (section) list = list.filter((r) => r.dept === section);
    if (t) list = list.filter((r) => r.name.toLowerCase().includes(t));
    const m = (r) => (r.calc && r.calc.margin != null ? r.calc.margin : null);
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "cost_desc") return (b.calc?.cost || 0) - (a.calc?.cost || 0);
      const am = m(a), bm = m(b);
      // Un-costed products always sink — a blank margin isn't a good or bad one.
      if (am == null && bm == null) return a.name.localeCompare(b.name);
      if (am == null) return 1;
      if (bm == null) return -1;
      return sort === "margin_asc" ? am - bm : bm - am;
    });
    return list;
  }, [rows, q, sort, section]);

  // Render cap purely for speed with ~1,800 products; the count above always
  // reports the true total so nothing looks quietly missing.
  const CAP = 400;
  const visible = shown.slice(0, CAP);

  const cur = SORTS.find((s) => s.value === sort) || SORTS[0];

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 px-2 rounded" style={{ border: `1px solid ${C.line}`, background: C.surface, flex: "1 1 220px" }}>
          <Search size={15} color={C.gray} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="flex-1 py-2 outline-none" style={{ background: "transparent", border: "none", fontSize: 13 }} />
        </div>
        <InlineMenu align="right" options={SORTS} onSelect={setSort}>
          <span className="inline-flex items-center gap-1 px-2.5 py-2 rounded text-xs font-bold uppercase tracking-wide btn-pop"
            style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer", whiteSpace: "nowrap" }}>
            {cur.label}
          </span>
        </InlineMenu>
      </div>

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <button onClick={() => setSection(null)} className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
          style={!section ? { background: C.fill, color: "#fff", border: "none" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
          All
        </button>
        {SECTIONS.map(({ dept, label }) => (
          <button key={dept} onClick={() => setSection(dept === section ? null : dept)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
            style={section === dept ? { background: C.fill, color: "#fff", border: "none" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
            <DeptIcon d={dept} size={12} />{label}
          </button>
        ))}
        <span className="ml-auto" style={{ fontSize: 12, color: C.gray }}>
          {shown.length} product{shown.length === 1 ? "" : "s"}{shown.length > CAP ? ` · showing first ${CAP}` : ""}
        </span>
      </div>

      {!shown.length && <Empty>Nothing matches.</Empty>}

      {visible.map((r) => (
        <button key={r.name} onClick={() => onPick(r.name)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded mb-1.5 text-left card-pop"
          style={{ background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer" }}>
          <span style={{ color: C.gray, flexShrink: 0 }}><DeptIcon d={r.dept} size={13} /></span>
          <span className="min-w-0 flex-1" style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          {r.calc ? (
            <>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, color: C.gray, width: 88, textAlign: "right" }}>{usd(r.calc.cost)} cost</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, color: C.inkSoft, width: 88, textAlign: "right" }}>{usd(r.calc.sell)} sell</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, fontWeight: 800, color: marginColor(r.calc.margin), width: 64, textAlign: "right" }}>
                {r.calc.margin == null ? "—" : `${r.calc.margin.toFixed(0)}%`}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: C.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Not costed</span>
          )}
        </button>
      ))}
      {shown.length > CAP && (
        <div style={{ fontSize: 12, color: C.gray, marginTop: 8 }}>
          {shown.length - CAP} more — search or pick a department to narrow it down.
        </div>
      )}
    </>
  );
}

// ---- donut: where the cost goes --------------------------------------------
function CostDonut({ slices, total, margin, size = 168 }) {
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={20} />
      {total > 0 && slices.map((s, i) => {
        const len = (s.value / total) * circ;
        const el = (
          <circle
            key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={SLICE[i % SLICE.length]} strokeWidth={20}
            strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        acc += len;
        return el;
      })}
      <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 20, fontWeight: 800, fill: C.ink, fontFamily: "ui-monospace,monospace" }}>
        {usd(total).replace(/\.00$/, "")}
      </text>
      <text x="50%" y="61%" textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, fill: C.gray }}>
        {margin == null ? "TO MAKE" : `${margin.toFixed(0)}% MARGIN`}
      </text>
    </svg>
  );
}

// ---- one product's cost sheet ----------------------------------------------
function ProductSheet({ row, costing, onBack }) {
  const [busy, setBusy] = useState(false);
  const product = row.costed;
  const c = row.calc;
  const [sell, setSell] = useState(product?.sellPrice ?? "");

  const start = async () => {
    setBusy(true);
    try { await costing.ensureProduct(row.name); } finally { setBusy(false); }
  };
  const addLine = async (inputId) => {
    const id = product?.id || (await costing.ensureProduct(row.name));
    await costing.saveLine({ productId: id, inputId, qty: 1, position: (c?.lines.length || 0) + 1 });
  };

  const slices = (c?.lines || []).map((l) => ({ key: l.id, label: l.input?.name || "—", value: l.cost }));

  return (
    <>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 mb-3" style={{ background: "none", border: "none", color: C.blue, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
        <ArrowLeft size={14} />All products
      </button>

      <div className="rounded mb-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.line}` }}>
          <span style={{ color: C.gray }}><DeptIcon d={row.dept} size={15} /></span>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{row.name}</span>
        </div>

        {!product ? (
          <div className="px-4 py-5 text-center">
            <div style={{ fontSize: 13, color: C.gray, marginBottom: 10 }}>This product hasn’t been costed yet.</div>
            <Btn kind="dark" onClick={start} disabled={busy}><Plus size={13} />{busy ? "Starting…" : "Start costing it"}</Btn>
          </div>
        ) : (
          <>
            {/* chart + the numbers */}
            <div className="px-4 py-4 flex items-center gap-6 flex-wrap" style={{ borderBottom: `1px solid ${C.line}` }}>
              <CostDonut slices={slices} total={c.cost} margin={c.margin} />
              <div className="min-w-0" style={{ flex: "1 1 220px" }}>
                {!slices.length && <div style={{ fontSize: 13, color: C.gray }}>Add what it takes to make and the breakdown appears here.</div>}
                {slices.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2 py-1" style={{ fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: SLICE[i % SLICE.length], flexShrink: 0 }} />
                    <span className="min-w-0 flex-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", color: C.gray }}>{c.cost ? `${((s.value / c.cost) * 100).toFixed(0)}%` : "—"}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, width: 66, textAlign: "right" }}>{usd(s.value)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-5">
                <Figure label="Cost to make" value={usd(c.cost)} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 4 }}>Sell price</div>
                  <input
                    type="number" step="any" value={sell}
                    onChange={(e) => setSell(e.target.value)}
                    onBlur={() => costing.setSellPrice(product.id, sell)}
                    placeholder="0.00" className="px-2 py-1.5 outline-none"
                    style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 110, fontSize: 14, background: C.surface }}
                  />
                </div>
                <Figure label="Profit" value={usd(c.profit)} />
                <Figure label="Margin" value={c.margin == null ? "—" : `${c.margin.toFixed(1)}%`} color={marginColor(c.margin)} big />
              </div>
            </div>

            {/* recipe */}
            <div className="px-4 py-3">
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 8 }}>
                What it takes to make
              </div>

              {c.lines.map((l, i) => (
                <div key={l.id} className="flex items-center gap-2 py-1.5 flex-wrap" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: SLICE[i % SLICE.length], flexShrink: 0 }} />
                  <span className="min-w-0" style={{ flex: "1 1 190px", fontSize: 13 }}>
                    {l.input ? l.input.name : <span style={{ color: C.rush }}>(deleted input)</span>}
                    {l.input && <span style={{ color: C.gray, fontSize: 12 }}> · {usd(l.input.unitPrice)}/{l.input.unit}</span>}
                  </span>
                  <input
                    type="number" step="any" defaultValue={l.qty}
                    onBlur={(e) => costing.saveLine({ ...l, qty: e.target.value })}
                    className="px-2 py-1 outline-none text-right"
                    style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 84, fontSize: 13, background: C.surface }}
                    title="How many per product"
                  />
                  <span style={{ width: 28, fontSize: 12, color: C.gray }}>{l.input?.unit || ""}</span>
                  <span style={{ width: 74, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 700, fontSize: 13 }}>{usd(l.cost)}</span>
                  <button onClick={() => costing.deleteLine(l.id)} title="Remove" style={{ color: C.gray, background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <div className="mt-3">
                <InlineMenu
                  options={costing.inputs.map((i) => ({ value: i.id, label: `${i.name} · ${usd(i.unitPrice)}/${i.unit}` }))}
                  onSelect={addLine}
                >
                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-bold uppercase tracking-wide btn-pop"
                    style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer" }}>
                    <Plus size={13} />Add material or labor
                  </span>
                </InlineMenu>
                {!costing.inputs.length && (
                  <span style={{ fontSize: 12, color: C.gray, marginLeft: 10 }}>Add some under “Materials &amp; labor” first.</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Figure({ label, value, color, big }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: big ? 22 : 18, fontWeight: 800, color: color || C.ink }}>{value}</div>
    </div>
  );
}

// ---- materials & labor library ---------------------------------------------
function InputLibrary({ costing }) {
  const [editing, setEditing] = useState(null);

  return (
    <>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div style={{ fontSize: 13, color: C.gray, flex: 1 }}>
          One price per material. Change it here and every product using it re-prices instantly.
        </div>
        <Btn kind="dark" onClick={() => setEditing({ kind: "material", unit: "each", unitPrice: "" })}><Plus size={13} />New material</Btn>
      </div>

      {!costing.inputs.length && <Empty>Nothing yet. Add the raw materials, thread, and labor rates you buy.</Empty>}

      {KINDS.map(({ key, label, Icon }) => {
        const list = costing.inputs.filter((i) => i.kind === key);
        if (!list.length) return null;
        return (
          <div key={key} className="mb-4">
            <div className="flex items-center gap-1.5 mb-2" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray }}>
              <Icon size={13} />{label}
            </div>
            {list.map((i) => {
              const used = costing.usageOf(i.id);
              return (
                <button key={i.id} onClick={() => setEditing(i)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded mb-1.5 text-left card-pop"
                  style={{ background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer" }}>
                  <span className="min-w-0 flex-1">
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name}</span>
                    {i.vendor && <span style={{ fontSize: 12, color: C.gray }}> · {i.vendor}</span>}
                    <div style={{ fontSize: 11.5, color: C.gray }}>
                      {used ? `Used on ${used} product${used === 1 ? "" : "s"}` : "Not used yet"}
                      {i.priceUpdatedAt ? ` · priced ${stamp(i.priceUpdatedAt)}` : ""}
                    </div>
                  </span>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 800, fontSize: 14 }}>{usd(i.unitPrice)}</span>
                  <span style={{ fontSize: 12, color: C.gray, width: 40 }}>/{i.unit}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      {editing && <InputEditor input={editing} costing={costing} onClose={() => setEditing(null)} />}
    </>
  );
}

function InputEditor({ input, costing, onClose }) {
  const [f, setF] = useState({
    kind: input.kind || "material", name: input.name || "", unit: input.unit || "each",
    unitPrice: input.unitPrice ?? "", vendor: input.vendor || "", sku: input.sku || "", note: input.note || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const used = input.id ? costing.usageOf(input.id) : 0;
  const priceChanged = input.id ? Number(f.unitPrice || 0) !== Number(input.unitPrice || 0) : true;

  const save = async () => {
    if (!f.name.trim() || saving) return;
    setSaving(true);
    try {
      await costing.saveInput({ ...input, ...f, priceChanged });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: C.surface, fontSize: 13, borderRadius: 6 };
  const label = { fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", zIndex: 90, padding: "24px 12px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          {input.id ? "Edit" : "New"} {f.kind === "labor" ? "labor rate" : f.kind === "other" ? "cost" : "material"}
        </div>
        <div className="p-4">
          <div className="mb-3">
            <div style={label}>Type</div>
            <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
              {KINDS.map(({ key, label: lbl, Icon }) => (
                <button key={key} onClick={() => set("kind", key)} className="flex items-center gap-1.5 px-3 py-2"
                  style={f.kind === key ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft }}>
                  <Icon size={13} /><span style={{ fontSize: 12, fontWeight: 700 }}>{lbl}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div style={label}>Name *</div>
            <input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={f.kind === "labor" ? "e.g. Sewing labor" : "e.g. Black thread"} className="w-full px-2 py-2 outline-none" style={inp} />
          </div>

          <div className="flex gap-3 mb-3 flex-wrap">
            <div style={{ flex: "1 1 120px" }}>
              <div style={label}>Price</div>
              <input type="number" step="any" value={f.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="0.00" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <div style={label}>Per</div>
              <input value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder={f.kind === "labor" ? "hr" : "ft, yd, each"} className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <div style={label}>Vendor</div>
              <input value={f.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Where you buy it" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
          </div>

          {input.id && priceChanged && used > 0 && (
            <div className="mb-3" style={{ border: `1px solid ${C.high}`, background: C.highBg, borderRadius: 6, padding: "8px 10px", fontSize: 12.5, color: C.inkSoft }}>
              This re-prices <b>{used} product{used === 1 ? "" : "s"}</b> using it.
            </div>
          )}

          <div className="mb-4">
            <div style={label}>Notes</div>
            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }} />
          </div>

          <div className="flex gap-2">
            <Btn kind="dark" onClick={save} disabled={!f.name.trim() || saving}><Check size={14} />{saving ? "Saving…" : "Save"}</Btn>
            <Btn onClick={onClose}>Cancel</Btn>
            {input.id && (
              <span className="ml-auto">
                <Btn onClick={async () => { await costing.deleteInput(input.id); onClose(); }}><Trash2 size={13} />Delete</Btn>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
