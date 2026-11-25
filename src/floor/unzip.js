// Opening a .zip in the browser, for the import: a USB stick's programs are
// often zipped up to be emailed or carried. Only what the import needs: the
// files inside, as text. Built on the browser's own decompression, so nothing
// is added to the app.
//
// Handles the two ways a zip stores a file (as is, or deflated). Skips folders,
// the copies macOS adds (__MACOSX, "._" files), anything password-protected,
// and anything bigger than `max` (not a program).

const sig = (v, at) => v.getUint32(at, true);

export async function readZip(blob, { max = 3 * 1024 * 1024 } = {}) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // the end-of-archive record is in the last 64 KB (after any comment)
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (sig(v, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("That file isn't a zip, or it's damaged.");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  if (at === 0xffffffff) throw new Error("That zip is too big to open here. Unzip it on the computer and pick the folder instead.");
  const out = [];
  const skipped = [];
  const names = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || sig(v, at) !== 0x02014b50) throw new Error("That zip is damaged.");
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const packed = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const noteLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const path = names.decode(buf.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + noteLen;

    const base = path.split("/").pop();
    if (!base || path.endsWith("/")) continue;                                  // a folder
    if (path.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store") continue;
    if (flags & 1) { skipped.push({ name: path, why: "It's password-protected." }); continue; }
    if (size > max) { out.push({ name: base, path, size, text: "" }); continue; }  // too big to be a program: the import says so
    if (sig(v, local) !== 0x04034b50) { skipped.push({ name: path, why: "It's damaged in the zip." }); continue; }
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + packed);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8 && typeof DecompressionStream === "function") {
      bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    } else { skipped.push({ name: path, why: "It's packed in a way this can't open. Unzip it on the computer instead." }); continue; }
    // programs are plain text; a byte that isn't valid UTF-8 is read as Latin-1 so nothing is lost
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { text = new TextDecoder("latin1").decode(bytes); }
    out.push({ name: base, path, size: bytes.length, text });
  }
  return { files: out, skipped };
}

export const isZip = (file) => /\.zip$/i.test(file?.name || "") || /zip/i.test(file?.type || "");
