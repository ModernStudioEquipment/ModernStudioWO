// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sheetFromItem, sheetFromWorkOrder } from "../floor/floorSheet.js";

// The floor can open a work order now, read-only. What it must never see is who
// the order is for. These tests plant customer details in every place they
// could plausibly sit and check none of it comes out the other end.
const SECRET = /Keslow|Bob Smith|INV-99|555-0100|call him/i;

describe("the floor's read-only work order", () => {
  it("keeps the customer off a Shopify order's sheet", () => {
    const order = {
      orderNo: "34615", customer: "Keslow Camera", contact: "Bob Smith",
      priority: "RUSH", dueDate: "2026-11-20", invoice: "INV-99", phone: "555-0100",
    };
    const it_ = { name: "Grip head", qty: "6", color: "black", dept: "CNC", sku: "GH-1", imageUrl: "u", note: "call him first" };
    const s = sheetFromItem(order, it_);
    expect(JSON.stringify(s)).not.toMatch(SECRET);
    expect(s).toMatchObject({ orderNo: "34615", product: "Grip head", qty: "6", partNo: "GH-1", rush: true, dueDate: "2026-11-20" });
  });

  it("keeps Ordered by, Invoice(s) and Notes off a work order sheet", () => {
    const w = {
      orderNo: "100004", type: "cnc", station: "2",
      fields: {
        product: "Junior receiver", partNo: "JR-1125", total: "40", dueDate: "11/20/2026",
        orderedBy: "Bob Smith", invoices: "INV-99", notes: "Keslow wants it Friday, call him",
        step1: "face it", step2: "", step3: "bore it",
      },
    };
    const s = sheetFromWorkOrder(w);
    expect(JSON.stringify(s)).not.toMatch(SECRET);
    expect(s.steps).toEqual(["face it", "bore it"]);
    expect(s).toMatchObject({ dept: "CNC", station: "2", qty: "40", partNo: "JR-1125" });
  });

  it("brings a line-item sheet's rows, and only what to make from them", () => {
    const s = sheetFromWorkOrder({
      orderNo: "100005", type: "saw",
      fields: { invoices: "INV-99", lines: [
        { item: "1in bar", size: "48in", qty: "6", customer: "Keslow" },
        { item: "", size: "", qty: "" },
      ] },
    });
    expect(s.lines).toEqual([{ what: "1in bar", size: "48in", qty: "6" }]);
    expect(JSON.stringify(s)).not.toMatch(SECRET);
  });

  it("never invents a key: only the allowed ones come out", () => {
    const s = sheetFromWorkOrder({ type: "shop", fields: { anythingNew: "Keslow" } });
    expect(Object.keys(s).sort()).toEqual(
      ["color", "dept", "dueDate", "image", "kind", "lines", "orderNo", "partNo", "product", "qty", "rush", "station", "steps"].sort());
  });
});
