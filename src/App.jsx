import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabaseClient";
// ─── Round Robin ──────────────────────────────────────────────────────────────
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

function computeLeaderboard(players, matches) {
  const stats = {};
  players.forEach(p => { stats[p] = { name: p, played: 0, won: 0, lost: 0, pts: 0 }; });
  matches.forEach(m => {
    if (!m.winner) return;
    stats[m.p1].played++; stats[m.p2].played++;
    const s1 = Number(m.score1);
const s2 = Number(m.score2);
const gap = Math.abs(s1 - s2);

let winnerPoints = 10;
let loserPoints = 0;

if (gap >= 15) winnerPoints += 3;

if ((s1 === 25 && s2 === 0) || (s2 === 25 && s1 === 0)) {
  winnerPoints += 5;
  loserPoints -= 3;
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
  return Object.values(stats).sort((a, b) => b.pts - a.pts || b.won - a.won);
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

// ─── Bracket ──────────────────────────────────────────────────────────────────
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
  const byId = {};
  result.forEach(m => { byId[m.id] = m; });

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

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#0c0c0e", surface: "#131316", border: "rgba(255,255,255,0.07)", borderActive: "rgba(255,255,255,0.16)",
  gold: "#c9a84c", goldLight: "#e2c97e", goldDim: "rgba(201,168,76,0.12)", goldBorder: "rgba(201,168,76,0.28)",
  text: "#f0ede8", textMid: "#8a8680", textDim: "#4a4845",
  green: "#4caf7d", greenBg: "rgba(76,175,125,0.1)",
  red: "#e05c5c", redBg: "rgba(224,92,92,0.08)",
  violet: "#9d8df1", violetBg: "rgba(157,141,241,0.12)", violetBorder: "rgba(157,141,241,0.3)",
  teal: "#5bc4a8", tealBg: "rgba(91,196,168,0.1)", tealBorder: "rgba(91,196,168,0.3)",
};
const F = {
  display: "'Cormorant Garamond','Palatino Linotype',Georgia,serif",
  body: "'DM Sans','Helvetica Neue',sans-serif",
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Toast({ t }) {
  if (!t) return null;
  return <div style={{
    position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
    background: t.err ? "#1f0d0d" : "#0d1f16", border: `1px solid ${t.err ? C.red : C.green}`,
    color: C.text, padding: "10px 22px", borderRadius: 8, fontSize: 12,
    letterSpacing: "0.06em", fontFamily: F.body, whiteSpace: "nowrap",
  }}>{t.msg}</div>;
}

function useToast() {
  const [t, setT] = useState(null);
  const show = (msg, err = false) => { setT({ msg, err }); setTimeout(() => setT(null), 2800); };
  return [t, show];
}

function Pill({ children, color, bg, border }) {
  return <span style={{
    fontSize: 10, letterSpacing: "0.08em", color: color || C.textMid,
    background: bg || "transparent", border: `1px solid ${border || C.border}`,
    padding: "2px 8px", borderRadius: 20, fontFamily: F.body,
  }}>{children}</span>;
}

function Inp({ label, ...p }) {
  return <div style={{ marginBottom: 16 }}>
    {label && <div style={{ fontSize: 10, color: C.textMid, letterSpacing: "0.1em", marginBottom: 6, fontFamily: F.body }}>{label}</div>}
    <input {...p} style={{
      width: "100%", padding: "11px 14px", background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 8, color: C.text,
      fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: F.body, ...p.style,
    }}
      onFocus={e => e.target.style.borderColor = C.borderActive}
      onBlur={e => e.target.style.borderColor = C.border}
    />
  </div>;
}

function Btn({ children, variant = "gold", full = true, small, ...p }) {
  const vs = {
    gold: { bg: C.gold, color: "#0a0a0c", hov: C.goldLight },
    ghost: { bg: "transparent", color: C.textMid, hov: C.surface, border: C.border },
    danger: { bg: C.redBg, color: C.red, hov: "rgba(224,92,92,0.14)", border: `1px solid ${C.red}33` },
    violet: { bg: C.violetBg, color: C.violet, hov: "rgba(157,141,241,0.18)", border: C.violetBorder },
    teal: { bg: C.tealBg, color: C.teal, hov: "rgba(91,196,168,0.16)", border: C.tealBorder },
  };
  const s = vs[variant] || vs.gold;
  return <button {...p} style={{
    padding: small ? "6px 12px" : "11px 18px", border: s.border || "none",
    borderRadius: 8, fontSize: small ? 11 : 13, fontWeight: 600, cursor: "pointer",
    background: s.bg, color: s.color, letterSpacing: "0.05em",
    width: full ? "100%" : "auto", fontFamily: F.body, ...p.style,
  }}
    onMouseEnter={e => e.currentTarget.style.background = s.hov}
    onMouseLeave={e => e.currentTarget.style.background = s.bg}
  >{children}</button>;
}

function TopBar({ title, subtitle, rightEl }) {
  return <div style={{
    background: C.surface, borderBottom: `1px solid ${C.border}`,
    padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
  }}>
    <div>
      <div style={{ fontSize: 16, color: C.gold, fontFamily: F.display, letterSpacing: "0.06em", fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: C.textMid, fontFamily: F.body, marginTop: 2 }}>{subtitle}</div>}
    </div>
    {rightEl}
  </div>;
}

function TabBar({ tabs, active, onChange }) {
  return <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "0 16px", background: C.surface }}>
    {tabs.map(([k, label]) => <button key={k} onClick={() => onChange(k)} style={{
      padding: "12px 14px", background: "transparent", border: "none",
      borderBottom: active === k ? `2px solid ${C.gold}` : "2px solid transparent",
      color: active === k ? C.gold : C.textMid, fontSize: 12, cursor: "pointer",
      letterSpacing: "0.06em", fontFamily: F.body, fontWeight: active === k ? 600 : 400, whiteSpace: "nowrap",
    }}>{label}</button>)}
  </div>;
}

// ─── Score Modal ──────────────────────────────────────────────────────────────
function ScoreModal({ match, onSave, onCancel }) {
  const [s1, setS1] = useState(match.score1 ?? "");
  const [s2, setS2] = useState(match.score2 ?? "");
  const n1 = parseInt(s1), n2 = parseInt(s2);
  const valid = !isNaN(n1) && !isNaN(n2) && n1 !== n2 && n1 >= 0 && n2 >= 0;
  const winner = valid ? (n1 > n2 ? match.p1 : match.p2) : null;

  return <div style={{
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
  }}>
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, width: "100%", maxWidth: 360 }}>
      <div style={{ marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMid, letterSpacing: "0.1em", fontFamily: F.body, marginBottom: 4 }}>{match.roundLabel || `ROUND ${match.round}`}</div>
        <div style={{ fontSize: 11, color: C.textDim, fontFamily: F.body }}>Enter match score</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", gap: 10, alignItems: "center", marginBottom: 20 }}>
        {[{ name: match.p1, val: s1, set: setS1 }, { name: match.p2, val: s2, set: setS2 }].map((pl, i) => [
          <div key={pl.name}>
            <div style={{ fontSize: 12, color: winner === pl.name ? C.gold : C.textMid, marginBottom: 8, textAlign: "center", fontFamily: F.body, fontWeight: winner === pl.name ? 600 : 400 }}>{pl.name}</div>
            <input type="number" min={0} max={99} value={pl.val} onChange={e => pl.set(e.target.value)} placeholder="0"
              style={{
                width: "100%", padding: "16px 4px", background: C.bg,
                border: `2px solid ${winner === pl.name ? C.gold : C.border}`,
                borderRadius: 10, color: winner === pl.name ? C.gold : C.text,
                fontSize: 32, textAlign: "center", outline: "none", boxSizing: "border-box", fontFamily: F.display,
              }} />
          </div>,
          i === 0 && <div key="vs" style={{ textAlign: "center", color: C.textDim, fontSize: 11, fontFamily: F.body }}>VS</div>,
        ])}
      </div>
      {winner && <div style={{ textAlign: "center", marginBottom: 14, color: C.gold, fontSize: 12, fontFamily: F.body, letterSpacing: "0.06em" }}>✦ {winner} advances</div>}
      {!isNaN(n1) && !isNaN(n2) && n1 === n2 && s1 !== "" && <div style={{ textAlign: "center", marginBottom: 12, color: C.red, fontSize: 11, fontFamily: F.body }}>No draws allowed</div>}
      <div style={{ fontSize: 10, color: C.textDim, textAlign: "center", marginBottom: 16, fontFamily: F.body }}>No draws · Winner advances</div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={() => valid && onSave(n1, n2, winner)} style={{ opacity: valid ? 1 : 0.4 }}>Save result</Btn>
        <Btn variant="ghost" onClick={onCancel} full={false} style={{ flex: 1 }}>Cancel</Btn>
      </div>
    </div>
  </div>;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function Leaderboard({ players, matches }) {
  const lb = useMemo(() => computeLeaderboard(players, matches), [players, matches]);
  const medals = ["🥇", "🥈", "🥉"];
  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 44px 44px 44px 48px", gap: 6, padding: "0 12px 8px" }}>
      {["", "Player", "P", "W", "L", "Pts"].map((h, i) => <div key={i} style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.1em", textAlign: i > 1 ? "center" : "left", fontFamily: F.body }}>{h}</div>)}
    </div>
    {lb.map((p, i) => <div key={p.name} style={{
      display: "grid", gridTemplateColumns: "32px 1fr 44px 44px 44px 48px",
      gap: 6, alignItems: "center", padding: "12px 12px", borderRadius: 8, marginBottom: 4,
      background: i === 0 ? "rgba(201,168,76,0.06)" : i % 2 === 0 ? C.surface : "transparent",
      border: `1px solid ${i === 0 ? C.goldBorder : C.border}`,
    }}>
      <div style={{ textAlign: "center", fontSize: i < 3 ? 16 : 11 }}>{medals[i] ?? `${i + 1}`}</div>
      <div style={{ fontSize: 13, fontFamily: F.body, color: i === 0 ? C.gold : C.text, fontWeight: i === 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: C.textMid, fontFamily: F.body }}>{p.played}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: C.green, fontWeight: 600, fontFamily: F.body }}>{p.won}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: C.red, fontWeight: 600, fontFamily: F.body }}>{p.lost}</div>
      <div style={{ textAlign: "center", fontSize: 16, color: i === 0 ? C.gold : C.text, fontWeight: 700, fontFamily: F.display }}>{p.pts}</div>
    </div>)}
  </div>;
}

