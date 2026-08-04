import { loadData, saveData, uid } from './state.js';
import { generateNextRound, estimateCycleRounds } from './rotation.js';
import { renderBarChart, renderLineChart } from './charts.js';

let data = loadData();
let screen = 'setup';
let selectedIds = new Set(
  data.sessions.length
    ? data.sessions[data.sessions.length - 1].playerIds.filter((id) => data.players.some((p) => p.id === id))
    : data.players.map((p) => p.id)
);
let viewingSessionId = null;
let renamingPlayerId = null;

const root = document.getElementById('app');

function getPlayer(id) {
  return data.players.find((p) => p.id === id);
}
function getName(id) {
  return getPlayer(id)?.name || 'Unknown';
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function getNameHtml(id) {
  return escapeHtml(getName(id));
}
function activeSession() {
  return data.sessions.find((s) => !s.ended) || null;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function suggestedCourts(playerCount) {
  return Math.max(1, Math.floor(playerCount / 4));
}

function assignRanks(sortedByPointsThenWins) {
  let rank = 0;
  sortedByPointsThenWins.forEach((p, i) => {
    if (i === 0 || p.points !== sortedByPointsThenWins[i - 1].points || p.wins !== sortedByPointsThenWins[i - 1].wins) {
      rank = i + 1;
    }
    p.rank = rank;
  });
  return sortedByPointsThenWins;
}

function computeStandings(session) {
  const stats = {};
  session.playerIds.forEach((id) => {
    stats[id] = { id, name: getName(id), gamePts: 0, bonusPts: 0, points: 0, roundsPlayed: 0, wins: 0 };
  });
  session.rounds.forEach((round) => {
    round.courts.forEach((court) => {
      if (court.scoreA == null || court.scoreB == null) return;
      const aWin = court.scoreA > court.scoreB;
      const bWin = court.scoreB > court.scoreA;
      court.teamA.forEach((id) => {
        if (!stats[id]) return;
        const bonus = aWin ? session.winBonus : 0;
        stats[id].gamePts += court.scoreA;
        stats[id].bonusPts += bonus;
        stats[id].points += court.scoreA + bonus;
        stats[id].roundsPlayed += 1;
        if (aWin) stats[id].wins += 1;
      });
      court.teamB.forEach((id) => {
        if (!stats[id]) return;
        const bonus = bWin ? session.winBonus : 0;
        stats[id].gamePts += court.scoreB;
        stats[id].bonusPts += bonus;
        stats[id].points += court.scoreB + bonus;
        stats[id].roundsPlayed += 1;
        if (bWin) stats[id].wins += 1;
      });
    });
  });
  const sorted = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.wins - a.wins;
  });
  return assignRanks(sorted);
}

function computeAllTimeStats() {
  const endedSessions = data.sessions
    .filter((s) => s.ended)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const perPlayer = {};
  const perSessionPoints = {};
  data.players.forEach((p) => {
    perPlayer[p.id] = { id: p.id, name: p.name, points: 0, gamePts: 0, bonusPts: 0, wins: 0, roundsPlayed: 0, sessions: 0 };
    perSessionPoints[p.id] = new Array(endedSessions.length).fill(null);
  });

  endedSessions.forEach((session, idx) => {
    computeStandings(session).forEach((p) => {
      const acc = perPlayer[p.id];
      if (!acc || p.roundsPlayed === 0) return;
      acc.points += p.points;
      acc.gamePts += p.gamePts;
      acc.bonusPts += p.bonusPts;
      acc.wins += p.wins;
      acc.roundsPlayed += p.roundsPlayed;
      acc.sessions += 1;
      perSessionPoints[p.id][idx] = p.points;
    });
  });

  const leaderboard = assignRanks(
    Object.values(perPlayer)
      .filter((p) => p.sessions > 0)
      .sort((a, b) => (b.points !== a.points ? b.points - a.points : b.wins - a.wins))
  );

  return { leaderboard, endedSessions, perSessionPoints };
}

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function buildShareText(session) {
  const standings = computeStandings(session);
  const dateStr = new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const lines = standings.map((p) => {
    const rank = RANK_MEDALS[p.rank - 1] || `${p.rank}.`;
    return `${rank} ${p.name} - *${p.points}* pts`;
  });
  return `🎾 *PadelMix Standings* — ${dateStr}\n\n${lines.join('\n')}`;
}

