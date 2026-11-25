import { describe, it, expect, beforeEach, vi } from "vitest";
import { recall, remember } from "../floor/remember.js";

// Staying put across a refresh. The stored value is a hint, never trusted
// blindly: a tab name from last week may not exist today.

beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("remembering where someone was", () => {
  it("gives back what was stored", () => {
    remember("k", "machines");
    expect(recall("k")).toBe("machines");
  });
  it("falls back when nothing's stored, or it isn't one of the allowed values", () => {
    expect(recall("k", ["a", "b"], "a")).toBe("a");
    remember("k", "gone-tab");
    expect(recall("k", ["a", "b"], "a")).toBe("a");
    remember("k", "b");
    expect(recall("k", ["a", "b"], "a")).toBe("b");
  });
  it("forgets on an empty value", () => {
    remember("k", "x");
    remember("k", "");
    expect(recall("k", null, "none")).toBe("none");
  });
  it("never throws when storage is switched off", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(recall("k", null, "safe")).toBe("safe");
    expect(() => remember("k", "v")).not.toThrow();
  });
});
