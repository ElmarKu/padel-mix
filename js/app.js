import { loadData, saveData, uid } from './state.js';
import { generateNextRound, estimateCycleRounds } from './rotation.js';

let data = loadData();
let screen = 'setup';
let selectedIds = new Set(
  data.sessions.length
    ? data.sessions[data.sessions.length - 1].playerIds.filter((id) => data.players.some((p) => p.id === id))
    : data.players.map((p) => p.id)
);
let viewingSessionId = null;

const root = document.getElementById('app');

function getPlayer(id) {
  return data.players.find((p) => p.id === id);
}
function getName(id) {
  return getPlayer(id)?.name || 'Unknown';
}
function activeSession() {
  return data.sessions.find((s) => !s.ended) || null;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function computeStandings(session) {
  const stats = {};
  session.playerIds.forEach((id) => {
    stats[id] = { id, name: getName(id), points: 0, roundsPlayed: 0, wins: 0 };
  });
  session.rounds.forEach((round) => {
    round.courts.forEach((court) => {
      if (court.scoreA == null || court.scoreB == null) return;
      const aWin = court.scoreA > court.scoreB;
      const bWin = court.scoreB > court.scoreA;
      court.teamA.forEach((id) => {
        if (!stats[id]) return;
        stats[id].points += court.scoreA + (aWin ? session.winBonus : 0);
        stats[id].roundsPlayed += 1;
        if (aWin) stats[id].wins += 1;
      });
      court.teamB.forEach((id) => {
        if (!stats[id]) return;
        stats[id].points += court.scoreB + (bWin ? session.winBonus : 0);
        stats[id].roundsPlayed += 1;
        if (bWin) stats[id].wins += 1;
      });
    });
  });
  return Object.values(stats).sort((a, b) => b.points - a.points);
}

function suggestTarget(session) {
  const total = session.playerIds.length;
  const courtsUsed = Math.min(session.courts, Math.floor(total / 4));
  const cycleRounds = estimateCycleRounds(total, courtsUsed);
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
  if (!session.pendingRound) {
    const { target } = suggestTarget(session);
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

  if (screen === 'setup') renderSetup();
  if (screen === 'round') renderRound();
  if (screen === 'standings') renderStandings();
}

function renderSetup() {
  const el = document.getElementById('screen-setup');
  const s = data.settings;
  el.innerHTML = `
    <h2>Today's Players</h2>
    <div id="roster-list" class="roster-list"></div>
    <form id="add-player-form" class="row">
      <input id="new-player-name" type="text" placeholder="Add player name" autocomplete="off" />
      <button type="submit">Add</button>
    </form>

    <h2>Session Settings</h2>
    <label>Courts available
      <input id="set-courts" type="number" min="1" value="${s.courts}" />
    </label>
    <label>Start time
      <input id="set-start" type="time" value="${nowTimeStr()}" />
    </label>
    <label>Duration (minutes)
      <input id="set-duration" type="number" min="10" step="5" value="90" />
    </label>
    <details>
      <summary>Advanced</summary>
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

    ${renderPastSessions()}
  `;

  const rosterList = document.getElementById('roster-list');
  rosterList.innerHTML = data.players
    .map(
      (p) => `
      <label class="roster-item">
        <input type="checkbox" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} />
        ${p.name}
      </label>`
    )
    .join('') || '<p class="muted">No players yet — add some below.</p>';

  rosterList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
  });

  el.querySelectorAll('.view-past').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewingSessionId = btn.dataset.id;
      screen = 'standings';
      render();
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
      return `<li><button class="link view-past" data-id="${s.id}">${d.toLocaleDateString()} — ${s.playerIds.length} players — top: ${top ? top.name : '-'}</button></li>`;
    })
    .join('');
  return `<h2>Past Sessions</h2><ul class="past-list">${items}</ul>`;
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

  const courtCards = round.courts
    .map(
      (c) => `
    <div class="court-card">
      <h3>Court ${c.court}</h3>
      <div class="team">
        <span>${c.teamA.map(getName).join(' & ')}</span>
        <input type="number" min="0" class="score-input" data-court="${c.court}" data-team="A" placeholder="0" />
      </div>
      <div class="vs">vs</div>
      <div class="team">
        <span>${c.teamB.map(getName).join(' & ')}</span>
        <input type="number" min="0" class="score-input" data-court="${c.court}" data-team="B" placeholder="0" />
      </div>
    </div>`
    )
    .join('');

  const sitOutText = round.sitOuts.length
    ? `Sitting out: ${round.sitOuts.map(getName).join(', ')}`
    : '';

  const cycleBanner = info.cycleComplete
    ? `<p class="banner">Full rotation complete! ~${Math.round(info.remainingMin)} min left — play a bonus round or end the session.</p>`
    : '';

  el.innerHTML = `
    <h2>Round ${roundNum}</h2>
    <p class="muted">Elapsed ${Math.round(info.elapsedMin)} / ${session.durationMin} min</p>
    ${cycleBanner}
    <label>Target points this round
      <input id="round-target" type="number" min="5" value="${round.courts[0]?.target ?? info.target}" />
    </label>
    <p class="muted">${sitOutText}</p>
    <div class="courts">${courtCards}</div>
    <button id="save-round-btn" class="primary">Save Round &amp; Next</button>
    <button id="end-session-btn" class="secondary">End Session</button>
    <p id="round-warning" class="warning"></p>
  `;

  document.getElementById('round-target').addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || info.target;
    round.courts.forEach((c) => { c.target = val; });
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
      (p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${p.name}</td>
      <td>${p.points}</td>
      <td>${p.wins}</td>
      <td>${p.roundsPlayed}</td>
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
          <span>${c.teamA.map(getName).join(' & ')}</span>
          <input type="number" class="edit-score" data-round="${idx}" data-court="${c.court}" data-team="A" value="${c.scoreA}" />
          -
          <input type="number" class="edit-score" data-round="${idx}" data-court="${c.court}" data-team="B" value="${c.scoreB}" />
          <span>${c.teamB.map(getName).join(' & ')}</span>
        </div>`
        )
        .join('')}
    </li>`
    )
    .join('');

  el.innerHTML = `
    <h2>Standings</h2>
    <table class="standings-table">
      <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Wins</th><th>Rounds</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${isActive ? '<button id="back-to-round-btn" class="primary">Back to Round</button>' : '<button id="back-home-btn" class="primary">Back to Home</button>'}
    <h2>Round History</h2>
    <ul class="history-list">${history || '<li class="muted">No rounds played yet.</li>'}</ul>
    ${history ? '<button id="save-edits-btn" class="secondary">Save Score Edits</button>' : ''}
  `;

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

screen = activeSession() ? 'round' : 'setup';
render();
