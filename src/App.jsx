import React, { useEffect, useState } from "react";
import {
  Clock, Printer, Plus, Truck, CheckCircle2, AlertTriangle, Hammer,
  Flag, Check, ArrowRight, ShoppingCart, LogOut, Store, MapPin, Package,
} from "lucide-react";
import { C, PRI, PRI_CYCLE, elapsed, blocked, pct } from "./theme.js";
import { backendMode } from "./lib/db.js";
import { useAuth } from "./hooks/useAuth.js";
import { useOrders } from "./hooks/useOrders.js";
import { useWorkOrders } from "./hooks/useWorkOrders.js";
import {
  Pill, Btn, Group, ItemLine, Empty, Tabwrap, DeptBadge,
} from "./components/ui.jsx";
import { Auth } from "./components/Auth.jsx";
import { Logo } from "./components/Logo.jsx";
import { Dashboard } from "./components/Dashboard.jsx";
import { MaterialModal } from "./components/modals/MaterialModal.jsx";
import { OrderDetail } from "./components/modals/OrderDetail.jsx";
import { PickPhoto } from "./components/modals/PickPhoto.jsx";
import { WorkOrderDoc } from "./components/modals/WorkOrderDoc.jsx";
import { NewOrderModal } from "./components/modals/NewOrderModal.jsx";
import { FulfillModal } from "./components/modals/FulfillModal.jsx";
import { TrackingModal } from "./components/modals/TrackingModal.jsx";
import { CustomWorkOrderDoc } from "./components/modals/CustomWorkOrderDoc.jsx";
import { WO_TYPES } from "./components/workorders/forms.js";

