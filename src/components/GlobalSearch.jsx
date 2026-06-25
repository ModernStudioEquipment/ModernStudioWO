import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { C } from "../theme.js";

// Global order search that lives in the top bar. Matches across order number,
// customer, the person who ordered (contact), and product (line-item) names —
// across every order regardless of which stage/tab it's in. Picking a result
// opens that order's detail, so you never have to scroll a list to find one.
export function GlobalSearch({ orders, onOpen }) {
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
          return (o.items || []).some((it) => (it.name || "").toLowerCase().includes(query));
        })
        .slice(0, 12)
    : [];

  const pick = (o) => {
    onOpen(o.id);
    setOpen(false);
    setQ("");
  };

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
            background: "#fff",
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
            return (
              <button
                key={o.id}
                onClick={() => pick(o)}
                className="flex flex-col w-full hover:bg-gray-100"
                style={{ textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 13 }}>#{o.orderNo}</span>
                  <span className="font-bold truncate" style={{ fontSize: 13 }}>{o.customer}</span>
                  <span className="ml-auto shrink-0" style={{ fontSize: 11, color: C.gray }}>{o.source}</span>
                </div>
                <div className="truncate" style={{ fontSize: 12, color: C.gray, marginTop: 2, maxWidth: 350 }}>
                  {matchItem ? matchItem.name : `${o.items.length} item${o.items.length === 1 ? "" : "s"}`}
                  {matchItem && extra > 0 ? ` · +${extra} more` : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
