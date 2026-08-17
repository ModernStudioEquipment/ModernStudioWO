import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Clock, Printer, Plus, Truck, CheckCircle2, AlertTriangle, Hammer,
  Flag, Check, ArrowRight, ShoppingCart, LogOut, Store, MapPin, Package, X, Bell, ExternalLink, RefreshCw, Pencil, RotateCcw, ChevronsDownUp, ChevronsUpDown, Sun, Moon, MonitorPlay, Layers, ArrowUpDown, ChevronLeft, ChevronRight, PackageSearch, Trash2, DollarSign,
} from "lucide-react";
import { C, PRI, PRI_CYCLE, PRI_RANK, elapsed, stamp, materialKey, quoteNoteFor, blocked, pct, dueLabel, priLabel, effectivePriority, trackingUrl, stagedTooLong, stagedDwellMs, STAGE_LABELS } from "./theme.js";
import { backendMode, db } from "./lib/db.js";
import { useAuth } from "./hooks/useAuth.js";
import { useOrders } from "./hooks/useOrders.js";
import { useWorkOrders } from "./hooks/useWorkOrders.js";
import { useUndo } from "./hooks/useUndo.js";
import { useStockNotices } from "./hooks/useStockNotices.js";
import { useCosting } from "./hooks/useCosting.js";
import {
  Pill, Btn, Group, ItemLine, Empty, Tabwrap, DeptBadge, DuePill, CompletionPill, MethodBadge, InvoicedBadge, MoveMenu, SittingBadge, InlineMenu,
} from "./components/ui.jsx";
import { Auth } from "./components/Auth.jsx";
import { Logo } from "./components/Logo.jsx";
import { Dashboard } from "./components/Dashboard.jsx";
import { GlobalSearch } from "./components/GlobalSearch.jsx";
import FloorControl from "./floor/FloorControl.jsx";
import Costing from "./components/Costing.jsx";
import { SyncButton } from "./components/SyncButton.jsx";
import { MaterialModal } from "./components/modals/MaterialModal.jsx";
import { OrderDetail } from "./components/modals/OrderDetail.jsx";
import { PickPhoto } from "./components/modals/PickPhoto.jsx";
import { WorkOrderDoc } from "./components/modals/WorkOrderDoc.jsx";
import { NewOrderModal } from "./components/modals/NewOrderModal.jsx";
import { NewPurchaseModal } from "./components/modals/NewPurchaseModal.jsx";
import { NewNoticeModal } from "./components/modals/NewNoticeModal.jsx";
import { QuoteModal } from "./components/modals/QuoteModal.jsx";
import { ResyncModal } from "./components/modals/ResyncModal.jsx";
import { FulfillModal } from "./components/modals/FulfillModal.jsx";
import { TrackingModal } from "./components/modals/TrackingModal.jsx";
import { PickedUpModal } from "./components/modals/PickedUpModal.jsx";
import { PartialModal } from "./components/modals/PartialModal.jsx";
import { InvoiceModal } from "./components/modals/InvoiceModal.jsx";
import { OrderedModal } from "./components/modals/OrderedModal.jsx";
import { ReceiveModal } from "./components/modals/ReceiveModal.jsx";
import { CustomWorkOrderDoc } from "./components/modals/CustomWorkOrderDoc.jsx";
import { WO_TYPES } from "./components/workorders/forms.js";

