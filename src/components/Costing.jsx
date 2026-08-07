import React, { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, Search, Package, Wrench, DollarSign, Check } from "lucide-react";
import { C, stamp } from "../theme.js";
import { Btn, Empty, InlineMenu } from "./ui.jsx";

const usd = (n) =>
  n == null || isNaN(n) ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KINDS = [
  { key: "material", label: "Material", Icon: Package },
  { key: "labor", label: "Labor", Icon: Wrench },
  { key: "other", label: "Other", Icon: DollarSign },
];

// Margin colour: healthy / thin / underwater. Deliberately blunt — the whole
// point of this screen is spotting the products that aren't making money.
const marginColor = (m) => (m == null ? C.gray : m < 0 ? C.rush : m < 25 ? C.high : C.green);

export default function Costing({ costing, productNames = [], onClose }) {
  const [view, setView] = useState("products"); // products | inputs
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null); // product name

  // Every product we've ever ordered, plus anything already costed, deduped.
  const allProducts = useMemo(() => {
    const byName = new Map();
    productNames.forEach((n) => byName.set(n, { name: n, costed: null }));
    costing.products.forEach((p) => byName.set(p.name, { name: p.name, costed: p }));
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [productNames, costing.products]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? allProducts.filter((p) => p.name.toLowerCase().includes(t)) : allProducts;
    return list.slice(0, 300); // the catalog is ~1,800 — render a slice, search narrows it
  }, [allProducts, q]);

  const selectedRow = allProducts.find((p) => p.name === selected) || null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: C.concrete, overflowY: "auto" }}>
      {/* header — mirrors the app's top bar so this reads as part of the app */}
      <div className="flex items-center gap-3 px-5 py-3 flex-wrap" style={{ background: C.fill, color: "#fff", position: "sticky", top: 0, zIndex: 2 }}>
        <button onClick={onClose} className="inline-flex items-center gap-1.5" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          <ArrowLeft size={17} />Back to board
        </button>
        <span style={{ fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", fontSize: 13, marginLeft: 6 }}>Costing &amp; margins</span>
        <div className="flex items-center gap-1 ml-auto">
          {[["products", "Products"], ["inputs", "Materials & labor"]].map(([k, lbl]) => (
            <button key={k} onClick={() => setView(k)} className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
              style={view === k ? { background: "rgba(255,255,255,0.18)", color: "#fff", border: "none" } : { background: "transparent", color: "rgba(255,255,255,0.7)", border: "none" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        {view === "inputs"
          ? <InputLibrary costing={costing} />
          : selectedRow
            ? <ProductSheet row={selectedRow} costing={costing} onBack={() => setSelected(null)} />
            : <ProductList shown={shown} total={allProducts.length} q={q} setQ={setQ} costing={costing} onPick={setSelected} />}
      </div>
    </div>
  );
}

// ---- product list -----------------------------------------------------------
function ProductList({ shown, total, q, setQ, costing, onPick }) {
  const costedCount = costing.products.length;
  return (
    <>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 px-2 rounded" style={{ border: `1px solid ${C.line}`, background: C.surface, flex: "1 1 260px" }}>
          <Search size={15} color={C.gray} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="flex-1 py-2 outline-none" style={{ background: "transparent", border: "none", fontSize: 13 }} />
        </div>
        <span style={{ fontSize: 12, color: C.gray }}>
          {costedCount} of {total} costed
        </span>
      </div>

      {!shown.length && <Empty>No product matches “{q}”.</Empty>}

      {shown.map((p) => {
        const c = p.costed ? costing.costOf(p.costed) : null;
        return (
          <button
            key={p.name}
            onClick={() => onPick(p.name)}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded mb-1.5 text-left card-pop"
            style={{ background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer" }}
          >
            <span className="min-w-0 flex-1" style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </span>
            {c ? (
              <>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, color: C.gray, width: 90, textAlign: "right" }}>{usd(c.cost)} cost</span>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, color: C.inkSoft, width: 90, textAlign: "right" }}>{usd(c.sell)} sell</span>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, fontWeight: 800, color: marginColor(c.margin), width: 70, textAlign: "right" }}>
                  {c.margin == null ? "—" : `${c.margin.toFixed(0)}%`}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11.5, color: C.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Not costed</span>
            )}
          </button>
        );
      })}
      {shown.length >= 300 && (
        <div style={{ fontSize: 12, color: C.gray, marginTop: 8 }}>
          Showing the first 300 — search to narrow it down.
        </div>
      )}
    </>
  );
}

// ---- one product's cost sheet ----------------------------------------------
function ProductSheet({ row, costing, onBack }) {
  const [busy, setBusy] = useState(false);
  const product = row.costed;
  const c = product ? costing.costOf(product) : null;
  const [sell, setSell] = useState(product?.sellPrice ?? "");

  const start = async () => {
    setBusy(true);
    try { await costing.ensureProduct(row.name); } finally { setBusy(false); }
  };

  const addLine = async (inputId) => {
    const id = product?.id || (await costing.ensureProduct(row.name));
    await costing.saveLine({ productId: id, inputId, qty: 1, position: (c?.lines.length || 0) + 1 });
  };

  return (
    <>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 mb-3" style={{ background: "none", border: "none", color: C.blue, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
        <ArrowLeft size={14} />All products
      </button>

      <div className="rounded mb-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{row.name}</div>
        </div>

        {!product ? (
          <div className="px-4 py-5 text-center">
            <div style={{ fontSize: 13, color: C.gray, marginBottom: 10 }}>This product hasn’t been costed yet.</div>
            <Btn kind="dark" onClick={start} disabled={busy}><Plus size={13} />{busy ? "Starting…" : "Start costing it"}</Btn>
          </div>
        ) : (
          <>
            {/* recipe */}
            <div className="px-4 py-3">
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 8 }}>
                What it takes to make
              </div>

              {!c.lines.length && <div style={{ fontSize: 13, color: C.gray, marginBottom: 10 }}>Nothing added yet — add the materials, thread, labor and so on below.</div>}

              {c.lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2 py-1.5 flex-wrap" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <span className="min-w-0" style={{ flex: "1 1 200px", fontSize: 13 }}>
                    {l.input ? l.input.name : <span style={{ color: C.rush }}>(deleted input)</span>}
                    {l.input && <span style={{ color: C.gray, fontSize: 12 }}> · {usd(l.input.unitPrice)}/{l.input.unit}</span>}
                  </span>
                  <input
                    type="number" step="any" defaultValue={l.qty}
                    onBlur={(e) => costing.saveLine({ ...l, qty: e.target.value })}
                    className="px-2 py-1 outline-none text-right"
                    style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 90, fontSize: 13, background: C.surface }}
                    title="How many per product"
                  />
                  <span style={{ width: 30, fontSize: 12, color: C.gray }}>{l.input?.unit || ""}</span>
                  <span style={{ width: 80, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 700, fontSize: 13 }}>{usd(l.cost)}</span>
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
                  <span style={{ fontSize: 12, color: C.gray, marginLeft: 10 }}>
                    Add some under “Materials &amp; labor” first.
                  </span>
                )}
              </div>
            </div>

            {/* the numbers */}
            <div className="px-4 py-3 flex flex-wrap items-end gap-5" style={{ borderTop: `1px solid ${C.line}`, background: C.concrete }}>
              <Figure label="Cost to make" value={usd(c.cost)} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray, marginBottom: 4 }}>Sell price</div>
                <input
                  type="number" step="any" value={sell}
                  onChange={(e) => setSell(e.target.value)}
                  onBlur={() => costing.setSellPrice(product.id, sell)}
                  placeholder="0.00"
                  className="px-2 py-1.5 outline-none"
                  style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 120, fontSize: 14, background: C.surface }}
                />
              </div>
              <Figure label="Profit" value={usd(c.profit)} />
              <Figure label="Margin" value={c.margin == null ? "—" : `${c.margin.toFixed(1)}%`} color={marginColor(c.margin)} big />
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
  const [editing, setEditing] = useState(null); // input object or {} for new

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
        const rows = costing.inputs.filter((i) => i.kind === key);
        if (!rows.length) return null;
        return (
          <div key={key} className="mb-4">
            <div className="flex items-center gap-1.5 mb-2" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.gray }}>
              <Icon size={13} />{label}
            </div>
            {rows.map((i) => {
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