export default function App() {
  const auth = useAuth();
  const authed = !auth.needsAuth || !!auth.user;
  const board = useOrders(authed);
  const wo = useWorkOrders(authed);
  const { orders } = board;

  const [tab, setTab] = useState("dash");
  const [now, setNow] = useState(Date.now());
  const [matTarget, setMatTarget] = useState(null); // itemId awaiting material entry
  const [doc, setDoc] = useState(null); // { o, it } for printable work order
  const [flashItem, setFlashItem] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [pickItem, setPickItem] = useState(null); // { o, it }
  const [orderView, setOrderView] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState(null); // { order, method }
  const [trackTarget, setTrackTarget] = useState(null); // order being marked shipped
  const [customDoc, setCustomDoc] = useState(null); // work order sheet open for edit ({type} = new, or a saved WO)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ---- gating: auth must resolve before we show anything ----
  if (auth.needsAuth && !auth.ready) {
    return <Splash>Connecting…</Splash>;
  }
  if (auth.needsAuth && !auth.user) {
    return <Auth auth={auth} />;
  }

  // ---- triage / workflow handlers ----
  const triage = (itemId, decision) => {
    if (decision === "need") return setMatTarget(itemId);
    board.triageItem(itemId, decision);
  };
  const commitMaterials = async (rows) => {
    await board.addMaterials(matTarget, rows);
    setMatTarget(null);
  };
  const cyclePri = (orderId, cur) => board.setPriority(orderId, PRI_CYCLE[cur]);

  // "Have it": material is on the shelf. Mark received; if that was the last
  // thing the item was waiting on, it auto-moves to Work Order — jump there
  // and flash it so the move is visible.
  const haveIt = async (it, m) => {
    const fresh = await board.receiveMaterial(m.id);
    const moved = fresh.flatMap((o) => o.items).find((x) => x.id === it.id);
    if (moved && moved.stage === "workorder") {
      setTab("work");
      setFlashItem(it.id);
      setTimeout(() => setFlashItem(null), 2600);
    }
  };

  // Close out a completed order via Ship or Will Call. Records the location and
  // sends the order to the matching top tab.
  const openFulfill = (order, method) => setFulfillTarget({ order, method });
  const confirmFulfill = async (location) => {
    const { order, method } = fulfillTarget;
    await board.fulfillOrder(order.id, method, location);
    setFulfillTarget(null);
    setTab(method === "willcall" ? "willcall" : "shipping");
  };

  // Shipping stage 2: record tracking number from the Shipping tab.
  const confirmTracking = async (trackingNumber) => {
    await board.markShipped(trackTarget.id, trackingNumber);
    setTrackTarget(null);
    setTab("shipped"); // order moves out of Shipping and into the Shipped tab
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
  const workOrders = orders.filter((o) => o.items.some((it) => it.stage === "workorder"));
  const qbActive = wo.workOrders.filter((w) => !w.done); // QuickBooks work orders not yet done
  const buyOrders = orders.filter((o) => o.items.some((it) => it.needsMaterial && it.materials.some((m) => !m.received)));
  const count = (os, pred) => os.reduce((n, o) => n + o.items.filter(pred).length, 0);
  const detailOrder = orders.find((o) => o.id === detailId);

  const oInTriage = (o) => o.items.some((i) => i.stage === "new");
  const oDone = (o) => !oInTriage(o) && o.items.length > 0 && o.items.every((i) => i.stage === "done");
  const oProg = (o) => !oInTriage(o) && !oDone(o);
  // Completed = production done but not yet shipped/will-called (awaiting that call).
  const awaitingFulfill = (o) => oDone(o) && !o.fulfillment;
  const willCallOrders = orders.filter((o) => o.fulfillment === "willcall");
  // Shipping = staged, no tracking yet. Shipped = tracking logged, out the door.
  const shippingOrders = orders.filter((o) => o.fulfillment === "shipping" && !o.trackingNumber);
  const shippedOrders = orders.filter((o) => o.fulfillment === "shipping" && o.trackingNumber);
  const OFILTERS = [
    { k: "all", label: "All", n: orders.length },
    { k: "triage", label: "In triage", n: orders.filter(oInTriage).length },
    { k: "prog", label: "In progress", n: orders.filter(oProg).length },
    { k: "done", label: "Completed", n: orders.filter(awaitingFulfill).length },
    { k: "pct", label: "% done", n: null },
  ];
  const visibleOrders =
    orderView === "triage" ? orders.filter(oInTriage)
    : orderView === "prog" ? orders.filter(oProg)
    : orderView === "done" ? orders.filter(awaitingFulfill)
    : orderView === "pct" ? [...orders].sort((a, b) => pct(b) - pct(a))
    : [...orders].sort((a, b) => b.receivedAt - a.receivedAt);

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

  const TABS = [
    { k: "dash", label: "Dashboard" },
    { k: "new", label: "New Orders", dot: newOrders.length },
    { k: "pick", label: "Pick List", n: count(pickOrders, (it) => it.stage === "picklist") },
    { k: "work", label: "Work Order", n: count(workOrders, (it) => it.stage === "workorder") },
    { k: "buy", label: "Purchasing", n: buyOrders.reduce((n, o) => n + o.items.reduce((s, it) => s + (it.needsMaterial ? it.materials.filter((m) => !m.received).length : 0), 0), 0) },
    { k: "orders", label: "Orders" },
    { k: "willcall", label: "Will Call", n: willCallOrders.length },
    { k: "shipping", label: "Shipping", n: shippingOrders.length },
    { k: "shipped", label: "Shipped", n: shippedOrders.length },
  ];

  return (
    <div style={{ background: C.concrete, minHeight: "100vh", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink }}>
      {/* ---- top bar ---- */}
      <div className="flex items-center gap-4 px-5 py-3" style={{ background: C.ink, color: "#fff" }}>
        <div className="shrink-0">
          <Logo height={30} variant="light" />
        </div>
        <div className="flex items-center gap-1 ml-2 flex-1 min-w-0" style={{ overflowX: "auto" }}>
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className="relative px-3 py-1.5 rounded font-bold shrink-0 whitespace-nowrap"
              style={{ fontSize: 13, background: tab === t.k ? "rgba(255,255,255,0.14)" : "transparent", color: tab === t.k ? "#fff" : "rgba(255,255,255,0.65)" }}
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
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded font-bold uppercase shrink-0"
          style={{ fontSize: 12, background: "#fff", color: C.ink, letterSpacing: 0.5 }}
        >
          <Plus size={15} />New order
        </button>
        {auth.needsAuth && (
          <button onClick={auth.signOut} title="Sign out" className="inline-flex items-center gap-1.5 shrink-0" style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            <LogOut size={15} />
          </button>
        )}
      </div>

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
                orders={orders}
                workOrders={wo.workOrders}
                now={now}
                onNavigate={setTab}
                onOpenOrder={setDetailId}
              />
            )}

            {tab === "new" && (
              <Tabwrap
                title="New orders — triage every item"
                sub="Grouped by order. For each line, say where it goes."
                action={<Btn kind="dark" onClick={() => setShowNew(true)}><Plus size={13} />New order</Btn>}
              >
                {!newOrders.length && <Empty>Nothing waiting. New orders land here the moment they come in.</Empty>}
                {newOrders.map((o) => (
                  <Group key={o.id} o={o} now={now}>
                    {o.items.filter((it) => it.stage === "new").map((it) => (
                      <div key={it.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                        <div className="flex items-center gap-2 mb-2">
                          <DeptBadge d={it.dept} />
                          <span className="font-bold" style={{ fontSize: 14 }}>{it.name}</span>
                          <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>×{it.qty}</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => triage(it.id, "instock")} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.greenBg, color: C.green, border: `1px solid ${C.green}` }}>In stock</button>
                          <button onClick={() => triage(it.id, "have")} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.highBg, color: C.high, border: `1px solid ${C.high}` }}>Create WO</button>
                          <button onClick={() => triage(it.id, "need")} className="flex-1 py-2 rounded font-bold uppercase tracking-wide text-xs" style={{ background: C.rushBg, color: C.rush, border: `1px solid ${C.rush}` }}>Material</button>
                        </div>
                      </div>
                    ))}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "pick" && (
              <Tabwrap title="Pick list — grab these off the shelf" sub="Click an item to see its photo, then grab it and check it off.">
                {!pickOrders.length && <Empty>Empty. In-stock items show up here after triage.</Empty>}
                {pickOrders.map((o) => (
                  <Group key={o.id} o={o} now={now}>
                    {o.items.filter((it) => it.stage === "picklist").map((it) => (
                      <ItemLine
                        key={it.id} it={it}
                        onOpen={() => setPickItem({ o, it })}
                        right={<Btn kind="dark" onClick={() => board.finishItem(it.id)}><Check size={13} />Item picked</Btn>}
                      />
                    ))}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "work" && (
              <Tabwrap title="Work order — make these" sub="QuickBooks orders you create here, plus Shopify orders pulled from the web.">
                {/* ---- QuickBooks: custom work orders ---- */}
                <div className="rounded mb-3 p-3 flex items-center gap-2 flex-wrap" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5 }}>New work order</span>
                  {WO_TYPES.map((t) => (
                    <button
                      key={t.key}
                      onClick={async () => setCustomDoc({ type: t.key, orderNo: await board.nextOrderNo() })}
                      className="px-3 py-2 rounded font-bold uppercase tracking-wide text-xs"
                      style={{ background: C.ink, color: "#fff" }}
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
                    style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.ink}`, cursor: "pointer" }}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15 }}>#{w.orderNo}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold uppercase" style={{ background: C.grayBg, color: C.inkSoft }}>{w.type}</span>
                      <div>
                        <div className="font-bold" style={{ fontSize: 14 }}>{w.title || "(untitled)"}</div>
                        <div style={{ fontSize: 12, color: C.gray }}>QuickBooks work order</div>
                      </div>
                      <span className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Pill c={C.inkSoft} bg={C.grayBg} Icon={Clock}>{elapsed(now - w.createdAt)} ago</Pill>
                        <Btn onClick={() => setCustomDoc(w)}><Printer size={13} />Print</Btn>
                        <Btn kind="dark" onClick={() => wo.markDone(w.id)}><Check size={13} />Mark done</Btn>
                      </span>
                    </div>
                  </div>
                ))}

                {/* ---- Shopify: triaged customer-order items ---- */}
                <div style={{ marginTop: 18 }}>
                  <SectionHeader label="Shopify" count={count(workOrders, (it) => it.stage === "workorder")} />
                </div>
                {!workOrders.length && <Empty>Nothing from Shopify yet. Triaged “create WO” items show up here.</Empty>}
                {workOrders.map((o) => (
                  <Group key={o.id} o={o} now={now}>
                    {o.items.filter((it) => it.stage === "workorder").map((it) => (
                      <ItemLine
                        key={it.id} it={it} flash={flashItem === it.id}
                        onOpen={() => setDoc({ o, it })}
                        right={
                          <span className="flex items-center gap-2">
                            <Pill c={C.inkSoft} bg={C.grayBg} Icon={Clock}>{elapsed(now - o.receivedAt)} ago</Pill>
                            <Btn onClick={() => setDoc({ o, it })}><Printer size={13} />Print</Btn>
                            <Btn kind="dark" onClick={() => board.finishItem(it.id)}><Check size={13} />Mark done</Btn>
                          </span>
                        }
                      />
                    ))}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "buy" && (
              <Tabwrap title="Purchasing — order this material" sub="Grouped by order. Hit “have it” and the item moves to Work Order.">
                {!buyOrders.length && <Empty>Nothing to buy. Materials land here when an item is triaged “need material.”</Empty>}
                {buyOrders.map((o) => (
                  <Group key={o.id} o={o} now={now}>
                    {o.items.filter((it) => it.needsMaterial).map((it) =>
                      it.materials.filter((m) => !m.received).map((m) => (
                        <div key={m.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                          <DeptBadge d={it.dept} />
                          <div>
                            <div className="font-bold" style={{ fontSize: 14 }}>{m.name}</div>
                            <div style={{ fontSize: 12, color: C.gray }}>for {it.name}</div>
                          </div>
                          <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>{m.amount}</span>
                          <span className="ml-auto flex items-center gap-2">
                            {m.ordered ? (
                              <Pill c={C.blue} bg={C.blueBg} Icon={ShoppingCart}>ordered</Pill>
                            ) : (
                              <Btn kind="ghost" onClick={() => board.markOrdered(m.id)}><ShoppingCart size={13} />Mark ordered</Btn>
                            )}
                            <Btn kind="green" onClick={() => haveIt(it, m)}><ArrowRight size={13} />Have it → Work Order</Btn>
                          </span>
                        </div>
                      ))
                    )}
                  </Group>
                ))}
              </Tabwrap>
            )}

            {tab === "orders" && (
              <Tabwrap title="Orders — the office view" sub="Click an order for full details. Filter or sort with the buttons below.">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {OFILTERS.map((f) => (
                    <button
                      key={f.k} onClick={() => setOrderView(f.k)}
                      className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
                      style={orderView === f.k ? { background: C.ink, color: "#fff" } : { background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}` }}
                    >
                      {f.label}{f.n != null ? ` · ${f.n}` : ""}
                    </button>
                  ))}
                </div>
                {!visibleOrders.length && <Empty>No orders in this view.</Empty>}
                {visibleOrders.map((o) => {
                  const st = orderStatus(o), p = PRI[o.priority];
                  const done = o.items.filter((it) => it.stage === "done").length, total = o.items.length;
                  return (
                    <div
                      key={o.id} onClick={() => setDetailId(o.id)}
                      className="rounded mb-2"
                      style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${st.c}`, opacity: o.fulfillment ? 0.6 : 1, cursor: "pointer" }}
                    >
                      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                        <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15 }}>#{o.orderNo}</span>
                        <div>
                          <div className="font-bold" style={{ fontSize: 14 }}>{o.customer}</div>
                          <div style={{ fontSize: 12, color: C.gray }}>Ordered by {o.contact} · {elapsed(now - o.receivedAt)} ago</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); cyclePri(o.id, o.priority); }} title="Click to change priority">
                          <Pill c={p.c} bg={p.bg} Icon={Flag}>{o.priority}</Pill>
                        </button>
                        <div className="ml-auto flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            {o.items.map((it) => (
                              <span key={it.id} title={it.name} style={{ width: 22, height: 8, borderRadius: 2, background: it.stage === "done" ? C.green : blocked(it) ? C.high : C.line }} />
                            ))}
                            <span style={{ fontSize: 12, color: C.gray, marginLeft: 4 }}>{done}/{total} done</span>
                          </div>
                          <Pill c={st.c} bg={st.bg} Icon={st.Icon}>{st.label}</Pill>
                          {st.key === "ready" ? (
                            <>
                              <Btn kind="gold" onClick={(e) => { e.stopPropagation(); openFulfill(o, "willcall"); }}>
                                <Store size={13} />Will call
                              </Btn>
                              <Btn kind="brass" onClick={(e) => { e.stopPropagation(); openFulfill(o, "shipping"); }}>
                                <Truck size={13} />Ship
                              </Btn>
                            </>
                          ) : st.key === "willcall" || st.key === "shipping" || st.key === "shipped" ? (
                            <span className="flex items-center gap-1" style={{ fontSize: 12, color: C.gray }}>
                              <MapPin size={12} />{o.location}
                              {o.trackingNumber && <span style={{ fontFamily: "ui-monospace,monospace", marginLeft: 6 }}>· {o.trackingNumber}</span>}
                            </span>
                          ) : (
                            <Btn onClick={(e) => { e.stopPropagation(); setDoc({ o, it: o.items.find((i) => i.stage === "workorder" || i.stage === "done") || o.items[0] }); }}>
                              <Printer size={13} />Work order
                            </Btn>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Tabwrap>
            )}

            {tab === "willcall" && (
              <Tabwrap title="Will Call — held for pickup" sub="Completed orders waiting for the customer to collect. Location is where to find them.">
                <FulfillmentBoard variant="willcall" orders={willCallOrders} now={now} onOpen={setDetailId} emptyText="Nothing on will-call yet. Completed orders land here when you mark them Will Call." />
              </Tabwrap>
            )}

            {tab === "shipping" && (
              <Tabwrap title="Shipping — staged to go out" sub="Where each order is staged in the shop. Hit Shipped to log the tracking number once it leaves.">
                <FulfillmentBoard variant="shipping" orders={shippingOrders} now={now} onOpen={setDetailId} onMarkShipped={setTrackTarget} emptyText="Nothing shipping yet. Completed orders land here when you mark them Ship." />
              </Tabwrap>
            )}

            {tab === "shipped" && (
              <Tabwrap title="Shipped — out the door" sub="Dispatched orders with their tracking numbers.">
                <FulfillmentBoard variant="shipping" orders={shippedOrders} now={now} onOpen={setDetailId} emptyText="Nothing shipped yet. Orders move here once you log a tracking number in Shipping." />
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
      {matTarget && <MaterialModal onClose={() => setMatTarget(null)} onCommit={commitMaterials} />}
      {detailOrder && <OrderDetail order={detailOrder} status={orderStatus(detailOrder)} now={now} onClose={() => setDetailId(null)} />}
      {pickItem && (
        <PickPhoto
          order={pickItem.o} item={pickItem.it}
          onPicked={async () => { await board.finishItem(pickItem.it.id); setPickItem(null); }}
          onClose={() => setPickItem(null)}
        />
      )}
      {doc && <WorkOrderDoc order={doc.o} item={doc.it} onSave={(patch) => board.updateItem(doc.it.id, patch)} onClose={() => setDoc(null)} />}
      {fulfillTarget && (
        <FulfillModal
          order={fulfillTarget.order}
          method={fulfillTarget.method}
          onConfirm={confirmFulfill}
          onClose={() => setFulfillTarget(null)}
        />
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

// List for the Will Call / Shipping tabs: completed orders with their staged
// warehouse location. Shipping orders also get a "Shipped" action that logs a
// tracking number; once logged, the tracking number shows in its place.
function FulfillmentBoard({ orders, now, onOpen, onMarkShipped, variant, emptyText }) {
  if (!orders.length) return <Empty>{emptyText}</Empty>;
  return (
    <>
      {orders.map((o) => {
        const p = PRI[o.priority];
        const shipped = variant === "shipping" && o.trackingNumber;
        return (
          <div
            key={o.id}
            onClick={() => onOpen(o.id)}
            className="rounded mb-2"
            style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${shipped ? C.green : C.line}`, opacity: shipped ? 0.7 : 1, cursor: "pointer" }}
          >
            <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
              <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 15 }}>#{o.orderNo}</span>
              <div>
                <div className="font-bold" style={{ fontSize: 14 }}>{o.customer}</div>
                <div style={{ fontSize: 12, color: C.gray }}>Ordered by {o.contact} · {elapsed(now - o.receivedAt)} ago</div>
              </div>
              <Pill c={p.c} bg={p.bg} Icon={Flag}>{o.priority}</Pill>
              <div className="ml-auto flex items-center gap-3" style={{ fontSize: 13 }}>
                <span className="flex items-center gap-1">
                  <MapPin size={15} color={C.gray} />
                  <span className="font-bold">{o.location || "—"}</span>
                </span>
                {variant === "shipping" && (
                  shipped ? (
                    <Pill c={C.green} bg={C.greenBg} Icon={Package}>{o.trackingNumber}</Pill>
                  ) : (
                    <Btn kind="dark" onClick={(e) => { e.stopPropagation(); onMarkShipped(o); }}>
                      <Truck size={13} />Shipped
                    </Btn>
                  )
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
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
    <div style={{ background: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontStyle: "italic", fontWeight: 700 }}>
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
