import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";

// Does the app actually come up? These run against the localStorage demo
// adapter (no VITE_SUPABASE_* in the test env), so they exercise the real
// component tree without touching the backend.

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("app boots", () => {
  it("renders the board without throwing", async () => {
    const { default: App } = await import("../App.jsx");
    const { container } = render(<App />);
    // Something rendered — not a blank root.
    expect(container.firstChild).not.toBeNull();
  });

  it("shows the main navigation", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    // Tabs the shop relies on every day. If these vanish, the board is unusable
    // even if React didn't technically crash. findAll* because these labels
    // legitimately appear more than once (nav tab AND the section heading).
    expect((await screen.findAllByText(/Dashboard/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/New Orders/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Pick List/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Purchasing/i)).length).toBeGreaterThan(0);
  });
});

describe("error boundary", () => {
  it("shows a recovery panel instead of a blank screen when a child throws", () => {
    const Boom = () => { throw new Error("kaboom"); };
    // React logs the caught error; silence it so the run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();          // the actual cause is visible
    expect(screen.getByText(/Reload the board/i)).toBeTruthy(); // and there's a way out
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>the board</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("the board")).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });
});
