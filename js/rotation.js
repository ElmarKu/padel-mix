function pickSitOuts(playerIds, sitOutCounts, lastSitOutRound, currentRound, numSitOuts) {
  if (numSitOuts <= 0) return [];
  const sorted = [...playerIds].sort((a, b) => {
    const countDiff = (sitOutCounts[a] || 0) - (sitOutCounts[b] || 0);
    if (countDiff !== 0) return countDiff;
    const lastA = lastSitOutRound[a] ?? -1;
    const lastB = lastSitOutRound[b] ?? -1;
    return lastB - lastA;
  });
  return sorted.slice(0, numSitOuts);
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function randomShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignmentCost(courts, partnerCounts, opponentCounts) {
  let cost = 0;
  for (const court of courts) {
    const [a, b, c, d] = court;
    const pAB = partnerCounts[pairKey(a, b)] || 0;
    const pCD = partnerCounts[pairKey(c, d)] || 0;
    cost += pAB * pAB * 10 + pCD * pCD * 10;
    for (const x of [a, b]) {
      for (const y of [c, d]) {
        cost += (opponentCounts[pairKey(x, y)] || 0);
      }
    }
  }
  return cost;
}

function generateCourts(players, numCourts, partnerCounts, opponentCounts, trials = 300) {
  let best = null;
  let bestCost = Infinity;
  for (let t = 0; t < trials; t++) {
    const shuffled = randomShuffle(players);
    const courts = [];
    for (let i = 0; i < numCourts; i++) {
      courts.push(shuffled.slice(i * 4, i * 4 + 4));
    }
    const cost = assignmentCost(courts, partnerCounts, opponentCounts);
    if (cost < bestCost) {
      bestCost = cost;
      best = courts;
      if (bestCost === 0) break;
    }
  }
  return best.map(([a, b, c, d]) => ({ teamA: [a, b], teamB: [c, d] }));
}

function buildHistoryCounts(pastRounds) {
  const partnerCounts = {};
  const opponentCounts = {};
  for (const round of pastRounds) {
    for (const court of round.courts) {
      const [a, b] = court.teamA;
      const [c, d] = court.teamB;
      partnerCounts[pairKey(a, b)] = (partnerCounts[pairKey(a, b)] || 0) + 1;
      partnerCounts[pairKey(c, d)] = (partnerCounts[pairKey(c, d)] || 0) + 1;
      for (const x of [a, b]) {
        for (const y of [c, d]) {
          opponentCounts[pairKey(x, y)] = (opponentCounts[pairKey(x, y)] || 0) + 1;
        }
      }
    }
  }
  return { partnerCounts, opponentCounts };
}

function buildSitOutState(playerIds, pastRounds) {
  const sitOutCounts = {};
  const lastSitOutRound = {};
  playerIds.forEach((id) => { sitOutCounts[id] = 0; });
  pastRounds.forEach((round, idx) => {
    (round.sitOuts || []).forEach((id) => {
      sitOutCounts[id] = (sitOutCounts[id] || 0) + 1;
      lastSitOutRound[id] = idx;
    });
  });
  return { sitOutCounts, lastSitOutRound };
}

function generateNextRound(playerIds, numCourtsRequested, pastRounds) {
  const courtsUsed = Math.min(numCourtsRequested, Math.floor(playerIds.length / 4));
  const playingCount = courtsUsed * 4;
  const numSitOuts = playerIds.length - playingCount;

  const { sitOutCounts, lastSitOutRound } = buildSitOutState(playerIds, pastRounds);
  const currentRound = pastRounds.length;
  const sitOuts = pickSitOuts(playerIds, sitOutCounts, lastSitOutRound, currentRound, numSitOuts);
  const sitOutSet = new Set(sitOuts);
  const playing = playerIds.filter((id) => !sitOutSet.has(id));

  const { partnerCounts, opponentCounts } = buildHistoryCounts(pastRounds);
  const courts = courtsUsed > 0 ? generateCourts(playing, courtsUsed, partnerCounts, opponentCounts) : [];

  return {
    courts: courts.map((c, i) => ({ court: i + 1, ...c, scoreA: null, scoreB: null, target: null })),
    sitOuts,
  };
}

function estimateCycleRounds(totalPlayers, courtsUsed) {
  if (courtsUsed <= 0) return 1;
  const totalPairs = (totalPlayers * (totalPlayers - 1)) / 2;
  const pairsPerRound = courtsUsed * 2;
  return Math.max(1, Math.ceil(totalPairs / pairsPerRound));
}

export { generateNextRound, estimateCycleRounds, pairKey };
