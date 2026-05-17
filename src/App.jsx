import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT SCORING RULES
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SCORING_RULES = {
  winPoints: 10,
  losePoints: 0,
  maxScore: 25,
  gapBonusEnabled: true,
  gapValue: 15,
  gapBonusPoints: 3,
  perfectBonusEnabled: true,
  perfectWinnerScore: 25,
  perfectLoserScore: 0,
  perfectWinnerBonus: 5,
  perfectLoserPenalty: -3,
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUND ROBIN
// ─────────────────────────────────────────────────────────────────────────────
function generateRoundRobin(players) {
  const list = [...players];
  if (list.length % 2 !== 0) list.push("BYE");
  const total = list.length;
  const matches = [];
  for (let r = 0; r < total - 1; r++) {
    const round = [];
    for (let i = 0; i < total / 2; i++) {
      const p1 = list[i], p2 = list[total - 1 - i];
      if (p1 !== "BYE" && p2 !== "BYE") round.push({ p1, p2 });
    }
    round.forEach((m, mi) =>
      matches.push({ id: `r${r}-m${mi}`, round: r + 1, p1: m.p1, p2: m.p2, score1: null, score2: null, winner: null })
    );
    list.splice(1, 0, list.pop());
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD — supports custom scoring rules + new columns
// ─────────────────────────────────────────────────────────────────────────────
function computeLeaderboard(players, matches, scoringRules = DEFAULT_SCORING_RULES) {
  const sr = { ...DEFAULT_SCORING_RULES, ...scoringRules };
  const stats = {};
  players.forEach(p => {
    stats[p] = { name: p, played: 0, won: 0, lost: 0, pts: 0, scored: 0, conceded: 0, diff: 0 };
  });

  matches.forEach(m => {
    if (!m.winner) return;
    stats[m.p1].played++;
    stats[m.p2].played++;
    const s1 = Number(m.score1);
    const s2 = Number(m.score2);
    const gap = Math.abs(s1 - s2);

    // Track goals scored/conceded
    if (stats[m.p1]) { stats[m.p1].scored += s1; stats[m.p1].conceded += s2; }
    if (stats[m.p2]) { stats[m.p2].scored += s2; stats[m.p2].conceded += s1; }

    let winnerPoints = sr.winPoints;
    let loserPoints = sr.losePoints;

    // Gap bonus
    if (sr.gapBonusEnabled && gap >= sr.gapValue) {
      winnerPoints += sr.gapBonusPoints;
    }

    // Perfect win bonus
    if (sr.perfectBonusEnabled) {
      const isPerfect =
        (s1 === sr.perfectWinnerScore && s2 === sr.perfectLoserScore) ||
        (s2 === sr.perfectWinnerScore && s1 === sr.perfectLoserScore);
      if (isPerfect) {
        winnerPoints += sr.perfectWinnerBonus;
        loserPoints += sr.perfectLoserPenalty;
      }
    }

    if (m.winner === m.p1) {
      stats[m.p1].won++;
      stats[m.p1].pts += winnerPoints;
      stats[m.p2].lost++;
      stats[m.p2].pts += loserPoints;
    } else {
      stats[m.p2].won++;
      stats[m.p2].pts += winnerPoints;
      stats[m.p1].lost++;
      stats[m.p1].pts += loserPoints;
    }
  });

  // Compute score diff
  Object.values(stats).forEach(p => { p.diff = p.scored - p.conceded; });

  // Sort: pts → wins → diff → scored
  return Object.values(stats).sort((a, b) =>
    b.pts - a.pts || b.won - a.won || b.diff - a.diff || b.scored - a.scored
  );
}

function getRRPlayable(matches) {
  const done = {};
  matches.forEach(m => {
    if (!done[m.round]) done[m.round] = new Set();
    if (m.winner) { done[m.round].add(m.p1); done[m.round].add(m.p2); }
  });
  return matches
    .filter(m => {
      if (m.winner) return false;
      if (m.round === 1) return true;
      const prev = done[m.round - 1] || new Set();
      return prev.has(m.p1) && prev.has(m.p2);
    })
    .map(m => m.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRACKET
// ─────────────────────────────────────────────────────────────────────────────
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function generateBracket(players) {
  const size = nextPow2(players.length);
  const seeds = [...players];
  while (seeds.length < size) seeds.push("BYE");
  const totalRounds = Math.log2(size);
  const matches = [];

  for (let i = 0; i < size / 2; i++) {
    const p1 = seeds[i], p2 = seeds[size - 1 - i];
    const isBye = p2 === "BYE";
    matches.push({ id: `b-r1-m${i}`, round: 1, slot: i, p1, p2, score1: null, score2: null, winner: isBye ? p1 : null, isBye });
  }

  for (let r = 2; r <= totalRounds; r++) {
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) {
      matches.push({ id: `b-r${r}-m${i}`, round: r, slot: i, p1: null, p2: null, score1: null, score2: null, winner: null, isBye: false });
    }
  }

  return propagateBracket(matches);
}

function propagateBracket(matches) {
  const result = matches.map(m => ({ ...m }));
  const rounds = [...new Set(result.map(m => m.round))].sort((a, b) => a - b);

  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const r = rounds[ri];
    const nextR = rounds[ri + 1];
    const rMatches = result.filter(m => m.round === r).sort((a, b) => a.slot - b.slot);
    const nextMatches = result.filter(m => m.round === nextR).sort((a, b) => a.slot - b.slot);

    rMatches.forEach((m, idx) => {
      const targetSlot = Math.floor(idx / 2);
      const isFirst = idx % 2 === 0;
      const target = nextMatches[targetSlot];
      if (!target) return;

      if (m.winner) {
        if (isFirst) target.p1 = m.winner;
        else target.p2 = m.winner;
        if (target.p1 && target.p2 && (target.p1 === "BYE" || target.p2 === "BYE")) {
          target.winner = target.p1 === "BYE" ? target.p2 : target.p1;
          target.isBye = true;
        }
      } else {
        if (isFirst) { target.p1 = null; }
        else { target.p2 = null; }
        if (!target.winner) { target.score1 = null; target.score2 = null; }
      }
    });
  }
  return result;
}

function getBracketRoundName(round, totalRounds) {
  const diff = totalRounds - round;
  if (diff === 0) return "Final";
  if (diff === 1) return "Semi-final";
  if (diff === 2) return "Quarter-final";
  return `Round ${round}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#080a0e", surface: "#111520", surface2: "#161b28", surface3: "#1c2235",
  border: "rgba(201,168,76,0.1)", borderSubtle: "rgba(255,255,255,0.05)", borderActive: "rgba(201,168,76,0.32)",
  gold: "#c9a84c", goldLight: "#e2c06a", goldDim: "rgba(201,168,76,0.15)", goldBorder: "rgba(201,168,76,0.28)",
  text: "#eef0f6", textMid: "#6b7a99", textMuted: "#8b96b5", textDim: "#30394f",
  green: "#4ade9a", greenBg: "rgba(74,222,154,0.07)", greenBorder: "rgba(74,222,154,0.2)",
  red: "#e05a6a", redBg: "rgba(224,90,106,0.07)", redBorder: "rgba(224,90,106,0.22)",
  violet: "#9d7dea", violetBg: "rgba(157,125,234,0.08)", violetBorder: "rgba(157,125,234,0.25)",
  teal: "#52d4c8", tealBg: "rgba(82,212,200,0.07)", tealBorder: "rgba(82,212,200,0.22)",
};
const F = {
  display: "'Space Grotesk','Outfit',system-ui,sans-serif",
  body: "'Outfit','DM Sans',system-ui,sans-serif",
  mono: "'DM Mono','Fira Code',monospace",
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Toast({ t }) {
  if (!t) return null;
  return <div className={`toast ${t.err ? "toast--err" : "toast--ok"}`}>{t.msg}</div>;
}

function useToast() {
  const [t, setT] = useState(null);
  const show = (msg, err = false) => { setT({ msg, err }); setTimeout(() => setT(null), 2800); };
  return [t, show];
}

function Pill({ children, color, bg, border }) {
  return <span className="pill" style={{ color, background: bg, borderColor: border }}>{children}</span>;
}

function Inp({ label, ...p }) {
  return <div className="inp-wrap">
    {label && <div className="inp-label">{label}</div>}
    <input {...p} className="inp-field" />
  </div>;
}

function Btn({ children, variant = "gold", full = true, small, ...p }) {
  const vs = {
    gold: { bg: `linear-gradient(135deg,${C.gold},#a8832a)`, color: "#0a0800", hov: `linear-gradient(135deg,${C.goldLight},${C.gold})` },
    ghost: { bg: "rgba(255,255,255,0.03)", color: C.textMuted, hov: "rgba(255,255,255,0.06)", border: C.borderSubtle },
    danger: { bg: C.redBg, color: C.red, hov: "rgba(224,90,106,0.14)", border: `1px solid ${C.redBorder}` },
    violet: { bg: C.violetBg, color: C.violet, hov: "rgba(157,125,234,0.14)", border: C.violetBorder },
    teal: { bg: C.tealBg, color: C.teal, hov: "rgba(82,212,200,0.14)", border: C.tealBorder },
  };
  const s = vs[variant] || vs.gold;
  return <button {...p}
    className={`btn btn--${variant}${small ? " btn--small" : ""}${full ? " btn--full" : ""}`}
    style={{ background: s.bg, color: s.color, border: s.border || "none", ...p.style }}
    onMouseEnter={e => { e.currentTarget.style.background = s.hov; e.currentTarget.style.transform = "translateY(-1px)"; }}
    onMouseLeave={e => { e.currentTarget.style.background = s.bg; e.currentTarget.style.transform = ""; }}
  >{children}</button>;
}

function TopBar({ title, subtitle, rightEl }) {
  return <div className="topbar">
    <div>
      <div className="topbar__title">{title}</div>
      {subtitle && <div className="topbar__subtitle">{subtitle}</div>}
    </div>
    {rightEl}
  </div>;
}

function TabBar({ tabs, active, onChange }) {
  return <div className="tabbar">
    {tabs.map(([k, label]) => <button key={k} onClick={() => onChange(k)}
      className={`tabbar__tab${active === k ? " tabbar__tab--active" : ""}`}
    >{label}</button>)}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE MODAL — with maxScore validation
// ─────────────────────────────────────────────────────────────────────────────
function ScoreModal({ match, onSave, onCancel, scoringRules = DEFAULT_SCORING_RULES }) {
  const [s1, setS1] = useState(match.score1 ?? "");
  const [s2, setS2] = useState(match.score2 ?? "");
  const sr = { ...DEFAULT_SCORING_RULES, ...scoringRules };
  const n1 = parseInt(s1), n2 = parseInt(s2);
  const maxOk = (isNaN(n1) || n1 <= sr.maxScore) && (isNaN(n2) || n2 <= sr.maxScore);
  const valid = !isNaN(n1) && !isNaN(n2) && n1 !== n2 && n1 >= 0 && n2 >= 0 && maxOk;
  const winner = valid ? (n1 > n2 ? match.p1 : match.p2) : null;
  const isDraw = !isNaN(n1) && !isNaN(n2) && n1 === n2 && s1 !== "";
  const maxExceeded = (!isNaN(n1) && n1 > sr.maxScore) || (!isNaN(n2) && n2 > sr.maxScore);

  return <div className="modal-overlay">
    <div className="modal-box">
      <div className="modal-header">
        <div className="modal-round-label">{match.roundLabel || `ROUND ${match.round}`}</div>
        <div className="modal-enter-label">Enter match score</div>
      </div>
      <div className="modal-scores">
        {[{ name: match.p1, val: s1, set: setS1 }, { name: match.p2, val: s2, set: setS2 }].map((pl, i) => [
          <div key={pl.name}>
            <div className={`modal-player-name${winner === pl.name ? " modal-player-name--winner" : ""}`}>{pl.name}</div>
            <input type="number" min={0} max={sr.maxScore} value={pl.val}
              onChange={e => pl.set(e.target.value)} placeholder="0"
              className={`modal-score-input${winner === pl.name ? " modal-score-input--winner" : ""}`}
            />
          </div>,
          i === 0 && <div key="vs" className="modal-vs">VS</div>,
        ])}
      </div>
      {winner && <div className="modal-winner-msg">✦ {winner} wins</div>}
      {isDraw && <div className="modal-no-draw">Draws are not allowed</div>}
      {maxExceeded && (
        <div className="modal-no-draw">Max score is {sr.maxScore}</div>
      )}
      <div className="modal-hint">Max score: {sr.maxScore} · No draws · Winner advances</div>
      <div className="modal-actions">
        <Btn onClick={() => valid && onSave(n1, n2, winner)} style={{ opacity: valid ? 1 : 0.4 }}>Save result</Btn>
        <Btn variant="ghost" onClick={onCancel} full={false} style={{ flex: 1 }}>Cancel</Btn>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD — extended columns (diff, scored, conceded)
// ─────────────────────────────────────────────────────────────────────────────
function Leaderboard({ players, matches, scoringRules = DEFAULT_SCORING_RULES }) {
  const lb = useMemo(() => computeLeaderboard(players, matches, scoringRules), [players, matches, scoringRules]);
  const medals = ["🥇", "🥈", "🥉"];

  return <div>
    {/* Extended header: #, Player, P, W, L, +/-, GF, GA, Pts */}
    <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 40px 40px 40px 52px 48px 48px 56px", gap: 4, padding: "0 14px 10px", marginBottom: 4 }}>
      {["", "Player", "P", "W", "L", "+/−", "GF", "GA", "Pts"].map((h, i) => (
        <div key={i} style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em", textAlign: i > 1 ? "center" : "left", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase" }}>{h}</div>
      ))}
    </div>
    {lb.map((p, i) => (
      <div key={p.name} style={{
        display: "grid", gridTemplateColumns: "36px 1fr 40px 40px 40px 52px 48px 48px 56px",
        gap: 4, alignItems: "center", padding: "12px 14px", borderRadius: 8, marginBottom: 5,
        background: i === 0 ? "rgba(201,168,76,0.06)" : i % 2 === 0 ? C.surface2 : C.surface,
        border: `1px solid ${i === 0 ? C.goldBorder : C.border}`,
        boxShadow: i === 0 ? "0 0 20px rgba(201,168,76,0.06)" : "none",
        transition: "all 0.15s", position: "relative", overflow: "hidden",
      }}>
        {i === 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(to bottom,${C.goldLight},${C.gold})`, borderRadius: "3px 0 0 3px" }} />}
        <div style={{ textAlign: "center", fontSize: i < 3 ? 15 : 11, color: C.textDim, fontFamily: F.display, fontWeight: 600 }}>{medals[i] ?? `${i + 1}`}</div>
        <div style={{ fontSize: 13, fontFamily: F.body, color: i === 0 ? C.goldLight : C.text, fontWeight: i === 0 ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.textMid }}>{p.played}</div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.green, fontWeight: 600 }}>{p.won}</div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.red, fontWeight: 600 }}>{p.lost}</div>
        <div style={{ textAlign: "center", fontSize: 12, color: p.diff > 0 ? C.green : p.diff < 0 ? C.red : C.textMid, fontWeight: 600 }}>
          {p.diff > 0 ? `+${p.diff}` : p.diff}
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.textMuted }}>{p.scored}</div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.textMuted }}>{p.conceded}</div>
        <div style={{ textAlign: "center", fontSize: 15, color: i === 0 ? C.gold : C.text, fontWeight: 700, fontFamily: F.display }}>{p.pts}</div>
      </div>
    ))}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING RULES DISPLAY — read-only summary card
// ─────────────────────────────────────────────────────────────────────────────
function ScoringRulesDisplay({ rules }) {
  const sr = { ...DEFAULT_SCORING_RULES, ...rules };
  const rows = [
    ["Win", `+${sr.winPoints} pts`],
    ["Lose", `${sr.losePoints >= 0 ? "+" : ""}${sr.losePoints} pts`],
    ["Max Score", sr.maxScore],
    sr.gapBonusEnabled && ["Gap Bonus", `Gap ≥ ${sr.gapValue} → +${sr.gapBonusPoints} pts`],
    sr.perfectBonusEnabled && ["Perfect Win", `${sr.perfectWinnerScore}–${sr.perfectLoserScore} → winner +${sr.perfectWinnerBonus}, loser ${sr.perfectLoserPenalty}`],
  ].filter(Boolean);

  return <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
    <div style={{ fontSize: 10, color: C.gold, letterSpacing: "0.16em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>⚙ Scoring Rules</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
      {rows.map(([label, val]) => (
        <div key={label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.textMid, fontFamily: F.display }}>{label}</span>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600, fontFamily: F.mono, background: C.surface3, padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.border}` }}>{val}</span>
        </div>
      ))}
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING RULES EDITOR — for AdminPanel
// ─────────────────────────────────────────────────────────────────────────────
function ScoringRulesEditor({ rules, onChange }) {
  const sr = { ...DEFAULT_SCORING_RULES, ...rules };
  const set = (key, val) => onChange({ ...sr, [key]: val });

  const numInput = (label, key, min = 0, hint = "") => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.textMid, letterSpacing: "0.1em", marginBottom: 6, fontFamily: F.display, fontWeight: 500, textTransform: "uppercase" }}>{label}{hint && <span style={{ color: C.textDim, fontSize: 10, marginLeft: 6, textTransform: "none" }}>{hint}</span>}</div>
      <input type="number" min={min} value={sr[key]}
        onChange={e => set(key, Number(e.target.value))}
        className="inp-field" style={{ maxWidth: 120 }} />
    </div>
  );

  const toggle = (label, key, desc) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: C.surface3, borderRadius: 8, border: `1px solid ${sr[key] ? C.goldBorder : C.border}`, marginBottom: 10, cursor: "pointer" }}
      onClick={() => set(key, !sr[key])}>
      <div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 2 }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: C.textMid }}>{desc}</div>}
      </div>
      {/* Toggle switch */}
      <div style={{ width: 44, height: 24, borderRadius: 12, background: sr[key] ? C.gold : C.surface2, border: `1px solid ${sr[key] ? C.gold : C.borderActive}`, position: "relative", transition: "all 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 2, left: sr[key] ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: sr[key] ? "#0a0800" : C.textMid, transition: "left 0.2s" }} />
      </div>
    </div>
  );

  return <div style={{ background: C.surface, border: `1px solid ${C.goldBorder}`, borderRadius: 12, padding: "22px 24px", marginBottom: 24, position: "relative" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.goldBorder},transparent)` }} />
    <div style={{ fontSize: 11, color: C.gold, letterSpacing: "0.16em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase", marginBottom: 20 }}>⚙ Scoring Rules</div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 20px" }}>
      {numInput("Win Points", "winPoints")}
      {numInput("Lose Points", "losePoints", undefined, "(can be negative)")}
      {numInput("Max Score", "maxScore", 1)}
    </div>

    {toggle("Gap Bonus", "gapBonusEnabled", "Award bonus points for a large score gap")}
    {sr.gapBonusEnabled && (
      <div style={{ background: C.surface2, borderRadius: 8, padding: "14px 16px", marginBottom: 10, border: `1px solid ${C.border}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
          {numInput("Gap Threshold", "gapValue", 1)}
          {numInput("Bonus Points", "gapBonusPoints")}
        </div>
      </div>
    )}

    {toggle("Perfect Win Bonus", "perfectBonusEnabled", "Bonus/penalty for a shutout victory")}
    {sr.perfectBonusEnabled && (
      <div style={{ background: C.surface2, borderRadius: 8, padding: "14px 16px", marginBottom: 10, border: `1px solid ${C.border}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
          {numInput("Winner Score", "perfectWinnerScore", 0)}
          {numInput("Loser Score", "perfectLoserScore", 0)}
          {numInput("Winner Bonus", "perfectWinnerBonus")}
          {numInput("Loser Penalty", "perfectLoserPenalty", undefined, "(negative)")}
        </div>
      </div>
    )}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT UTILITIES — client-side image/PDF export
// ─────────────────────────────────────────────────────────────────────────────

// Lightweight HTML→canvas export using html2canvas loaded from CDN
function useExportReady() {
  const [ready, setReady] = useState(!!window.html2canvas);
  useEffect(() => {
    if (window.html2canvas) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

async function exportElementAsImage(el, filename) {
  if (!window.html2canvas) return;
  const canvas = await window.html2canvas(el, {
    backgroundColor: "#080a0e",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function exportElementAsPDF(el, filename) {
  if (!window.html2canvas) return;

  // Ensure jsPDF is loaded
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const canvas = await window.html2canvas(el, {
    backgroundColor: "#080a0e",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const imgData = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? "landscape" : "portrait", unit: "px", format: [canvas.width / 2, canvas.height / 2] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width / 2, canvas.height / 2);
  pdf.save(filename);
}

function ExportButtons({ targetRef, baseName, label = "Export" }) {
  const ready = useExportReady();
  const [busy, setBusy] = useState(false);

  const run = async (type) => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    try {
      if (type === "img") await exportElementAsImage(targetRef.current, `${baseName}.png`);
      else await exportElementAsPDF(targetRef.current, `${baseName}.pdf`);
    } finally { setBusy(false); }
  };

  if (!ready) return null;
  return <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <button onClick={() => run("img")} disabled={busy}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: F.body, display: "flex", alignItems: "center", gap: 6 }}>
      ↓ PNG
    </button>
    <button onClick={() => run("pdf")} disabled={busy}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: F.body, display: "flex", alignItems: "center", gap: 6 }}>
      ↓ PDF
    </button>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// QR CODE — lightweight inline SVG QR via qrcode.js from CDN
// ─────────────────────────────────────────────────────────────────────────────
function QRCode({ url, size = 200 }) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(!!window.QRCode);

  useEffect(() => {
    if (window.QRCode) { setLoaded(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = () => setLoaded(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!loaded || !ref.current) return;
    ref.current.innerHTML = "";
    try {
      new window.QRCode(ref.current, {
        text: url, width: size, height: size,
        colorDark: "#c9a84c", colorLight: "#0c0f16",
        correctLevel: window.QRCode.CorrectLevel.H,
      });
    } catch (e) { console.error("QR error", e); }
  }, [loaded, url, size]);

  if (!loaded) return <div style={{ width: size, height: size, background: C.surface2, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 11 }}>Loading QR…</div>;
  return <div ref={ref} style={{ borderRadius: 8, overflow: "hidden" }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE MODAL — link copy + QR code
// ─────────────────────────────────────────────────────────────────────────────
function ShareModal({ league, onClose }) {
  const [copied, setCopied] = useState(false);
  // Build a public URL — uses window.location.origin + hash routing
  const url = `${window.location.origin}${window.location.pathname}?t=${league.id}`;

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const downloadQR = () => {
    const canvas = document.querySelector("#qr-export canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${league.name}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.goldBorder},transparent)` }} />
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: C.gold, letterSpacing: "0.16em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Share Tournament</div>
        <div style={{ fontSize: 13, color: C.textMid }}>Scan or share the link below</div>
      </div>

      {/* QR */}
      <div id="qr-export" style={{ display: "flex", justifyContent: "center", marginBottom: 20, padding: 16, background: C.surface3, borderRadius: 12, border: `1px solid ${C.border}` }}>
        <QRCode url={url} size={180} />
      </div>

      {/* URL bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input readOnly value={url} className="inp-field" style={{ flex: 1, fontSize: 12, fontFamily: F.mono }} />
        <button onClick={copy}
          style={{ background: copied ? C.greenBg : C.goldDim, border: `1px solid ${copied ? C.greenBorder : C.goldBorder}`, color: copied ? C.green : C.gold, borderRadius: 6, padding: "0 16px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: F.body, whiteSpace: "nowrap", transition: "all 0.15s" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn variant="ghost" small full={false} style={{ flex: 1 }} onClick={downloadQR}>↓ Download QR</Btn>
        <Btn variant="ghost" small full={false} style={{ flex: 1 }} onClick={onClose}>Close</Btn>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BRACKET VISUAL
// ─────────────────────────────────────────────────────────────────────────────
function BracketPlayer({ name, score, isWinner, isPending, isBye }) {
  return <div className={`bracket-player${isWinner ? " bracket-player--winner" : ""}`}>
    <span className={`bracket-player__name${isPending || isBye ? " bracket-player__name--dim" : isWinner ? " bracket-player__name--winner" : ""}${isPending ? " bracket-player__name--pending" : ""}`}>
      {isPending ? "TBD" : isBye ? "BYE" : name}
    </span>
    {score !== null && score !== undefined && !isBye && !isPending && (
      <span className={`bracket-player__score${isWinner ? " bracket-player__score--winner" : ""}`}>{score}</span>
    )}
  </div>;
}

function BracketView({ matches, onMatchClick, adminMode }) {
  const rounds = useMemo(() => {
    const map = {};
    matches.forEach(m => { if (!map[m.round]) map[m.round] = []; map[m.round].push(m); });
    Object.values(map).forEach(arr => arr.sort((a, b) => a.slot - b.slot));
    return map;
  }, [matches]);

  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const totalRounds = roundNums.length;
  const champion = matches.find(m => m.round === totalRounds)?.winner;

  return <div className="bracket-scroll">
    {champion && (
      <div className="bracket-champion">
        <div className="bracket-champion__label">CHAMPION</div>
        <div className="bracket-champion__name">🏆 {champion}</div>
      </div>
    )}
    <div className="bracket-rounds" style={{ minWidth: totalRounds * 224 }}>
      {roundNums.map((r) => {
        const rMatches = rounds[r];
        const label = getBracketRoundName(r, totalRounds);
        return <div key={r} className="bracket-round">
          <div className="bracket-round__label">{label.toUpperCase()}</div>
          <div className="bracket-round__matches">
            {rMatches.map((m) => {
              const canClick = adminMode && m.p1 && m.p2 && !m.isBye;
              const isPending = !m.p1 || !m.p2;
              return <div key={m.id}>
                <div className={`bracket-match${isPending ? " bracket-match--pending" : ""}`}
                  style={{ border: `1px solid ${m.winner && !m.isBye ? C.goldBorder : isPending ? C.border : C.borderActive}` }}
                >
                  <BracketPlayer name={m.p1} score={m.score1} isWinner={m.winner === m.p1} isPending={!m.p1} />
                  <div className="bracket-divider" />
                  <BracketPlayer name={m.p2} score={m.score2} isWinner={m.winner === m.p2} isPending={!m.p2} isBye={m.p2 === "BYE"} />
                </div>
                {m.isBye && m.winner && (
                  <div className="bracket-bye-label">
                    <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>BYE — auto advance</Pill>
                  </div>
                )}
                {canClick && (
                  <div className="bracket-score-btn">
                    <Btn variant={m.winner ? "ghost" : "gold"} small full={false} onClick={() => onMatchClick(m, label)}>
                      {m.winner ? "Edit score" : "+ Score"}
                    </Btn>
                  </div>
                )}
              </div>;
            })}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// RR FIXTURES
// ─────────────────────────────────────────────────────────────────────────────
function RRFixtures({ matches, playable, onScoreClick, adminMode }) {
  const rounds = useMemo(() => {
    const map = {};
    matches.forEach(m => { if (!map[m.round]) map[m.round] = []; map[m.round].push(m); });
    return map;
  }, [matches]);

  return <div>{Object.keys(rounds).sort((a, b) => a - b).map(r => {
    const ms = rounds[r];
    const allDone = ms.every(m => m.winner);
    return <div key={r} className="rr-round">
      <div className="rr-round__header">
        <span className="rr-round__label">ROUND {r}</span>
        {allDone
          ? <Pill color={C.green} bg={C.greenBg} border={C.greenBorder}>COMPLETE</Pill>
          : <Pill color={C.gold} bg={C.goldDim} border={C.goldBorder}>IN PROGRESS</Pill>}
      </div>
      {ms.map(m => {
        const canPlay = adminMode || playable.includes(m.id);
        return <div key={m.id} className="rr-match"
          style={{ border: `1px solid ${m.winner ? C.border : canPlay ? C.goldBorder : C.border}` }}
        >
          <div className="rr-match__players">
            {m.winner ? <>
              <span className={`rr-match__player${m.winner === m.p1 ? " rr-match__player--winner" : ""}`}>{m.p1}</span>
              <span className="rr-match__score">{m.score1} – {m.score2}</span>
              <span className={`rr-match__player${m.winner === m.p2 ? " rr-match__player--winner" : ""}`}>{m.p2}</span>
            </> : <>
              <span className={`rr-match__player${canPlay ? "" : " rr-match__player--dim"}`}>{m.p1}</span>
              <span className="rr-match__vs">vs</span>
              <span className={`rr-match__player${canPlay ? "" : " rr-match__player--dim"}`}>{m.p2}</span>
            </>}
          </div>
          {canPlay
            ? <Btn variant={m.winner ? "ghost" : "gold"} small full={false} onClick={() => onScoreClick(m)}>{m.winner ? "Edit" : "+ Score"}</Btn>
            : !m.winner && <span className="rr-match__locked">LOCKED</span>}
        </div>;
      })}
    </div>;
  })}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAGUE VIEW — with scoring rules display, export buttons, share button
// ─────────────────────────────────────────────────────────────────────────────
function LeagueView({ league, onUpdate, onLogout, adminMode = false }) {
  const scoringRules = league.scoringRules || DEFAULT_SCORING_RULES;
  const defaultTab = league.type === "bracket" ? "bracket" : "fixtures";
  const [tab, setTab] = useState(defaultTab);
  const [scoreMatch, setScoreMatch] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, showToast] = useToast();
  const lbRef = useRef(null);
  const fixturesRef = useRef(null);

  const playable = useMemo(() => league.type === "rr" ? getRRPlayable(league.matches) : [], [league.matches, league.type]);
  const completed = league.matches.filter(m => m.winner && !m.isBye).length;
  const total = league.matches.filter(m => !m.isBye).length;

  const handleSave = (n1, n2, winner) => {
    let updated;
    if (league.type === "bracket") {
      const raw = league.matches.map(m => m.id === scoreMatch.id ? { ...m, score1: n1, score2: n2, winner } : m);
      updated = propagateBracket(raw);
    } else {
      updated = league.matches.map(m => m.id === scoreMatch.id ? { ...m, score1: n1, score2: n2, winner } : m);
    }
    onUpdate({ ...league, matches: updated });
    showToast(`✓ ${winner} wins!`);
    setScoreMatch(null);
  };

  // Knockout: Bracket + Rules only (no leaderboard/standings)
  // Round Robin: Fixtures + Standings + Rules
  const tabs = league.type === "bracket"
    ? [["bracket", "Bracket"], ["rules", "Rules"]]
    : [["fixtures", "Fixtures"], ["standings", "Standings"], ["rules", "Rules"]];

  const typeTag = league.type === "bracket"
    ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
    : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>;

  return <div className="screen">
    <Toast t={toast} />
    {scoreMatch && <ScoreModal match={scoreMatch} onSave={handleSave} onCancel={() => setScoreMatch(null)} scoringRules={scoringRules} />}
    {shareOpen && <ShareModal league={league} onClose={() => setShareOpen(false)} />}

    <TopBar
      title={`◈ ${league.name}`}
      subtitle={<span className="topbar__subtitle-inner">
        <span>{completed}/{total} matches played</span>{typeTag}
        {adminMode && <Pill color={C.gold} bg={C.goldDim} border={C.goldBorder}>ADMIN</Pill>}
      </span>}
      rightEl={<div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setShareOpen(true)} className="btn-icon" style={{ borderColor: C.goldBorder, color: C.gold }}>Share ↗</button>
        {onLogout && <button onClick={onLogout} className="btn-icon">Logout</button>}
      </div>}
    />
    <TabBar tabs={tabs} active={tab} onChange={setTab} />

    <div className="content-area" style={{ maxWidth: league.type === "bracket" ? 900 : 680 }}>

      {/* Standings tab — Round Robin only */}
      {tab === "standings" && league.type === "rr" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.14em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase" }}>Standings</div>
          <ExportButtons targetRef={lbRef} baseName={`${league.name}-standings`} />
        </div>
        <div ref={lbRef} style={{ padding: 4 }}>
          <Leaderboard players={league.players} matches={league.matches} scoringRules={scoringRules} />
        </div>
      </>}

      {/* Fixtures tab with export */}
      {tab === "fixtures" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.14em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase" }}>Fixtures</div>
          <ExportButtons targetRef={fixturesRef} baseName={`${league.name}-fixtures`} />
        </div>
        <div ref={fixturesRef}>
          <RRFixtures matches={league.matches} playable={playable} onScoreClick={setScoreMatch} adminMode={adminMode} />
        </div>
      </>}

      {/* Bracket tab with export */}
      {tab === "bracket" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.14em", fontFamily: F.display, fontWeight: 600, textTransform: "uppercase" }}>Bracket</div>
          <ExportButtons targetRef={fixturesRef} baseName={`${league.name}-bracket`} />
        </div>
        <div ref={fixturesRef}>
          <BracketView
            matches={league.matches}
            onMatchClick={(m, label) => setScoreMatch({ ...m, roundLabel: label })}
            adminMode={adminMode}
          />
        </div>
      </>}

      {/* Rules tab */}
      {tab === "rules" && <ScoringRulesDisplay rules={scoringRules} />}
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onPublic }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState("");
  const go = () => { if (!onLogin(u.trim(), p)) setErr("Invalid credentials"); };
  return <div className="auth-screen">
    <div className="auth-box">
      <div className="auth-logo">
        <div className="auth-logo__icon">◈</div>
        <div className="auth-logo__title">Carrom Scheduler</div>
        <div className="auth-logo__sub">SCORE MANAGER</div>
      </div>
      <div className="card">
        <Inp label="USERNAME" value={u} onChange={e => { setU(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && go()} placeholder="Enter username" />
        <Inp label="PASSWORD" type="password" value={p} onChange={e => { setP(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && go()} placeholder="Enter password" />
        {err && <div className="auth-error">{err}</div>}
        <Btn onClick={go}>Login</Btn>
        <div className="auth-public-link">
          <span onClick={onPublic}>← View public results</span>
        </div>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC VIEW
// ─────────────────────────────────────────────────────────────────────────────
function PublicView({ leagues, onLoginClick }) {
  const [sel, setSel] = useState(null);
  const list = Object.values(leagues);
  const selLeague = sel ? leagues[sel] : null;

  return <div className="screen">
    <div className="public-hero">
      <div className="public-hero__icon">◈</div>
      <h1 className="public-hero__title">Carrom Scheduler</h1>
      <p className="public-hero__sub">LIVE RESULTS</p>
      <button onClick={onLoginClick} className="public-hero__btn"
        onMouseEnter={e => e.currentTarget.style.background = C.goldDim}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(201,168,76,0.08)"}
      >Admin / Player login →</button>
    </div>

    <div className="public-content">
      {list.length === 0
        ? <p className="empty-msg empty-msg--top">No active tournaments.</p>
        : <>
          <div className="section-label">ACTIVE TOURNAMENTS</div>
          {list.map(l => {
            const done = l.matches.filter(m => m.winner && !m.isBye).length;
            const tot = l.matches.filter(m => !m.isBye).length;
            const isOpen = sel === l.id;
            return <div key={l.id} className="tournament-item">
              <div onClick={() => setSel(isOpen ? null : l.id)}
                className={`tournament-item__header${isOpen ? " tournament-item__header--open" : ""}`}
              >
                <div>
                  <div className="tournament-item__title-row">
                    <span className={`tournament-item__name${isOpen ? " tournament-item__name--open" : ""}`}>◈ {l.name}</span>
                    {l.type === "bracket"
                      ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
                      : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>}
                  </div>
                  <div className="tournament-item__meta">{l.players.length} players · {done}/{tot} played</div>
                </div>
                <span className={`tournament-item__chevron${isOpen ? " tournament-item__chevron--open" : ""}`}>{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && <div className="tournament-item__body">
                {l.type === "bracket"
                  ? <BracketView matches={l.matches} adminMode={false} />
                  : <Leaderboard players={l.players} matches={l.matches} scoringRules={l.scoringRules} />}
              </div>}
            </div>;
          })}
        </>}
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — includes scoring rules editor
// ─────────────────────────────────────────────────────────────────────────────
function AdminPanel({ state, setState, onClose }) {
  const [view, setView] = useState("list");
  const [selId, setSelId] = useState(null);
  const [toast, showToast] = useToast();
  const [lname, setLname] = useState("");
  const [lusr, setLusr] = useState("");
  const [lpwd, setLpwd] = useState("");
  const [names, setNames] = useState("");
  const [ltype, setLtype] = useState("rr");
  // Scoring rules state for the create form
  const [scoringRules, setScoringRules] = useState({ ...DEFAULT_SCORING_RULES });

  const leagues = Object.values(state.leagues);
  const sel = selId ? state.leagues[selId] : null;

  const createLeague = () => {
    if (!lname.trim() || !lusr.trim() || !lpwd.trim()) return showToast("Fill all fields", true);
    const players = names.split("\n").map(n => n.trim()).filter(Boolean);
    if (players.length < 2) return showToast("At least 2 players needed", true);
    if (new Set(players).size !== players.length) return showToast("Duplicate names", true);
    if (Object.values(state.leagues).some(l => l.username === lusr.trim())) return showToast("Username taken", true);
    const id = `league_${Date.now()}`;
    const matches = ltype === "bracket" ? generateBracket(players) : generateRoundRobin(players);
    setState(prev => ({
      ...prev,
      leagues: {
        ...prev.leagues,
        [id]: { id, name: lname.trim(), username: lusr.trim(), password: lpwd.trim(), players, matches, type: ltype, scoringRules: { ...scoringRules } }
      }
    }));
    showToast(`"${lname}" created!`);
    setLname(""); setLusr(""); setLpwd(""); setNames(""); setLtype("rr");
    setScoringRules({ ...DEFAULT_SCORING_RULES });
    setView("list");
  };

  const deleteLeague = (id) => {
    setState(prev => { const l = { ...prev.leagues }; delete l[id]; return { ...prev, leagues: l }; });
    showToast("League deleted");
    if (selId === id) { setSelId(null); setView("list"); }
  };

  const tabs = [["list", "All Leagues"], ["create", "+ New"], ...(sel ? [["manage", sel.name]] : [])];

  return <div className="screen">
    <Toast t={toast} />
    <TopBar title="Admin Console" rightEl={
      <button onClick={onClose} className="btn-icon btn-icon--violet">Exit</button>
    } />
    <TabBar tabs={tabs} active={view} onChange={setView} />

    <div className="content-area content-area--wide">

      {/* LIST */}
      {view === "list" && (leagues.length === 0
        ? <p className="empty-msg">No tournaments yet.</p>
        : leagues.map(l => {
          const done = l.matches.filter(m => m.winner && !m.isBye).length;
          const tot = l.matches.filter(m => !m.isBye).length;
          return <div key={l.id} className="league-card">
            <div className="league-card__info" onClick={() => { setSelId(l.id); setView("manage"); }}>
              <div className="league-card__title-row">
                <span className="league-card__name">◈ {l.name}</span>
                {l.type === "bracket"
                  ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
                  : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>}
              </div>
              <div className="league-card__meta">{l.players.length} players · {done}/{tot} played</div>
              <div className="league-card__login">Login: <span className="league-card__login-user">{l.username}</span></div>
            </div>
            <div className="league-card__actions">
              <Btn variant="ghost" small full={false} onClick={() => { setSelId(l.id); setView("manage"); }}>Manage</Btn>
              <Btn variant="danger" small full={false} onClick={() => deleteLeague(l.id)}>Delete</Btn>
            </div>
          </div>;
        })
      )}

      {/* CREATE */}
      {view === "create" && <div className="card">
        <div className="card__section-label">NEW TOURNAMENT</div>

        <div className="format-picker">
          <div className="format-picker__label">TOURNAMENT FORMAT</div>
          <div className="format-picker__grid">
            {[
              ["rr", "Round Robin", "All vs all · Points-based standings", C.violet, C.violetBg, C.violetBorder],
              ["bracket", "Knockout Bracket", "Elimination · Winner advances each round", C.teal, C.tealBg, C.tealBorder],
            ].map(([val, title, desc, col, bg, border]) => (
              <div key={val} onClick={() => setLtype(val)}
                className={`format-option${ltype === val ? " format-option--active" : ""}`}
                style={ltype === val ? { background: bg, borderColor: col } : {}}
              >
                <div className="format-option__title" style={ltype === val ? { color: col } : {}}>{title}</div>
                <div className="format-option__desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        <Inp label="TOURNAMENT NAME" value={lname} onChange={e => setLname(e.target.value)} placeholder="e.g. Summer Cup 2025" />
        <Inp label="LOGIN USERNAME" value={lusr} onChange={e => setLusr(e.target.value)} placeholder="e.g. summercup" />
        <Inp label="LOGIN PASSWORD" type="password" value={lpwd} onChange={e => setLpwd(e.target.value)} placeholder="shared password" />

        <div className="players-field">
          <div className="players-field__label">
            PLAYER NAMES — one per line{ltype === "bracket" ? " (top = #1 seed)" : ""}
          </div>
          {ltype === "bracket" && <div className="bracket-seed-hint">
            Seed #1 plays the lowest seed, #2 plays second-lowest, etc. Odd counts get byes — higher seeds skip round 1.
          </div>}
          <textarea value={names} onChange={e => setNames(e.target.value)} rows={7}
            placeholder={"Alice\nBob\nCarol\nDave\n..."}
            className="textarea" />
        </div>

        {/* Scoring Rules Editor */}
        <ScoringRulesEditor rules={scoringRules} onChange={setScoringRules} />

        <Btn variant={ltype === "bracket" ? "teal" : "violet"} onClick={createLeague}>Generate fixtures & create tournament</Btn>
      </div>}

      {/* MANAGE */}
      {view === "manage" && sel && (
        <LeagueView
          league={sel}
          onUpdate={updated => setState(prev => ({ ...prev, leagues: { ...prev.leagues, [selId]: updated } }))}
          onLogout={null}
          adminMode={true}
        />
      )}
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState({ leagues: {} });
  const [isLoaded, setIsLoaded] = useState(false);
  const [screen, setScreen] = useState("public");

  // Load initial data from Supabase
  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from("app_state")
        .select("data")
        .eq("id", 1)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Load error:", error);
      } else if (data?.data) {
        setAppState(data.data);
      }
      setIsLoaded(true);
    }
    loadData();
  }, []);

  // Realtime sync
  useEffect(() => {
    if (!isLoaded) return;
    const channel = supabase
      .channel("app_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.1" },
        (payload) => { if (payload.new?.data) setAppState(payload.new.data); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isLoaded]);

  // Persist to Supabase on state change
  useEffect(() => {
    if (!isLoaded) return;
    async function saveData() {
      const { error } = await supabase
        .from("app_state")
        .upsert({ id: 1, data: appState, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) console.error("Save error:", error);
    }
    saveData();
  }, [appState, isLoaded]);

  // Allow external navigation to public view
  useEffect(() => {
    const h = () => setScreen("public");
    window.addEventListener("viewpublic", h);
    return () => window.removeEventListener("viewpublic", h);
  }, []);

  // Handle deep-link via ?t= query param (from QR / share link)
  useEffect(() => {
    if (!isLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("t");
    if (tid && appState.leagues[tid]) {
      setScreen(`league:${tid}`);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [isLoaded, appState.leagues]);

  const tryLogin = (u, p) => {
    if (u === "Admin" && p === "admin123") { setScreen("admin"); return true; }
    const found = Object.values(appState.leagues).find(l => l.username === u && l.password === p);
    if (found) { setScreen(`league:${found.id}`); return true; }
    return false;
  };

  if (!isLoaded) return (
    <div className="loading-screen">
      <div className="loading-screen__inner">
        <div className="loading-screen__icon">◈</div>
        <div className="loading-screen__text">LOADING…</div>
      </div>
    </div>
  );

  if (screen === "public") return <PublicView leagues={appState.leagues} onLoginClick={() => setScreen("login")} />;
  if (screen === "login") return <LoginScreen onLogin={tryLogin} onPublic={() => setScreen("public")} />;
  if (screen === "admin") return <AdminPanel state={appState} setState={setAppState} onClose={() => setScreen("public")} />;

  if (screen.startsWith("league:")) {
    const id = screen.split(":")[1];
    const league = appState.leagues[id];
    if (!league) return <div className="not-found">
      League not found.<br />
      <button onClick={() => setScreen("public")} className="btn-icon" style={{ marginTop: 12 }}>Go Home</button>
    </div>;
    return <LeagueView
      league={league}
      onUpdate={l => setAppState(prev => ({ ...prev, leagues: { ...prev.leagues, [id]: l } }))}
      onLogout={() => setScreen("public")}
      adminMode={false}
    />;
  }
}