import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import CncPreview from "../floor/CncPreview.jsx";
import CncPrograms from "../floor/CncPrograms.jsx";

// The tool path drawing on screen. jsdom has no canvas, so the 2D context is a
// stand-in that counts what's drawn: enough to know the path reached the
// canvas and that the controls change what's on it.

const MILL = "O1\nT1 M06 (1/2 ENDMILL)\nG54 G00 X0. Y0.\nG43 H01 Z1.\nG01 Z-0.25 F10.\nX3.\nY2.\nG00 Z1.\nT2 M06 (DRILL)\nG00 X1. Y1.\nG43 H02 Z1.\nG81 Z-0.5 R0.1 F5.\nX2.\nG80\nM30\n";
const LATHE = "O2\nG50 S3000\nT0101 (ROUGH)\nG96 S400 M03\nG00 X1.3 Z0.1\nG71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.5\nG01 Z-1.\nN20 X1.25 Z-1.5\nG70 P10 Q20\nM30\n";

let ctx;
beforeEach(() => {
  localStorage.clear();
  ctx = { lines: 0, strokes: 0, arcs: 0 };
  const fake = {
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, setLineDash() {}, fill() {},
    moveTo() {}, lineTo() { ctx.lines += 1; }, stroke() { ctx.strokes += 1; }, arc() { ctx.arcs += 1; },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fake);
});

describe("the tool path drawing", () => {
  it("draws a mill program and says how far the cuts reach", () => {
    render(<CncPreview content={MILL} toolNames={{ 1: "1/2 ENDMILL", 2: "DRILL" }} />);
    expect(ctx.lines).toBeGreaterThan(5);
    expect(screen.getByText(/Cuts span X/).textContent).toMatch(/X 0 to 3/);
    expect(screen.getByText(/Deepest/).textContent).toMatch(/Z-0\.5/);
    expect(screen.getByText(/T1 1\/2 ENDMILL/)).toBeTruthy();
    expect(screen.getByText(/T2 DRILL/)).toBeTruthy();
    expect(screen.getByText(/It can't see the stock/)).toBeTruthy();
    for (const v of ["3D", "Top", "Front", "Side"]) expect(screen.getByRole("button", { name: v })).toBeTruthy();
  });

  it("draws a lathe program as a turned part and gives its diameters", () => {
    render(<CncPreview content={LATHE} />);
    expect(screen.getByText(/The tool cuts from diameter/).textContent).toMatch(/0\.5 out to 1\.25/);
    expect(screen.getByText(/drawn as the profile it cuts down to/)).toBeTruthy();
    for (const v of ["Side", "3D", "End"]) expect(screen.getByRole("button", { name: v })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Top" })).toBeNull();
  });

  it("stepping back with the slider shows the line the tool is on, and draws less", () => {
    render(<CncPreview content={MILL} />);
    const all = ctx.lines;
    ctx.lines = 0;
    fireEvent.change(screen.getByLabelText("Step through the program"), { target: { value: "2" } });
    expect(screen.getAllByText("Line 6").length).toBe(2);     // beside the slider, and with the program line
    expect(screen.getByText("X3.")).toBeTruthy();              // and the program line is shown
    expect(ctx.lines).toBeLessThan(all);
    expect(ctx.arcs).toBeGreaterThan(0);                       // the marker for where the tool is
  });

  it("hiding rapids draws fewer lines and drops them from the legend", () => {
    render(<CncPreview content={MILL} />);
    expect(screen.getByText(/Rapid \(not cutting\)/)).toBeTruthy();
    ctx.lines = 0;
    fireEvent.click(screen.getByLabelText(/Show rapid moves/));
    const without = ctx.lines;
    ctx.lines = 0;
    fireEvent.click(screen.getByLabelText(/Show rapid moves/));
    expect(ctx.lines).toBeGreaterThan(without);
    fireEvent.click(screen.getByLabelText(/Show rapid moves/));
    expect(screen.queryByText(/Rapid \(not cutting\)/)).toBeNull();
  });

  it("a view button redraws, and zoom buttons don't throw", () => {
    render(<CncPreview content={MILL} />);
    ctx.strokes = 0;
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(ctx.strokes).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Fit to the window"));
    fireEvent.click(screen.getByLabelText("Play the program"));
    expect(screen.getByLabelText("Pause")).toBeTruthy();
  });

  it("says so plainly when there's nothing to draw", () => {
    render(<CncPreview content={"O1\n(NOTHING HERE)\nM30\n"} />);
    expect(screen.getByText(/Nothing to draw/)).toBeTruthy();
  });

  it("survives a browser with no canvas at all", () => {
    HTMLCanvasElement.prototype.getContext.mockImplementation(() => null);
    expect(() => render(<CncPreview content={MILL} />)).not.toThrow();
    expect(screen.getByText(/Cuts span X/)).toBeTruthy();
  });
});

describe("opening it from a program", () => {
  it("each program has a 3D preview button that shows and hides the drawing", async () => {
    const part = { id: "p1", name: "Pin", machine: "st10", steps: [], photos: [], facts: {} };
    render(<CncPrograms part={part} onFact={() => {}} />);
    fireEvent.change(screen.getByLabelText("Program file"), { target: { files: [new File([LATHE], "O2.nc", { type: "text/plain" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /3D preview/ }));
    expect(screen.getByText(/The tool cuts from diameter/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Hide preview/ }));
    expect(screen.queryByText(/The tool cuts from diameter/)).toBeNull();
  });
});
