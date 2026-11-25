import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X, Send, Camera, Square, Sparkles, Brain, Trash2, Wand2, ImagePlus, Loader2, Check, ThumbsDown } from "lucide-react";
import { db } from "../lib/db.js";
import { askAi, aiStatus } from "./cncAiClient.js";
import { splitMachines } from "./cncParts.js";
import { fmtCost, costOf } from "./cncAi.js";
import { historyText, photosFor, partPack, shopPack, programFor, parseAnswer, liveText, shrinkPhoto, starters, alreadyKept, MAX_ATTACH, machinePhotosFor, machinePhotosLine } from "./cncChat.js";

// The CNC assistant: ask it anything, about one part or about the shop.
//
// Everything said is kept (with who asked and when), so the next person picks
// up where the last left off and the assistant answers with all of it in mind.
// Photos go with a question: the setup, the part, an alarm on the screen.
//
// It remembers by itself: every fact an answer turns up is kept for the whole
// shop and sent with every later question, marked as learned rather than
// confirmed. "This was wrong" on an answer keeps a correction, which outranks
// everything else it knows. Anything kept can be forgotten.
//
// It explains and advises. It doesn't hand out programs: a change to a program
// comes back as "Rewrite with this", which goes through the measured rewrite.
//
// part = null for the whole shop. pp = usePartPrograms() for a part.

const NAME_KEY = "mse_cnc_name";
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };

