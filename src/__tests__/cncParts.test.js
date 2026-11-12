// @vitest-environment node
import { describe, it, expect } from "vitest";
import { duplicatePart, isSkuTaken } from "../floor/cncParts.js";

// Duplicating a catalogue part. SKU is unique in cnc_parts, so a copy that kept
// it could never be saved — the DUP- prefix (QuickBooks' own convention) is
// what makes the copy saveable at all.
const part = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Junior Receiver 1-1/8in Bore",
  sku: "012-345",
  productNo: "P-77",
  programNo: "O1234",
  material: "6061 bar",
  notes: "deburr the bore",
  blueprintUrl: "https://x/bp.png",
  steps: ["face it", "bore it"],
};

describe("duplicating a CNC part", () => {
  it("prefixes the identifiers the way QuickBooks does", () => {
    const c = duplicatePart(part);
    expect(c.sku).toBe("DUP-012-345");
    expect(c.productNo).toBe("DUP-P-77");
    expect(c.programNo).toBe("DUP-O1234");
  });

  it("copies everything else exactly, and comes back unsaved", () => {
    const c = duplicatePart(part);
    expect(c.id).toBeNull();
    expect(c.name).toBe(part.name);
    expect(c.material).toBe("6061 bar");
    expect(c.notes).toBe("deburr the bore");
    expect(c.blueprintUrl).toBe("https://x/bp.png");
    expect(c.steps).toEqual(["face it", "bore it"]);
  });

  it("doesn't share the steps array with the original", () => {
    const c = duplicatePart(part);
    c.steps[0] = "changed";
    expect(part.steps[0]).toBe("face it");
  });

  it("leaves a blank identifier blank instead of writing a bare DUP-", () => {
    const c = duplicatePart({ ...part, sku: "", productNo: "  ", programNo: undefined });
    expect(c.sku).toBe("");
    expect(c.productNo).toBe("");
    expect(c.programNo).toBe("");
  });

  it("can copy a copy", () => {
    expect(duplicatePart(duplicatePart(part)).sku).toBe("DUP-DUP-012-345");
  });

  it("recognises a taken SKU when the save is refused", () => {
    expect(isSkuTaken({ code: "23505", message: 'duplicate key value violates unique constraint "cnc_parts_sku_key"' })).toBe(true);
    expect(isSkuTaken({ message: "network down" })).toBe(false);
  });
});
