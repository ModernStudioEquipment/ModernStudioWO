import React, { useEffect, useState } from "react";
import { X, RefreshCw, Plus, Trash2, Pencil, AlertTriangle, Check } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// Re-load one order from whichever system it came from. Always shows what WILL
// change before anything does — the endpoint's GET is a dry run, and only the
// confirm button POSTs. Nothing here writes on open.
//
// Both intake paths have the same blind spot: they only ever ADD. QuickBooks
// can't tell a renamed line from a new one, and the Shopify webhook fires once
// at order creation and then de-dupes forever. Either way, an order edited after
// it synced silently stays wrong on the board until someone re-loads it.
export function ResyncModal({ order, onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // Same request shape either way; only the endpoint differs.
  const system = order.source === "Shopify" ? "Shopify" : "QuickBooks";
  const endpoint = order.source === "Shopify"
    ? `/api/shopify-resync?order=${encodeURIComponent(order.orderNo)}`
    : `/api/conductor-sync?resync=${encodeURIComponent(order.orderNo)}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(endpoint);
        const body = await res.json();
        if (!live) return;
        if (!res.ok) setError(body.error || `Couldn't read this order from ${system}.`);
        else setPlan(body);
      } catch (e) {
        if (live) setError(String(e));
      }
    })();
    return () => { live = false; };
  }, [endpoint, system]);

  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setError(body.error || "Couldn't apply the changes.");
      else { setResult(body); onDone?.(); }
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const Row = ({ icon, color, children }) => (
    <div className="flex items-start gap-2 py-1.5" style={{ fontSize: 13, borderBottom: `1px solid ${C.line}` }}>
      <span style={{ color, flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );

  const risky = (plan?.remove || []).filter((r) => r.hasWork);

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "95vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <RefreshCw size={17} />Re-sync #{order.orderNo} from {system}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>

        <div className="p-4" style={{ maxHeight: "78vh", overflowY: "auto" }}>
          {error && (
            <div style={{ border: `1px solid ${C.rush}`, background: C.rushBg, color: C.rush, borderRadius: 6, padding: "9px 11px", fontSize: 13 }}>
              {error}
            </div>
          )}

          {!plan && !error && <div style={{ fontSize: 13, color: C.gray }}>Reading this order from QuickBooks…</div>}

          {result && (
            <div style={{ border: `1px solid ${C.green}`, background: C.greenBg, color: C.green, borderRadius: 6, padding: "10px 12px", fontSize: 13, fontWeight: 700 }}>
              <Check size={14} style={{ verticalAlign: "-2px" }} /> Done — {result.added} added, {result.updated} updated, {result.removed} removed.
            </div>
          )}

          {plan && !result && (
            <>
              <div style={{ fontSize: 12.5, color: C.gray, marginBottom: 12 }}>
                Board has {plan.boardItems} item{plan.boardItems === 1 ? "" : "s"} · this {plan.kind} has {plan.sourceItems ?? plan.quickbooksItems} in {system}.
              </div>

              {/* Cancelled upstream is worth saying out loud — but it stays a
                  warning, not an action. Cancelling the order is a person's call. */}
              {plan.cancelledInShopify && (
                <div className="flex items-start gap-2 mb-3" style={{ border: `1px solid ${C.rush}`, background: C.rushBg, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, color: C.inkSoft }}>
                  <AlertTriangle size={14} style={{ color: C.rush, flexShrink: 0, marginTop: 1 }} />
                  <span>This order is <b>cancelled in Shopify</b>. Re-syncing won't cancel it here — do that from the order if it should come off the board.</span>
                </div>
              )}

              {plan.inSync ? (
                <div style={{ border: `1px solid ${C.green}`, background: C.greenBg, color: C.green, borderRadius: 6, padding: "10px 12px", fontSize: 13, fontWeight: 700 }}>
                  <Check size={14} style={{ verticalAlign: "-2px" }} /> Already matches {system} — nothing to change.
                </div>
              ) : (
                <>
                  {!!plan.add.length && (
                    <div className="mb-3">
                      <Label>Will be added</Label>
                      {plan.add.map((a, i) => (
                        <Row key={i} icon={<Plus size={14} />} color={C.green}>
                          <b>{a.name}</b> <span style={{ color: C.gray }}>×{a.qty}</span>
                        </Row>
                      ))}
                    </div>
                  )}

                  {!!plan.update.length && (
                    <div className="mb-3">
                      <Label>Will be updated</Label>
                      {plan.update.map((u, i) => (
                        <Row key={i} icon={<Pencil size={14} />} color={C.blue}>
                          <b>{u.from.name}</b>
                          {u.to.name && <div style={{ color: C.gray }}>name → {u.to.name}</div>}
                          {u.to.qty && <div style={{ color: C.gray }}>qty {u.from.qty} → {u.to.qty}</div>}
                        </Row>
                      ))}
                    </div>
                  )}

                  {!!plan.remove.length && (
                    <div className="mb-3">
                      <Label>Will be removed (no longer in {system})</Label>
                      {plan.remove.map((r, i) => (
                        <Row key={i} icon={<Trash2 size={14} />} color={r.hasWork ? C.rush : C.gray}>
                          <b>{r.name}</b> <span style={{ color: C.gray }}>×{r.qty}</span>
                          {r.hasWork && (
                            <div style={{ color: C.rush, fontWeight: 700 }}>
                              someone has worked on this ({r.stage})
                            </div>
                          )}
                        </Row>
                      ))}
                    </div>
                  )}

                  {!!risky.length && (
                    <div className="flex items-start gap-2 mb-3" style={{ border: `1px solid ${C.rush}`, background: C.rushBg, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, color: C.inkSoft }}>
                      <AlertTriangle size={14} style={{ color: C.rush, flexShrink: 0, marginTop: 1 }} />
                      <span>
                        {risky.length === 1 ? "One item" : `${risky.length} items`} being removed {risky.length === 1 ? "has" : "have"} work
                        logged against {risky.length === 1 ? "it" : "them"}. Check with the floor before applying.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Btn kind="dark" onClick={apply} disabled={applying}>
                      <RefreshCw size={14} />{applying ? "Applying…" : "Apply these changes"}
                    </Btn>
                    <Btn onClick={onClose}>Cancel</Btn>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 800, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{children}</div>
);

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 70, padding: "24px 12px",
};
