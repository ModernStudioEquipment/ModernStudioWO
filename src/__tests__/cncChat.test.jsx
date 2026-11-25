import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { historyText, photosFor, parseAnswer, liveText, shopPack, partPack, memoryText, starters } from "../floor/cncChat.js";
import CncChat from "../floor/CncChat.jsx";
import { db } from "../lib/db.js";

// The assistant. The demo stand-in answers here (no backend in tests), so
// what's tested is the conversation: what's kept, what's sent, and what the
// buttons on an answer do.

const PIN = "%\nO00017 (PIN)\nG20 G40 G80 G99\nG50 S3000\nT0101 (CNMG ROUGH)\nG96 S400 M03\nG54 G00 X1.35 Z0.1 M08\nG01 X0.625 F0.006\nZ-1.\nG00 X1.4\nG28 U0. W0.\nM30\n%\n";
const part = { id: "p1", name: "Baby Pin", machine: "st10", material: "1018 steel", facts: { stock: '1.25" bar', holding: "3-jaw chuck" }, steps: [], photos: [] };
const tools = { st10: { tools: [{ t: "1", what: "CNMG rough turn" }], notes: "Door switch is touchy" } };

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("what goes with a question", () => {
  const msgs = [
    { role: "person", body: "What does line 7 do?", author: "Moe", at: new Date(2026, 10, 25).getTime(), photos: ["https://x/a.jpg"] },
    { role: "assistant", body: "It rapids to the start.", at: 2 },
    { role: "memory", body: "never sent as conversation", at: 3 },
  ];
  it("the conversation so far, with who asked and when, and nothing else", () => {
    const h = historyText(msgs);
    expect(h).toBe("Q (Moe, 11/25, with 1 photo): What does line 7 do?\n\nA: It rapids to the start.");
  });
  it("keeps the newest when it's long, and says how many were left out", () => {
    const long = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "assistant" : "person", body: `${i} ${"x".repeat(600)}`, at: i }));
    const h = historyText(long);
    expect(h.length).toBeLessThan(52_000);
    expect(h).toMatch(/^\(\d+ earlier messages left out to keep this short\.\)/);
    expect(h).toContain("199 xxx");
  });
  it("the photos: new ones first, then the latest from earlier, each saying where it came from, at most eight", () => {
    const p = photosFor(msgs, ["https://x/new.jpg"], "Is this held right?");
    expect(p.map((x) => x.url)).toEqual(["https://x/new.jpg", "https://x/a.jpg"]);
    expect(p[0].label).toMatch(/sent with this question: "Is this held right\?"/);
    expect(p[1].label).toMatch(/Moe sent on 11\/25 with "What does line 7 do\?"/);
    const many = [{ role: "person", photos: Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`), at: 1 }];
    expect(photosFor(many, ["https://x/n.jpg"])).toHaveLength(8);
  });
  it("a question about the shop carries every machine, the parts and what's remembered", () => {
    const pack = shopPack(tools, [part], [{ body: "T3 on the VF-4 is really a 3/8 endmill", partId: null }]);
    expect(pack).toMatch(/== MACHINE: Haas VF-4 ==\nWhat it is: Vertical machining center/);
    expect(pack).toMatch(/== MACHINE: Haas ST-10Y ==\nWhat it is: Turning center .* live tooling and a Y axis/);
    expect(pack).toMatch(/Notes: Door switch is touchy\nTool list:\n {2}T1 {2}CNMG rough turn/);
    expect(pack).toMatch(/== MACHINE: Haas DS-30SSY ==[\s\S]*Tool list: NOT FILLED IN/);
    expect(pack).toMatch(/- Baby Pin, on the ST-10Y, 1018 steel/);
    expect(pack).toMatch(/THINGS THE SHOP HAS ASKED YOU TO REMEMBER ==\n- T3 on the VF-4 is really a 3\/8 endmill/);
  });
  it("a question about a part carries the part's pack, the other machines, and what's remembered", () => {
    const pack = partPack(part, [{ id: "v", name: "O00017.nc", content: PIN, status: "unproven" }], tools, [{ body: "Use soft jaws", partId: "p1" }], [part]);
    expect(pack).toMatch(/CNC PART PACK: Baby Pin/);
    expect(pack).toMatch(/WHAT THE PROGRAM CUTS/);
    expect(pack).toMatch(/THE SHOP'S OTHER MACHINES ==\nHaas VF-4: Vertical/);
    expect(pack).not.toMatch(/OTHER MACHINES[\s\S]*Haas ST-10Y:/);    // its own machine is in the pack already
    expect(pack).toMatch(/- \(Baby Pin\) Use soft jaws/);
    expect(memoryText([])).toBe("");
  });
});

describe("what comes back", () => {
  it("the lines at the end become buttons, and the rest reads as plain text", () => {
    const a = parseAnswer("**Short answer:** it's fine.\n\n- Check the stick-out\n- Run it in single block\n\nREMEMBER: The ST-10Y chuck is 6 inch.\nREWRITE: Add a 0.01 chamfer to both ends.\nPHOTO: the part in the chuck\nremember: Second fact.\nREMEMBER:   ");
    expect(a.body).toBe("Short answer: it's fine.\n\n• Check the stick-out\n• Run it in single block");
    expect(a.remember).toEqual(["The ST-10Y chuck is 6 inch.", "Second fact."]);
    expect(a.rewrite).toBe("Add a 0.01 chamfer to both ends.");
    expect(a.photo).toBe("the part in the chuck");
  });
  it("while it's arriving, a half-written button line never shows", () => {
    expect(liveText("It's fine.\nREMEM")).toBe("It's fine.");
    expect(liveText("It's fine.\nREMEMBER: the ch")).toBe("It's fine.");
    expect(liveText("Remember to check")).toBe("Remember to check");
  });
  it("starts with questions that fit what it's about", () => {
    expect(starters(part)[0]).toMatch(/what this program does/);
    expect(starters(null).join(" ")).toMatch(/ST-10Y/);
  });
});

describe("the conversation on screen", () => {
  const pp = { programs: [{ id: "v", name: "O00017.nc", content: PIN, status: "unproven" }] };
  const open = () => render(<CncChat part={part} pp={pp} machineFacts={tools} parts={[part]} onClose={() => {}} onRewrite={() => {}} />);

  it("asks, shows the answer, and keeps both on the part", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Moe" } });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What does T1 do?" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText("What does T1 do?")).toBeTruthy();
    expect(await screen.findByText(/You asked: "What does T1 do\?"/, {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(async () => expect((await db.getCncChat("p1")).map((m) => [m.role, m.author])).toEqual([["person", "Moe"], ["assistant", ""]]), { timeout: 4000 });
    expect(localStorage.getItem("mse_cnc_name")).toBe("Moe");
  }, 15000);

  it("the next person sees it, and the next question is sent with it", async () => {
    await db.addCncChat({ partId: "p1", role: "person", body: "Is the stick-out right?", author: "Jesse" });
    await db.addCncChat({ partId: "p1", role: "assistant", body: "It needs 3.25 inches." });
    open();
    expect(await screen.findByText("Is the stick-out right?")).toBeTruthy();
    expect(screen.getByText("It needs 3.25 inches.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "And the jaws?" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText(/That's question 2 here, and the 1 before it were sent along with it/, {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it("what it learns is kept by itself, for every later question, labelled as not confirmed, and can be forgotten", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: "Anything to know?" } });
    fireEvent.click(screen.getByLabelText("Send"));
    // the demo answer ends with a REMEMBER line: no button to press, it's kept
    expect(await screen.findByText(/Remembered: This is what a remembered fact looks like/, {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(async () => expect((await db.getCncMemory("p1")).length).toBe(1));
    const [kept] = await db.getCncMemory("p1");
    expect(kept).toMatchObject({ partId: null, meta: { auto: true, from: "Baby Pin" } });
    expect(memoryText([kept], [part])).toMatch(/\[learned, not confirmed\]/);
    expect((await db.getCncMemory(null)).length).toBe(1);   // the whole shop's, not just this part's
    // asked again, the same fact isn't kept twice
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "And again?" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(async () => expect((await db.getCncChat("p1")).length).toBe(4), { timeout: 8000 });
    expect((await db.getCncMemory("p1")).length).toBe(1);
    // forgotten from the answer itself
    fireEvent.click(screen.getAllByRole("button", { name: /Forget: This is what a remembered fact looks like/ })[0]);
    await waitFor(async () => expect((await db.getCncMemory("p1")).length).toBe(0));
    expect(screen.getAllByText(/Forgotten: This is what a remembered fact looks like/).length).toBeGreaterThan(0);
  }, 20000);

  it("'This was wrong' keeps a correction that outranks everything, and says it in the conversation", async () => {
    await db.addCncChat({ partId: "p1", role: "person", body: "What insert is in T1?", author: "Moe" });
    const ans = await db.addCncChat({ partId: "p1", role: "assistant", body: "A CNMG 432.\nSURE: medium - from the program comment" });
    open();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Jesse" } });
    fireEvent.click(screen.getByRole("button", { name: /This was wrong/ }));
    expect(screen.getByRole("button", { name: /Keep the correction/ }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What's actually right"), { target: { value: "T1 is a DNMG 431 now" } });
    fireEvent.click(screen.getByRole("button", { name: /Keep the correction/ }));
    expect(await screen.findByText("That answer was wrong. What's right: T1 is a DNMG 431 now")).toBeTruthy();
    const mem = await db.getCncMemory("p1");
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ body: 'T1 is a DNMG 431 now (about: "What insert is in T1?")', author: "Jesse", meta: { correction: true } });
    // corrections come first, under their own heading, ahead of any fact however new
    const text = memoryText([{ body: "Newer fact", meta: { auto: true }, at: 9 }, ...mem], [part]);
    expect(text.indexOf("CORRECTIONS")).toBe(0);
    expect(text.indexOf("T1 is a DNMG 431 now")).toBeLessThan(text.indexOf("Newer fact"));
    expect(text).toMatch(/\[correction from Jesse\]/);
    expect(ans.id).toBeTruthy();
  });

  it("a very long memory keeps every correction and the newest facts, and says how many were left out", () => {
    const facts = Array.from({ length: 600 }, (_, i) => ({ body: `fact ${i} ${"x".repeat(80)}`, meta: { auto: true } }));
    const text = memoryText([{ body: "the one correction", meta: { correction: true }, author: "J" }, ...facts]);
    expect(text).toMatch(/the one correction/);
    expect(text).toMatch(/fact 599/);
    expect(text).not.toMatch(/fact 0 /);
    expect(text).toMatch(/older facts left out to keep this short/);
    expect(text.length).toBeLessThan(31_000);
  });

  it("'Rewrite with this' hands the instruction to the measured rewrite", async () => {
    await db.addCncChat({ partId: "p1", role: "assistant", body: "You could.\nREWRITE: Break the sharp edges with a 0.01 chamfer." });
    const onRewrite = vi.fn();
    render(<CncChat part={part} pp={pp} machineFacts={tools} parts={[part]} onClose={() => {}} onRewrite={onRewrite} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rewrite with this: Break the sharp edges/ }));
    expect(onRewrite).toHaveBeenCalledWith("Break the sharp edges with a 0.01 chamfer.");
  });

  it("a photo goes with the question and is kept with it", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    open();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "setup.png", { type: "image/png" });
    fireEvent.change(await screen.findByLabelText("Photo to send"), { target: { files: [file] } });
    expect(screen.getByAltText("photo 1 to send")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Send"));    // a photo on its own is a question too
    await waitFor(async () => expect((await db.getCncChat("p1"))[0]?.photos?.length).toBe(1));
    const q = (await db.getCncChat("p1"))[0];
    expect(q.body).toMatch(/What do you see in this photo/);
    expect(q.photos[0]).toMatch(/^data:/);                // in the demo, kept on this computer
  });

  it("the whole shop has its own conversation, apart from any part's", async () => {
    await db.addCncChat({ partId: "p1", role: "person", body: "About the pin" });
    render(<CncChat part={null} machineFacts={tools} parts={[part]} onClose={() => {}} />);
    expect(await screen.findByText(/Ask anything about the machines or the work/)).toBeTruthy();
    expect(screen.queryByText("About the pin")).toBeNull();
  });
});

describe("how sure it is", () => {
  it("is read off the last line and never shown as text", () => {
    expect(parseAnswer("6000 rpm.\nSURE: medium - your options may differ")).toMatchObject({ body: "6000 rpm.", sure: { level: "medium", why: "your options may differ" } });
    expect(parseAnswer("x\nSURE: HIGH — Haas manual").sure).toEqual({ level: "high", why: "Haas manual" });
    expect(parseAnswer("x\nSURE: probably").sure).toEqual({ level: "medium", why: "probably" });
    expect(parseAnswer("x").sure).toBeNull();
    expect(liveText("6000 rpm.\nSUR")).toBe("6000 rpm.");
  });
  it("is shown above the answer, with the pages it looked up below", async () => {
    await db.addCncChat({ partId: null, role: "assistant", body: "It tops out at 6000 rpm.\nSURE: low - couldn't confirm your options", meta: { sources: [{ url: "https://www.haascnc.com/st10y", title: "ST-10Y | Haas" }], searches: 2 } });
    render(<CncChat part={null} machineFacts={{}} parts={[]} onClose={() => {}} />);
    expect(await screen.findByText(/Not sure: check this before acting on it/)).toBeTruthy();
    expect(screen.getByText("couldn't confirm your options")).toBeTruthy();
    expect(screen.getByText(/Looked up \(2 searches\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "ST-10Y | Haas" }).getAttribute("href")).toBe("https://www.haascnc.com/st10y");
  });
});