// ─── Bracket Visual ───────────────────────────────────────────────────────────
function BracketPlayer({ name, score, isWinner, isPending, isBye }) {
  return <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 12px", background: isWinner ? "rgba(201,168,76,0.07)" : "transparent",
  }}>
    <span style={{
      fontSize: 13, fontFamily: F.body,
      color: isPending || isBye ? C.textDim : isWinner ? C.gold : C.text,
      fontWeight: isWinner ? 600 : 400, fontStyle: isPending ? "italic" : "normal",
    }}>{isPending ? "TBD" : isBye ? "BYE" : name}</span>
    {score !== null && score !== undefined && !isBye && !isPending && (
      <span style={{ fontSize: 16, fontFamily: F.display, color: isWinner ? C.gold : C.textMid, fontWeight: 700 }}>{score}</span>
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

  return <div style={{ overflowX: "auto", paddingBottom: 16 }}>
    {champion && (
      <div style={{ textAlign: "center", marginBottom: 24, padding: "14px 20px", background: "rgba(201,168,76,0.08)", border: `1px solid ${C.goldBorder}`, borderRadius: 12 }}>
        <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em", fontFamily: F.body, marginBottom: 6 }}>CHAMPION</div>
        <div style={{ fontSize: 28, color: C.gold, fontFamily: F.display, letterSpacing: "0.08em" }}>🏆 {champion}</div>
      </div>
    )}

    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: totalRounds * 224 }}>
      {roundNums.map((r) => {
        const rMatches = rounds[r];
        const label = getBracketRoundName(r, totalRounds);
        return <div key={r} style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: C.textMid, letterSpacing: "0.12em", fontFamily: F.body, textAlign: "center", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>{label.toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {rMatches.map((m) => {
              const canClick = adminMode && m.p1 && m.p2 && !m.isBye;
              const isPending = !m.p1 || !m.p2;
              return <div key={m.id}>
                <div style={{
                  background: C.surface, borderRadius: 10, overflow: "hidden",
                  border: `1px solid ${m.winner && !m.isBye ? C.goldBorder : isPending ? C.border : C.borderActive}`,
                  opacity: isPending ? 0.5 : 1,
                }}>
                  <BracketPlayer name={m.p1} score={m.score1} isWinner={m.winner === m.p1} isPending={!m.p1} />
                  <div style={{ height: 1, background: C.border }} />
                  <BracketPlayer name={m.p2} score={m.score2} isWinner={m.winner === m.p2} isPending={!m.p2} isBye={m.p2 === "BYE"} />
                </div>
                {m.isBye && m.winner && (
                  <div style={{ textAlign: "right", marginTop: 3 }}>
                    <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>BYE — auto advance</Pill>
                  </div>
                )}
                {canClick && (
                  <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
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

// ─── RR Fixtures ──────────────────────────────────────────────────────────────
function RRFixtures({ matches, playable, onScoreClick, adminMode }) {
  const rounds = useMemo(() => {
    const map = {};
    matches.forEach(m => { if (!map[m.round]) map[m.round] = []; map[m.round].push(m); });
    return map;
  }, [matches]);

  return <div>{Object.keys(rounds).sort((a, b) => a - b).map(r => {
    const ms = rounds[r];
    const allDone = ms.every(m => m.winner);
    return <div key={r} style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 11, color: C.textMid, letterSpacing: "0.1em", fontFamily: F.body, fontWeight: 600 }}>ROUND {r}</span>
        {allDone
          ? <Pill color={C.green} bg={C.greenBg} border={`${C.green}44`}>COMPLETE</Pill>
          : <Pill color={C.gold} bg={C.goldDim} border={C.goldBorder}>IN PROGRESS</Pill>}
      </div>
      {ms.map(m => {
        const canPlay = adminMode || playable.includes(m.id);
        return <div key={m.id} style={{
          background: C.surface,
          border: `1px solid ${m.winner ? C.border : canPlay ? C.goldBorder : C.border}`,
          borderRadius: 10, padding: "14px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6,
        }}>
          <div style={{ fontSize: 14, fontFamily: F.body, display: "flex", alignItems: "center", gap: 8 }}>
            {m.winner ? <>
              <span style={{ color: m.winner === m.p1 ? C.gold : C.textMid, fontWeight: m.winner === m.p1 ? 600 : 400 }}>{m.p1}</span>
              <span style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", fontSize: 13, color: C.text, fontFamily: F.display }}>{m.score1} – {m.score2}</span>
              <span style={{ color: m.winner === m.p2 ? C.gold : C.textMid, fontWeight: m.winner === m.p2 ? 600 : 400 }}>{m.p2}</span>
            </> : <>
              <span style={{ color: canPlay ? C.text : C.textMid }}>{m.p1}</span>
              <span style={{ color: C.textDim, fontSize: 11 }}>vs</span>
              <span style={{ color: canPlay ? C.text : C.textMid }}>{m.p2}</span>
            </>}
          </div>
          {canPlay
            ? <Btn variant={m.winner ? "ghost" : "gold"} small full={false} onClick={() => onScoreClick(m)}>{m.winner ? "Edit" : "+ Score"}</Btn>
            : !m.winner && <span style={{ fontSize: 10, color: C.textDim, fontFamily: F.body, letterSpacing: "0.06em" }}>LOCKED</span>}
        </div>;
      })}
    </div>;
  })}</div>;
}

// ─── League View ─────────────────────────────────────────────────────────────
function LeagueView({ league, onUpdate, onLogout, adminMode = false }) {
  const defaultTab = league.type === "bracket" ? "bracket" : "fixtures";
  const [tab, setTab] = useState(defaultTab);
  const [scoreMatch, setScoreMatch] = useState(null);
  const [toast, showToast] = useToast();

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

  const tabs = league.type === "bracket"
    ? [["bracket", "Bracket"]]
    : [["fixtures", "Fixtures"], ["standings", "Standings"]];

  const typeTag = league.type === "bracket"
    ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
    : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>;

  return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: F.body, color: C.text }}>
    <Toast t={toast} />
    {scoreMatch && <ScoreModal match={scoreMatch} onSave={handleSave} onCancel={() => setScoreMatch(null)} />}
    <TopBar
      title={`◈ ${league.name}`}
      subtitle={<span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{completed}/{total} matches played</span>{typeTag}
        {adminMode && <Pill color={C.gold} bg={C.goldDim} border={C.goldBorder}>ADMIN</Pill>}
      </span>}
      rightEl={onLogout && <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMid, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: F.body }}>Logout</button>}
    />
    <TabBar tabs={tabs} active={tab} onChange={setTab} />
    <div style={{ padding: "24px 16px", maxWidth: league.type === "bracket" ? 900 : 600, margin: "0 auto" }}>
      {tab === "standings" && <Leaderboard players={league.players} matches={league.matches} />}
      {tab === "fixtures" && <RRFixtures matches={league.matches} playable={playable} onScoreClick={setScoreMatch} adminMode={adminMode} />}
      {tab === "bracket" && <BracketView
        matches={league.matches}
        onMatchClick={(m, label) => setScoreMatch({ ...m, roundLabel: label })}
        adminMode={adminMode}
      />}
    </div>
  </div>;
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ state, setState, onClose }) {
  const [view, setView] = useState("list");
  const [selId, setSelId] = useState(null);
  const [toast, showToast] = useToast();
  const [lname, setLname] = useState(""); const [lusr, setLusr] = useState("");
  const [lpwd, setLpwd] = useState(""); const [names, setNames] = useState("");
  const [ltype, setLtype] = useState("rr");

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
    setState(prev => ({ ...prev, leagues: { ...prev.leagues, [id]: { id, name: lname.trim(), username: lusr.trim(), password: lpwd.trim(), players, matches, type: ltype } } }));
    showToast(`"${lname}" created!`);
    setLname(""); setLusr(""); setLpwd(""); setNames(""); setLtype("rr");
    setView("list");
  };

  const deleteLeague = (id) => {
    setState(prev => { const l = { ...prev.leagues }; delete l[id]; return { ...prev, leagues: l }; });
    showToast("League deleted");
    if (selId === id) { setSelId(null); setView("list"); }
  };

  const tabs = [["list", "All Leagues"], ["create", "+ New"], ...(sel ? [["manage", sel.name]] : [])];

  return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: F.body, color: C.text }}>
    <Toast t={toast} />
    <TopBar title="Admin Console" rightEl={
      <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.violetBorder}`, color: C.violet, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: F.body }}>Exit</button>
    } />
    <TabBar tabs={tabs} active={view} onChange={setView} />

    <div style={{ padding: "24px 16px", maxWidth: 720, margin: "0 auto" }}>

      {/* LIST */}
      {view === "list" && (leagues.length === 0
        ? <p style={{ textAlign: "center", color: C.textDim, marginTop: 60 }}>No tournaments yet.</p>
        : leagues.map(l => {
          const done = l.matches.filter(m => m.winner && !m.isBye).length;
          const tot = l.matches.filter(m => !m.isBye).length;
          return <div key={l.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer", flex: 1 }} onClick={() => { setSelId(l.id); setView("manage"); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 16, color: C.gold, fontFamily: F.display, letterSpacing: "0.04em" }}>◈ {l.name}</span>
                {l.type === "bracket"
                  ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
                  : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>}
              </div>
              <div style={{ fontSize: 11, color: C.textMid }}>{l.players.length} players · {done}/{tot} played</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>Login: <span style={{ color: C.textMid }}>{l.username}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" small full={false} onClick={() => { setSelId(l.id); setView("manage"); }}>Manage</Btn>
              <Btn variant="danger" small full={false} onClick={() => deleteLeague(l.id)}>Delete</Btn>
            </div>
          </div>;
        })
      )}

      {/* CREATE */}
      {view === "create" && <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 26 }}>
        <div style={{ fontSize: 12, color: C.textMid, letterSpacing: "0.08em", marginBottom: 20 }}>NEW TOURNAMENT</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: C.textMid, letterSpacing: "0.1em", marginBottom: 10 }}>TOURNAMENT FORMAT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              ["rr", "Round Robin", "All vs all · Points-based standings", C.violet, C.violetBg, C.violetBorder],
              ["bracket", "Knockout Bracket", "Elimination · Winner advances each round", C.teal, C.tealBg, C.tealBorder],
            ].map(([val, title, desc, col, bg, border]) => (
              <div key={val} onClick={() => setLtype(val)} style={{
                padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                background: ltype === val ? bg : C.bg,
                border: `2px solid ${ltype === val ? col : C.border}`,
                transition: "all 0.15s",
              }}>
                <div style={{ fontSize: 13, color: ltype === val ? col : C.text, fontWeight: 600, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 11, color: C.textMid }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        <Inp label="TOURNAMENT NAME" value={lname} onChange={e => setLname(e.target.value)} placeholder="e.g. Summer Cup 2025" />
        <Inp label="LOGIN USERNAME" value={lusr} onChange={e => setLusr(e.target.value)} placeholder="e.g. summercup" />
        <Inp label="LOGIN PASSWORD" type="password" value={lpwd} onChange={e => setLpwd(e.target.value)} placeholder="shared password" />

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: C.textMid, letterSpacing: "0.1em", marginBottom: 6 }}>
            PLAYER NAMES — one per line{ltype === "bracket" ? " (top = #1 seed)" : ""}
          </div>
          {ltype === "bracket" && <div style={{ fontSize: 11, color: C.teal, marginBottom: 8, padding: "8px 12px", background: "rgba(91,196,168,0.06)", borderRadius: 8, border: `1px solid ${C.tealBorder}` }}>
            Seed #1 plays the lowest seed, #2 plays second-lowest, etc. Odd counts get byes — higher seeds skip round 1.
          </div>}
          <textarea value={names} onChange={e => setNames(e.target.value)} rows={7}
            placeholder={"Alice\nBob\nCarol\nDave\n..."}
            style={{ width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: F.body }} />
        </div>
        <Btn variant={ltype === "bracket" ? "teal" : "violet"} onClick={createLeague}>Generate fixtures & create tournament</Btn>
      </div>}

      {/* MANAGE — reuse LeagueView in admin mode, no outer wrapper chrome */}
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

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onPublic }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState("");
  const go = () => { if (!onLogin(u.trim(), p)) setErr("Invalid credentials"); };
  return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.body, padding: 20 }}>
    <div style={{ width: "100%", maxWidth: 340 }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 44, fontFamily: F.display, color: C.gold, letterSpacing: "0.1em", fontWeight: 600, lineHeight: 1 }}>◈</div>
        <div style={{ fontSize: 28, fontFamily: F.display, color: C.text, letterSpacing: "0.14em", marginTop: 10 }}>Carrom League</div>
        <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.14em", marginTop: 4 }}>SCORE MANAGER</div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 26 }}>
        <Inp label="USERNAME" value={u} onChange={e => { setU(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && go()} placeholder="Enter username" />
        <Inp label="PASSWORD" type="password" value={p} onChange={e => { setP(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && go()} placeholder="Enter password" />
        {err && <div style={{ color: C.red, fontSize: 12, textAlign: "center", marginBottom: 12 }}>{err}</div>}
        <Btn onClick={go}>Login</Btn>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: C.textDim }}>
          <span style={{ color: C.gold, cursor: "pointer" }} onClick={onPublic}>← View public results</span>
        </div>
      </div>
    </div>
  </div>;
}

// ─── Public View ──────────────────────────────────────────────────────────────
function PublicView({ leagues, onLoginClick }) {
  const [sel, setSel] = useState(null);
  const list = Object.values(leagues);
  const selLeague = sel ? leagues[sel] : null;

  return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: F.body, color: C.text }}>
    <div style={{ textAlign: "center", padding: "56px 20px 36px", borderBottom: `1px solid ${C.border}`, background: "linear-gradient(180deg,rgba(201,168,76,0.04) 0%,transparent 100%)" }}>
      <div style={{ fontSize: 52, fontFamily: F.display, color: C.gold, letterSpacing: "0.08em", fontWeight: 600, lineHeight: 1 }}>◈</div>
      <h1 style={{ fontSize: 36, fontFamily: F.display, fontWeight: 400, letterSpacing: "0.16em", color: C.text, margin: "14px 0 6px" }}>Carrom League</h1>
      <p style={{ color: C.textMid, fontSize: 11, letterSpacing: "0.14em", margin: "0 0 24px" }}>LIVE RESULTS</p>
      <button onClick={onLoginClick}
        style={{ background: "transparent", border: `1px solid ${C.goldBorder}`, color: C.gold, borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 12, letterSpacing: "0.08em", fontFamily: F.body }}
        onMouseEnter={e => e.currentTarget.style.background = C.goldDim}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >Admin / Player login →</button>
    </div>

    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 16px 60px" }}>
      {list.length === 0
        ? <p style={{ textAlign: "center", color: C.textDim, marginTop: 40 }}>No active tournaments.</p>
        : <>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em", textAlign: "center", marginBottom: 20 }}>ACTIVE TOURNAMENTS</div>
          {list.map(l => {
            const done = l.matches.filter(m => m.winner && !m.isBye).length;
            const tot = l.matches.filter(m => !m.isBye).length;
            const isOpen = sel === l.id;
            return <div key={l.id} style={{ marginBottom: 8 }}>
              <div onClick={() => setSel(isOpen ? null : l.id)} style={{
                background: isOpen ? "rgba(201,168,76,0.06)" : C.surface,
                border: `1px solid ${isOpen ? C.goldBorder : C.border}`,
                borderRadius: isOpen ? "12px 12px 0 0" : 12,
                padding: "16px 20px", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, color: isOpen ? C.gold : C.text, fontFamily: F.display, letterSpacing: "0.04em" }}>◈ {l.name}</span>
                    {l.type === "bracket"
                      ? <Pill color={C.teal} bg={C.tealBg} border={C.tealBorder}>KNOCKOUT</Pill>
                      : <Pill color={C.violet} bg={C.violetBg} border={C.violetBorder}>ROUND ROBIN</Pill>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMid }}>{l.players.length} players · {done}/{tot} played</div>
                </div>
                <span style={{ color: isOpen ? C.gold : C.textDim, fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && <div style={{ background: C.surface, border: `1px solid ${C.goldBorder}`, borderTop: `1px solid ${C.border}`, borderRadius: "0 0 12px 12px", padding: 20, overflowX: "auto" }}>
                {l.type === "bracket"
                  ? <BracketView matches={l.matches} adminMode={false} />
                  : <Leaderboard players={l.players} matches={l.matches} />}
              </div>}
            </div>;
          })}
        </>}
    </div>
  </div>;
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState({ leagues: {} });
  const [isLoaded, setIsLoaded] = useState(false);
  const [screen, setScreen] = useState("public");

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from("app_state")
        .select("data")
        .eq("id", 1)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = row not found (first run) — that's fine, we upsert on save
        console.error("Load error:", error);
      } else if (data?.data) {
        setAppState(data.data);
      }
      setIsLoaded(true);
    }
    loadData();
  }, []);

  // ── Realtime subscription — keeps all open tabs in sync ───────────────────
  useEffect(() => {
    if (!isLoaded) return;

    const channel = supabase
      .channel("app_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.1" },
        (payload) => {
          if (payload.new?.data) {
            setAppState(payload.new.data);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoaded]);

  // ── Save — upsert so first run also works; only runs after load ───────────
  useEffect(() => {
    if (!isLoaded) return;

    async function saveData() {
      const { error } = await supabase
        .from("app_state")
        .upsert(
          { id: 1, data: appState, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );

      if (error) {
        console.error("Save error:", error);
      }
    }
    saveData();
  }, [appState, isLoaded]);

  // ── Navigation helpers ────────────────────────────────────────────────────
  useEffect(() => {
    const h = () => setScreen("public");
    window.addEventListener("viewpublic", h);
    return () => window.removeEventListener("viewpublic", h);
  }, []);

  const tryLogin = (u, p) => {
    if (u === "Admin" && p === "admin123") { setScreen("admin"); return true; }
    const found = Object.values(appState.leagues).find(l => l.username === u && l.password === p);
    if (found) { setScreen(`league:${found.id}`); return true; }
    return false;
  };

  if (!isLoaded) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.body }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 44, color: C.gold, marginBottom: 16 }}>◈</div>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: "0.14em" }}>LOADING…</div>
      </div>
    </div>
  );

  if (screen === "public") return <PublicView leagues={appState.leagues} onLoginClick={() => setScreen("login")} />;
  if (screen === "login") return <LoginScreen onLogin={tryLogin} onPublic={() => setScreen("public")} />;
  if (screen === "admin") return <AdminPanel state={appState} setState={setAppState} onClose={() => setScreen("public")} />;
  if (screen.startsWith("league:")) {
    const id = screen.split(":")[1];
    const league = appState.leagues[id];
    if (!league) return <div style={{ color: C.red, padding: 40, textAlign: "center", fontFamily: F.body }}>
      League not found.<br />
      <button onClick={() => setScreen("public")} style={{ marginTop: 12, background: "transparent", border: `1px solid ${C.border}`, color: C.textMid, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>Go Home</button>
    </div>;
    return <LeagueView league={league}
      onUpdate={l => setAppState(prev => ({ ...prev, leagues: { ...prev.leagues, [id]: l } }))}
      onLogout={() => setScreen("public")}
      adminMode={false}
    />;
  }
}