function buildAllTimeShareText(leaderboard) {
  const lines = leaderboard.map((p) => {
    const rank = RANK_MEDALS[p.rank - 1] || `${p.rank}.`;
    return `${rank} ${p.name} - *${p.points}* pts`;
  });
  return `🎾 *PadelMix All-Time Standings*\n\n${lines.join('\n')}`;
}

function ensureCycleInfo(session) {
  if (session.cycleRounds == null) {
    const total = session.playerIds.length;
    const courtsUsed = Math.min(session.courts, Math.floor(total / 4));
    session.cycleRounds = estimateCycleRounds(total, courtsUsed);
  }
  return session.cycleRounds;
}

function suggestTarget(session) {
  const cycleRounds = ensureCycleInfo(session);
  const roundsPlayed = session.rounds.length;
  const elapsedMin = (Date.now() - session.startedAt) / 60000;
  const remainingMin = Math.max(0, session.durationMin - elapsedMin);
  const cycleComplete = roundsPlayed >= cycleRounds;
  const roundsLeft = cycleComplete ? 1 : Math.max(1, cycleRounds - roundsPlayed);
  const avgMinPerRound = remainingMin / roundsLeft;
  const target = clamp(Math.round((avgMinPerRound * 60) / session.secPerPoint), 8, 40);
  return { target, cycleComplete, cycleRounds, remainingMin, elapsedMin };
}

function ensurePendingRound(session) {
  ensureCycleInfo(session);
  if (!session.pendingRound) {
    const roundNum = session.rounds.length + 1;
    let target;
    if (roundNum <= session.cycleRounds) {
      if (session.cycleTarget == null) session.cycleTarget = suggestTarget(session).target;
      target = session.cycleTarget;
    } else {
      if (session.bonusTarget == null) session.bonusTarget = suggestTarget(session).target;
      target = session.bonusTarget;
    }
    const gen = generateNextRound(session.playerIds, session.courts, session.rounds);
    gen.courts.forEach((c) => { c.target = target; });
    session.pendingRound = gen;
    saveData(data);
  }
  return session.pendingRound;
}

function render() {
  root.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  document.getElementById('nav-standings').style.display =
    activeSession() || data.sessions.length ? 'inline-block' : 'none';
  document.getElementById('nav-history').style.display =
    data.sessions.some((s) => s.ended) ? 'inline-block' : 'none';

  if (screen === 'setup') renderSetup();
  if (screen === 'round') renderRound();
  if (screen === 'standings') renderStandings();
  if (screen === 'history') renderHistory();
}