export default function App() {
  const auth = useAuth();
  const authed = !auth.needsAuth || !!auth.user;
  const board = useOrders(authed);
  const wo = useWorkOrders(authed);
  const undoer = useUndo();
  const [costingOpen, setCostingOpen] = useState(false); // full-screen costing / margins world
  const stock = useStockNotices(authed);
  const costing = useCosting(authed && costingOpen);
  // Cancelled orders are kept on record in the DB but hidden from every board.
  const allOrders = board.orders;

  const orders = allOrders.filter((o) => !o.cancelledAt);

  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("mse_tab_v1") || "dash"; } catch { return "dash"; }
  });
  const [now, setNow] = useState(Date.now());
  // Per-device dark mode — saved in localStorage only, never shared with the team.
  // A `.dark` class on <html> swaps the CSS color tokens; index.html applies the
  // saved choice before first paint so there's no flash of light on load.
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("mse_theme_v1") === "dark"; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("mse_theme_v1", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  // A pill behind the active tab that glides to whichever tab is selected. Measures
  // the active tab each render; only updates (and only animates after the first
  // paint) when the geometry actually changes, so there's no flash and no loop.
  const tabEls = useRef({});
  const tabFirst = useRef(true);
  const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0, animate: false });
  useLayoutEffect(() => {
    const el = tabEls.current[tab];
    if (!el) return;
    const n = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, animate: !tabFirst.current };
    tabFirst.current = false;
    setPill((p) => (p.left === n.left && p.top === n.top && p.width === n.width && p.height === n.height) ? p : n);
  });

  // Sideways nav arrows: shown ONLY when a tab is actually cut off, and each side
  // disappears once you've reached that end of the strip. Re-measured on scroll,
  // on resize, and after every render (tab counts change the strip's width).
  const tabStripRef = useRef(null);
  const [navScroll, setNavScroll] = useState({ left: false, right: false });
  const measureTabs = useCallback(() => {
    const el = tabStripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const l = max > 2 && el.scrollLeft > 2;
    const r = max > 2 && el.scrollLeft < max - 2;
    // Same-object return when unchanged, so this can run every render without looping.
    setNavScroll((p) => (p.left === l && p.right === r ? p : { left: l, right: r }));
  }, []);
  useLayoutEffect(measureTabs);
  useEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    el.addEventListener("scroll", measureTabs, { passive: true });
    window.addEventListener("resize", measureTabs);
    // The strip can change width without the window resizing — a count badge
    // appearing, the search box growing — so watch the element itself too.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureTabs) : null;
    if (ro) { ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild); }
    return () => {
      el.removeEventListener("scroll", measureTabs);
      window.removeEventListener("resize", measureTabs);
      ro?.disconnect();
    };
  }, [measureTabs]);
  // Glide to the new position. Animated by hand rather than with
  // scrollBy({behavior:"smooth"}) because native smooth scrolling is silently a
  // no-op in some browsers — that's what made the arrows do nothing at first.
  const tabAnimRef = useRef(0);
  const tabSnapRef = useRef(0);
  const nudgeTabs = (dir) => {
    const el = tabStripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const step = Math.max(160, el.clientWidth * 0.6);
    const from = el.scrollLeft;
    const to = Math.max(0, Math.min(max, from + dir * step));
    if (to === from) return;
    cancelAnimationFrame(tabAnimRef.current);
    clearTimeout(tabSnapRef.current);
    const t0 = performance.now();
    const dur = 280;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // easeInOutQuad
    const tick = (nowT) => {
      const t = Math.min(1, (nowT - t0) / dur);
      el.scrollLeft = from + (to - from) * ease(t);
      measureTabs();
      if (t < 1) tabAnimRef.current = requestAnimationFrame(tick);
    };
    tabAnimRef.current = requestAnimationFrame(tick);
    // rAF is paused in a backgrounded tab, so the animation might never run.
    // Land on the target anyway — a button that does nothing is worse than a jump.
    tabSnapRef.current = setTimeout(() => {
      if (Math.abs(el.scrollLeft - to) > 1) { el.scrollLeft = to; measureTabs(); }
    }, dur + 60);
  };
  useEffect(() => () => { cancelAnimationFrame(tabAnimRef.current); clearTimeout(tabSnapRef.current); }, []);
  const [matTarget, setMatTarget] = useState(null); // itemId awaiting material entry
  const [doc, setDoc] = useState(null); // { o, it } for printable work order
  const [likeKinds, setLikeKinds] = useState(null); // { o, it, others } — same product on other orders
  const [showNewNotice, setShowNewNotice] = useState(false); // low-stock notice form
  const [quoteTarget, setQuoteTarget] = useState(null); // { materials: [...] } awaiting quote notes
  const [resyncTarget, setResyncTarget] = useState(null); // order being re-loaded (QuickBooks or Shopify)
  const [flashItem, setFlashItem] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [flashOrderId, setFlashOrderId] = useState(null); // order to scroll to + flash after a search jump
  const [confirmStock, setConfirmStock] = useState(null); // New Orders item id awaiting the "already picked?" answer
  const [pickNotesOnly, setPickNotesOnly] = useState(false); // Pick List: show only orders with a noted item
  const [pickItem, setPickItem] = useState(null); // { o, it }
  const [orderView, setOrderView] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [sortBy, setSortBy] = useState("newest"); // shared across every order list: newest / oldest / order # / due
  const [newSource, setNewSource] = useState("all"); // New Orders filter: all / QuickBooks / Shopify
  const [orderSource, setOrderSource] = useState("all"); // Orders tab filter: all / QuickBooks / Shopify
  const [orderDrag, setOrderDrag] = useState(null); // order id being dragged in the Orders tab (for the visual dim)
  const orderDragRef = useRef(null); // synchronous copy so the drop handler never reads a stale value
  const [optArr, setOptArr] = useState(null); // optimistic manual order during a drag (snappy before the DB write lands)
  // Shared drag-reorder: the sequence lives in the DB (app_settings, key
  // "orders_manual") so the whole crew sees the same order; realtime keeps boards synced.
  const manualOrder = optArr || board.arrangement || [];
  useEffect(() => { setOptArr(null); }, [board.arrangement]); // once the saved order lands, drop the optimistic copy
  // Per-computer collapse memory: which order cards are expanded, scoped per
  // board ('new' / 'pick'). Default = collapsed (absent from the set). Kept in
  // localStorage so it's per-machine and NOT shared across the crew.
  const [expanded, setExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mse_expanded_v1") || "{}"); } catch { return {}; }
  });
  const [fulfillTarget, setFulfillTarget] = useState(null); // { order, method }
  const [trackTarget, setTrackTarget] = useState(null); // order being marked shipped
  const [pickupTarget, setPickupTarget] = useState(null); // will-call order being marked picked up
  const [walkInTarget, setWalkInTarget] = useState(null); // order a walk-in customer collected straight from the board
  const [partialTarget, setPartialTarget] = useState(null); // { order, kind } partial pickup/shipment
  const [invoiceTarget, setInvoiceTarget] = useState(null); // QB order whose invoice number is being entered
  const [orderTarget, setOrderTarget] = useState(null); // purchasing material being marked ordered (asks who/vendor/PO)
  const [receiveTarget, setReceiveTarget] = useState(null); // { it, m } material being received (asks dest tab/qty/note)
  const [syncing, setSyncing] = useState(false); // QuickBooks sync in progress
  const [customDoc, setCustomDoc] = useState(null); // work order sheet open for edit ({type} = new, or a saved WO)
  const [workCombined, setWorkCombined] = useState(false); // Work Order tab: combine like items across orders
  const [floorOpen, setFloorOpen] = useState(false); // full-screen dark "Floor Control" world

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Persist the collapse memory on this machine.
  useEffect(() => {
    try { localStorage.setItem("mse_expanded_v1", JSON.stringify(expanded)); } catch { /* ignore */ }
  }, [expanded]);

  // Remember the active tab so a full-page refresh stays put (per machine).
  useEffect(() => {
    try { localStorage.setItem("mse_tab_v1", tab); } catch { /* ignore */ }
  }, [tab]);
  const isExpanded = (scope, id) => !!(expanded[scope] && expanded[scope][id]);
  const toggleExpanded = (scope, id) => setExpanded((m) => {
    const cur = { ...(m[scope] || {}) };
    if (cur[id]) delete cur[id]; else cur[id] = true;
    return { ...m, [scope]: cur };
  });
  const setAllExpanded = (scope, ids, on) => setExpanded((m) => ({
    ...m, [scope]: on ? Object.fromEntries(ids.map((id) => [id, true])) : {},
  }));

  // After a search jump, scroll the order's card into view and flash it —
  // works in whatever tab the card lives in (id set on every order element).
  useEffect(() => {
    if (!flashOrderId) return;
    const t1 = setTimeout(() => {
      const el = document.getElementById(`order-${flashOrderId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash-order");
        setTimeout(() => el.classList.remove("flash-order"), 2800);
      }
    }, 60);
    const t2 = setTimeout(() => setFlashOrderId(null), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [flashOrderId]);

  // ---- gating: auth must resolve before we show anything ----
  if (auth.needsAuth && !auth.ready) {
    return <Splash>Connecting…</Splash>;
  }
  if (auth.needsAuth && !auth.user) {
    return <Auth auth={auth} />;
  }
  // Scoped login: a CNC lead (role "cnc") only ever sees the CNC Floor Control —
  // no office board, no other departments, no way back to the office.
  if (auth.role === "cnc") {
    return <FloorControl cncOnly orders={orders} onSignOut={auth.signOut} />;
  }

  // Search result clicked: take you to that order in the tab you're already in
  // (scroll + flash). If it's not on a list tab (e.g. the Dashboard), fall back
  // to the Orders tab, which lists everything.
  const goToOrder = (id) => {
    if (!document.getElementById(`order-${id}`)) {
      setTab("orders");
      setOrderView("all");
    }
    setFlashOrderId(id);
  };
  // From a search result's location chip: jump to that tab and flash the order there.
  const goToTab = (id, tabKey) => {
    setTab(tabKey);
    if (tabKey === "orders") setOrderView("all");
    setFlashOrderId(id);
  };

  // ---- triage / workflow handlers ----
  // Triage is the New Orders routing decision (In stock / Create WO). It's the
  // easiest thing on the board to mis-tap, so it's undoable too — back to "new".
  const triage = async (itemId, decision) => {
    if (decision === "need") return setMatTarget(itemId);
    const { it, o } = findItem(itemId);
    const prev = it?.stage;
    await board.triageItem(itemId, decision);
    if (prev) {
      const dest = decision === "instock" ? "picklist" : "workorder";
      undoer.record(label(it, o, `Sent to ${STAGE_LABELS[dest] || dest}`), () => board.moveItem(itemId, prev));
    }
  };
  const commitMaterials = async (rows) => {
    await board.addMaterials(matTarget, rows);
    setMatTarget(null);
  };
  const cyclePri = (orderId, cur) => board.setPriority(orderId, PRI_CYCLE[cur]);

  // --- Undo (one deep, this device) -------------------------------------------
  // Stage changes are the easy ones to mis-tap and the hardest to trace after the
  // fact ("what did I just mark done?"), so they capture the item's previous
  // stage BEFORE the write and record how to put it back.
  const findItem = (itemId) => {
    for (const o of orders) {
      const it = o.items.find((x) => x.id === itemId);
      if (it) return { it, o };
    }
    return {};
  };
  const label = (it, o, what) => `${what} — ${it.name}${o ? ` (#${o.orderNo})` : ""}`;
  const finishItemU = async (itemId) => {
    const { it, o } = findItem(itemId);
    const prev = it?.stage;
    const fresh = await board.finishItem(itemId);
    if (prev) undoer.record(label(it, o, "Marked done"), () => board.moveItem(itemId, prev));
    // Finishing the LAST product means the order is ready to go somewhere — ask
    // right here (destination + location) instead of leaving it parked on the
    // board waiting for someone to notice it's done.
    const updated = (fresh || []).find((x) => x.id === o?.id);
    if (updated && !updated.fulfillment && !updated.cancelledAt &&
        updated.items.length && updated.items.every((i) => i.stage === "done")) {
      setDetailId(null);
      setFulfillTarget({ order: updated, method: updated.fulfillmentMethod || null });
    }
  };
  const moveItemU = async (itemId, stage) => {
    const { it, o } = findItem(itemId);
    const prev = it?.stage;
    await board.moveItem(itemId, stage);
    if (prev) undoer.record(label(it, o, `Moved to ${STAGE_LABELS[stage] || stage}`), () => board.moveItem(itemId, prev));
  };
  const markWoDoneU = async (w) => {
    await wo.markDone(w.id);
    undoer.record(`Marked done — work order #${w.orderNo || ""}`.trim(), () => wo.markDone(w.id, false));
  };
  // --- Purchasing: demand for the same product across the whole board ----------
  // A buyer marking one line ordered needs to see every OTHER open line for the
  // same material, so they can buy for all of them in one go instead of ordering
  // the same thing three times. Matched on the material name, case-insensitive.
  const demandFor = (name, exceptId = null) => {
    const key = materialKey(name);
    if (!key) return [];
    const rows = [];
    for (const o of orders) {
      for (const it of o.items) {
        for (const m of it.materials || []) {
          if (m.received || m.id === exceptId) continue;
          if (materialKey(m.name) !== key) continue;
          rows.push({
            id: m.id, orderNo: o.orderNo, customer: o.customer, standalone: o.source === "purchase",
            itemName: it.name, amount: m.amount, ordered: m.ordered,
          });
        }
      }
    }
    return rows;
  };
  // Only the lines nobody has bought yet — those are the ones worth warning about
  // when someone goes to add the same material again.
  const openDemandFor = (name) => demandFor(name).filter((r) => !r.ordered);

  // A big order can have a dozen materials; flagging each one by hand is a chore.
  // This marks every un-ordered, not-yet-flagged material on the order at once
  // (one refetch, not one per material) and is undoable as a single action.
  const openMatsFor = (o) =>
    o.items.flatMap((it) => (it.materials || []).filter((m) => !m.received && !m.ordered && !m.progress));
  const quoteAllFor = async (o) => {
    const targets = openMatsFor(o);
    if (!targets.length) return;
    setQuoteTarget({ materials: targets, orderNo: o.orderNo });
  };

  // Confirmed from the quote pop-up: flag every target, carrying the note.
  const confirmQuote = async ({ note, by }) => {
    const targets = quoteTarget?.materials || [];
    const orderNo = quoteTarget?.orderNo;
    setQuoteTarget(null);
    if (!targets.length) return;
    const single = targets.length === 1;
    const noteFor = (m) => quoteNoteFor(note, m, single);

    // Exactly how each material stood before this click, so undo restores it
    // rather than assuming everything started unflagged — re-opening a flag to
    // edit its note must undo back to "flagged, old note", not to "not flagged".
    const before = targets.map((m) => ({
      id: m.id, progress: m.progress || null, progressAt: m.progressAt || null,
      progressBy: m.progressBy || null, note: m.note ?? null,
    }));
    // Editing rather than requesting: every target was already flagged.
    const editing = targets.every((m) => m.progress);

    // Paint immediately, then persist — a refetch behind the click would
    // re-download the whole board just to show a flag that's already known.
    targets.forEach((m) => {
      const n = noteFor(m);
      board.patchMaterial(m.id, {
        progress: "Quote requested",
        // Already flagged: keep the original stamp. Re-saving a note must not
        // restyle "asked 3 days ago" as "just now".
        ...(m.progress ? {} : { progressAt: Date.now(), progressBy: by }),
        ...(n !== undefined ? { note: n } : {}),
      });
    });
    await Promise.all(targets.map((m) =>
      db.setMaterialProgress(m.id, "Quote requested", { by, note: noteFor(m), keepStamp: !!m.progress })));

    undoer.record(
      editing
        ? `Note updated — ${targets.length === 1 ? targets[0].name : `${targets.length} materials`}${orderNo ? ` (#${orderNo})` : ""}`
        : `Quote requested — ${targets.length} material${targets.length === 1 ? "" : "s"}${orderNo ? ` (#${orderNo})` : ""}`,
      async () => {
        before.forEach((b) => board.patchMaterial(b.id, { progress: b.progress, progressAt: b.progressAt, progressBy: b.progressBy, note: b.note }));
        await Promise.all(before.map((b) =>
          b.progress
            ? db.setMaterialProgress(b.id, b.progress, { by: b.progressBy, note: b.note, keepStamp: true })
            : db.setMaterialProgress(b.id, null, { note: b.note })));
      }
    );
  };

  // "No quote was requested after all" — the deliberate way to take the flag off,
  // from inside the pop-up rather than a stray tap on the row. The note is kept:
  // whatever was written about the material is still worth having.
  const clearQuote = async () => {
    const m = quoteTarget?.materials?.[0];
    setQuoteTarget(null);
    if (!m) return;
    const before = { progress: m.progress || null, progressAt: m.progressAt || null, progressBy: m.progressBy || null };
    board.patchMaterial(m.id, { progress: null, progressAt: null, progressBy: null });
    await db.setMaterialProgress(m.id, null);
    undoer.record(`Quote flag cleared — ${m.name}`, async () => {
      board.patchMaterial(m.id, before);
      await db.setMaterialProgress(m.id, before.progress, { by: before.progressBy, keepStamp: true });
    });
  };

  const markOrderedU = async (materialId, details) => {
    const m = orders.flatMap((o) => o.items).flatMap((it) => it.materials).find((x) => x.id === materialId);
    await board.markOrdered(materialId, details);
    if (m && !m.ordered) undoer.record(`Marked ordered — ${m.name}`, () => board.unmarkOrdered(materialId));
  };

  // Invoiced checkbox (QB orders): checking an un-invoiced order opens the popup
  // to enter its invoice number; clicking an already-invoiced one clears it.
  const onInvoiceClick = (o) => {
    if (o.invoiced) board.setInvoiced(o.id, false, null);
    else setInvoiceTarget(o);
  };

  // Receiving a material (from the receive popup): mark it received with the
  // qty/note, and — once all the item's materials are in — move the item to the
  // chosen stage. Jump to that tab + flash so the move is visible.
  const confirmReceive = async ({ stage, qtyReceived, note }) => {
    const it = receiveTarget.it;
    await board.receiveMaterial(receiveTarget.m.id, { stage, qtyReceived, note });
    setReceiveTarget(null);
    const tabFor = { picklist: "pick", workorder: "work" };
    if (tabFor[stage]) {
      setTab(tabFor[stage]);
      setFlashItem(it.id);
      setTimeout(() => setFlashItem(null), 4400); // ~5 flashes at 0.85s
    }
  };

  // "Combine like items" → one batch work order for the same product pulled
  // from several orders. Shows a single line with the summed quantity, but
  // saves "completed by" back to every underlying item it was combined from.
  const makeCombinedDoc = (row) => {
    const reals = row.entries.map((e) => e.it);
    const orders = row.entries.map((e) => e.o);
    const orderNos = [...new Set(orders.map((o) => o.orderNo))];
    const topPriority = orders
      .map((o) => o.priority || "Normal")
      .reduce((best, p) => (PRI_RANK[p] > PRI_RANK[best] ? p : best), "Normal");
    const dueDates = orders.map((o) => o.dueDate).filter(Boolean).sort();
    const synthOrder = {
      orderNo: orderNos.map((n) => `#${n}`).join(", "),
      receivedAt: Math.min(...orders.map((o) => +new Date(o.receivedAt))),
      contact: "",
      priority: topPriority,
      dueDate: dueDates[0] || null,
    };
    const combinedItem = {
      id: `combined-${row.name}`,
      name: row.name,
      qty: row.qty,
      color: row.color || "",
      dept: row.dept,
      imageUrl: reals.find((it) => it.imageUrl)?.imageUrl || null,
      completedBy: reals.find((it) => it.completedBy)?.completedBy || "",
    };
    setDoc({ o: synthOrder, items: [combinedItem], saveTargets: reals });
  };

  // Re-route every like-item in a combined row to a new department at once.
  const setCombinedDept = (row, dept) =>
    Promise.all(row.entries.map((e) => board.updateItem(e.it.id, { dept })));

  // Turn a low-stock notice into a work order: opens a blank sheet for the right
  // department, pre-filled with the product, and files the notice as handled with
  // the work order number recorded on it.
  const makeNoticeWorkOrder = async (n) => {
    const type = (n.dept || "Shop").toLowerCase();
    const orderNo = await wo.nextWorkOrderNo();
    const fields = { product: n.name, item: n.name, notes: n.note || "" };
    if (n.qtyOnHand) fields.notes = [fields.notes, `On hand when reported: ${n.qtyOnHand}`].filter(Boolean).join(" · ");
    setCustomDoc({ type, orderNo, fields, title: n.name });
    await stock.setHandled(n.id, true, { by: n.reportedBy || null, workOrderNo: orderNo });
  };

  // Printing a work order for ONE product: if the same product is waiting on other
  // orders too, ask whether to put them on a single sheet. Previously the only way
  // to find that out was to switch to the "Combine like items" view first, so the
  // shop could easily run the same part twice.
  const likeKindKey = (it) => `${it.name}__${it.color || ""}`;
  const likeKindsFor = (o, it) => {
    const key = likeKindKey(it);
    const found = [];
    workOrders.forEach((oo) => {
      if (oo.id === o.id) return;
      oo.items.forEach((x) => {
        if (x.stage === "workorder" && likeKindKey(x) === key) found.push({ o: oo, it: x });
      });
    });
    return found;
  };
  const printItem = (o, it) => {
    const others = likeKindsFor(o, it);
    if (others.length) setLikeKinds({ o, it, others });
    else setDoc({ o, items: [it] });
  };
  // "Combine" from that prompt builds the same row shape CombinedItems produces,
  // so it goes through the identical combined-sheet path.
  const combineLikeKinds = ({ o, it, others }) => {
    const entries = [{ o, it }, ...others];
    makeCombinedDoc({
      name: it.name,
      color: it.color,
      dept: it.dept,
      qty: entries.reduce((n, e) => n + (parseFloat(e.it.qty) || 1), 0),
      entries,
    });
    setLikeKinds(null);
  };

  // Pull recent QuickBooks sales orders onto the board (via the Conductor sync
  // function). Takes up to ~a minute since it reads QuickBooks live.
  const syncQuickBooks = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/conductor-sync", { method: "POST" });
      let data = null;
      try { data = await res.json(); } catch { /* slow/cut-off response — sync may still have run */ }
      await board.refetch();
      if (data && typeof data.inserted === "number") {
        alert(`QuickBooks sync complete: ${data.inserted} new order${data.inserted === 1 ? "" : "s"} added` +
          `${data.skippedDuplicate ? `, ${data.skippedDuplicate} already on the board` : ""}.`);
      } else if (data && data.error) {
        alert(`QuickBooks sync didn't finish:\n${data.error}${data.hint ? `\n\n${data.hint}` : ""}`);
      } else {
        alert("Sync sent — QuickBooks can take up to a minute, and any new orders will appear on the board on their own. If nothing showed up, make sure the office PC, QuickBooks, and the Web Connector are all running, then try again.");
      }
    } catch {
      await board.refetch();
      alert("Couldn't confirm the sync — new orders may still appear shortly. If not, check that the office PC + QuickBooks Web Connector are running, then try again.");
    } finally {
      setSyncing(false);
    }
  };

  // Close out a completed order via Ship or Will Call. Records the location and
  // sends the order to the matching top tab.
  const openFulfill = (order, method) => setFulfillTarget({ order, method });
  const confirmFulfill = async (location, chosen) => {
    const { order, method } = fulfillTarget;
    const dest = chosen || method; // the modal asks when no destination was fixed
    await board.fulfillOrder(order.id, dest, location);
    setFulfillTarget(null);
    // Land ON the order in its new tab and flash it, so you can see where it went
    // instead of hunting for it in the list.
    goToTab(order.id, dest === "willcall" ? "willcall" : "shipping");
  };

  // Shipping stage 2: record tracking number from the Shipping tab.
  const confirmTracking = async (payload) => {
    const id = trackTarget.id;
    await board.markShipped(id, payload);
    setTrackTarget(null);
    goToTab(id, "completed"); // out of Shipping, into Completed — flashed so it's findable
  };

  // Partial pickup/shipment: record it; the order auto-completes (and leaves the
  // board) only once everything's out, otherwise it stays live with progress.
  const confirmPartial = async (payload) => {
    await board.recordFulfillment(partialTarget.order.id, payload);
    setPartialTarget(null);
  };

  // Will Call: mark an order picked up (records who collected it). It then
  // moves out of Will Call into the Completed tab.
  const confirmPickup = async (by) => {
    await board.markPickedUp(pickupTarget.id, by);
    setPickupTarget(null);
    setTab("completed");
  };

  // Walk-in pickup: a customer collected an order before it worked through the
  // stages. Mark every item done, put it on will-call (no staging spot — it's
  // already gone), and record who took it + when, so it lands straight in
  // Completed in one step.
  const confirmWalkInPickup = async (by) => {
    const order = walkInTarget;
    await Promise.all(order.items.filter((it) => it.stage !== "done").map((it) => board.moveItem(it.id, "done")));
    await board.fulfillOrder(order.id, "willcall", "");
    await board.markPickedUp(order.id, by);
    setWalkInTarget(null);
    setTab("completed");
  };

  // Save a custom work order — update in place when editing, otherwise create.
  // Returns the id so a freshly-saved new sheet keeps editing the same record.
  const saveWorkOrder = async (woPayload) => {
    if (woPayload.id) {
      await wo.updateWorkOrder(woPayload.id, { title: woPayload.title, fields: woPayload.fields });
      return woPayload.id;
    }
    return await wo.createWorkOrder(woPayload);
  };

  // ---- derived views ----
  const newOrders = orders.filter((o) => o.items.some((it) => it.stage === "new"));
  const pickOrders = orders.filter((o) => o.items.some((it) => it.stage === "picklist"));
  const pickNoted = pickOrders.filter((o) => o.items.some((it) => it.stage === "picklist" && it.note));
  const workOrders = orders.filter((o) => o.items.some((it) => it.stage === "workorder"));
  const qbActive = wo.workOrders.filter((w) => !w.done); // QuickBooks work orders not yet done
  const buyOrders = orders.filter((o) => o.items.some((it) => it.needsMaterial && it.materials.some((m) => !m.received)));
  // Standalone purchases (source='purchase') live only in Purchasing — keep them
  // out of the Orders list, its counts, and the dashboard.
  // Low-stock notices: open ones are the queue; handled ones stay for reference.
  const openNotices = (stock.notices || []).filter((n) => n.status !== "handled");
  const handledNotices = (stock.notices || []).filter((n) => n.status === "handled");
  const customerOrders = orders.filter((o) => o.source !== "purchase");
  const count = (os, pred) => os.reduce((n, o) => n + o.items.filter(pred).length, 0);
  const detailOrder = allOrders.find((o) => o.id === detailId);

  const oInTriage = (o) => o.items.some((i) => i.stage === "new");
  const oDone = (o) => !oInTriage(o) && o.items.length > 0 && o.items.every((i) => i.stage === "done");
  const oProg = (o) => !oInTriage(o) && !oDone(o);
  // Completed = production done but not yet shipped/will-called (awaiting that call).
  const awaitingFulfill = (o) => oDone(o) && !o.fulfillment;
  // Will Call tab = still awaiting pickup. Once picked up, an order is complete
  // and moves to the Completed tab (alongside shipped orders).
  const willCallOrders = orders.filter((o) => o.fulfillment === "willcall" && !o.pickedUpAt);
  const pickedUpOrders = orders.filter((o) => o.fulfillment === "willcall" && o.pickedUpAt && oDone(o));
  // Shipping = staged, no tracking yet. Shipped = tracking logged, out the door.
  const shippingOrders = orders.filter((o) => o.fulfillment === "shipping" && !o.trackingNumber);
  const shippedOrders = orders.filter((o) => o.fulfillment === "shipping" && o.trackingNumber && oDone(o));
  // Completed tab = finished orders: shipped + picked up. Both lists above also
  // require everything on the order to be MADE (oDone), because an order doesn't
  // stay finished just because it once shipped: a QuickBooks re-sync can add a
  // line the customer tacked on afterwards, and that line still has to be built.
  // Without that check the same order sat in Completed and in New Orders at once,
  // which reads as a glitch — so the natural way to resolve it was to mark the new
  // product done, and a real product never got made. Such an order returns here by
  // itself once the new line is finished; tracking and dates are never touched.
  const completedOrders = [...shippedOrders, ...pickedUpOrders];
  // The Orders tab is the active worklist: drop orders that have shipped or been
  // picked up (they still live on in the Shipped / Will Call tabs) — unless they
  // have unfinished work again, in which case they belong back on the worklist.
  const ordersForList = customerOrders.filter((o) => (!o.trackingNumber && !o.pickedUpAt) || !oDone(o));
  // Orders tab can be narrowed to QuickBooks / Shopify; the counts follow it.
  const ordersSourced = ordersForList.filter((o) => orderSource === "all" || o.source === orderSource);
  const OFILTERS = [
    { k: "all", label: "All", n: ordersSourced.length },
    { k: "triage", label: "In triage", n: ordersSourced.filter(oInTriage).length },
    { k: "prog", label: "In progress", n: ordersSourced.filter(oProg).length },
    { k: "done", label: "Completed", n: ordersSourced.filter(awaitingFulfill).length },
    { k: "pct", label: "% done", n: null },
    { k: "due", label: "Due date", n: null },
  ];
  // Soonest due date first; orders without a due date fall to the bottom.
  const byDue = (a, b) => {
    if (!a.dueDate && !b.dueDate) return b.receivedAt - a.receivedAt;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  };
  // Soonest due date first; orders with no due date last; then oldest first.
  const byUrgency = (a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.receivedAt - b.receivedAt;
  };
  // One sort used by every list of orders, so "oldest first" or "by number" means
  // the same thing on every tab. Order numbers are compared numerically (string
  // sort would put #473215 before #99).
  const orderNoNum = (o) => {
    const n = parseInt(String(o.orderNo ?? "").replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? Infinity : n;
  };
  const sortOrders = (list) => {
    const arr = [...list];
    if (sortBy === "oldest") return arr.sort((a, b) => a.receivedAt - b.receivedAt);
    if (sortBy === "number") return arr.sort((a, b) => orderNoNum(a) - orderNoNum(b));
    if (sortBy === "due") return arr.sort(byUrgency);
    return arr.sort((a, b) => b.receivedAt - a.receivedAt); // newest
  };

  const visibleOrders =
    orderView === "triage" ? sortOrders(ordersSourced.filter(oInTriage))
    : orderView === "prog" ? sortOrders(ordersSourced.filter(oProg))
    : orderView === "done" ? sortOrders(ordersSourced.filter(awaitingFulfill))
    : orderView === "pct" ? [...ordersSourced].sort((a, b) => pct(b) - pct(a))
    : orderView === "due" ? [...ordersSourced].sort(byDue)
    : sortOrders(ordersSourced);
  // Orders tab: hold-and-drag to reorder. The order is shared across the crew
  // (stored in the DB) and overrides the sort above; "Reset order" clears it.
  const orderedVisible = manualOrder.length
    ? [...visibleOrders].sort((a, b) => {
        const ia = manualOrder.indexOf(a.id), ib = manualOrder.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      })
    : visibleOrders;
  const dropOrder = (targetId) => {
    const src = orderDragRef.current;
    orderDragRef.current = null;
    if (!src || src === targetId) return setOrderDrag(null);
    const ids = orderedVisible.map((o) => o.id);
    const from = ids.indexOf(src), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return setOrderDrag(null);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOptArr(ids); // show the new order instantly
    board.setArrangement(ids); // persist team-wide; realtime refetch syncs every open board
    setOrderDrag(null);
  };
  const resetOrder = () => { setOptArr([]); board.setArrangement([]); };

  // New Orders, filtered by source (All / QuickBooks / Shopify), then sorted.
  const newOrdersShown = sortOrders(
    newOrders.filter((o) => newSource === "all" || o.source === newSource)
  );
  // Urgent tab: active orders that are manually Urgent or due within ~2 days
  // (effectivePriority bumps due-soon orders to RUSH). Soonest first, but
  // production-done ("Ready to fulfill") orders sink to the bottom.
  const urgentOrders = [...ordersForList]
    .filter((o) => effectivePriority(o, now) === "RUSH")
    .sort((a, b) => (oDone(a) ? 1 : 0) - (oDone(b) ? 1 : 0) || byUrgency(a, b));

  // Which tabs an order currently lives in — the stage/fulfillment lists that
  // hold it (its items can span several). Powers the global search: you can find
  // an order from any tab, see where it is, and jump straight to it. Falls back
  // to the Orders master list when it's ready-to-fulfill / not in a stage tab.
  const SEARCH_TABS = [
    { k: "new", label: "New Orders", list: newOrders },
    { k: "pick", label: "Pick List", list: pickOrders },
    { k: "work", label: "Work Order", list: workOrders },
    { k: "buy", label: "Purchasing", list: buyOrders },
    { k: "willcall", label: "Will Call", list: willCallOrders },
    { k: "shipping", label: "Shipping", list: shippingOrders },
    { k: "completed", label: "Completed", list: completedOrders },
  ];
  const orderLocations = (o) => {
    const hits = SEARCH_TABS.filter((t) => t.list.some((x) => x.id === o.id)).map(({ k, label }) => ({ k, label }));
    return hits.length ? hits : [{ k: "orders", label: "Orders" }];
  };

  const orderStatus = (o) => {
    if (o.fulfillment === "shipping")
      return o.trackingNumber
        ? { key: "shipped", label: "Shipped", c: C.gray, bg: C.grayBg, Icon: Truck }
        : { key: "shipping", label: "Staged to ship", c: C.blue, bg: C.blueBg, Icon: Package };
    if (o.fulfillment === "willcall") return { key: "willcall", label: "Will call", c: C.gold, bg: C.goldBg, Icon: Store };
    if (o.items.some((it) => it.stage === "new")) return { key: "triage", label: "Needs triage", c: C.gray, bg: C.grayBg, Icon: AlertTriangle };
    if (o.items.length > 0 && o.items.every((it) => it.stage === "done")) return { key: "ready", label: "Ready to fulfill", c: C.green, bg: C.greenBg, Icon: CheckCircle2 };
    return { key: "prog", label: "In progress", c: C.blue, bg: C.blueBg, Icon: Hammer };
  };

  // One order row for the Orders + Urgent tabs (same card so they stay in sync).
  const renderOrderCard = (o) => {
    const st = orderStatus(o);
    const done = o.items.filter((it) => it.stage === "done").length, total = o.items.length;
    // Urgent (manually Urgent or due within ~2 days) → a loud red card so it
    // can't be missed: red outline, red-tinted background, red URGENT badge.
    const urgent = effectivePriority(o, now) === "RUSH";
    const dragOn = tab === "orders"; // hold-and-drag to reorder — Orders tab only
    return (
      <div
        key={o.id} id={`order-${o.id}`} onClick={() => setDetailId(o.id)}
        draggable={dragOn}
        onDragStart={dragOn ? (e) => { orderDragRef.current = o.id; setOrderDrag(o.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
        onDragOver={dragOn ? (e) => e.preventDefault() : undefined}
        onDrop={dragOn ? (e) => { e.preventDefault(); dropOrder(o.id); } : undefined}
        onDragEnd={dragOn ? () => { orderDragRef.current = null; setOrderDrag(null); } : undefined}
        className="mb-2 card-pop"
        style={{ background: urgent ? C.rushBg : C.surface, border: `1px solid ${urgent ? C.rush : C.line}`, borderLeft: `4px solid ${urgent ? C.rush : st.c}`, opacity: orderDrag === o.id ? 0.4 : (o.fulfillment ? 0.6 : 1), cursor: dragOn ? "grab" : "pointer", ...(o.notes ? { boxShadow: `0 0 0 2px ${C.note}` } : null) }}
      >
        <div className="flex items-center gap-x-3 gap-y-2 px-4 py-3 flex-wrap">
          <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, color: urgent ? C.rush : C.ink }}>#{o.orderNo}</span>
          {urgent && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide" style={{ background: C.rush, color: "#fff" }}>
              <Flag size={12} />Urgent
            </span>
          )}
          <div className="min-w-0">
            <div className="font-bold flex items-center gap-2 flex-wrap" style={{ fontSize: 14 }}>{o.customer}{o.notes && <Bell size={15} color={C.note} fill={C.note} title={`Note: ${o.notes}`} style={{ flexShrink: 0 }} />}<MethodBadge m={o.fulfillmentMethod} onChange={(m) => board.setFulfillmentMethod(o.id, m)} /></div>
            <div style={{ fontSize: 12, color: C.gray }}>
              Ordered by {o.contact} · {stamp(o.receivedAt, now)}
            </div>
            {o.shipTo && <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>→ Ship to: {o.shipTo}</div>}
            {o.shipVia && <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>→ Ship via: {o.shipVia}</div>}
          </div>
          <DuePill o={o} now={now} onChange={(date, time) => board.setDueDate(o.id, date, time)} />
          <CompletionPill o={o} onChange={(date) => board.setCompletionDate(o.id, date)} />
          <InvoicedBadge o={o} onClick={onInvoiceClick} />
          <div className="basis-full sm:basis-auto sm:ml-auto flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1">
              {o.items.map((it) => (
                <span key={it.id} title={it.name} style={{ width: 22, height: 8, borderRadius: 2, background: it.stage === "done" ? C.green : blocked(it) ? C.high : C.line }} />
              ))}
              <span style={{ fontSize: 12, color: C.gray, marginLeft: 4 }}>{done}/{total} done</span>
            </div>
            <Pill c={st.c} bg={st.bg} Icon={st.Icon}>{st.label}</Pill>
            {st.key === "ready" ? (
              <>
                {o.fulfillmentMethod !== "shipping" && (
                  <Btn kind="gold" onClick={(e) => { e.stopPropagation(); openFulfill(o, "willcall"); }}>
                    <Store size={13} />Will call
                  </Btn>
                )}
                {o.fulfillmentMethod !== "willcall" && (
                  <Btn kind="brass" onClick={(e) => { e.stopPropagation(); openFulfill(o, "shipping"); }}>
                    <Truck size={13} />Ship
                  </Btn>
                )}
              </>
            ) : st.key === "willcall" || st.key === "shipping" || st.key === "shipped" ? (
              <span className="flex items-center gap-1" style={{ fontSize: 12, color: C.gray }}>
                <MapPin size={12} />{o.location}
                {o.trackingNumber && (
                  <a href={trackingUrl(o.trackingNumber)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Track this shipment (opens the carrier's site)" style={{ fontFamily: "ui-monospace,monospace", marginLeft: 6, color: C.blue, textDecoration: "none" }}>· {o.trackingNumber}<ExternalLink size={10} style={{ marginLeft: 2, verticalAlign: "-1px" }} /></a>
                )}
              </span>
            ) : (
              <Btn onClick={(e) => { e.stopPropagation(); setDoc({ o, items: [o.items.find((i) => i.stage === "workorder" || i.stage === "done") || o.items[0]] }); }}>
                <Printer size={13} />Work order
              </Btn>
            )}
          </div>
        </div>
      </div>
    );
  };

  const TABS = [
    { k: "dash", label: "Dashboard" },
    { k: "new", label: "New Orders", dot: newOrders.length },
    { k: "pick", label: "Pick List", n: count(pickOrders, (it) => it.stage === "picklist") },
    { k: "work", label: "Work Order", n: count(workOrders, (it) => it.stage === "workorder") },
    { k: "buy", label: "Purchasing", n: buyOrders.reduce((n, o) => n + o.items.reduce((s, it) => s + (it.needsMaterial ? it.materials.filter((m) => !m.received).length : 0), 0), 0) },
    { k: "inventory", label: "Inventory", dot: openNotices.length },
    { k: "orders", label: "Orders" },
    { k: "urgent", label: "Urgent", dot: urgentOrders.length },
    { k: "willcall", label: "Will Call", n: willCallOrders.length },
    { k: "shipping", label: "Shipping", n: shippingOrders.length },
    { k: "completed", label: "Completed", n: completedOrders.length },
  ];

  return (
    <div style={{ background: C.concrete, minHeight: "100vh", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink }}>
      {/* ---- top bar (pinned so tabs + search stay visible while scrolling).
           On phones it wraps: logo + search on top, full-width scrollable tabs below. ---- */}
      <div className="flex items-center gap-x-4 gap-y-2 px-5 py-3 flex-wrap md:flex-nowrap" style={{ background: C.fill, color: "#fff", position: "sticky", top: 0, zIndex: 50 }}>
        <button
          onClick={() => { setTab("dash"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="shrink-0"
          title="Go to dashboard"
          style={{ display: "flex", alignItems: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          <Logo height={30} variant="light" />
        </button>
        {/* The tab strip scrolls sideways when the window is too narrow for every
            tab. The scrollbar is hidden, so without these arrows there's nothing
            telling you the rest of the tabs are even there. Each appears only when
            there's actually more to see in that direction. */}
        <div className="ml-2 flex-1 min-w-0 basis-full order-last md:basis-0 md:order-none" style={{ position: "relative" }}>
        {navScroll.left && (
          <button
            onClick={() => nudgeTabs(-1)}
            title="Show earlier tabs"
            className="flex items-center justify-center"
            style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", zIndex: 3, width: 26, height: 26, borderRadius: 13, border: "none", cursor: "pointer", color: "#fff", background: C.fill, boxShadow: `6px 0 10px 4px ${C.fill}` }}
          >
            <ChevronLeft size={17} />
          </button>
        )}
        {navScroll.right && (
          <button
            onClick={() => nudgeTabs(1)}
            title="Show more tabs"
            className="flex items-center justify-center"
            style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 3, width: 26, height: 26, borderRadius: 13, border: "none", cursor: "pointer", color: "#fff", background: C.fill, boxShadow: `-6px 0 10px 4px ${C.fill}` }}
          >
            <ChevronRight size={17} />
          </button>
        )}
        <div ref={tabStripRef} className="flex items-center gap-1 no-scrollbar" style={{ overflowX: "auto", position: "relative" }}>
          <span aria-hidden style={{ position: "absolute", left: 0, top: 0, transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height, background: "rgba(255,255,255,0.16)", borderRadius: 8, transition: pill.animate ? "transform 0.32s cubic-bezier(0.34,1.1,0.64,1), width 0.32s cubic-bezier(0.34,1.1,0.64,1)" : "none", pointerEvents: "none", zIndex: 0 }} />
          {TABS.map((t) => (
            <button
              key={t.k}
              ref={(el) => { if (el) tabEls.current[t.k] = el; }}
              onClick={() => { setTab(t.k); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="navtab relative px-3 py-1.5 rounded font-bold shrink-0 whitespace-nowrap"
              style={{ fontSize: 13, background: "transparent", color: tab === t.k ? "#fff" : "rgba(255,255,255,0.65)", zIndex: 1, transition: "color 0.25s" }}
            >
              {t.label}{t.n ? ` · ${t.n}` : ""}
              {t.dot ? (
                <span className="inline-flex items-center justify-center" style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, padding: "0 4px", background: C.rush, borderRadius: 8, fontSize: 10 }}>
                  {t.dot}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        </div>
        <GlobalSearch orders={orders} locate={orderLocations} onOpen={(id) => setDetailId(id)} onGoToTab={goToTab} key={tab} />
        <button
          onClick={() => setCostingOpen(true)}
          title="Costing & margins — what each product costs to make"
          className="inline-flex items-center gap-1.5 shrink-0"
          style={{ color: "rgba(255,255,255,0.7)", background: "transparent", border: "none", cursor: "pointer", padding: 4, fontSize: 12, fontWeight: 700 }}
        >
          <DollarSign size={16} />
        </button>
        <button
          onClick={() => setFloorOpen(true)}
          title="Open Floor Control — arrange the shop-floor monitors"
          className="inline-flex items-center gap-1.5 shrink-0"
          style={{ color: "rgba(255,255,255,0.7)", background: "transparent", border: "none", cursor: "pointer", padding: 4, fontSize: 12, fontWeight: 700 }}
        >
          <MonitorPlay size={16} /> Floor
        </button>
        <button
          onClick={() => setDark((d) => !d)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex items-center shrink-0"
          style={{ color: "rgba(255,255,255,0.7)", background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {auth.needsAuth && (
          <button onClick={auth.signOut} title="Sign out" className="inline-flex items-center gap-1.5 shrink-0" style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            <LogOut size={15} />
          </button>
        )}
      </div>

      {/* Undo bar — its own row so it never squeezes the nav tabs, and there's room
          to spell out exactly what happened (the whole point: "what did I just click?"). */}
      {undoer.last && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: C.grayBg, borderBottom: `1px solid ${C.line}`, fontSize: 12.5 }}>
          <RotateCcw size={14} style={{ color: C.gray, flexShrink: 0 }} />
          <span style={{ color: C.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {undoer.last.label}
          </span>
          <span style={{ color: C.gray, whiteSpace: "nowrap" }}>{stamp(undoer.last.at, now)}</span>
          <div className="ml-auto flex items-center gap-2" style={{ flexShrink: 0 }}>
            <Btn kind="dark" onClick={undoer.undo} disabled={undoer.undoing}>
              <RotateCcw size={13} />{undoer.undoing ? "Undoing…" : "Undo"}
            </Btn>
            <button onClick={undoer.clear} title="Dismiss" style={{ color: C.gray, background: "none", border: "none", cursor: "pointer", padding: 4, display: "inline-flex" }}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {floorOpen && <FloorControl orders={orders} onClose={() => setFloorOpen(false)} />}
      {costingOpen && (
        <Costing costing={costing} productNames={costing.catalog} onClose={() => setCostingOpen(false)} />
      )}

      {backendMode === "local" && <LocalBanner />}
      {board.error && (
        <div className="px-5 py-2" style={{ background: C.rushBg, color: C.rush, fontSize: 13 }}>
          Backend error: {board.error}
        </div>
      )}

      <div className="p-5" style={{ maxWidth: tab === "dash" ? 1440 : 1040, margin: "0 auto" }}>
        {board.loading && !orders.length ? (
          <Empty>Loading the board…</Empty>
        ) : (
          <>
            {tab === "dash" && (
              <Dashboard
                orders={customerOrders}
                workOrders={wo.workOrders}
                notices={stock.notices}
                now={now}
                onNavigate={setTab}
                onOpenOrder={setDetailId}
              />
            )}

            {tab === "new" && (
              <Tabwrap
                title="NEW ORDERS"
                titleAside={<ExpandToggle scope="new" ids={newOrdersShown.map((o) => o.id)} isExpanded={isExpanded} setAllExpanded={setAllExpanded} />}
                action={
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <SegGroup value={newSource} onChange={setNewSource} options={[["all", "All"], ["QuickBooks", "QB"], ["Shopify", "Shopify"]]} />
                    <SortMenu value={sortBy} onChange={setSortBy} />
                    <SyncButton syncing={syncing} onClick={syncQuickBooks} />
                    <Btn kind="dark" onClick={() => setShowNew(true)}><Plus size={13} />New order</Btn>
                  </div>
                }
              >
                {!newOrdersShown.length && <Empty>{newSource === "all" ? "Nothing waiting. New orders land here the moment they come in." : `No ${newSource} orders waiting.`}</Empty>}
                {newOrdersShown.map((o) => (
                  <Group key={o.id} o={o} now={now} onDueDate={board.setDueDate} onCompletion={board.setCompletionDate} onMethod={board.setFulfillmentMethod} onInvoice={onInvoiceClick} onOpen={() => setDetailId(o.id)} collapsible noteRail open={isExpanded("new", o.id)} onToggle={() => toggleExpanded("new", o.id)}>
                    {/* Show every item, active (still-'new') ones first and the
                        already-routed (greyed/crossed-out) ones sunk to the bottom,
                        so nothing silently vanishes and the to-do items stay on top.
                        The order leaves this tab only once all are done. */}
                    {[...o.items].sort((a, b) => itemRank(a) - itemRank(b)).map((it) => it.stage === "new" ? (
                      <div key={it.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                        <div className="flex items-center gap-2 mb-2">
                          <DeptBadge d={it.dept} onChange={(dep) => board.updateItem(it.id, { dept: dep })} />
                          <span className="font-bold" style={{ fontSize: 14 }}>{it.name}</span>
                          <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>×{it.qty}</span>
                          <SittingBadge it={it} now={now} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmStock(it)} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.greenBg, color: C.green, border: `1px solid ${C.green}` }}>In stock</button>
                          <button onClick={() => triage(it.id, "have")} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.highBg, color: C.high, border: `1px solid ${C.high}` }}>Create WO</button>
                          <button onClick={() => triage(it.id, "need")} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.rushBg, color: C.rush, border: `1px solid ${C.rush}` }}>Material</button>
                        </div>
                      </div>
                    ) : (
                      <div key={it.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.line}`, background: C.concrete }}>
                        <span className="font-bold" style={{ fontSize: 13, color: C.gray, textDecoration: "line-through" }}>{it.name}</span>
                        <span style={{ fontFamily: "ui-monospace,monospace", color: C.gray, textDecoration: "line-through", fontSize: 13 }}>×{it.qty}</span>
                        <span className="ml-auto inline-flex items-center gap-1" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.green }}>
                          {it.stage === "done" ? <Check size={12} /> : <ArrowRight size={12} />}
                          {it.stage === "done" ? "Done" : `Sent to ${STAGE_LABELS[it.stage] || it.stage}`}
                        </span>
                      </div>
                    ))}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "pick" && (
              <Tabwrap
                title="PICK LIST"
                sub="Click an item to see its image, then grab it and check it off."
                titleAside={<ExpandToggle scope="pick" ids={(pickNotesOnly ? pickNoted : pickOrders).map((o) => o.id)} isExpanded={isExpanded} setAllExpanded={setAllExpanded} />}
                action={
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    <SortMenu value={sortBy} onChange={setSortBy} />
                    <button onClick={() => setPickNotesOnly(false)} className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide" style={!pickNotesOnly ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>All</button>
                    <button onClick={() => setPickNotesOnly(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide" style={pickNotesOnly ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
                      <Bell size={12} />With notes{pickNoted.length ? ` · ${pickNoted.length}` : ""}
                    </button>
                  </div>
                }
              >
                {!(pickNotesOnly ? pickNoted : pickOrders).length && (
                  <Empty>{pickNotesOnly ? "No items have notes right now." : "Empty. In-stock items show up here after triage."}</Empty>
                )}
                {sortOrders(pickNotesOnly ? pickNoted : pickOrders).map((o) => (
                  <Group key={o.id} o={o} now={now} onDueDate={board.setDueDate} onCompletion={board.setCompletionDate} onMethod={board.setFulfillmentMethod} onInvoice={onInvoiceClick} onOpen={() => setDetailId(o.id)} collapsible open={isExpanded("pick", o.id)} onToggle={() => toggleExpanded("pick", o.id)}>
                    {o.items.filter((it) => it.stage === "picklist").map((it) => (
                      <ItemLine
                        key={it.id} it={it} now={now}
                        onDept={(dep) => board.updateItem(it.id, { dept: dep })}
                        onOpen={() => setPickItem({ o, it })}
                        right={
                          <span className="flex items-center gap-2">
                            {it.note && <Bell size={16} color={C.high} fill={C.high} title={`Note: ${it.note}`} style={{ flexShrink: 0 }} />}
                            <MoveMenu stage={it.stage} onMove={(s) => (s === "awaiting" ? setMatTarget(it.id) : moveItemU(it.id, s))} />
                            <Btn kind="dark" onClick={() => finishItemU(it.id)}><Check size={13} />Item picked</Btn>
                          </span>
                        }
                      />
                    ))}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "work" && (
              <Tabwrap title="WORK ORDERS" sub="QuickBooks orders you create here, plus Shopify orders pulled from the web." action={<SortMenu value={sortBy} onChange={setSortBy} />}>
                {/* ---- QuickBooks: custom work orders ---- */}
                <div className="rounded mb-3 p-3 flex items-center gap-2 flex-wrap" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5 }}>Create new work order</span>
                  {WO_TYPES.map((t) => (
                    <button
                      key={t.key}
                      onClick={async () => setCustomDoc({ type: t.key, orderNo: await wo.nextWorkOrderNo() })}
                      className="px-3 py-2 rounded font-bold uppercase tracking-wide text-xs"
                      style={{ background: C.fill, color: "#fff" }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <SectionHeader label="QuickBooks Orders" count={qbActive.length} />
                {qbActive.length === 0 && <Empty>No QuickBooks work orders yet. Create one with the buttons above.</Empty>}
                {qbActive.map((w) => (
                  <div
                    key={w.id}
                    onClick={() => setCustomDoc(w)}
                    title="Open to edit"
                    className="rounded mb-3"
                    style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.ink}`, cursor: "pointer" }}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15 }}>WO #{w.orderNo}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold uppercase" style={{ background: C.grayBg, color: C.inkSoft }}>{w.type}</span>
                      <div className="min-w-0">
                        <div className="font-bold" style={{ fontSize: 14 }}>{w.title || "(untitled)"}</div>
                        <div style={{ fontSize: 12, color: C.gray }}>QuickBooks work order</div>
                      </div>
                      <span className="basis-full sm:basis-auto sm:ml-auto flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Pill c={C.inkSoft} bg={C.grayBg} Icon={Clock}>{stamp(w.createdAt, now)}</Pill>
                        <Btn onClick={() => setCustomDoc(w)}><Printer size={13} />Print</Btn>
                        <Btn kind="dark" onClick={() => markWoDoneU(w)}><Check size={13} />Mark done</Btn>
                      </span>
                    </div>
                  </div>
                ))}

                {/* ---- Shopify: triaged customer-order items ---- */}
                <div style={{ marginTop: 18 }} className="flex items-center justify-between flex-wrap gap-2">
                  <SectionHeader label="Shopify" count={count(workOrders, (it) => it.stage === "workorder")} />
                  <div className="flex items-center gap-1">
                    {[["byorder", "By order"], ["combined", "Combine like items"]].map(([k, label]) => {
                      const on = workCombined === (k === "combined");
                      return (
                        <button
                          key={k} onClick={() => setWorkCombined(k === "combined")}
                          className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
                          style={on ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {!workOrders.length && <Empty>Nothing from Shopify yet. Triaged “create WO” items show up here.</Empty>}
                {workCombined ? (
                  <CombinedItems orders={workOrders} stage="workorder" onMake={makeCombinedDoc} onDept={setCombinedDept} />
                ) : (
                  sortOrders(workOrders).map((o) => {
                    const woItems = o.items.filter((it) => it.stage === "workorder");
                    const depts = [...new Set(woItems.map((it) => it.dept))];
                    return (
                      <Group key={o.id} o={o} now={now} onDueDate={board.setDueDate} onCompletion={board.setCompletionDate} onMethod={board.setFulfillmentMethod} onInvoice={onInvoiceClick} onOpen={() => setDetailId(o.id)}>
                        {depts.map((dept) => {
                          const deptItems = woItems.filter((it) => it.dept === dept);
                          const multi = deptItems.length > 1;
                          return (
                            <div key={dept}>
                              {multi && (
                                <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ background: C.concrete, borderBottom: `1px solid ${C.line}` }}>
                                  <DeptBadge d={dept} />
                                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.inkSoft }}>Work order</span>
                                  <span style={{ fontSize: 12, color: C.gray }}>· {deptItems.length} items</span>
                                  <span className="ml-auto">
                                    <Btn onClick={() => setDoc({ o, items: deptItems })} title="One sheet with every product in this department"><Printer size={13} />Print all</Btn>
                                  </span>
                                </div>
                              )}
                              {deptItems.map((it) => (
                                <ItemLine
                                  key={it.id} it={it} now={now} flash={flashItem === it.id}
                                  onDept={(dep) => board.updateItem(it.id, { dept: dep })}
                                  onOpen={() => setPickItem({ o, it, wo: true })}
                                  right={
                                    <span className="flex flex-wrap items-center justify-end gap-2">
                                      {it.note && <Bell size={16} color={C.high} fill={C.high} title={`Note: ${it.note}`} style={{ flexShrink: 0 }} />}
                                      <MoveMenu stage={it.stage} onMove={(s) => (s === "awaiting" ? setMatTarget(it.id) : moveItemU(it.id, s))} />
                                      <Btn onClick={() => printItem(o, it)} title="Print a work order for just this product"><Printer size={13} />Print</Btn>
                                      <Btn kind={it.inProgress ? "green" : "ghost"} onClick={() => board.updateItem(it.id, { inProgress: !it.inProgress })}><Hammer size={13} />In progress</Btn>
                                      <Btn kind="dark" onClick={() => finishItemU(it.id)}><Check size={13} />Mark done</Btn>
                                    </span>
                                  }
                                />
                              ))}
                            </div>
                          );
                        })}
                      </Group>
                    );
                  })
                )}
              </Tabwrap>
            )}

            {tab === "buy" && (
              <Tabwrap title="PURCHASING" action={<div className="flex items-center gap-2 flex-wrap justify-end"><SortMenu value={sortBy} onChange={setSortBy} /><Btn kind="dark" onClick={() => setShowNewPurchase(true)}><Plus size={13} />New purchase</Btn></div>}>
                {!buyOrders.length && <Empty>Nothing to buy. Materials land here when an item is triaged “need material.”</Empty>}
                {sortOrders(buyOrders).map((o) => (
                  <Group key={o.id} o={o} now={now} onDueDate={board.setDueDate} onCompletion={board.setCompletionDate} onMethod={board.setFulfillmentMethod} onInvoice={onInvoiceClick} onOpen={() => setDetailId(o.id)}>
                    {/* Whole-order shortcut — only worth showing when there's more
                        than one material still waiting to be flagged. */}
                    {openMatsFor(o).length > 1 && (
                      <div className="flex items-center gap-2 px-4 py-2" style={{ background: C.concrete, borderBottom: `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 12, color: C.gray }}>
                          {openMatsFor(o).length} materials still to be quoted
                        </span>
                        <span className="ml-auto">
                          <Btn onClick={() => quoteAllFor(o)} title="Mark every material on this order as quote requested">
                            <Check size={13} />Quote requested — all {openMatsFor(o).length}
                          </Btn>
                        </span>
                      </div>
                    )}
                    {o.items.filter((it) => it.needsMaterial).map((it) =>
                      it.materials.filter((m) => !m.received).map((m) => {
                        // Once the expected date is reached, flag the row so the
                        // shop knows the material is due in (red if it's overdue).
                        const today = new Date(now).toLocaleDateString("en-CA");
                        const expReached = m.ordered && m.expectedAt && today >= m.expectedAt;
                        const overdue = expReached && today > m.expectedAt;
                        return (
                        <div key={m.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <DeptBadge d={it.dept} onChange={(dep) => board.updateItem(it.id, { dept: dep })} />
                            <div className="min-w-0">
                              {/* Click the product to open the order pop-up and edit its details. */}
                              <span className="flex items-center gap-1">
                                <button onClick={() => setOrderTarget(m)} title="Click to edit order details" className="font-bold text-left hover:underline" style={{ fontSize: 14, background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit" }}>{m.name}</button>
                                {m.note && <Bell size={13} color={C.gold} title={m.note} style={{ flexShrink: 0 }} />}
                              </span>
                              {o.source !== "purchase" && <div style={{ fontSize: 12, color: C.gray }}>for {it.name}</div>}
                            </div>
                            {/* Requested vs actually ordered, side by side, so a short
                                order is obvious rather than silently overwriting the ask. */}
                            <span className="flex items-center gap-2" style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
                              {m.amount && (
                                <span title="Quantity requested — what the order needs">{m.amount}</span>
                              )}
                              {m.ordered && m.orderedQty && m.orderedQty !== m.amount && (
                                <span title="Quantity actually ordered" style={{ color: C.high }}>
                                  → {m.orderedQty}
                                </span>
                              )}
                            </span>
                            <button onClick={() => board.setForInventory(m.id, !m.forInventory)} title="For an order = more urgent. Click to switch between For order / Inventory."
                              className="rounded uppercase"
                              style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, padding: "4px 9px", cursor: "pointer", border: "none",
                                color: m.forInventory ? C.gray : C.gold, background: m.forInventory ? C.grayBg : C.goldBg }}>
                              {m.forInventory ? "Inventory" : "For order"}
                            </button>
                            <span className="basis-full sm:basis-auto sm:ml-auto flex items-center gap-2 justify-end">
                              {expReached && (
                                <Pill c={overdue ? C.rush : C.high} bg={overdue ? C.rushBg : C.highBg} Icon={Truck}>
                                  {overdue ? `due ${dueLabel(m.expectedAt)}` : "arriving today"}
                                </Pill>
                              )}
                              {/* One toggle: quote requested or not. Ticked once set so
                                  it's obvious at a glance that someone's on it.
                                  Clicking ALWAYS opens the note. It used to clear the
                                  flag instead, so one stray tap wiped both the flag and
                                  the record of who was chasing it — and there was no way
                                  to read the note back without doing that. Clearing is
                                  still possible, but from inside the pop-up. */}
                              {!m.ordered && (
                                <button
                                  onClick={() => setQuoteTarget({ materials: [m] })}
                                  title={m.progress ? `Quote requested${m.progressAt ? ` · ${stamp(m.progressAt, now)}` : ""} — click to read the note` : "Mark that a quote has been requested"}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded btn-pop"
                                  style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", whiteSpace: "nowrap",
                                    ...(m.progress
                                      ? { background: C.highBg, color: C.high, border: `1px solid ${C.high}` }
                                      : { background: C.surface, color: C.gray, border: `1px solid ${C.line}` }) }}
                                >
                                  <Check size={12} style={{ opacity: m.progress ? 1 : 0.35 }} />Quote requested
                                </button>
                              )}
                              {m.ordered ? (
                                <button onClick={() => setOrderTarget(m)} title="View or edit the order details" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex" }}>
                                  <Pill c={C.blue} bg={C.blueBg} Icon={ShoppingCart}>ordered</Pill>
                                </button>
                              ) : (
                                <Btn kind="ghost" onClick={() => setOrderTarget(m)}><ShoppingCart size={13} />Mark ordered</Btn>
                              )}
                              <Btn kind="green" onClick={() => setReceiveTarget({ it, m })}><Check size={13} />Received</Btn>
                            </span>
                          </div>
                          {!m.ordered && m.progress && m.progressAt && (
                            <div style={{ fontSize: 11, color: C.gray, marginTop: 7 }}>
                              Quote requested · {stamp(m.progressAt, now)}{m.progressBy ? ` · by ${m.progressBy}` : ""}
                            </div>
                          )}
                          {/* Shown whenever there's something to show — NOT gated on
                              m.ordered, so un-ordering never makes the details look lost. */}
                          {(m.orderedQty || m.poNumber || m.vendor || m.contact || m.orderedBy || m.orderedAt || m.expectedAt) && (
                            <div style={{ fontSize: 11, color: C.gray, marginTop: 7 }}>
                              {[m.orderedQty && `got ${m.orderedQty}`, m.poNumber && `PO ${m.poNumber}`, m.vendor, m.contact && `talked to ${m.contact}`, m.orderedBy && `by ${m.orderedBy}`, m.orderedAt && `ordered ${stamp(new Date(m.orderedAt).getTime(), now)}`, m.expectedAt && `exp ${dueLabel(m.expectedAt)}`].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        );
                      })
                    )}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {/* ---- Inventory: low-stock notices. Purchasing's sibling — same idea,
                 but for products we MAKE instead of buy. Whoever spots the shortage
                 posts a notice; whoever makes it turns the notice into a work
                 order, so nobody has to do both jobs. ---- */}
            {tab === "inventory" && (
              <Tabwrap
                title="INVENTORY"
                sub="Products running low. Post a notice when you spot one — whoever makes it turns it into a work order."
                action={<Btn kind="dark" onClick={() => setShowNewNotice(true)}><Plus size={13} />New notice</Btn>}
              >
                {!openNotices.length && <Empty>Nothing running low. Post a notice when you spot a product getting thin.</Empty>}
                {openNotices.map((n) => (
                  <div key={n.id} className="rounded mb-3 card-pop" style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.high}` }}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <DeptBadge d={n.dept} />
                      <div className="min-w-0">
                        <div className="font-bold" style={{ fontSize: 15 }}>{n.name}</div>
                        <div style={{ fontSize: 12, color: C.gray }}>
                          {[n.reportedBy && `Noticed by ${n.reportedBy}`, `Posted ${stamp(n.createdAt, now)}`].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {n.qtyOnHand && (
                        <Pill c={C.high} bg={C.highBg} Icon={PackageSearch}>{n.qtyOnHand} on hand</Pill>
                      )}
                      <span className="basis-full sm:basis-auto sm:ml-auto flex flex-wrap items-center gap-2">
                        <Btn kind="dark" onClick={() => makeNoticeWorkOrder(n)}><Printer size={13} />Create work order</Btn>
                        <Btn onClick={() => stock.setHandled(n.id, true)} title="Already handled — file it away"><Check size={13} />Handled</Btn>
                        <button onClick={() => stock.deleteNotice(n.id)} title="Remove this notice" style={{ color: C.gray, background: "none", border: "none", cursor: "pointer", padding: 4, display: "inline-flex" }}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </div>
                    {n.note && (
                      <div className="px-4 py-2" style={{ borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.inkSoft, background: C.concrete }}>
                        {n.note}
                      </div>
                    )}
                  </div>
                ))}

                {!!handledNotices.length && (
                  <div style={{ marginTop: 20 }}>
                    <SectionHeader label="Handled" count={handledNotices.length} />
                    {handledNotices.map((n) => (
                      <div key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 rounded mb-2" style={{ background: C.concrete, border: `1px solid ${C.line}`, fontSize: 13 }}>
                        <span className="font-bold" style={{ color: C.gray, textDecoration: "line-through" }}>{n.name}</span>
                        {n.workOrderNo && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: C.inkSoft }}>WO #{n.workOrderNo}</span>}
                        <span style={{ fontSize: 12, color: C.gray }}>
                          {n.handledAt ? `Handled ${stamp(n.handledAt, now)}` : ""}
                        </span>
                        <span className="ml-auto">
                          <Btn onClick={() => stock.setHandled(n.id, false)}><RotateCcw size={13} />Reopen</Btn>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Tabwrap>
            )}

            {tab === "orders" && (
              <Tabwrap title="Orders" action={<div className="flex items-center gap-2 flex-wrap justify-end"><SortMenu value={sortBy} onChange={setSortBy} /><SegGroup value={orderSource} onChange={setOrderSource} options={[["all", "All"], ["QuickBooks", "QB"], ["Shopify", "Shopify"]]} /></div>}>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {OFILTERS.map((f) => (
                    <button
                      key={f.k} onClick={() => setOrderView(f.k)}
                      className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
                      style={orderView === f.k ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                    >
                      {f.label}{f.n != null ? ` · ${f.n}` : ""}
                    </button>
                  ))}
                  {manualOrder.length > 0 && (
                    <button onClick={resetOrder} title="Back to automatic sorting" className="px-3 py-1.5 rounded text-xs font-bold" style={{ background: "transparent", color: C.gray, border: `1px solid ${C.line}` }}>↺ Reset order</button>
                  )}
                </div>
                {!orderedVisible.length && <Empty>No orders in this view.</Empty>}
                {orderedVisible.map((o) => renderOrderCard(o))}
              </Tabwrap>
            )}

            {tab === "urgent" && (
              <Tabwrap title="Urgent">
                {!urgentOrders.length && <Empty>Nothing urgent right now. Orders show here when they're marked Urgent or due within 2 days.</Empty>}
                {urgentOrders.map((o) => renderOrderCard(o))}
              </Tabwrap>
            )}

            {tab === "willcall" && (
              <Tabwrap title="Will Call" action={<SortMenu value={sortBy} onChange={setSortBy} />}>
                <FulfillmentBoard variant="willcall" orders={sortOrders(willCallOrders)} now={now} onOpen={setDetailId} onPickedUp={(o) => setPartialTarget({ order: o, kind: "pickup" })} onSetLocation={board.setLocation} onReopen={board.reopenOrder} emptyText="Nothing on will-call yet. Completed orders land here when you mark them Will Call." />
              </Tabwrap>
            )}

            {tab === "shipping" && (
              <Tabwrap title="Shipping" action={<SortMenu value={sortBy} onChange={setSortBy} />}>
                <FulfillmentBoard variant="shipping" orders={sortOrders(shippingOrders)} now={now} onOpen={setDetailId} onMarkShipped={(o) => setPartialTarget({ order: o, kind: "shipment" })} onSetLocation={board.setLocation} onReopen={board.reopenOrder} emptyText="Nothing shipping yet. Completed orders land here when you mark them Ship." />
              </Tabwrap>
            )}

            {tab === "completed" && (
              <Tabwrap title="Completed" action={<SortMenu value={sortBy} onChange={setSortBy} />}>
                <SectionHeader label="Shipped" count={shippedOrders.length} />
                <div style={{ marginTop: 8 }}>
                  <FulfillmentBoard variant="shipping" orders={sortOrders(shippedOrders)} now={now} onOpen={setDetailId} emptyText="Nothing shipped yet. Orders land here once you log a tracking number in Shipping." />
                </div>
                <div style={{ marginTop: 22 }}>
                  <SectionHeader label="Picked up — will call" count={pickedUpOrders.length} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <FulfillmentBoard variant="willcall" orders={sortOrders(pickedUpOrders)} now={now} onOpen={setDetailId} emptyText="Nothing picked up yet. Will-call orders land here once they're collected." />
                </div>
              </Tabwrap>
            )}
          </>
        )}
      </div>

      {/* ---- modals ---- */}
      {showNew && (
        <NewOrderModal
          getNextOrderNo={board.nextOrderNo}
          onCreate={board.createOrder}
          onClose={() => setShowNew(false)}
        />
      )}
      {receiveTarget && (
        <ReceiveModal
          material={receiveTarget.m}
          onConfirm={confirmReceive}
          onClose={() => setReceiveTarget(null)}
        />
      )}
      {showNewPurchase && (
        <NewPurchaseModal
          getNextOrderNo={board.nextPurchaseNo}
          openFor={openDemandFor}
          onCreate={board.createPurchase}
          onClose={() => setShowNewPurchase(false)}
        />
      )}
      {resyncTarget && (
        <ResyncModal order={resyncTarget} onDone={board.refetch} onClose={() => setResyncTarget(null)} />
      )}
      {quoteTarget && (
        <QuoteModal
          material={quoteTarget.materials[0]}
          count={quoteTarget.materials.length}
          now={now}
          onConfirm={confirmQuote}
          onClear={clearQuote}
          onClose={() => setQuoteTarget(null)}
        />
      )}
      {showNewNotice && (
        <NewNoticeModal onCreate={stock.createNotice} onClose={() => setShowNewNotice(false)} />
      )}
      {matTarget && <MaterialModal onClose={() => setMatTarget(null)} onCommit={commitMaterials} openFor={openDemandFor} />}
      {detailOrder && (
        <OrderDetail
          order={detailOrder}
          status={orderStatus(detailOrder)}
          now={now}
          onDueDate={(date, time) => board.setDueDate(detailOrder.id, date, time)}
          onCompletion={(date) => board.setCompletionDate(detailOrder.id, date)}
          onInvoice={onInvoiceClick}
          onMethod={(m) => board.setFulfillmentMethod(detailOrder.id, m)}
          onSaveNotes={(notes) => board.setOrderNotes(detailOrder.id, notes)}
          onUpdateItem={(itemId, patch) => board.updateItem(itemId, patch)}
          onMoveItem={(itemId, s) => { if (s === "awaiting") { setDetailId(null); setMatTarget(itemId); } else moveItemU(itemId, s); }}
          onFinishItem={(itemId) => finishItemU(itemId)}
          onLoadEvents={board.getItemEvents}
          onResync={detailOrder.source === "QuickBooks" || detailOrder.source === "Shopify" ? () => setResyncTarget(detailOrder) : undefined}
          onGoToItem={(stage) => {
            // click a product's progress bubbles -> jump to the tab it lives in
            setDetailId(null);
            const map = { new: "new", picklist: "pick", workorder: "work", awaiting: "buy" };
            goToTab(detailOrder.id, map[stage] || (orderLocations(detailOrder)[0] || {}).k || "orders");
          }}
          onFulfill={(method) => { setDetailId(null); openFulfill(detailOrder, method); }}
          onSendOrderBack={(stage) => board.reopenOrder(detailOrder.id, stage)}
          onCancel={(reason) => board.cancelOrder(detailOrder.id, reason)}
          onWalkInPickup={!detailOrder.fulfillment && !detailOrder.pickedUpAt ? () => { setDetailId(null); setWalkInTarget(detailOrder); } : undefined}
          onPartialPickup={!detailOrder.fulfillment && !detailOrder.pickedUpAt ? () => { setDetailId(null); setPartialTarget({ order: detailOrder, kind: "pickup" }); } : undefined}
          onClose={() => setDetailId(null)}
        />
      )}
      {pickItem && (
        <PickPhoto
          order={pickItem.o} item={pickItem.it}
          qtyLabel={pickItem.wo ? "Qty" : "Pick qty"}
          actionLabel={pickItem.wo ? "Mark done" : "Item picked"}
          onPicked={async () => { await finishItemU(pickItem.it.id); setPickItem(null); }}
          onLoadEvents={board.getItemEvents}
          onSetImage={(url) => board.updateItem(pickItem.it.id, { imageUrl: url })}
          onUploadImage={(file) => board.uploadItemPhoto(pickItem.it.id, file)}
          onSetNote={(n) => board.updateItem(pickItem.it.id, { note: n })}
          onClose={() => setPickItem(null)}
        />
      )}
      {doc && <WorkOrderDoc order={doc.o} items={doc.items} onSave={(patch) => Promise.all((doc.saveTargets || doc.items).map((it) => board.updateItem(it.id, patch)))} onUploadPhoto={(file) => board.uploadItemPhoto((doc.saveTargets || doc.items)[0].id, file)} onClose={() => setDoc(null)} />}

      {/* Same product waiting on other orders — offer one sheet for all of them
          instead of running the same part twice. */}
      {likeKinds && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }} onClick={() => setLikeKinds(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 470, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
            <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
              <Layers size={17} />Same product on other orders
              <button onClick={() => setLikeKinds(null)} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
            </div>
            <div className="p-4">
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
                {likeKinds.it.name}{likeKinds.it.color ? ` · ${likeKinds.it.color}` : ""}
              </div>
              <div style={{ fontSize: 13, color: C.gray, marginBottom: 12 }}>
                Also on {likeKinds.others.length} other order{likeKinds.others.length > 1 ? "s" : ""} — make them all on one work order?
              </div>
              <div className="mb-4" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
                {[{ o: likeKinds.o, it: likeKinds.it, self: true }, ...likeKinds.others].map((e, i) => (
                  <div key={e.it.id} className="flex items-center gap-2 px-3 py-2" style={{ borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 12.5, background: e.self ? C.grayBg : C.surface }}>
                    <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>#{e.o.orderNo}</span>
                    <span className="min-w-0" style={{ color: C.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.o.customer}{e.self ? " · this one" : ""}
                    </span>
                    <span className="ml-auto" style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>×{e.it.qty}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: `2px solid ${C.line}`, background: C.grayBg }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5 }}>Total to make</span>
                  <span className="ml-auto" style={{ fontFamily: "ui-monospace,monospace", fontWeight: 800, fontSize: 14 }}>
                    ×{[likeKinds.it, ...likeKinds.others.map((e) => e.it)].reduce((n, x) => n + (parseFloat(x.qty) || 1), 0)}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => combineLikeKinds(likeKinds)}
                  className="flex-1 py-2.5 rounded font-bold uppercase tracking-wide text-xs"
                  style={{ background: C.fill, color: "#fff" }}
                >
                  Combine — one work order
                </button>
                <button
                  onClick={() => { setDoc({ o: likeKinds.o, items: [likeKinds.it] }); setLikeKinds(null); }}
                  className="flex-1 py-2.5 rounded font-bold uppercase tracking-wide text-xs"
                  style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  Just this order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {fulfillTarget && (
        <FulfillModal
          order={fulfillTarget.order}
          method={fulfillTarget.method}
          onConfirm={confirmFulfill}
          onClose={() => setFulfillTarget(null)}
        />
      )}
      {pickupTarget && (
        <PickedUpModal
          order={pickupTarget}
          onConfirm={confirmPickup}
          onClose={() => setPickupTarget(null)}
        />
      )}
      {walkInTarget && (
        <PickedUpModal
          order={walkInTarget}
          onConfirm={confirmWalkInPickup}
          onClose={() => setWalkInTarget(null)}
        />
      )}
      {partialTarget && (
        <PartialModal
          order={partialTarget.order}
          kind={partialTarget.kind}
          onConfirm={confirmPartial}
          onClose={() => setPartialTarget(null)}
        />
      )}
      {invoiceTarget && (
        <InvoiceModal
          order={invoiceTarget}
          onConfirm={async (num) => { await board.setInvoiced(invoiceTarget.id, true, num); setInvoiceTarget(null); }}
          onClose={() => setInvoiceTarget(null)}
        />
      )}
      {orderTarget && (
        <OrderedModal
          material={orderTarget}
          alsoNeeded={demandFor(orderTarget.name, orderTarget.id)}
          onConfirm={async (details) => { await markOrderedU(orderTarget.id, details); setOrderTarget(null); }}
          onUnorder={async () => { await board.unmarkOrdered(orderTarget.id); setOrderTarget(null); }}
          onClose={() => setOrderTarget(null)}
        />
      )}
      {confirmStock && (
        <div
          onClick={() => setConfirmStock(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", zIndex: 60, padding: "24px 12px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxWidth: "92vw", background: C.concrete, borderRadius: 8, overflow: "hidden", marginTop: "12vh" }}>
            <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
              Marked as picked?
              <button onClick={() => setConfirmStock(null)} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
            </div>
            <div className="p-4">
              <div style={{ fontSize: 14, marginBottom: 16 }}>
                Is <b>{confirmStock.name}</b> already picked off the shelf?
              </div>
              <div className="flex gap-2">
                <button onClick={() => { finishItemU(confirmStock.id); setConfirmStock(null); }} className="flex-1 py-2.5 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.green, color: "#fff" }}>Yes — already picked</button>
                <button onClick={() => { triage(confirmStock.id, "instock"); setConfirmStock(null); }} className="flex-1 py-2.5 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.surface, color: C.green, border: `1px solid ${C.green}` }}>No — send to pick list</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {trackTarget && (
        <TrackingModal
          order={trackTarget}
          onConfirm={confirmTracking}
          onClose={() => setTrackTarget(null)}
        />
      )}
      {customDoc && (
        <CustomWorkOrderDoc wo={customDoc} onSave={saveWorkOrder} onClose={() => setCustomDoc(null)} />
      )}
    </div>
  );
}

// #7: combine identical products across several orders into one batch line, so
// you can make them together (8 + 5 T-handles → 13) while still seeing which
// orders they came from. Read-only roll-up; the per-order view stays the source
// of truth for marking items done.
// Shared sort control. Same options everywhere so "oldest first" behaves the
// same on every tab; the Orders tab's manual drag order still overrides it.
const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "number", label: "Order number" },
  { value: "due", label: "Due date" },
];
function SortMenu({ value, onChange }) {
  const cur = SORT_OPTIONS.find((o) => o.value === value) || SORT_OPTIONS[0];
  return (
    <InlineMenu align="right" options={SORT_OPTIONS} onSelect={onChange}>
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold uppercase tracking-wide btn-pop"
        style={{ fontSize: 11, background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer", whiteSpace: "nowrap" }}
        title="Sort these orders"
      >
        <ArrowUpDown size={12} />{cur.label}
      </span>
    </InlineMenu>
  );
}

function CombinedItems({ orders, stage, onMake, onDept }) {
  const map = new Map();
  orders.forEach((o) =>
    o.items
      .filter((it) => it.stage === stage)
      .forEach((it) => {
        const key = `${it.name}__${it.color || ""}`;
        if (!map.has(key)) map.set(key, { name: it.name, color: it.color, dept: it.dept, qty: 0, sources: [], entries: [] });
        const e = map.get(key);
        e.qty += parseFloat(it.qty) || 1;
        e.sources.push({ orderNo: o.orderNo, qty: it.qty || 1 });
        e.entries.push({ o, it });
      })
  );
  const rows = [...map.values()].sort((a, b) => b.qty - a.qty);
  if (!rows.length) return <Empty>Nothing to combine yet.</Empty>;
  return (
    <>
      {rows.map((r, i) => (
        <div
          key={i}
          onClick={onMake ? () => onMake(r) : undefined}
          title={onMake ? "Make one work order for all of these" : undefined}
          className="rounded mb-2"
          style={{ background: C.surface, border: `1px solid ${C.line}`, cursor: onMake ? "pointer" : "default" }}
        >
          <div className="flex items-center gap-x-3 gap-y-2 px-4 py-3 flex-wrap">
            <span className="inline-flex items-center justify-center font-bold" style={{ minWidth: 46, height: 34, padding: "0 10px", borderRadius: 6, background: C.fill, color: "#fff", fontFamily: "ui-monospace,monospace", fontSize: 17 }}>
              ×{r.qty}
            </span>
            <DeptBadge d={r.dept} onChange={onDept ? (dep) => onDept(r, dep) : undefined} />
            <div style={{ minWidth: 0 }}>
              <div className="font-bold" style={{ fontSize: 14 }}>{r.name}{r.color ? ` · ${r.color}` : ""}</div>
              <div style={{ fontSize: 12, color: C.gray }}>
                {r.sources.length} order{r.sources.length === 1 ? "" : "s"}: {r.sources.map((s) => `#${s.orderNo} (${s.qty})`).join(", ")}
              </div>
            </div>
            {onMake && (
              <span className="basis-full sm:basis-auto sm:ml-auto flex justify-end" onClick={(e) => e.stopPropagation()}>
                <Btn onClick={() => onMake(r)}><Printer size={13} />Print work order</Btn>
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// List for the Will Call / Shipping tabs: completed orders with their staged
// warehouse location. Shipping orders also get a "Shipped" action that logs a
// tracking number; once logged, the tracking number shows in its place.
// The staged warehouse spot shown on a Will Call / Shipping card. Read-only text
// until you click it (only when onSave is given) — then an inline input to edit
// where the order is staged, without disturbing its fulfillment state.
function LocationCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const save = () => { onSave(v.trim() || null); setEditing(false); };
  if (editing) {
    return (
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <MapPin size={15} color={C.gray} />
        <input
          autoFocus value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setV(value || ""); setEditing(false); } }}
          placeholder="Location"
          className="px-2 py-1 outline-none"
          style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, width: 130 }}
        />
        <button onClick={save} title="Save location" className="inline-flex" style={{ color: C.green, background: "none", border: "none", cursor: "pointer", padding: 2 }}><Check size={16} /></button>
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1"
      onClick={onSave ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
      title={onSave ? "Click to edit the staged location" : undefined}
      style={{ cursor: onSave ? "pointer" : "default" }}
    >
      <MapPin size={15} color={C.gray} />
      <span className="font-bold">{value || "—"}</span>
      {onSave && <Pencil size={12} color={C.gray} style={{ flexShrink: 0 }} />}
    </span>
  );
}

function FulfillmentBoard({ orders, now, onOpen, onMarkShipped, onPickedUp, onSetLocation, onReopen, variant, emptyText }) {
  if (!orders.length) return <Empty>{emptyText}</Empty>;
  return (
    <>
      {orders.map((o) => {
        const shipped = variant === "shipping" && o.trackingNumber;
        const pickedUp = variant === "willcall" && o.pickedUpAt;
        const closed = shipped || pickedUp;
        const totalOrdered = o.items.reduce((n, it) => n + Math.max(parseInt(it.qty, 10) || 1, 1), 0);
        const totalOut = o.items.reduce((n, it) => n + (it.fulfilledQty || 0), 0);
        const partial = !closed && totalOut > 0 && totalOut < totalOrdered;
        // Urgent orders stay loud-red on the fulfillment boards too — unless
        // they're closed (shipped/picked up), where the green "done" wins.
        const urgent = !closed && effectivePriority(o, now) === "RUSH";
        return (
          <div
            key={o.id}
            id={`order-${o.id}`}
            onClick={() => onOpen(o.id)}
            className="mb-2 card-pop"
            style={{ background: urgent ? C.rushBg : C.surface, border: `1px solid ${urgent ? C.rush : C.line}`, borderLeft: `4px solid ${closed ? C.green : urgent ? C.rush : C.line}`, opacity: closed ? 0.7 : 1, cursor: "pointer", ...(o.notes ? { boxShadow: `0 0 0 2px ${C.note}` } : null) }}
          >
            <div className="flex items-center gap-x-3 gap-y-2 px-4 py-3 flex-wrap">
              <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, color: urgent ? C.rush : C.ink }}>#{o.orderNo}</span>
              {urgent && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide" style={{ background: C.rush, color: "#fff" }}>
                  <Flag size={12} />Urgent
                </span>
              )}
              <div className="min-w-0">
                <div className="font-bold flex items-center gap-2" style={{ fontSize: 14 }}>{o.customer}{o.notes && <Bell size={15} color={C.note} fill={C.note} title={`Note: ${o.notes}`} style={{ flexShrink: 0 }} />}</div>
                <div style={{ fontSize: 12, color: C.gray }}>Ordered by {o.contact} · {stamp(o.receivedAt, now)}</div>
                {o.shipTo && <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>→ Ship to: {o.shipTo}</div>}
            {o.shipVia && <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>→ Ship via: {o.shipVia}</div>}
              </div>
              <DuePill o={o} now={now} />
              {partial && <Pill c={C.high} bg={C.highBg} Icon={Package}>Partial · {totalOut}/{totalOrdered} {variant === "willcall" ? "picked up" : "shipped"}</Pill>}
              {variant === "shipping" && !shipped && stagedTooLong(o, now) && (
                <span
                  onClick={(e) => e.stopPropagation()}
                  title={`Staged to ship ${elapsed(stagedDwellMs(o, now))} — hasn't gone out yet`}
                  style={{ display: "inline-flex", flexShrink: 0 }}
                >
                  <Flag size={16} color={C.rush} fill={C.rush} />
                </span>
              )}
              <div className="basis-full sm:basis-auto sm:ml-auto flex flex-wrap items-center gap-3" style={{ fontSize: 13 }}>
                <LocationCell value={o.location} onSave={onSetLocation ? (loc) => onSetLocation(o.id, loc) : undefined} />
                {variant === "shipping" && (
                  shipped ? (
                    <span className="flex items-center gap-2 flex-wrap">
                      {o.carrier && <span style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft }}>{o.carrier}</span>}
                      <a
                        href={trackingUrl(o.trackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Track this shipment (opens the carrier's site in a new tab)"
                        style={{ textDecoration: "none" }}
                      >
                        <Pill c={C.green} bg={C.greenBg} Icon={Package}>{o.trackingNumber}<ExternalLink size={11} style={{ marginLeft: 3 }} /></Pill>
                      </a>
                      {o.shipNotes && <Bell size={14} color={C.gold} title={o.shipNotes} style={{ flexShrink: 0 }} />}
                    </span>
                  ) : (
                    <Btn kind="dark" onClick={(e) => { e.stopPropagation(); onMarkShipped(o); }}>
                      <Truck size={13} />Shipped
                    </Btn>
                  )
                )}
                {variant === "willcall" && (
                  pickedUp ? (
                    <Pill c={C.green} bg={C.greenBg} Icon={Check}>Picked up{o.pickedUpBy ? ` · ${o.pickedUpBy}` : ""}</Pill>
                  ) : (
                    <Btn kind="gold" onClick={(e) => { e.stopPropagation(); onPickedUp(o); }}>
                      <Check size={13} />Picked up
                    </Btn>
                  )
                )}
                {/* Send a not-yet-finished order back to a working tab. "Reopen"
                    keeps items done (just needs to go out); "Work Order/Pick List"
                    sends the not-fully-out items back to be finished. */}
                {onReopen && !closed && (
                  <InlineMenu
                    align="right"
                    options={[
                      { value: "reopen", label: "Reopen — back to Orders" },
                      { value: "workorder", label: "Send to Work Order" },
                      { value: "picklist", label: "Send to Pick List" },
                    ]}
                    onSelect={(v) => onReopen(o.id, v === "reopen" ? null : v)}
                  >
                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold uppercase tracking-wide btn-pop" style={{ fontSize: 12, background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer", whiteSpace: "nowrap" }}>
                      <RotateCcw size={12} />Send back
                    </span>
                  </InlineMenu>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// Order items within a card: still-to-triage ('new') first, fully-done last,
// everything already routed in between — so to-dos stay on top and finished work
// sinks to the bottom.
function itemRank(it) {
  return it.stage === "new" ? 0 : it.stage === "done" ? 2 : 1;
}

// Small expand/collapse-all toggle that sits next to a tab title (keeps it out
// of the action bar). The double-chevron shows whether a click opens or folds.
function ExpandToggle({ scope, ids, isExpanded, setAllExpanded }) {
  const anyOpen = ids.some((id) => isExpanded(scope, id));
  return (
    <button
      onClick={() => setAllExpanded(scope, ids, !anyOpen)}
      title={anyOpen ? "Collapse all" : "Expand all"}
      className="inline-flex items-center justify-center"
      style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.line}`, background: C.surface, color: C.inkSoft, cursor: "pointer" }}
    >
      {anyOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
    </button>
  );
}

// A segmented control with an Apple-style SLIDING pill: the dark indicator
// glides to whichever option you click instead of snapping. Equal-width buttons
// so the pill lines up on every option; an optional label sits to the left.
function SegGroup({ label, value, onChange, options, btnWidth = 70 }) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <span className="inline-flex items-center" style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: C.surface }}>
      {label && (
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: C.gray, textTransform: "uppercase", padding: "0 9px", whiteSpace: "nowrap", alignSelf: "stretch", display: "flex", alignItems: "center", borderRight: `1px solid ${C.line}` }}>{label}</span>
      )}
      <span style={{ position: "relative", display: "flex", padding: 3 }}>
        {/* the sliding pill — translateX by the active index, with a springy ease */}
        <span aria-hidden style={{ position: "absolute", top: 3, bottom: 3, left: 3, width: btnWidth, borderRadius: 6, background: C.fill, transform: `translateX(${idx * btnWidth}px)`, transition: "transform 0.26s cubic-bezier(0.34, 1.12, 0.64, 1)" }} />
        {options.map(([v, lbl]) => {
          const on = value === v;
          return (
            <button
              key={v} onClick={() => onChange(v)}
              className="text-xs font-bold uppercase tracking-wide no-pop"
              style={{ position: "relative", zIndex: 1, width: btnWidth, padding: "6px 0", border: "none", background: "transparent", color: on ? "#fff" : C.inkSoft, cursor: "pointer", transition: "color 0.2s", whiteSpace: "nowrap" }}
            >
              {lbl}
            </button>
          );
        })}
      </span>
    </span>
  );
}

function SectionHeader({ label, count }) {
  return (
    <div className="flex items-center gap-3 mb-3" style={{ marginTop: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2, color: C.ink }}>{label}</span>
      {count != null && (
        <span className="inline-flex items-center justify-center" style={{ minWidth: 20, height: 18, padding: "0 6px", background: C.grayBg, color: C.inkSoft, borderRadius: 9, fontSize: 11, fontWeight: 700 }}>{count}</span>
      )}
      <span style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  );
}

function Splash({ children }) {
  return (
    <div style={{ background: C.fill, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontStyle: "italic", fontWeight: 700 }}>
      {children}
    </div>
  );
}

function LocalBanner() {
  return (
    <div className="px-5 py-2 flex items-center gap-2" style={{ background: C.highBg, color: C.high, fontSize: 12.5 }}>
      <Clock size={14} />
      <span>
        <b>Local demo mode</b> — data lives in this browser only. Add your Supabase URL &amp; anon key to <code>.env</code> for the real multi-user backend.
      </span>
    </div>
  );
}
