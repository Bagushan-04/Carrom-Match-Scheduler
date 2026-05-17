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
    <input {...p} className="inp-field"
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
  return <button {...p}
    className={`btn btn--${variant}${small ? " btn--small" : ""}${full ? " btn--full" : ""}`}
    style={{ background: s.bg, color: s.color, border: s.border || "none", ...p.style }}
    onMouseEnter={e => e.currentTarget.style.background = s.hov}
    onMouseLeave={e => e.currentTarget.style.background = s.bg}
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

// ─── Score Modal ──────────────────────────────────────────────────────────────
function ScoreModal({ match, onSave, onCancel }) {
  const [s1, setS1] = useState(match.score1 ?? "");
  const [s2, setS2] = useState(match.score2 ?? "");
  const n1 = parseInt(s1), n2 = parseInt(s2);
  const valid = !isNaN(n1) && !isNaN(n2) && n1 !== n2 && n1 >= 0 && n2 >= 0;
  const winner = valid ? (n1 > n2 ? match.p1 : match.p2) : null;

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
            <input type="number" min={0} max={99} value={pl.val} onChange={e => pl.set(e.target.value)} placeholder="0"
              className={`modal-score-input${winner === pl.name ? " modal-score-input--winner" : ""}`}
            />
          </div>,
          i === 0 && <div key="vs" className="modal-vs">VS</div>,
        ])}
      </div>
      {winner && <div className="modal-winner-msg">✦ {winner} advances</div>}
      {!isNaN(n1) && !isNaN(n2) && n1 === n2 && s1 !== "" && <div className="modal-no-draw">No draws allowed</div>}
      <div className="modal-hint">No draws · Winner advances</div>
      <div className="modal-actions">
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
    <div className="lb-header">
      {["", "Player", "P", "W", "L", "Pts"].map((h, i) => <div key={i} className={`lb-header-cell${i > 1 ? " lb-header-cell--right" : ""}`}>{h}</div>)}
    </div>
    {lb.map((p, i) => <div key={p.name}
      className={`lb-row${i === 0 ? " lb-row--first" : i % 2 === 0 ? " lb-row--even" : ""}`}
      style={{ border: `1px solid ${i === 0 ? C.goldBorder : C.border}` }}
    >
      <div className={`lb-rank${i < 3 ? " lb-rank--medal" : ""}`}>{medals[i] ?? `${i + 1}`}</div>
      <div className={`lb-name${i === 0 ? " lb-name--first" : ""}`}>{p.name}</div>
      <div className="lb-cell lb-cell--mid">{p.played}</div>
      <div className="lb-cell lb-cell--green">{p.won}</div>
      <div className="lb-cell lb-cell--red">{p.lost}</div>
      <div className={`lb-pts${i === 0 ? " lb-pts--first" : ""}`}>{p.pts}</div>
    </div>)}
  </div>;
}

// ─── Bracket Visual ───────────────────────────────────────────────────────────
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
    return <div key={r} className="rr-round">
      <div className="rr-round__header">
        <span className="rr-round__label">ROUND {r}</span>
        {allDone
          ? <Pill color={C.green} bg={C.greenBg} border={`${C.green}44`}>COMPLETE</Pill>
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

  return <div className="screen">
    <Toast t={toast} />
    {scoreMatch && <ScoreModal match={scoreMatch} onSave={handleSave} onCancel={() => setScoreMatch(null)} />}
    <TopBar
      title={`◈ ${league.name}`}
      subtitle={<span className="topbar__subtitle-inner">
        <span>{completed}/{total} matches played</span>{typeTag}
        {adminMode && <Pill color={C.gold} bg={C.goldDim} border={C.goldBorder}>ADMIN</Pill>}
      </span>}
      rightEl={onLogout && <button onClick={onLogout} className="btn-icon">Logout</button>}
    />
    <TabBar tabs={tabs} active={tab} onChange={setTab} />
    <div className="content-area" style={{ maxWidth: league.type === "bracket" ? 900 : 600 }}>
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

// ─── Login ────────────────────────────────────────────────────────────────────
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

// ─── Public View ──────────────────────────────────────────────────────────────
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
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
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
    return <LeagueView league={league}
      onUpdate={l => setAppState(prev => ({ ...prev, leagues: { ...prev.leagues, [id]: l } }))}
      onLogout={() => setScreen("public")}
      adminMode={false}
    />;
  }
}