function renderSetup() {
  const el = document.getElementById('screen-setup');
  const s = data.settings;
  el.innerHTML = `
    <div class="panel">
      <h2>Today's Players</h2>
      <div id="roster-list" class="roster-list"></div>
      <form id="add-player-form" class="row">
        <input id="new-player-name" type="text" placeholder="Add player name" autocomplete="off" />
        <button type="submit">Add</button>
      </form>
    </div>

    <div class="panel">
      <h2>Session Settings</h2>
      <label>Start time
        <input id="set-start" type="time" value="${nowTimeStr()}" />
      </label>
      <label>Duration (minutes)
        <input id="set-duration" type="number" min="10" step="5" value="90" />
      </label>
      <details>
        <summary>Advanced</summary>
        <label>Courts available
          <input id="set-courts" type="number" min="1" value="${suggestedCourts(selectedIds.size)}" />
        </label>
        <p class="muted courts-hint">Auto: 1 court for 1–7 players, 2 for 8–11, +1 court per 4 more. Edit to override.</p>
        <label>Default point target
          <input id="set-target" type="number" min="5" value="${s.pointTarget}" />
        </label>
        <label>Win bonus
          <input id="set-bonus" type="number" min="0" value="${s.winBonus}" />
        </label>
        <label>Pace (seconds per point)
          <input id="set-pace" type="number" min="10" value="${s.secPerPoint}" />
        </label>
      </details>
      <p id="setup-warning" class="warning"></p>
      <button id="start-session-btn" class="primary">Start Session</button>
    </div>

    ${renderPastSessions()}
  `;

  const rosterList = document.getElementById('roster-list');
  rosterList.innerHTML = data.players
    .map((p) => {
      if (p.id === renamingPlayerId) {
        return `
        <span class="roster-item roster-item-editing">
          <input type="text" class="rename-input" data-id="${p.id}" value="${escapeHtml(p.name)}" />
        </span>`;
      }
      return `
      <span class="roster-item">
        <label class="roster-item-toggle">
          <input type="checkbox" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} />
          <span>${escapeHtml(p.name)}</span>
        </label>
        <button type="button" class="rename-btn" data-id="${p.id}" aria-label="Rename ${escapeHtml(p.name)}">✏️</button>
      </span>`;
    })
    .join('') || '<p class="muted">No players yet — add some below.</p>';

  rosterList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      const courtsInput = document.getElementById('set-courts');
      if (courtsInput) courtsInput.value = suggestedCourts(selectedIds.size);
    });
  });

  rosterList.querySelectorAll('.rename-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      renamingPlayerId = btn.dataset.id;
      renderSetup();
    });
  });

  const renameInput = rosterList.querySelector('.rename-input');
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
    const commit = () => {
      const name = renameInput.value.trim();
      const player = getPlayer(renameInput.dataset.id);
      if (name && player) player.name = name;
      renamingPlayerId = null;
      saveData(data);
      renderSetup();
    };
    renameInput.addEventListener('blur', commit);
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') renameInput.blur();
      if (e.key === 'Escape') { renamingPlayerId = null; renderSetup(); }
    });
  }

  el.querySelectorAll('.view-past').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewingSessionId = btn.dataset.id;
      screen = 'standings';
      render();
    });
  });

  el.querySelectorAll('.delete-session-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = data.sessions.find((s) => s.id === btn.dataset.id);
      if (!session) return;
      const d = new Date(session.date).toLocaleDateString();
      if (!confirm(`Delete the session from ${d}? This can't be undone.`)) return;
      data.sessions = data.sessions.filter((s) => s.id !== btn.dataset.id);
      saveData(data);
      renderSetup();
    });
  });

  document.getElementById('add-player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('new-player-name');
    const name = input.value.trim();
    if (!name) return;
    const id = uid();
    data.players.push({ id, name });
    selectedIds.add(id);
    saveData(data);
    renderSetup();
  });

  document.getElementById('start-session-btn').addEventListener('click', () => {
    const courts = parseInt(document.getElementById('set-courts').value, 10) || 1;
    const durationMin = parseInt(document.getElementById('set-duration').value, 10) || 60;
    const startLabel = document.getElementById('set-start').value;
    const pointTarget = parseInt(document.getElementById('set-target').value, 10) || 21;
    const winBonus = parseInt(document.getElementById('set-bonus').value, 10) || 0;
    const secPerPoint = parseInt(document.getElementById('set-pace').value, 10) || 45;
    const playerIds = [...selectedIds];

    const warning = document.getElementById('setup-warning');
    if (playerIds.length < 4) {
      warning.textContent = 'Select at least 4 players to start.';
      return;
    }
    warning.textContent = '';

    data.settings = { courts, pointTarget, winBonus, secPerPoint };
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      startLabel,
      durationMin,
      courts,
      pointTarget,
      winBonus,
      secPerPoint,
      playerIds,
      rounds: [],
      pendingRound: null,
      startedAt: Date.now(),
      ended: false,
    };
    data.sessions.push(session);
    saveData(data);
    screen = 'round';
    render();
  });
}

