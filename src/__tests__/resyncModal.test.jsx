import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ResyncModal } from "../components/modals/ResyncModal.jsx";

// One modal now serves two intake systems. If it ever asks the wrong endpoint,
// a Shopify order gets checked against QuickBooks — which doesn't have it — and
// the plan comes back proposing to delete every line on the order.

const plan = (over = {}) => ({
  mode: "resync-preview", orderNo: "34084", kind: "order",
  boardItems: 2, sourceItems: 2, add: [], update: [], remove: [], inSync: true, ...over,
});

let calls;
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((u, opts) => {
    calls.push({ url: String(u), method: opts?.method || "GET" });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(plan()) });
  }));
});

const open = (order) => render(<ResyncModal order={order} onClose={() => {}} onDone={() => {}} />);

describe("ResyncModal — asks the system the order actually came from", () => {
  it("sends a Shopify order to the Shopify endpoint", async () => {
    open({ orderNo: "34084", source: "Shopify" });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe("/api/shopify-resync?order=34084");
    expect(calls[0].method).toBe("GET");   // opening the modal must never write
  });

  it("still sends a QuickBooks order to the QuickBooks endpoint", async () => {
    open({ orderNo: "336556", source: "QuickBooks" });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe("/api/conductor-sync?resync=336556");
  });

  it("names the right system on screen", async () => {
    open({ orderNo: "34084", source: "Shopify" });
    expect(await screen.findByText(/Re-sync #34084 from Shopify/i)).toBeTruthy();
    expect(await screen.findByText(/Already matches Shopify/i)).toBeTruthy();
  });

  it("warns when the order is cancelled in Shopify instead of acting on it", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(plan({ cancelledInShopify: true })) })
    ));
    open({ orderNo: "34084", source: "Shopify" });
    expect(await screen.findByText(/cancelled in Shopify/i)).toBeTruthy();
  });

  it("surfaces the endpoint's own error text rather than a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "34084 wasn't found in Shopify." }) })
    ));
    open({ orderNo: "34084", source: "Shopify" });
    expect(await screen.findByText(/wasn't found in Shopify/i)).toBeTruthy();
  });
});
