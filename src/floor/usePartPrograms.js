import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/db.js";
import {
  programInfo, checkForPart, checkCounts, diffPrograms, readiness, readyCount,
  looksLikeProgram, MAX_PROGRAM_BYTES, nextStep,
} from "./cncPack.js";
import { toolpath } from "./cncPath.js";
import { cleanProgramText } from "./cncGcode.js";
import { estimateTime } from "./cncTime.js";
import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";

// Everything about one part's program files, in one place: loading them,
// adding and removing versions, stamping them proven, and what follows from
// them (what the checker found, how long it runs, what the part needs next).
//
// One instance per open part. The overview, the guided setup and the full
// details page all read the same one, so they can't disagree and the files
// are only fetched once.

const NO_FACTS = {}; // a stable default, so the memo below isn't thrown away every render

export function usePartPrograms(part, machineFacts = NO_FACTS, { onChanged } = {}) {
  const [programs, setPrograms] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null); // which part the list above belongs to
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploads, setUploads] = useState(0);        // bumps when a file is added, so views can show it

  const partId = part?.id || null;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const wanted = useRef(partId);
  wanted.current = partId;

  async function reload() {
    if (!partId) { setPrograms([]); setLoadedFor(null); return; }
    try {
      const list = await db.getCncPrograms(partId);
      // a slow answer for a part that's no longer open must not land on this one
      if (!alive.current || wanted.current !== partId) return;
      setPrograms(list);
      setLoadedFor(partId);
    } catch (e) {
      if (alive.current) setErr(e?.message || "Couldn't load the programs.");
    }
  }
  useEffect(() => {
    // A different part: its programs aren't loaded yet, and the last part's
    // must not sit under this one's name while they are.
    setPrograms([]); setLoadedFor(null); setErr("");
    reload();
  }, [partId]);

  const say = (e, what) => setErr(
    /cnc_programs|schema cache|does not exist/i.test(e?.message || "")
      ? "Program files need migration 0068 run first."
      : `${what}${e?.message ? `: ${e.message}` : "."}`
  );
  const changed = async () => { await reload(); onChanged?.(); };

  // Add program files. Returns how many went in (0 when every one was refused).
  async function addFiles(files) {
    if (!files?.length || !partId) return 0;
    setBusy(true);
    setErr("");
    let added = 0;
    try {
      const have = new Set(programs.map((p) => p.content));
      for (const f of files) {
        if (f.size > MAX_PROGRAM_BYTES) { setErr(`${f.name} is too big to be a program file (over 2 MB).`); continue; }
        const text = cleanProgramText(await readText(f)).text;
        if (!looksLikeProgram(text)) { setErr(`${f.name} isn't a program file. Upload the .nc file the Haas runs, not the Mastercam file.`); continue; }
        if (have.has(text)) { setErr(`${f.name} is already here: it's identical to a version that's been uploaded.`); continue; }
        await db.addCncProgram({ partId, name: f.name, content: text });
        have.add(text);
        added += 1;
      }
      await changed();
      if (added) setUploads((n) => n + 1);
    } catch (e2) {
      say(e2, "Couldn't save that program");
    } finally {
      if (alive.current) setBusy(false);
    }
    return added;
  }
  // A program the app wrote (an AI draft, or one made from sizes). Goes in as a
  // new version like any upload, never proven, with the record of how it came
  // about. Returns true when it's saved.
  async function addDraft({ name, content, ai = null }) {
    if (!partId || !String(content || "").trim()) return false;
    setBusy(true);
    setErr("");
    try {
      if (programs.some((p) => p.content === content)) { setErr("That's identical to a version that's already here."); return false; }
      await db.addCncProgram({ partId, name, content, ai });
      await changed();
      setUploads((n) => n + 1);
      return true;
    } catch (e) {
      say(e, "Couldn't save that program");
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  // Keep the AI's review with the version it read. Not worth an error on
  // screen if it can't be kept: the review is still in front of the person.
  async function keepReview(id, review) {
    try { await db.setCncProgramReview?.(id, review); await reload(); } catch { /* shown, just not kept */ }
  }
  async function prove(id, proven, by, record = null) {
    setErr("");
    try { await db.setCncProgramProven(id, proven, by, record); await changed(); return true; }
    catch (e) { say(e, "Couldn't save that"); return false; }
  }
  async function remove(id) {
    setErr("");
    try { await db.deleteCncProgram(id); await changed(); return true; }
    catch (e) { say(e, "Couldn't delete that"); return false; }
  }

  // Reading, checking and comparing a program is real work on a big file, so it
  // runs when a program, the machine or a tool list changes, not on every
  // keystroke in a box.
  const machineKey = part?.machine || "";
  const stockText = part?.facts?.stock || "";
  // What the part's machine is, for a program that doesn't make it obvious.
  const machineKind = MACHINES.find((m) => m.key === splitMachines(machineKey)[0])?.kind || "";
  const derived = useMemo(() => programs.map((p, idx) => {
    const older = programs[idx + 1] || null; // newest first, so the next one is the version before
    const found = checkForPart(p.content, { machine: machineKey, facts: { stock: stockText } }, machineFacts);
    const time = estimateTime(toolpath(p.content, { kind: machineKind }));
    return { info: programInfo(p.content), found, n: checkCounts(found), older, diff: older ? diffPrograms(older.content, p.content) : null, time };
  }), [programs, machineKey, machineFacts, stockText]);

  const checks = readiness(part, programs, machineFacts);
  // Nothing is said while a saved part's programs are still loading: "upload a
  // program" flashing up on a part that has three would be worse than a blank.
  const loading = !!partId && loadedFor !== partId;
  const stops = derived[0]?.n.stop || 0;
  const step = nextStep(part, programs, machineFacts, stops);

  return {
    partId, programs, derived, loading, loadedFor, busy, err, setErr, uploads,
    addFiles, addDraft, keepReview, prove, remove, reload,
    checks, done: readyCount(checks), stops, step, machineKind,
    newest: programs[0] || null, newestInfo: derived[0] || null,
  };
}

// FileReader rather than file.text(): older Safari on the shop iPads lacks the latter.
export function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = () => rej(r.error || new Error("Couldn't read that file"));
    r.readAsText(file);
  });
}