function renderPastSessions() {
  const past = data.sessions.filter((s) => s.ended);
  if (!past.length) return '';
  const items = past
    .slice()
    .reverse()
    .map((s) => {
      const standings = computeStandings(s);
      const top = standings[0];
      const d = new Date(s.date);
      return `<li class="past-list-item">
        <button class="link view-past" data-id="${s.id}">${d.toLocaleDateString()} — ${s.playerIds.length} players — top: ${top ? escapeHtml(top.name) : '-'}</button>
        <button type="button" class="delete-session-btn" data-id="${s.id}" aria-label="Delete session">🗑️</button>
      </li>`;
    })
    .join('');
  return `<div class="panel"><h2>Past Sessions</h2><ul class="past-list">${items}</ul></div>`;
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderRound() {
  const session = activeSession();
  const el = document.getElementById('screen-round');
  if (!session) {
    screen = 'setup';
    render();
    return;
  }
  const round = ensurePendingRound(session);
  const info = suggestTarget(session);
  const roundNum = session.rounds.length + 1;
  const inMainCycle = roundNum <= session.cycleRounds;
  const rotationLabel = inMainCycle
    ? `Rotation ${roundNum}/${session.cycleRounds}`
    : `Bonus round ${roundNum - session.cycleRounds}`;

  const courtCards = round.courts
    .map(
      (c) => `
    <div class="court-card">
      <h3>Court ${c.court}</h3>
      <div class="team">
        <span>${c.teamA.map(getNameHtml).join(' &amp; ')}</span>
        <input type="number" min="0" class="score-input" data-court="${c.court}" data-team="A" placeholder="0" />
      </div>
      <div class="vs">vs</div>
      <div class="team">
        <span>${c.teamB.map(getNameHtml).join(' &amp; ')}</span>
        <input type="number" min="0" class="score-input" data-court="${c.court}" data-team="B" placeholder="0" />
      </div>
    </div>`
    )
    .join('');

  const sitOutText = round.sitOuts.length
    ? `Sitting out: ${round.sitOuts.map(getNameHtml).join(', ')}`
    : '';

  const cycleBanner = info.cycleComplete
    ? `<p class="banner">Full rotation complete! ~${Math.round(info.remainingMin)} min left — play a bonus round or end the session.</p>`
    : '';

  el.innerHTML = `
    <div class="panel">
      <h2>Round ${roundNum} <span class="badge">${rotationLabel}</span></h2>
      <p class="muted">Elapsed ${Math.round(info.elapsedMin)} / ${session.durationMin} min</p>
      ${cycleBanner}
      <label>Target points this round
        <input id="round-target" type="number" min="5" value="${round.courts[0]?.target ?? info.target}" />
      </label>
      <p class="muted">${sitOutText}</p>
    </div>
    <div class="courts">${courtCards}</div>
    <button id="save-round-btn" class="primary">Save Round &amp; Next</button>
    <button id="end-session-btn" class="secondary">End Session</button>
    <p id="round-warning" class="warning"></p>
  `;

  document.getElementById('round-target').addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || round.courts[0]?.target;
    round.courts.forEach((c) => { c.target = val; });
    if (inMainCycle) session.cycleTarget = val;
    else session.bonusTarget = val;
    saveData(data);
  });

  document.getElementById('save-round-btn').addEventListener('click', () => {
    const warning = document.getElementById('round-warning');
    const scores = {};
    let valid = true;
    round.courts.forEach((c) => {
      const a = el.querySelector(`.score-input[data-court="${c.court}"][data-team="A"]`).value;
      const b = el.querySelector(`.score-input[data-court="${c.court}"][data-team="B"]`).value;
      if (a === '' || b === '') valid = false;
      scores[c.court] = { a: parseInt(a, 10), b: parseInt(b, 10) };
    });
    if (!valid) {
      warning.textContent = 'Enter both scores for every court.';
      return;
    }
    round.courts.forEach((c) => {
      c.scoreA = scores[c.court].a;
      c.scoreB = scores[c.court].b;
    });
    session.rounds.push(round);
    session.pendingRound = null;
    saveData(data);
    render();
  });

  document.getElementById('end-session-btn').addEventListener('click', () => {
    session.ended = true;
    session.pendingRound = null;
    saveData(data);
    viewingSessionId = session.id;
    screen = 'standings';
    render();
  });
}

function renderStandings() {
  const session = data.sessions.find((s) => s.id === viewingSessionId) || activeSession();
  const el = document.getElementById('screen-standings');
  if (!session) {
    el.innerHTML = '<p class="muted">No session yet.</p>';
    return;
  }
  const standings = computeStandings(session);
  const isActive = !session.ended;

  const rows = standings
    .map(
      (p) => `
    <tr>
      <td><span class="rank-badge${p.rank <= 3 ? ` rank-${p.rank}` : ''}">${p.rank}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td><strong>${p.points}</strong><span class="pts-breakdown">${p.gamePts}+${p.bonusPts}</span></td>
      <td>${p.wins}</td>
    </tr>`
    )
    .join('');

  const history = session.rounds
    .map(
      (r, idx) => `
    <li class="history-round">
      <strong>Round ${idx + 1}</strong>
      ${r.courts
        .map(
          (c) => `
        <div class="history-court">
          <span>${c.teamA.map(getNameHtml).join(' &amp; ')}</span>
          <input type="number" class="edit-score" data-round="${idx}" data-court="${c.court}" data-team="A" value="${c.scoreA}" />
          -
          <input type="number" class="edit-score" data-round="${idx}" data-court="${c.court}" data-team="B" value="${c.scoreB}" />
          <span>${c.teamB.map(getNameHtml).join(' &amp; ')}</span>
        </div>`
        )
        .join('')}
    </li>`
    )
    .join('');

  el.innerHTML = `
    <div class="panel">
      <h2>Standings</h2>
      <div class="table-wrap">
        <table class="standings-table">
          <thead><tr><th>#</th><th>Player</th><th>Total</th><th>W</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button id="share-btn" class="whatsapp">📤 Share to WhatsApp</button>
      ${isActive ? '<button id="back-to-round-btn" class="primary">Back to Round</button>' : '<button id="back-home-btn" class="primary">Back to Home</button>'}
    </div>

    <div class="panel">
      <h2>Round History</h2>
      <ul class="history-list">${history || '<li class="muted">No rounds played yet.</li>'}</ul>
      ${history ? '<button id="save-edits-btn" class="secondary">Save Score Edits</button>' : ''}
    </div>
  `;

  document.getElementById('share-btn').addEventListener('click', () => {
    const text = buildShareText(session);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });

  const backRound = document.getElementById('back-to-round-btn');
  if (backRound) backRound.addEventListener('click', () => { screen = 'round'; render(); });

  const backHome = document.getElementById('back-home-btn');
  if (backHome) backHome.addEventListener('click', () => { viewingSessionId = null; screen = 'setup'; render(); });

  const saveEdits = document.getElementById('save-edits-btn');
  if (saveEdits) {
    saveEdits.addEventListener('click', () => {
      el.querySelectorAll('.edit-score').forEach((input) => {
        const roundIdx = parseInt(input.dataset.round, 10);
        const court = parseInt(input.dataset.court, 10);
        const team = input.dataset.team;
        const value = parseInt(input.value, 10);
        const c = session.rounds[roundIdx].courts.find((x) => x.court === court);
        if (team === 'A') c.scoreA = value;
        else c.scoreB = value;
      });
      saveData(data);
      render();
    });
  }
}

