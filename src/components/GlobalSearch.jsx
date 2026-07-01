import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { C } from "../theme.js";

// Global order search that lives in the top bar. Matches across order number,
// customer, the person who ordered (contact), ship-to, and product (line-item)
// names — across EVERY order, no matter which tab you're in. Each result shows
// which tabs the order lives in (its items can span several); click the order to
// open its detail, or a tab chip to jump straight there and flash the card.
export function GlobalSearch({ orders, onOpen, locate, onGoToTab }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Ctrl/Cmd+F jumps straight to this search (find an order by #, customer, or
  // product) instead of the browser's page-find, which the crew asked for.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const query = q.trim().toLowerCase();
  const results = query
    ? orders
        .filter((o) => {
          if (String(o.orderNo).toLowerCase().includes(query)) return true;
          if ((o.customer || "").toLowerCase().includes(query)) return true;
          if ((o.contact || "").toLowerCase().includes(query)) return true;
          if ((o.shipTo || "").toLowerCase().includes(query)) return true; // the drop-ship recipient
          return (o.items || []).some((it) => (it.name || "").toLowerCase().includes(query));
        })
        .slice(0, 12)
    : [];

  const close = () => { setOpen(false); setQ(""); };
  const pick = (o) => { onOpen(o.id); close(); };            // open the order's detail
  const goTab = (o, tabKey) => { onGoToTab?.(o.id, tabKey); close(); }; // jump to a tab + flash

  return (
    <div ref={ref} className="shrink-0" style={{ position: "relative" }}>
      <div className="flex items-center gap-2 px-3 rounded" style={{ background: "rgba(255,255,255,0.12)", height: 34 }}>
        <Search size={15} color="rgba(255,255,255,0.7)" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          placeholder="Search order #, customer, product… (Ctrl+F)"
          style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 13, width: "clamp(104px, 32vw, 210px)" }}
        />
        {q && (
          <button onClick={() => { setQ(""); setOpen(false); }} style={{ color: "rgba(255,255,255,0.6)", display: "flex" }}>
            <X size={14} />
          </button>
        )}
      </div>

      {open && query && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 380,
            maxHeight: 440,
            overflowY: "auto",
            background: C.surface,
            borderRadius: 8,
            boxShadow: "0 12px 36px rgba(0,0,0,0.22)",
            border: `1px solid ${C.line}`,
            zIndex: 70,
            color: C.ink,
          }}
        >
          {!results.length && (
            <div style={{ padding: "14px 16px", fontSize: 13, color: C.gray }}>No matches for "{q}".</div>
          )}
          {results.map((o) => {
            const matchItem = (o.items || []).find((it) => (it.name || "").toLowerCase().includes(query));
            const extra = (o.items || []).length - 1;
            const locs = locate ? locate(o) : [];
            return (
              <div
                key={o.id}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.grayBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                style={{ padding: "9px 14px", borderBottom: `1px solid ${C.line}`, transition: "background 0.1s" }}
              >
                <div onClick={() => pick(o)} style={{ cursor: "pointer" }} title="Open order details">
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 13 }}>#{o.orderNo}</span>
                    <span className="font-bold truncate" style={{ fontSize: 13 }}>{o.customer}</span>
                    <span className="ml-auto shrink-0" style={{ fontSize: 11, color: C.gray }}>{o.source}</span>
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: C.gray, marginTop: 2, maxWidth: 350 }}>
                    {matchItem ? matchItem.name : `${o.items.length} item${o.items.length === 1 ? "" : "s"}`}
                    {matchItem && extra > 0 ? ` · +${extra} more` : ""}
                  </div>
                </div>
                {locs.length > 0 && (
                  <div className="flex items-center flex-wrap gap-1" style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 1 }}>In</span>
                    {locs.map((loc) => (
                      <button
                        key={loc.k}
                        className="btn-pop"
                        onClick={() => goTab(o, loc.k)}
                        title={`Go to ${loc.label} and flash this order`}
                        style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, padding: "2px 8px", borderRadius: 5, background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {loc.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
