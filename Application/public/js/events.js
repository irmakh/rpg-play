'use strict';

let masterPw = '';
let _speedsManuallyEdited = false;
let eventsData = {
  challenges: [],
  results: [],
  travel: { pace: 'normal', speedPerMin: '300 ft', speedPerHour: '3 miles', speedPerDay: '24 miles', distances: [] }
};

const PACE_DEFAULTS = {
  slow:   { speedPerMin: '200 ft', speedPerHour: '2 miles', speedPerDay: '18 miles' },
  normal: { speedPerMin: '300 ft', speedPerHour: '3 miles', speedPerDay: '24 miles' },
  fast:   { speedPerMin: '400 ft', speedPerHour: '4 miles', speedPerDay: '30 miles' },
};

function genId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  if (!pw) return;
  try {
    const res = await fetch('/api/characters', { headers: { 'X-Master-Password': pw } });
    if (!res.ok) { document.getElementById('gate-err').textContent = 'Wrong password.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    applyTheme(localStorage.getItem('ev-theme') || 'dark-gold');
    await loadEvents();
  } catch { document.getElementById('gate-err').textContent = 'Connection error.'; }
}

// Auto-login if DM already authenticated on another DM screen this session
(async function tryAutoLogin() {
  const saved = sessionStorage.getItem('dmMasterPw');
  if (!saved) return;
  document.getElementById('gate-pw').value = saved;
  await authenticate();
})();

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('ev-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}

// ── Load / Save ───────────────────────────────────────────────────────────────
async function loadEvents() {
  setSaveStatus('Loading…');
  try {
    const res = await fetch('/api/events-data?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) { setSaveStatus('Load failed (' + res.status + ')', true); renderAll(); return; }
    const data = await res.json();
    if (data && typeof data === 'object') {
      eventsData.challenges = Array.isArray(data.challenges) ? data.challenges : [];
      eventsData.results    = Array.isArray(data.results)    ? data.results    : [];
      const t = data.travel;
      if (t && typeof t === 'object') {
        eventsData.travel.pace         = t.pace         || eventsData.travel.pace;
        eventsData.travel.speedPerMin  = t.speedPerMin  ?? eventsData.travel.speedPerMin;
        eventsData.travel.speedPerHour = t.speedPerHour ?? eventsData.travel.speedPerHour;
        eventsData.travel.speedPerDay  = t.speedPerDay  ?? eventsData.travel.speedPerDay;
        eventsData.travel.distances    = Array.isArray(t.distances) ? t.distances : [];
      }
    }
    _speedsManuallyEdited = false;
    setSaveStatus('');
  } catch (e) { setSaveStatus('Load error', true); console.error('loadEvents:', e); }
  renderAll();
}

let saveTimer = null;
function debounceSave() {
  clearTimeout(saveTimer);
  setSaveStatus('saving…');
  saveTimer = setTimeout(saveEvents, 800);
}

async function saveEvents() {
  clearTimeout(saveTimer);
  try {
    const res = await fetch('/api/events-data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(eventsData)
    });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.ok === true;
    setSaveStatus(ok ? 'Saved' : ('Save failed' + (json.error ? ': ' + json.error : '')), !ok);
    if (ok) setTimeout(() => setSaveStatus(''), 2000);
  } catch (e) { setSaveStatus('Save failed', true); console.error('saveEvents:', e); }
}

function setSaveStatus(msg, isErr) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--err)' : 'var(--txd)';
}

function renderAll() {
  renderChallenges();
  renderResults();
  renderTravel();
}

// ── Challenges ────────────────────────────────────────────────────────────────
const STATUS_CYCLE = { pending: 'completed', completed: 'failed', failed: 'pending' };
const STATUS_LABEL = { pending: '⬤ Pending', completed: '✓ Done', failed: '✗ Failed' };

function renderChallenges() {
  const el = document.getElementById('challenge-list');
  if (!el) return;
  const items = eventsData.challenges;
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txd);padding:4px 0">No challenges yet.</div>';
    return;
  }
  el.innerHTML = items.map((c, i) => `
    <div class="ch-row">
      <textarea rows="2" placeholder="Describe the challenge…" oninput="updateChallengeText('${c.id}',this.value)" onchange="debounceSave()">${esc(c.text)}</textarea>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <button class="ch-status ${c.status}" onclick="cycleStatus('${c.id}')">${STATUS_LABEL[c.status] || STATUS_LABEL.pending}</button>
        <button class="btn danger sm" onclick="deleteChallenge('${c.id}')">✕</button>
      </div>
    </div>`).join('');
}

function addChallenge() {
  eventsData.challenges.push({ id: genId(), text: '', status: 'pending' });
  renderChallenges();
  debounceSave();
  // Focus the new textarea
  const rows = document.querySelectorAll('#challenge-list .ch-row textarea');
  if (rows.length) rows[rows.length - 1].focus();
}

