const STORAGE_KEY = 'padelmix_data_v1';

const DEFAULT_SETTINGS = {
  courts: 2,
  winBonus: 3,
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyGroup(id, name) {
  return { id, name, players: [], settings: { ...DEFAULT_SETTINGS }, sessions: [] };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { groups: [], activeGroupId: null };
  }
  const data = JSON.parse(raw);

  if (!Array.isArray(data.groups)) {
    const migrated = emptyGroup(uid(), 'My Group');
    migrated.players = data.players || [];
    migrated.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    migrated.sessions = data.sessions || [];
    return { groups: [migrated], activeGroupId: migrated.id };
  }

  data.groups.forEach((g) => {
    g.settings = { ...DEFAULT_SETTINGS, ...g.settings };
    if (!g.players) g.players = [];
    if (!g.sessions) g.sessions = [];
  });
  if (data.activeGroupId === undefined) data.activeGroupId = null;
  return data;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export { loadData, saveData, uid, DEFAULT_SETTINGS };
