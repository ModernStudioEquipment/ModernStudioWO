import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CncControlPanel from "../floor/CncControlPanel.jsx";
import { PANELS, GUIDES, allKeys, guidesFor, cleanGuides, keyName } from "../floor/cncKeypad.js";
import { cleanMachineFacts } from "../floor/cncPack.js";
import { MACHINES } from "../floor/machines.js";

const vf4 = MACHINES.find((m) => m.key === "vf4");
const st = MACHINES.find((m) => m.key === "st10");

describe("the keypads, as on the machines", () => {
  it("every key a guide lights is on that control's panel", () => {
    for (const control of ["ngc", "classic"]) {
      const keys = allKeys(PANELS[control]);
      for (const g of GUIDES[control]) for (const s of g.steps) for (const id of s.keys) expect(keys.has(id), `${control} ${g.id}: ${id}`).toBe(true);
    }
  });
  it("each control has its own keys: TOOL OFFSET MEASURE on the NGC mill, X DIAMETER MEASURE on the Classic lathes", () => {
    expect(allKeys(PANELS.ngc).has("toolmeasure")).toBe(true);
    expect(allKeys(PANELS.ngc).has("xdia")).toBe(false);
    expect(allKeys(PANELS.classic).has("xdia")).toBe(true);
    expect(allKeys(PANELS.classic).has("setgraph")).toBe(true);
    expect(keyName(PANELS.classic, "setgraph")).toBe("SETTING GRAPHIC");
  });
});

describe("the guides", () => {
  it("light the step's keys, numbered, and step through", () => {
    render(<CncControlPanel machine={vf4} control="ngc" saved={{}} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Run a new program safely/ }));
    const lit = () => [...document.querySelectorAll(".kp-key.lit, .kp-big.lit button")].map((b) => b.getAttribute("data-key"));
    expect(lit().sort()).toEqual(["down", "listprogram", "selectprogram"]);
    expect(document.querySelector('[data-key="listprogram"] .kp-badge').textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(lit().sort()).toEqual(["cyclestart", "graphics"]);
    expect(screen.getAllByText(/Not checked on our machine yet/).length).toBe(1);
  });
  it("tapping a key says what it does", () => {
    render(<CncControlPanel machine={st} control="classic" saved={{}} />);
    fireEvent.click(document.querySelector('[data-key="zface"]'));
    expect(screen.getByRole("status").textContent).toMatch(/Z offset with the tool touched on the part's face/);
  });
  it("a lead changes a step and its keys, saves, and marks it checked", async () => {
    const onSave = vi.fn(async () => {});
    render(<CncControlPanel machine={st} control="classic" saved={{}} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: /Move an axis by hand/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change this guide/ }));
    fireEvent.change(screen.getByLabelText("What this step says"), { target: { value: "Press HANDLE JOG on the right." } });
    fireEvent.click(screen.getByRole("button", { name: /Pick this step's keys/ }));
    fireEvent.click(document.querySelector('[data-key="handlejog"]'));   // off
    fireEvent.click(document.querySelector('[data-key="memory"]'));      // on
    fireEvent.click(screen.getByRole("button", { name: /Save the guide/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0].jog;
    expect(saved.steps[0]).toEqual({ keys: ["memory"], say: "Press HANDLE JOG on the right." });
    expect(saved.checked).toBeUndefined();
  });
  it("what's saved comes back as the guide, and a checked one says who checked it", () => {
    const saved = cleanGuides({ jog: { title: "Jog", steps: [{ keys: ["handlejog", "bad key!"], say: "x" }], checked: true, by: "Moe", at: 5 }, "<bad>": {} });
    expect(saved).toEqual({ jog: { title: "Jog", steps: [{ keys: ["handlejog"], say: "x" }], checked: true, by: "Moe", at: 5 } });
    const g = guidesFor("classic", saved).find((x) => x.id === "jog");
    expect(g).toMatchObject({ title: "Jog", checked: true, by: "Moe" });
    render(<CncControlPanel machine={st} control="classic" saved={saved} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Jog/ }));
    expect(screen.getByText(/Checked on our ST-10Y by Moe/)).toBeTruthy();
    // and it's kept with the machine
    expect(cleanMachineFacts({ guides: saved }).guides).toEqual(saved);
  });
});
