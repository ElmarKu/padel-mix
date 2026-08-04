const STORAGE_KEY = 'padelmix_data_v1';

const DEFAULT_SETTINGS = {
  courts: 2,
  pointTarget: 21,
  winBonus: 3,
  secPerPoint: 45,
};

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { players: [], settings: { ...DEFAULT_SETTINGS }, sessions: [] };
  }
  const data = JSON.parse(raw);
  data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (!data.sessions) data.sessions = [];
  if (!data.players) data.players = [];
  return data;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export { loadData, saveData, uid, DEFAULT_SETTINGS };
