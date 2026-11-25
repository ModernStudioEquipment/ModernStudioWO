// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readZip, isZip } from "../floor/unzip.js";
import { planImport } from "../floor/cncPack.js";

// A zip made here, the way a computer makes one: some files stored as they
// are, some deflated, plus the junk macOS adds and a folder entry.
async function zip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.text ?? "");
    const data = e.deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    const method = e.deflate ? 8 : 0;
    const flags = e.locked ? 1 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(6, flags, true); local.setUint16(8, method, true);
    local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(8, flags, true); c.setUint16(10, method, true);
    c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

const PIN = "%\nO00017 (3IN STEEL BABY PIN)\nG20\nT0101 (CNMG ROUGH)\nG96 S400 M03\nG00 X1.35 Z0.1\nG01 X0.625 F0.006\nM30\n%\n";
const PLATE = "%\nO05001 (MOUNT PLATE)\nG20 G90\nT1 M06 (1/2 ENDMILL)\nG54 G00 X0. Y0.\nG43 H01 Z1.\nG01 Z-0.25 F20.\nM30\n%\n";

describe("opening a zip of programs", () => {
  it("reads every program inside, stored or deflated, from any folder in it", async () => {
    const z = await zip([
      { name: "ST10Y/", text: "" },
      { name: "ST10Y/O00017.nc", text: PIN, deflate: true },
      { name: "ST10Y/sub/O05001.NC", text: PLATE },
      { name: "__MACOSX/ST10Y/._O00017.nc", text: "junk" },
      { name: "ST10Y/.DS_Store", text: "junk" },
    ]);
    const { files, skipped } = await readZip(z);
    expect(files.map((f) => [f.name, f.path])).toEqual([["O00017.nc", "ST10Y/O00017.nc"], ["O05001.NC", "ST10Y/sub/O05001.NC"]]);
    expect(files[0].text).toBe(PIN);
    expect(files[1].text).toBe(PLATE);
    expect(skipped).toEqual([]);
    // and the import treats them like files picked one by one
    const plan = planImport(files, []);
    expect(plan.map((r) => [r.action, r.newName])).toEqual([["new", "3IN STEEL BABY PIN"], ["new", "MOUNT PLATE"]]);
  });

  it("says what it couldn't open, and refuses something that isn't a zip", async () => {
    const { files, skipped } = await readZip(await zip([{ name: "secret.nc", text: PIN, locked: true }, { name: "ok.nc", text: PIN }]));
    expect(files.map((f) => f.name)).toEqual(["ok.nc"]);
    expect(skipped).toEqual([{ name: "secret.nc", why: "It's password-protected." }]);
    await expect(readZip(new Blob(["just some text, not a zip"]))).rejects.toThrow(/isn't a zip/);
  });

  it("hands over a file too big to be a program with no text, so the import says why it skipped it", async () => {
    const { files } = await readZip(await zip([{ name: "big.nc", text: "G01 X1.\n".repeat(50) }]), { max: 100 });
    expect(files[0]).toMatchObject({ name: "big.nc", text: "" });
    expect(planImport([{ ...files[0] }], [])[0]).toMatchObject({ action: "skip" });
  });

  it("knows a zip when it sees one", () => {
    expect(isZip({ name: "Programs.ZIP" })).toBe(true);
    expect(isZip({ name: "x", type: "application/x-zip-compressed" })).toBe(true);
    expect(isZip({ name: "O00017.nc", type: "" })).toBe(false);
  });
});
