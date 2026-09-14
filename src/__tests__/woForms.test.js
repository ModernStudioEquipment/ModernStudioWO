import { describe, it, expect } from "vitest";
import { fieldsLostSwitching, remapFields, WO_FORMS } from "../components/workorders/forms.js";

// Changing which department makes a work order is a real edit, not a relabel:
// Shop and CNC are field sheets, Sewing and Saw are line-item sheets, and even
// the two line sheets don't use the same columns. These two helpers decide what
// survives the move and what the user is warned about losing — and they're now
// reachable in one click from the work-order card, not just from inside the
// sheet, so a wrong answer here quietly changes what the shop is told to make.

const sewing = { lines: [{ product: "Sandbag cover", qty: "12" }, { product: "Spare", qty: "3" }] };
const saw = { lines: [{ item: "1in bar", size: "48in", qty: "6" }] };
const cnc = { product: "1in Sleeve", order: "100", total: "100", partNo: "MSE-1001", step1: "face it" };

describe("moving a work order between departments", () => {
  it("carries the product text into the column the target sheet actually reads", () => {
    const out = remapFields("sewing", "saw", sewing);
    expect(out.lines[0].item).toBe("Sandbag cover");   // not left under `product`
    expect(out.lines[0].qty).toBe("12");
    expect(out.lines[1].item).toBe("Spare");
  });

  it("carries a cut list back the other way", () => {
    const out = remapFields("saw", "sewing", saw);
    expect(out.lines[0].product).toBe("1in bar");
    expect(out.lines[0].qty).toBe("6");
    // Sewing has no Size column — that's what the warning is for.
    expect(fieldsLostSwitching("saw", "sewing", saw)).toContain("Size");
  });

  it("says nothing is lost when every column has a home", () => {
    expect(fieldsLostSwitching("sewing", "saw", sewing)).toEqual([]);
  });

  it("names the fields a different layout can't hold", () => {
    const lost = fieldsLostSwitching("cnc", "sewing", cnc);
    expect(lost).toContain("Part #");
    expect(lost).toContain("Step 1");
    // and going the other way, the rows themselves
    expect(fieldsLostSwitching("sewing", "cnc", sewing)).toContain("the line items");
  });

  it("keeps the keys two field sheets share", () => {
    const out = remapFields("cnc", "shop", cnc);
    expect(out.product).toBe("1in Sleeve");
    expect(out.total).toBe("100");
    expect(out.partNo).toBeUndefined();               // Shop has no part number
    expect(fieldsLostSwitching("cnc", "shop", cnc)).toContain("Part #");
  });

  it("gives the target sheet's own empty shape when nothing carries", () => {
    const out = remapFields("shop", "saw", { product: "x" });
    // A Saw sheet starts with its own header (the W/O date) and one blank row.
    WO_FORMS.saw.header.forEach((f) => expect(out).toHaveProperty(f.key));
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toEqual({ item: "", size: "", qty: "" });
  });
});