function renderHistory() {
  const el = document.getElementById('screen-history');
  const { leaderboard, endedSessions, perSessionPoints } = computeAllTimeStats();

  if (!leaderboard.length) {
    el.innerHTML = '<div class="panel"><h2>All-Time History</h2><p class="muted">No completed sessions yet.</p></div>';
    return;
  }

  const rows = leaderboard
    .map(
      (p) => `
    <tr>
      <td><span class="rank-badge${p.rank <= 3 ? ` rank-${p.rank}` : ''}">${p.rank}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.sessions}</td>
      <td>${p.wins}</td>
      <td><strong>${p.points}</strong></td>
    </tr>`
    )
    .join('');

  el.innerHTML = `
    <div class="panel">
      <h2>All-Time Leaderboard</h2>
      <div class="table-wrap">
        <table class="standings-table">
          <thead><tr><th>#</th><th>Player</th><th>Sessions</th><th>Wins</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button id="history-share-btn" class="whatsapp">📤 Share to WhatsApp</button>
    </div>

    <div class="panel">
      <h2>Total Points</h2>
      <div id="chart-total-points"></div>
    </div>

    <div class="panel">
      <h2>Win Rate</h2>
      <div id="chart-win-rate"></div>
    </div>

    <div class="panel">
      <h2>Points by Session</h2>
      <div id="chart-trend"></div>
    </div>
  `;

  renderBarChart(
    document.getElementById('chart-total-points'),
    leaderboard.map((p) => ({ id: p.id, label: p.name, value: p.points })),
    { formatValue: (v) => `${v} pts` }
  );

  const winRateItems = leaderboard
    .filter((p) => p.roundsPlayed > 0)
    .map((p) => ({ id: p.id, label: p.name, value: Math.round((p.wins / p.roundsPlayed) * 100) }))
    .sort((a, b) => b.value - a.value);
  renderBarChart(document.getElementById('chart-win-rate'), winRateItems, { formatValue: (v) => `${v}%` });

  const seriesColors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
  const top = leaderboard.slice(0, 5);
  const series = top.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: seriesColors[i % seriesColors.length],
    points: perSessionPoints[p.id],
  }));
  const xLabels = endedSessions.map((s) => new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  renderLineChart(document.getElementById('chart-trend'), series, xLabels);

  document.getElementById('history-share-btn').addEventListener('click', () => {
    const text = buildAllTimeShareText(leaderboard);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });
}

document.getElementById('nav-home').addEventListener('click', () => {
  viewingSessionId = null;
  screen = activeSession() ? 'round' : 'setup';
  render();
});
document.getElementById('nav-standings').addEventListener('click', () => {
  if (!viewingSessionId) viewingSessionId = activeSession()?.id || (data.sessions[data.sessions.length - 1]?.id ?? null);
  screen = 'standings';
  render();
});
document.getElementById('nav-history').addEventListener('click', () => {
  screen = 'history';
  render();
});

screen = activeSession() ? 'round' : 'setup';
render();
