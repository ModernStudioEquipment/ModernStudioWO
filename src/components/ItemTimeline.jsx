import React from "react";
import { C, STAGE_LABELS } from "../theme.js";

// Shared per-item history timeline. Shows where the product has been, when it
// moved, and — the part the office cares about — how long it sat in each stage
// and how long it's been in its current one. Driven by item.events (logged by
// the DB trigger). Used by the Pick List / Work Order item pop-up and by the
// Orders → order detail product list.

const stageName = (s) => STAGE_LABELS[s] || s || "—";
const isStageEvent = (e) => e.kind === "created" || e.kind === "moved";

function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const fmtTime = (at) =>
  new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function eventText(e) {
  if (e.kind === "created") return `Added to ${stageName(e.to)}`;
  if (e.kind === "moved") return `${stageName(e.from)} → ${stageName(e.to)}`;
  if (e.kind === "in_progress") return e.to === "true" ? "Marked in progress" : "In-progress cleared";
  if (e.kind === "dept") return `Department: ${e.from} → ${e.to}`;
  return e.kind;
}

export function ItemTimeline({ events, now = Date.now(), currentStage }) {
  if (!events || !events.length) {
    return <div style={{ fontSize: 12, color: C.gray }}>No history recorded yet.</div>;
  }
  const at = (e) => new Date(e.at).getTime();
  // Next logged stage change after event i (ignoring in-progress / dept events),
  // or null if there isn't one.
  const nextStageAt = (i) => {
    for (let j = i + 1; j < events.length; j++) if (isStageEvent(events[j])) return at(events[j]);
    return null;
  };
  const stageEvents = events.filter(isStageEvent);
  const lastStage = stageEvents[stageEvents.length - 1];
  // The item's actual stage is the source of truth. If the logged events don't
  // reach it, the item moved before history tracking started — so we know WHERE
  // it is but not how long it's been there.
  const realStage = currentStage || (lastStage && lastStage.to);
  const complete = !lastStage || lastStage.to === realStage;
  const enteredCurrentAt = complete && lastStage ? at(lastStage) : null;

  return (
    <div>
      {realStage && (
        <div className="mb-2" style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 800 }}>In {stageName(realStage)}</span>
          {enteredCurrentAt != null ? (
            <span style={{ color: C.gray }}> · {fmtDur(now - enteredCurrentAt)} so far</span>
          ) : (
            <span style={{ color: C.gray }}> · here before history tracking started</span>
          )}
        </div>
      )}
      <div style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 14, marginLeft: 3 }}>
        {events.map((e, i) => {
          const stage = isStageEvent(e);
          const nextAt = stage ? nextStageAt(i) : null;
          // Only show a dwell when we actually know it: either we logged the move
          // out (nextAt), or this stage is the item's real current stage.
          let dwell = null;
          if (stage && nextAt != null) dwell = `${fmtDur(nextAt - at(e))} in ${stageName(e.to)}`;
          else if (stage && e.to === realStage) dwell = `${fmtDur(now - at(e))} in ${stageName(e.to)} (still here)`;
          return (
            <div key={e.id} style={{ position: "relative", paddingBottom: 12 }}>
              <span style={{ position: "absolute", left: -21, top: 3, width: 8, height: 8, borderRadius: 4, background: complete && i === events.length - 1 ? C.green : C.ink, border: `2px solid ${C.concrete}` }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{eventText(e)}</div>
              <div style={{ fontSize: 11, color: C.gray }}>
                {fmtTime(e.at)}
                {dwell && <> · {dwell}</>}
              </div>
            </div>
          );
        })}
        {!complete && realStage && (
          <div style={{ position: "relative", paddingBottom: 2 }}>
            <span style={{ position: "absolute", left: -21, top: 3, width: 8, height: 8, borderRadius: 4, background: C.green, border: `2px solid ${C.concrete}` }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Now in {stageName(realStage)}</div>
            <div style={{ fontSize: 11, color: C.gray }}>Moved here before history tracking — earlier moves weren't recorded</div>
          </div>
        )}
      </div>
    </div>
  );
}