export default function CncChat({ part = null, pp = null, machineFacts = {}, parts = [], onClose, onRewrite = null }) {
  const partId = part?.id || null;
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState(null);     // null while loading
  const [memory, setMemory] = useState([]);
  const [kept, setKept] = useState(true);             // false: the table isn't there, nothing is being saved
  const [text, setText] = useState("");
  const [name, setName] = useState(readName);
  const [pending, setPending] = useState([]);         // photos picked for the next question: { file, preview }
  const [busy, setBusy] = useState("");               // "" | "sending" | "answering"
  const [live, setLive] = useState("");
  const [err, setErr] = useState("");
  const [retry, setRetry] = useState(null);           // the question to ask again after a failure
  const [showMemory, setShowMemory] = useState(false);
  const [fixing, setFixing] = useState(null);         // the answer being corrected: its id
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const stopper = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopper.current?.abort(); }; }, []);
  useEffect(() => { let on = true; aiStatus().then((s) => { if (on) setStatus(s); }); return () => { on = false; }; }, []);

  // ---- the conversation and what's remembered ----
  async function load() {
    try {
      const [chat, mem] = await Promise.all([db.getCncChat?.(partId), db.getCncMemory?.(partId)]);
      if (!alive.current) return;
      if (chat == null) { setKept(false); setMessages((m) => m || []); } else { setKept(true); setMessages(chat); }
      setMemory(Array.isArray(mem) ? mem : []);
    } catch (e) {
      if (alive.current) { setMessages((m) => m || []); setErr(`Couldn't load the conversation: ${e?.message || "try again"}`); }
    }
  }
  useEffect(() => { setMessages(null); setMemory([]); load(); }, [partId]);
  // keep the newest message in view
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, live, busy]);

  const save = async (row) => {
    if (!kept) return { ...row, id: `local-${Date.now()}-${Math.random()}`, at: Date.now() };
    return db.addCncChat({ partId, ...row });
  };

  // ---- asking ----
  async function ask(questionIn, photoFiles = pending, again = false) {
    const question = String(questionIn || "").trim() || (photoFiles.length ? "What do you see in this photo, and is anything wrong?" : "");
    if (!question || busy) return;
    setErr(""); setRetry(null); setLive("");
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* fine */ }
    setBusy("sending");
    const before = messages || [];
    let mine = again ? before[before.length - 1] : null;
    try {
      if (!again) {
        // photos first: shrunk, then kept in the app's own storage
        const urls = [];
        for (const p of photoFiles) urls.push(await db.uploadBlueprint(partId || "assistant", await shrinkPhoto(p.file)));
        mine = await save({ role: "person", body: question, photos: urls, author: name.trim() });
        if (!alive.current) return;
        setMessages([...before, mine]);
        setText(""); setPending([]);
      }
      setBusy("answering");
      stopper.current = new AbortController();
      const history = again ? before.slice(0, -1) : before;
      const program = part ? programFor(pp?.programs || [])?.content || "" : "";
      const input = {
        pack: part ? partPack(part, pp?.programs || [], machineFacts, memory, parts) : shopPack(machineFacts, parts, memory),
        program,
        question,
        history: historyText(history),
        // (only links the server can fetch: in the demo, photos stay on this computer)
        photos: photosFor(history, mine.photos || [], question, machinePhotosFor(machineFacts, part ? splitMachines(part.machine) : null)).filter((p) => /^https:/.test(p.url)),
        drawingUrl: part?.blueprintUrl || "",
      };
      let streamed = "";
      const out = await askAi("ask", input, { signal: stopper.current.signal, onText: (t) => { streamed += t; if (alive.current) setLive(streamed); } });
      if (!alive.current) return;
      const answer = await save({ role: "assistant", body: out.result.answer, meta: { machinePhotos: machinePhotosLine(input.photos), notes: out.notes || [], cost: costOf(out.usage), model: out.model || "", sources: out.sources || [], searches: out.searches || 0 } });
      if (!alive.current) return;
      setMessages((m) => [...(m || []), answer]);
      // what it learned is kept straight away, for every later question
      const learned = [];
      for (const fact of parseAnswer(out.result.answer).remember) {
        if (alreadyKept([...memory, ...learned], fact)) continue;
        try { learned.push(await save({ partId: null, role: "memory", body: fact, author: "", meta: { auto: true, ...(part ? { from: part.name || "" } : {}) } })); } catch { /* the answer still stands; the fact just isn't kept */ }
      }
      if (learned.length && alive.current) setMemory((m) => [...m, ...learned]);
    } catch (e) {
      if (!alive.current) return;
      if (e?.kind !== "stopped") setErr(e?.message || "Something went wrong. Try again.");
      // the question is kept; it can be asked again without typing it again
      if (mine) setRetry(mine);
    } finally {
      if (alive.current) { setBusy(""); setLive(""); }
    }
  }

  // "This was wrong": the correction is kept (it outranks everything), and said
  // in the conversation too, so the next answer here sees it.
  async function correct(answerMsg, right) {
    const fix = String(right || "").trim();
    if (!fix) return;
    try {
      const list = messages || [];
      const i = list.findIndex((m) => m.id === answerMsg.id);
      const asked = [...list.slice(0, i)].reverse().find((m) => m.role === "person")?.body || "";
      const row = await save({ partId: null, role: "memory", body: `${fix}${asked ? ` (about: "${asked.slice(0, 120)}")` : ""}`, author: name.trim(), meta: { correction: true, ...(part ? { from: part.name || "" } : {}) } });
      const said = await save({ role: "person", body: `That answer was wrong. What's right: ${fix}`, author: name.trim() });
      if (!alive.current) return;
      setMemory((m) => [...m, row]);
      setMessages((m) => [...(m || []), said]);
      setFixing(null);
    } catch (e) { setErr(`Couldn't keep that: ${e?.message || "try again"}`); }
  }
  async function forget(id) {
    try { if (kept) await db.deleteCncChat(id); setMemory((m) => m.filter((x) => x.id !== id)); }
    catch (e) { setErr(`Couldn't forget that: ${e?.message || "try again"}`); }
  }

  function pick(e) {
    const files = [...(e.target.files || [])].filter((f) => /^image\//.test(f.type || "image/"));
    e.target.value = "";
    setPending((p) => [...p, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, MAX_ATTACH));
    inputRef.current?.focus();
  }
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const list = messages || [];
  const totalCost = useMemo(() => list.reduce((n, m) => n + (m.meta?.cost || 0), 0), [list]);
  const off = status && !status.ready;

  return (
    <div className="ch">
      <div className="wz-top">
        <button className="cl-btn ghost" onClick={() => onClose?.()}><ArrowLeft size={15} /> {part ? "Back to the part" : "Back"}</button>
        <span className="cl-spacer" />
        <span className="ai-title"><Sparkles size={15} /> {part ? `Ask about ${part.name || "this part"}` : "Ask the assistant"}</span>
        <button className={`cl-btn${showMemory ? " on" : ""}`} onClick={() => setShowMemory((v) => !v)} aria-expanded={showMemory} title="What it's been asked to remember"><Brain size={14} /> {memory.length}</button>
        <button className="wz-x" onClick={() => onClose?.()} aria-label="Close"><X size={18} /></button>
      </div>

      {showMemory && (
        <div className="ch-memory">
          <b>What it remembers</b>
          <span className="ai-quiet">Kept by itself from every conversation, and sent with every question along with each machine's tool list and notes. Corrections come first and outrank the rest. Forget anything that's wrong.</span>
          {memory.length === 0 ? <span className="ai-quiet">Nothing yet.</span> : (
            <ul>{memory.map((m) => (
              <li key={m.id} className={m.meta?.correction ? "fix" : ""}><span>{m.meta?.correction ? <b>Correction: </b> : null}{m.body}{m.meta?.from ? <i> · from {m.meta.from}</i> : null}<i> · {m.meta?.correction ? m.author || "someone" : m.meta?.auto ? "learned, not confirmed" : m.author || "kept"}</i></span>
                <button className="cl-x" onClick={() => forget(m.id)} aria-label={`Forget: ${m.body}`} title="Forget this"><Trash2 size={14} /></button></li>
            ))}</ul>
          )}
        </div>
      )}

      {!kept && <div className="ch-warn">This conversation isn't being kept yet. It needs migration 0069 run in Supabase; until then it's forgotten when this screen closes.</div>}
      {off && <div className="ch-warn">The AI isn't switched on yet. It needs an Anthropic key added to the app's settings in Vercel (ANTHROPIC_API_KEY).</div>}

      <div className="ch-list" ref={listRef} aria-live="polite">
        {messages === null && <div className="ai-quiet ch-empty"><Loader2 size={16} className="ai-spin" /> Loading the conversation…</div>}
        {messages !== null && list.length === 0 && !busy && (
          <div className="ch-empty">
            <b>{part ? "Ask anything about this part" : "Ask anything about the machines or the work"}</b>
            <span>It knows {part ? "this part, its program and what the program cuts, " : ""}every machine's tool list and notes, and everything asked here before. Add a photo of the setup, the part or the screen and it'll look.</span>
            <div className="wz-picks">{starters(part).map((q) => <button key={q} onClick={() => ask(q, [])} disabled={off}>{q}</button>)}</div>
          </div>
        )}
        {list.map((m) => (m.role === "person" ? (
          <div className="ch-q" key={m.id}>
            <div className="ch-who">{m.author || "Someone"} · {new Date(m.at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            <div className="ch-bubble">{m.body}</div>
            {m.photos?.length > 0 && <div className="ch-photos">{m.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="sent with the question" /></a>)}</div>}
          </div>
        ) : (
          <Answer key={m.id} m={m} memory={memory} canRewrite={!!onRewrite} onRewrite={onRewrite} onPhoto={() => fileRef.current?.click()}
            onForget={forget} fixing={fixing === m.id} onFix={() => setFixing(fixing === m.id ? null : m.id)} onCorrect={(t) => correct(m, t)} />
        )))}
        {busy === "answering" && (
          <div className="ch-a">
            <div className="ch-who"><Sparkles size={12} /> Assistant</div>
            <div className="ch-bubble">{liveText(live) || <span className="ai-quiet"><Loader2 size={14} className="ai-spin" /> Thinking it through…</span>}</div>
          </div>
        )}
        {err && (
          <div className="ch-err">
            <span>{err}</span>
            {retry && <button className="cl-btn" onClick={() => ask(retry.body, [], true)}>Ask again</button>}
          </div>
        )}
      </div>

      <form className="ch-compose" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        {pending.length > 0 && (
          <div className="ch-pending">
            {pending.map((p, i) => (
              <span key={p.preview}><img src={p.preview} alt={`photo ${i + 1} to send`} /><button type="button" onClick={() => setPending((x) => x.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}><X size={12} /></button></span>
            ))}
          </div>
        )}
        <div className="ch-row">
          <button type="button" className="ch-cam" onClick={() => fileRef.current?.click()} disabled={!!busy || pending.length >= MAX_ATTACH} aria-label="Add a photo" title="Add a photo"><Camera size={20} /></button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} aria-label="Photo to send" />
          <textarea
            ref={inputRef} rows={1} value={text} disabled={!!busy || off}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
            placeholder={part ? "Ask about this part…" : "Ask about the machines, a setup, an alarm…"} aria-label="Your question"
          />
          {busy === "answering"
            ? <button type="button" className="ch-send stop" onClick={() => stopper.current?.abort()} aria-label="Stop"><Square size={16} /></button>
            : <button type="submit" className="ch-send" disabled={!!busy || off || (!text.trim() && !pending.length)} aria-label="Send">{busy ? <Loader2 size={18} className="ai-spin" /> : <Send size={18} />}</button>}
        </div>
        <div className="ch-foot">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
          <span className="ai-quiet">{status?.demo ? "Demo: answers are canned and nothing is sent anywhere." : totalCost > 0 ? `This conversation has cost ${fmtCost(totalCost)} so far.` : "Enter sends. Shift+Enter for a new line."}</span>
        </div>
      </form>
    </div>
  );
}

function Answer({ m, memory, canRewrite, onRewrite, onPhoto, onForget, fixing, onFix, onCorrect }) {
  const a = parseAnswer(m.body);
  const [right, setRight] = useState("");
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const keptRow = (f) => memory.find((x) => norm(x.body) === norm(f));
  return (
    <div className="ch-a">
      <div className="ch-who"><Sparkles size={12} /> Assistant · {new Date(m.at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
      {a.sure && (
        <div className={`ch-sure ${a.sure.level}`}>
          {a.sure.level === "high" ? "Confident" : a.sure.level === "medium" ? "Fairly sure: check before relying on it" : "Not sure: check this before acting on it"}
          {a.sure.why ? <span>{a.sure.why}</span> : null}
        </div>
      )}
      <div className="ch-bubble">{a.body}</div>
      {m.meta?.machinePhotos && <div className="ch-sources ch-saw"><span>Also looked at {m.meta.machinePhotos}, from the Machines page.</span></div>}
      {m.meta?.sources?.length > 0 && (
        <div className="ch-sources">
          <span>Looked up{m.meta.searches ? ` (${m.meta.searches} search${m.meta.searches === 1 ? "" : "es"})` : ""}:</span>
          {m.meta.sources.map((src) => <a key={src.url} href={src.url} target="_blank" rel="noreferrer noopener">{src.title}</a>)}
        </div>
      )}
      {(a.photo || a.rewrite || a.remember.length > 0) && (
        <div className="ch-acts">
          {a.photo && <button className="ch-act" onClick={onPhoto}><ImagePlus size={14} /> Add a photo of {a.photo.replace(/^(a |an |the )/i, "the ").replace(/\.$/, "")}</button>}
          {a.rewrite && canRewrite && <button className="ch-act" onClick={() => onRewrite(a.rewrite)} title={a.rewrite}><Wand2 size={14} /> Rewrite with this: {a.rewrite.length > 70 ? `${a.rewrite.slice(0, 70)}…` : a.rewrite}</button>}
          {a.remember.map((f) => {
            const row = keptRow(f);
            return (
              <span key={f} className={`ch-kept${row ? "" : " gone"}`}>
                {row ? <Check size={14} /> : <Brain size={14} />}
                <span>{row ? "Remembered" : "Forgotten"}: {f}</span>
                {row && <button onClick={() => onForget(row.id)} aria-label={`Forget: ${f}`} title="Forget this: it's wrong"><X size={13} /></button>}
              </span>
            );
          })}
        </div>
      )}
      {fixing ? (
        <form className="ch-fix" onSubmit={(e) => { e.preventDefault(); onCorrect(right); }}>
          <textarea rows={2} value={right} onChange={(e) => setRight(e.target.value)} placeholder="What's actually right?" aria-label="What's actually right" autoFocus />
          <div><button type="submit" className="cl-btn" disabled={!right.trim()}><Check size={14} /> Keep the correction</button><button type="button" className="cl-btn ghost" onClick={onFix}>Cancel</button></div>
        </form>
      ) : (
        <button className="ch-wrong" onClick={onFix}><ThumbsDown size={13} /> This was wrong</button>
      )}
      {m.meta?.notes?.length > 0 && <div className="ai-quiet ch-note">{m.meta.notes.join(" ")}</div>}
    </div>
  );
}