function deleteChallenge(id) {
  eventsData.challenges = eventsData.challenges.filter(c => c.id !== id);
  renderChallenges();
  debounceSave();
}

function updateChallengeText(id, val) {
  const c = eventsData.challenges.find(c => c.id === id);
  if (c) c.text = val;
}

function cycleStatus(id) {
  const c = eventsData.challenges.find(c => c.id === id);
  if (!c) return;
  c.status = STATUS_CYCLE[c.status] || 'pending';
  renderChallenges();
  debounceSave();
}

// ── Results ───────────────────────────────────────────────────────────────────
function renderResults() {
  const el = document.getElementById('result-list');
  if (!el) return;
  const items = eventsData.results;
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txd);padding:4px 0">No results yet.</div>';
    return;
  }
  el.innerHTML = items.map((r) => `
    <div class="res-row">
      <textarea rows="2" placeholder="Describe the result…" oninput="updateResultText('${r.id}',this.value)" onchange="debounceSave()">${esc(r.text)}</textarea>
      <button class="btn danger sm" onclick="deleteResult('${r.id}')">✕</button>
    </div>`).join('');
}

function addResult() {
  eventsData.results.push({ id: genId(), text: '' });
  renderResults();
  debounceSave();
  const rows = document.querySelectorAll('#result-list .res-row textarea');
  if (rows.length) rows[rows.length - 1].focus();
}

function deleteResult(id) {
  eventsData.results = eventsData.results.filter(r => r.id !== id);
  renderResults();
  debounceSave();
}

function updateResultText(id, val) {
  const r = eventsData.results.find(r => r.id === id);
  if (r) r.text = val;
}

// ── Travel ────────────────────────────────────────────────────────────────────
function renderTravel() {
  const t = eventsData.travel;
  // Pace buttons
  ['slow', 'normal', 'fast'].forEach(p => {
    const btn = document.getElementById('pace-' + p);
    if (btn) btn.classList.toggle('active', t.pace === p);
  });
  // Speed fields — only update if not focused (avoid clobbering user typing)
  const minEl  = document.getElementById('speed-min');
  const hourEl = document.getElementById('speed-hour');
  const dayEl  = document.getElementById('speed-day');
  if (minEl  && document.activeElement !== minEl)  minEl.value  = t.speedPerMin  || '';
  if (hourEl && document.activeElement !== hourEl) hourEl.value = t.speedPerHour || '';
  if (dayEl  && document.activeElement !== dayEl)  dayEl.value  = t.speedPerDay  || '';
  // Distances
  renderDistances();
}

function setPace(pace) {
  eventsData.travel.pace = pace;
  if (!_speedsManuallyEdited) {
    const defaults = PACE_DEFAULTS[pace];
    eventsData.travel.speedPerMin  = defaults.speedPerMin;
    eventsData.travel.speedPerHour = defaults.speedPerHour;
    eventsData.travel.speedPerDay  = defaults.speedPerDay;
  }
  renderTravel();
  debounceSave();
}

function updateSpeed(field, val) {
  eventsData.travel[field] = val;
  _speedsManuallyEdited = true;
  debounceSave();
}

function renderDistances() {
  const el = document.getElementById('distance-list');
  if (!el) return;
  const dists = eventsData.travel.distances || [];
  if (!dists.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txd);padding:4px 0">No distances logged yet.</div>';
    return;
  }
  el.innerHTML = dists.map(d => `
    <div class="dist-row">
      <input type="text" value="${esc(d.label)}" placeholder="Label (e.g. To Neverwinter)…"
        oninput="updateDistLabel('${d.id}',this.value)" onchange="debounceSave()">
      <input type="text" class="dist-val" value="${esc(d.value)}" placeholder="Distance…"
        oninput="updateDistValue('${d.id}',this.value)" onchange="debounceSave()">
      <button class="btn danger sm" onclick="deleteDist('${d.id}')">✕</button>
    </div>`).join('');
}

function addDistance() {
  if (!eventsData.travel.distances) eventsData.travel.distances = [];
  eventsData.travel.distances.push({ id: genId(), label: '', value: '' });
  renderDistances();
  debounceSave();
  const inputs = document.querySelectorAll('#distance-list .dist-row input');
  if (inputs.length) inputs[inputs.length - 2].focus();
}

function deleteDist(id) {
  eventsData.travel.distances = eventsData.travel.distances.filter(d => d.id !== id);
  renderDistances();
  debounceSave();
}

function updateDistLabel(id, val) {
  const d = eventsData.travel.distances.find(d => d.id === id);
  if (d) d.label = val;
}

function updateDistValue(id, val) {
  const d = eventsData.travel.distances.find(d => d.id === id);
  if (d) d.value = val;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('gate').style.display !== 'none') authenticate();
});
