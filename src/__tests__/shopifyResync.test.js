import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planChanges, lineName, effectiveQty } from "../../api/shopify-resync.js";

// The Shopify re-sync DELETES board items that Shopify no longer lists. If the
// pairing is wrong, an edited line looks like "removed + added" and every note,
// timestamp and completion logged against it is destroyed. That can't be tested
// against the live store, so it's tested here instead.

const bItem = (name, extra = {}) => ({ id: name, name, qty: "1", ...extra });
const sItem = (name, qty = 1) => ({ name, qty });

describe("planChanges — pairing board items to Shopify lines", () => {
  it("does nothing when the order is unchanged", () => {
    const board = [bItem("8' Wag Flags — Solid / Without Frame"), bItem("Grip Head")];
    const shop = [sItem("8' Wag Flags — Solid / Without Frame"), sItem("Grip Head")];
    const p = planChanges(board, shop);
    expect(p.add).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("ignores case and spacing rather than calling it a rename", () => {
    const p = planChanges([bItem("Grip  Head")], [sItem("grip head")]);
    expect(p.remove).toEqual([]);
    expect(p.add).toEqual([]);
    // Same item — but the exact spelling from Shopify wins.
    expect(p.update[0].to.name).toBe("grip head");
  });

  // THE CASE THE FEATURE EXISTS FOR: a variant swapped after the order synced.
  it("treats a variant change as an update, NOT a delete + re-add", () => {
    const board = [bItem("8' Wag Flags — Solid / Without Frame", { stage: "done", completed_by: "Jose" })];
    const shop = [sItem("8' Wag Flags — Silent Full Grid Cloth / With Frame")];
    const p = planChanges(board, shop);
    expect(p.remove).toEqual([]);                 // nothing destroyed
    expect(p.add).toEqual([]);                    // nothing duplicated
    expect(p.update).toHaveLength(1);
    expect(p.update[0].to.name).toBe("8' Wag Flags — Silent Full Grid Cloth / With Frame");
  });

  // Order 34084's real shape: two variants of the SAME product, both finished.
  it("keeps two variants of one product apart instead of cross-pairing them", () => {
    const board = [
      bItem("8' Wag Flags — Solid / Without Frame", { stage: "done" }),
      bItem("8' Wag Flags — Silent Full Grid Cloth / With Frame", { stage: "done" }),
    ];
    const shop = [
      sItem("8' Wag Flags — Silent Full Grid Cloth / With Frame"),
      sItem("8' Wag Flags — Solid / Without Frame"),
    ];
    const p = planChanges(board, shop);
    expect(p.add).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);   // completed work left alone
  });

  it("pairs the exact match first when one variant of a pair changed", () => {
    const board = [
      bItem("8' Wag Flags — Solid / Without Frame"),
      bItem("8' Wag Flags — Silent Full Grid Cloth / With Frame"),
    ];
    const shop = [
      sItem("8' Wag Flags — Solid / Without Frame"),      // unchanged
      sItem("8' Wag Flags — Bleached Muslin / With Frame"), // edited
    ];
    const p = planChanges(board, shop);
    expect(p.remove).toEqual([]);
    expect(p.add).toEqual([]);
    expect(p.update).toHaveLength(1);
    // The UNCHANGED line must not be the one rewritten.
    expect(p.update[0].from.name).toBe("8' Wag Flags — Silent Full Grid Cloth / With Frame");
    expect(p.update[0].to.name).toBe("8' Wag Flags — Bleached Muslin / With Frame");
  });

  it("reports a genuinely new line as an addition", () => {
    const p = planChanges([bItem("Grip Head")], [sItem("Grip Head"), sItem("Trolley Adapter")]);
    expect(p.add.map((a) => a.name)).toEqual(["Trolley Adapter"]);
    expect(p.remove).toEqual([]);
  });

  it("reports a genuinely deleted line as a removal, and flags logged work", () => {
    const board = [bItem("Grip Head"), bItem("Trolley Adapter", { stage: "done", completed_by: "Ana" })];
    const p = planChanges(board, [sItem("Grip Head")]);
    expect(p.add).toEqual([]);
    expect(p.remove).toHaveLength(1);
    expect(p.remove[0].name).toBe("Trolley Adapter");
    expect(p.remove[0].hasWork).toBe(true);   // the modal warns before applying this
  });

  it("flags work in every form the board records it", () => {
    const forms = [{ stage: "done" }, { completed_by: "Ana" }, { in_progress: true }, { needs_material: true }];
    for (const f of forms) {
      expect(planChanges([bItem("X", f)], []).remove[0].hasWork).toBe(true);
    }
    expect(planChanges([bItem("X", { stage: "new" })], []).remove[0].hasWork).toBe(false);
  });

  it("updates a changed quantity without touching the name", () => {
    const p = planChanges([bItem("Grip Head", { qty: "2" })], [sItem("Grip Head", 5)]);
    expect(p.update).toHaveLength(1);
    expect(p.update[0].to).toEqual({ qty: "5" });
    expect(p.remove).toEqual([]);
  });

  it("handles an empty board and an empty Shopify order", () => {
    expect(planChanges([], [sItem("Grip Head")]).add).toHaveLength(1);
    expect(planChanges([bItem("Grip Head")], []).remove).toHaveLength(1);
    expect(planChanges([], [])).toEqual({ add: [], update: [], remove: [] });
  });
});

describe("line mapping", () => {
  it("names a line the same way the webhook did when it created it", () => {
    expect(lineName({ title: "Grip Head", variant_title: null })).toBe("Grip Head");
    expect(lineName({ title: "8' Wag Flags", variant_title: "Solid / Without Frame" }))
      .toBe("8' Wag Flags — Solid / Without Frame");
  });

  it("uses current_quantity so refunded and edited-out lines drop to zero", () => {
    expect(effectiveQty({ quantity: 3, current_quantity: 1 })).toBe(1);
    expect(effectiveQty({ quantity: 2, current_quantity: 0 })).toBe(0); // filtered out upstream
    expect(effectiveQty({ quantity: 2 })).toBe(2);                      // older orders omit it
    expect(effectiveQty({})).toBe(1);
  });
});

// The webhook writes the names; the re-sync compares against them. If the two
// ever disagree, a re-sync would rename every single line on its first run.
describe("webhook and re-sync agree on how a line is named", () => {
  it("the webhook still builds names as 'title — variant_title'", () => {
    const src = readFileSync(resolve(process.cwd(), "api/shopify-webhook.js"), "utf8");
    expect(
      src.includes("li.variant_title ? `${li.title} — ${li.variant_title}` : li.title"),
      "api/shopify-webhook.js changed how it names line items. api/shopify-resync.js\n" +
        "must be changed to match (lineName), or the next re-sync will rename every line."
    ).toBe(true);
  });
});
