// Sample data mirroring the prototype. Used to seed local/demo mode on first
// run, and mirrored by supabase/seed.sql for the real backend.
// Times are expressed as "minutes ago" and resolved at load time.

const SEED_ORDERS = [
  {
    orderNo: "1051", customer: "Floor — internal", contact: "Shop", minsAgo: 18, priority: "RUSH", source: "phone",
    items: [{ name: "Black rag 4x4", qty: 6, dept: "Sewing" }],
  },
  {
    orderNo: "1050", customer: "Apex Rentals", contact: "Dave R.", minsAgo: 125, priority: "High", source: "phone",
    items: [
      { name: '1/2" baby pin', qty: 10 },
      { name: "Knuckle head, anodized", qty: 4 },
      { name: "Sound blanket", qty: 2, dept: "Sewing" },
    ],
  },
  {
    orderNo: "1048", customer: "Lupe Films", contact: "Lupe", minsAgo: 1500, priority: "Normal", source: "phone",
    items: [
      { name: "C-stand arm", qty: 8, stage: "picklist" },
      { name: "Grip head", qty: 6, stage: "workorder", color: "Black" },
    ],
  },
  {
    orderNo: "1047", customer: "Sunset Stages", contact: "Order desk", minsAgo: 2900, priority: "Normal", source: "phone",
    items: [
      {
        name: "Cardellini-style clamp", qty: 12, stage: "awaiting", needsMaterial: true, color: "Black",
        materials: [{ name: '1" aluminum bar', amount: "20 ft", received: false, ordered: false }],
      },
    ],
  },
  {
    orderNo: "1042", customer: "R. Mendez (DP)", contact: "Mendez", minsAgo: 4300, priority: "Normal", source: "phone",
    items: [{ name: "Mafer clamp", qty: 5, stage: "done" }],
  },
  {
    orderNo: "1053", customer: "Indie DP — Sarah K.", contact: "Sarah K.", minsAgo: 8, priority: "RUSH", source: "phone",
    items: [{ name: "Cheese plate", qty: 4 }],
  },
  {
    orderNo: "1052", customer: "Griffith Park Studios", contact: "Tony", minsAgo: 45, priority: "High", source: "phone",
    items: [{ name: "Junior pin", qty: 20 }, { name: "Baby plate", qty: 10 }],
  },
  {
    orderNo: "1056", customer: "Hand Held Films", contact: "Marco", minsAgo: 95, priority: "High", source: "phone",
    items: [{ name: "Turtle base", qty: 2 }],
  },
  {
    orderNo: "1054", customer: "Keslow Camera", contact: "Front desk", minsAgo: 210, priority: "Normal", source: "phone",
    items: [{ name: "Grid clamp", qty: 16 }, { name: "Sound blanket", qty: 4, dept: "Sewing" }],
  },
  {
    orderNo: "1055", customer: "Quixote Studios", contact: "Purchasing", minsAgo: 640, priority: "Normal", source: "phone",
    items: [
      { name: "Offset arm", qty: 8 },
      { name: "C-stand riser", qty: 12 },
      { name: "Furni pad", qty: 6, dept: "Sewing" },
    ],
  },
  {
    orderNo: "1057", customer: "Sirui Rentals", contact: "Order desk", minsAgo: 1320, priority: "Normal", source: "phone",
    items: [{ name: "Empty sandbag (15 lb)", qty: 50, dept: "Sewing" }],
  },
  {
    orderNo: "1058", customer: "Mole-Richardson", contact: "Shop", minsAgo: 2100, priority: "Normal", source: "phone",
    items: [{ name: "Wall spreader", qty: 6 }, { name: "Scaffold clamp", qty: 24 }],
  },
];

let uid = 0;
const nid = () => `seed-${++uid}`;

// Build fully-shaped order objects (the normalized in-memory shape the UI uses).
export function buildSeed() {
  uid = 0;
  const now = Date.now();
  return SEED_ORDERS.map((o) => ({
    id: nid(),
    orderNo: o.orderNo,
    customer: o.customer,
    contact: o.contact,
    receivedAt: now - o.minsAgo * 60000,
    priority: o.priority || "Normal",
    source: o.source || "phone",
    willCall: false,
    fulfillment: null, // null | 'willcall' | 'shipping'
    location: null,
    trackingNumber: null,
    items: o.items.map((it) => ({
      id: nid(),
      name: it.name,
      qty: it.qty,
      dept: it.dept || "Machine",
      color: it.color || null,
      stage: it.stage || "new",
      needsMaterial: it.needsMaterial || false,
      materials: (it.materials || []).map((m) => ({
        id: nid(),
        name: m.name,
        amount: m.amount,
        ordered: m.ordered || false,
        received: m.received || false,
      })),
    })),
  }));
}
