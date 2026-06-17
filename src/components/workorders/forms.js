// Form definitions for custom work orders, one per department. The modal and the
// printable doc both read these, so building/adjusting a department's form is
// just editing this file.
//
// layout "fields"    -> flat list of `fields`
// layout "lineItems" -> `header` fields + a repeating `line` (columns)

const today = () =>
  new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const todayShort = () => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const WO_TYPES = [
  { key: "shop", label: "Shop" },
  { key: "cnc", label: "CNC" },
  { key: "sewing", label: "Sewing" },
  { key: "saw", label: "Saw" },
];

export const WO_FORMS = {
  // The single-product MODERN sheet (formerly "Basic").
  shop: {
    label: "Shop work order",
    layout: "fields",
    fields: [
      { key: "product", label: "Product", type: "text", full: true },
      { key: "order", label: "Order", type: "text" },
      { key: "total", label: "Total", type: "text" },
      { key: "orderedOn", label: "Ordered on", type: "text", default: today },
      { key: "dueDate", label: "Due date", type: "text" },
      { key: "color", label: "Color", type: "text" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },

  // CNC sheet: the MODERN sheet plus a part number and a 6-step column.
  cnc: {
    label: "CNC work order",
    layout: "fields",
    fields: [
      { key: "product", label: "Product", type: "text", full: true },
      { key: "partNo", label: "Part #", type: "text" },
      { key: "order", label: "Order", type: "text" },
      { key: "total", label: "Total", type: "text" },
      { key: "orderedOn", label: "Ordered on", type: "text", default: today },
      { key: "dueDate", label: "Due date", type: "text" },
      { key: "step1", label: "Step 1", type: "text", full: true },
      { key: "step2", label: "Step 2", type: "text", full: true },
      { key: "step3", label: "Step 3", type: "text", full: true },
      { key: "step4", label: "Step 4", type: "text", full: true },
      { key: "step5", label: "Step 5", type: "text", full: true },
      { key: "step6", label: "Step 6", type: "text", full: true },
    ],
  },

  // Sewing sheet: header + a product/qty line-item list.
  sewing: {
    label: "Sewing work order",
    layout: "lineItems",
    lineLabel: "Products",
    header: [
      { key: "orderDate", label: "Order date", default: todayShort },
      { key: "dueDate", label: "Due date" },
      { key: "time", label: "Time" },
      { key: "invoices", label: "Invoice(s)" },
    ],
    line: [
      { key: "product", label: "Product", grow: true },
      { key: "qty", label: "Qty", width: 70 },
    ],
    minRows: 18,
  },

  // Saw sheet: plain cut list — Order # + material / size / qty rows.
  saw: {
    label: "Saw work order",
    layout: "lineItems",
    lineLabel: "Cut list",
    header: [],
    line: [
      { key: "item", label: "Material / item", grow: true },
      { key: "size", label: "Size", width: 100 },
      { key: "qty", label: "Qty", width: 70 },
    ],
    minRows: 12,
  },
};

export const emptyLine = (form) => {
  const o = {};
  form.line.forEach((c) => (o[c.key] = ""));
  return o;
};

export const initFields = (form) => {
  if (form.layout === "lineItems") {
    const o = { lines: [emptyLine(form)] };
    form.header.forEach((f) => (o[f.key] = f.default ? f.default() : ""));
    return o;
  }
  const o = {};
  form.fields.forEach((f) => (o[f.key] = f.default ? f.default() : ""));
  return o;
};
