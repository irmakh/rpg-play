/* ── AI Dungeon Master — Frontend ─────────────────────────────────────────── */

// ── Game data constants ───────────────────────────────────────────────────────
const SKILL_NAMES = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'
];
const ABILITIES = ['str','dex','con','int','wis','cha'];
const ABILITY_LABELS = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
const SAVE_LABELS = { str:'Strength Save', dex:'Dexterity Save', con:'Constitution Save', int:'Intelligence Save', wis:'Wisdom Save', cha:'Charisma Save' };

// ── Application state ─────────────────────────────────────────────────────────
let state = {
  selectedChar:   null,   // { id, name, has_password }
  charPassword:   '',
  charData:       null,   // full data from server
  sessionId:      null,
  rollData:       null,   // { sk-0..17, save-str..cha, init, hpcur, hpmax }
  provider:       'openrouter',
  lmStudioUrl:    'http://localhost:1234',
  model:          '',
  apiKey:         '',
  selectedScenario: null,
  language:       'English',
  sidebarOpen:    true,
  sending:        false,
  sessionEnded:   false,
  currentSummary: '',     // summary text for current session
};

// ── Helper: abilityMod ────────────────────────────────────────────────────────
function abilityMod(score) {
  const v = parseInt(score) || 10;
  const m = Math.floor((v - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

// ── Helper: format modifier for display ───────────────────────────────────────
function fmtMod(val) {
  const n = parseInt(val) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

// ── Helper: roll dice notation "2d6", "1d20", etc. ───────────────────────────
function rollDice(notation) {
  const m = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return { total: 0, rolls: [], sides: 0, count: 0, flat: 0 };
  const count = parseInt(m[1]);
  const sides = parseInt(m[2]);
  const flat  = m[3] ? parseInt(m[3]) : 0;
  let total = flat;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    total += r;
  }
  return { total, rolls, sides, count, flat };
}

// ── API helpers ───────────────────────────────────────────────────────────────
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (state.charPassword) h['x-character-password'] = state.charPassword;
  return h;
}

async function apiFetch(url, opts = {}) {
  opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Screen navigation ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  // Lock body scroll on adventure screen so the header can't be pushed off-screen
  document.body.classList.toggle('adv-active', id === 'screen-adventure');
}

// ── Character selection screen ────────────────────────────────────────────────
async function loadCharacters() {
  const grid = document.getElementById('char-list');
  grid.innerHTML = '<div class="loading-msg">Loading characters…</div>';
  try {
    const chars = await apiFetch('/api/ai-dm/characters');
    if (!chars.length) { grid.innerHTML = '<div class="loading-msg">No characters found. Create a character first.</div>'; return; }
    grid.innerHTML = '';
    chars.forEach(c => {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.innerHTML = `
        <div class="char-portrait-wrap">
          <span class="char-portrait-placeholder">🧙</span>
        </div>
        <div class="char-card-name">${esc(c.name)}</div>
        ${c.has_password ? '<div class="char-card-lock">🔒 Password protected</div>' : ''}
      `;
      card.addEventListener('click', () => selectCharacter(c));
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = `<div class="error-msg">Failed to load characters: ${esc(e.message)}</div>`;
  }
}

function selectCharacter(c) {
  state.selectedChar = c;
  if (c.has_password) {
    showPasswordScreen(c);
  } else {
    state.charPassword = '';
    afterCharacterAuth();
  }
}

// ── Password screen ───────────────────────────────────────────────────────────
function showPasswordScreen(c) {
  document.getElementById('pw-char-name').textContent = c.name;
  document.getElementById('pw-input').value = '';
  document.getElementById('pw-error').style.display = 'none';
  showScreen('screen-password');
  document.getElementById('pw-input').focus();
}

document.getElementById('pw-cancel').addEventListener('click', () => {
  state.selectedChar = null;
  showScreen('screen-select');
});

async function submitPassword() {
  const pw = document.getElementById('pw-input').value.trim();
  if (!pw) return;
  state.charPassword = pw;
  try {
    await apiFetch(`/api/ai-dm/characters/${state.selectedChar.id}/data`);
    afterCharacterAuth();
  } catch (e) {
    state.charPassword = '';
    document.getElementById('pw-error').style.display = 'block';
  }
}

document.getElementById('pw-submit').addEventListener('click', submitPassword);
document.getElementById('pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitPassword(); });

// ── After authentication: load sessions and show setup ────────────────────────
async function afterCharacterAuth() {
  // Load full character data
  try {
    const charInfo = await apiFetch(`/api/ai-dm/characters/${state.selectedChar.id}/data`);
    state.charData = charInfo.data;
  } catch {}

  // Load recent sessions for this character
  await loadRecentSessions();

  showScreen('screen-select');
  document.querySelectorAll('.char-card').forEach(card => card.classList.remove('selected'));
  // Highlight selected card
  document.querySelectorAll('.char-card').forEach((card, i) => {
    if (card.querySelector('.char-card-name')?.textContent === state.selectedChar.name) {
      card.classList.add('selected');
    }
  });

  // Show "New Adventure" button in sessions area
  const wrap = document.getElementById('recent-sessions-wrap');
  wrap.style.display = 'block';
}

async function loadRecentSessions() {
  const list = document.getElementById('recent-sessions');
  list.innerHTML = '<div class="loading-msg">Loading…</div>';
  try {
    const sessions = await apiFetch(`/api/ai-dm/sessions/list/${state.selectedChar.id}`);
    list.innerHTML = '';

    // "New Adventure" button at top
    const newBtn = document.createElement('div');
    newBtn.className = 'session-row';
    newBtn.style.borderColor = 'var(--gold-dim)';
    newBtn.innerHTML = `<span style="font-size:18px">⚔️</span><span class="session-scenario">New Adventure</span><span class="session-meta">Choose a scenario and AI model</span>`;
    newBtn.addEventListener('click', openSetupScreen);
    list.appendChild(newBtn);

    sessions.forEach(s => {
      const row = document.createElement('div');
      const isEnded = s.status === 'ended';
      row.className = `session-row${isEnded ? ' ended' : ''}`;
      const date = new Date(s.startedAt).toLocaleDateString();
      row.innerHTML = `
        <span style="font-size:16px">${isEnded ? '📜' : '🟢'}</span>
        <div style="flex:1">
          <div class="session-scenario">${esc(s.scenarioName)}</div>
          <div class="session-meta">${esc(s.model)} · ${date}</div>
        </div>
        <span class="session-status ${s.status}">${s.status === 'active' ? 'Active' : 'Ended'}</span>
      `;
      row.addEventListener('click', () => {
        if (isEnded) openSessionDetail(s.id);
        else resumeSession(s.id);
      });
      list.appendChild(row);
    });

    if (!sessions.length) {
      const msg = document.createElement('div');
      msg.className = 'loading-msg';
      msg.textContent = 'No previous adventures. Start a new one!';
      list.appendChild(msg);
    }
  } catch (e) {
    list.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
}

// ── Setup screen ──────────────────────────────────────────────────────────────
async function openSetupScreen() {
  if (!state.selectedChar) return;
  document.getElementById('setup-char-name').textContent = state.selectedChar.name;
  state.selectedScenario = null;
  state.language = 'English';
  document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.lang-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === 'English'));
  document.getElementById('btn-start-adventure').disabled = true;

  // Load saved config
  try {
    const cfg = await apiFetch('/api/ai-dm/config');
    state.provider    = cfg.provider    || 'openrouter';
    state.lmStudioUrl = cfg.lmStudioUrl || 'http://localhost:1234';
    state.model       = cfg.model       || '';
    document.getElementById('lm-url').value = state.lmStudioUrl;
    if (cfg.hasApiKey) document.getElementById('or-apikey').placeholder = '(saved)';
    setProviderUI(state.provider);
  } catch {}

  await loadScenarios();
  showScreen('screen-setup');
}

function setProviderUI(provider) {
  state.provider = provider;
  document.querySelectorAll('.provider-tab').forEach(t => t.classList.toggle('active', t.dataset.provider === provider));
  document.getElementById('prov-lmstudio').style.display  = provider === 'lmstudio'   ? '' : 'none';
  document.getElementById('prov-openrouter').style.display = provider === 'openrouter' ? '' : 'none';
  document.getElementById('model-select').innerHTML = '<option value="">— click Load to fetch models —</option>';
  state.model = '';
  checkStartReady();
}

document.querySelectorAll('.provider-tab').forEach(t => {
  t.addEventListener('click', () => setProviderUI(t.dataset.provider));
});

document.querySelectorAll('.lang-tab').forEach(t => {
  t.addEventListener('click', () => {
    state.language = t.dataset.lang;
    document.querySelectorAll('.lang-tab').forEach(x => x.classList.toggle('active', x === t));
  });
});

document.getElementById('setup-back').addEventListener('click', () => showScreen('screen-select'));

// ── Model loading ─────────────────────────────────────────────────────────────
document.getElementById('btn-load-models').addEventListener('click', loadModels);

async function loadModels() {
  const btn = document.getElementById('btn-load-models');
  const sel = document.getElementById('model-select');
  const errEl = document.getElementById('models-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '…';
  sel.innerHTML = '<option>Loading…</option>';

  try {
    const lmUrl = document.getElementById('lm-url').value.trim();
    const apiKey = document.getElementById('or-apikey').value.trim();
    const params = new URLSearchParams({ provider: state.provider });
    if (state.provider === 'lmstudio') params.set('lmStudioUrl', lmUrl || 'http://localhost:1234');
    if (state.provider === 'openrouter' && apiKey) params.set('apiKey', apiKey);

    const models = await apiFetch(`/api/ai-dm/models?${params}`);
    sel.innerHTML = '';
    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
    } else {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        if (m.id === state.model) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!state.model && models.length) state.model = models[0].id;
    }
    checkStartReady();
  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load</option>';
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Load';
  }
}

document.getElementById('model-select').addEventListener('change', function() {
  state.model = this.value;
  checkStartReady();
});

// ── Scenario loading ──────────────────────────────────────────────────────────
async function loadScenarios() {
  const grid = document.getElementById('scenario-grid');
  grid.innerHTML = '<div class="loading-msg">Loading scenarios…</div>';
  try {
    const scenarios = await apiFetch('/api/ai-dm/scenarios');
    grid.innerHTML = '';
    scenarios.forEach(s => {
      const card = document.createElement('div');
      card.className = `scenario-card${s.isCustom ? ' custom-scenario' : ''}`;
      card.dataset.id = s.id;
      card.innerHTML = `
        <div class="scenario-name">${esc(s.name)}</div>
        <div class="scenario-location">${esc(s.location)}</div>
        <div class="scenario-desc">${esc(s.description)}</div>
        <span class="scenario-difficulty diff-${esc(s.difficulty)}">${esc(s.difficulty)}${s.isCustom ? ' · Custom' : ''}</span>
        ${s.isCustom ? '<button class="scenario-delete-btn" title="Delete this scenario">✕</button>' : ''}
      `;
      if (s.isCustom) {
        card.querySelector('.scenario-delete-btn').addEventListener('click', async ev => {
          ev.stopPropagation();
          if (!confirm(`Delete scenario "${s.name}"?`)) return;
          try {
            await apiFetch(`/api/ai-dm/scenarios/${s.id}`, { method: 'DELETE', body: '{}' });
            if (state.selectedScenario?.id === s.id) { state.selectedScenario = null; document.getElementById('btn-start-adventure').disabled = true; }
            await loadScenarios();
          } catch (e) { alert(`Error: ${e.message}`); }
        });
      }
      card.addEventListener('click', () => selectScenario(s, card));
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
}

function selectScenario(scenario, card) {
  state.selectedScenario = scenario;
  document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  checkStartReady();
}

function checkStartReady() {
  const ready = !!state.selectedScenario && !!document.getElementById('model-select').value;
  document.getElementById('btn-start-adventure').disabled = !ready;
}

document.getElementById('btn-start-adventure').addEventListener('click', startAdventure);

async function startAdventure() {
  const model = document.getElementById('model-select').value;
  const lmUrl = document.getElementById('lm-url').value.trim();
  const apiKey = document.getElementById('or-apikey').value.trim();
  if (!model || !state.selectedScenario) return;

  state.model = model;
  if (state.provider === 'lmstudio') state.lmStudioUrl = lmUrl || 'http://localhost:1234';
  if (state.provider === 'openrouter' && apiKey) state.apiKey = apiKey;

  const btn = document.getElementById('btn-start-adventure');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const result = await apiFetch('/api/ai-dm/sessions', {
      method: 'POST',
      body: JSON.stringify({
        characterId: state.selectedChar.id,
        scenarioId:  state.selectedScenario.id,
        provider:    state.provider,
        model,
        lmStudioUrl: state.lmStudioUrl,
        apiKey:      state.apiKey || undefined,
        language:    state.language,
      }),
    });
    state.sessionId   = result.sessionId;
    state.sessionEnded = false;
    await openAdventureScreen(result.sessionId);
  } catch (e) {
    alert(`Failed to start adventure: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚔ Begin Adventure';
  }
}

// ── Resume existing session ───────────────────────────────────────────────────
async function resumeSession(sessionId) {
  state.sessionId = sessionId;
  state.sessionEnded = false;
  await openAdventureScreen(sessionId);
}

// ── Open adventure screen ─────────────────────────────────────────────────────
async function openAdventureScreen(sessionId) {
  try {
    const data = await apiFetch(`/api/ai-dm/sessions/${sessionId}`);
    const { session, messages, rollData } = data;
    state.rollData    = rollData;
    state.sessionEnded = session.status === 'ended';
    state.model = session.model;
    state.language = session.language || 'English';
    state.currentSummary = session.summary || '';
    updateSummaryBadge();

    // Populate sidebar
    populateSidebar();

    // Header
    document.getElementById('adv-scenario-name').textContent = session.scenarioName;
    document.getElementById('adv-char-name-header').textContent = state.selectedChar?.name || session.characterName;
    document.getElementById('adv-model-badge').textContent = session.model.split('/').pop();

    // Language badge — only show when non-English
    const langBadge = document.getElementById('adv-language-badge');
    if (state.language === 'Turkish') {
      langBadge.textContent = '🇹🇷 TR';
      langBadge.style.display = '';
    } else {
      langBadge.style.display = 'none';
    }

    // Render history — only enable rolls on the last DM message if player hasn't replied yet
    const msgContainer = document.getElementById('chat-messages');
    msgContainer.innerHTML = '';
    messages.forEach((m, idx) => {
      if (m.role === 'assistant') {
        const hasUserAfter = messages.slice(idx + 1).some(x => x.role === 'user');
        appendDMMessage(m.content, false, !hasUserAfter);
      } else if (m.role === 'user') {
        appendPlayerMessage(m.content);
      }
    });

    scrollChatBottom();

    // Disable input if session ended
    if (session.status === 'ended') {
      document.getElementById('chat-input').disabled = true;
      document.getElementById('btn-send').disabled = true;
      document.getElementById('btn-end-session').style.display = 'none';
      appendSystemNote('This session has ended. Start a new adventure to continue playing.');
    }

    showScreen('screen-adventure');

    // If no messages yet, trigger the AI opening (new session)
    if (!messages.length || (messages.length === 1 && messages[0].role === 'system')) {
      await sendMessage('(Begin the adventure — set the opening scene now.)');
    }
  } catch (e) {
    alert(`Failed to load session: ${e.message}`);
  }
}

// ── Sidebar population ────────────────────────────────────────────────────────
function populateSidebar() {
  const d = state.charData || {};
  const rd = state.rollData || {};

  // Name & class
  const charName = state.selectedChar?.name || '';
  document.getElementById('sb-char-name').textContent = charName;
  document.getElementById('sb-class-level').textContent =
    [(d.class || ''), d.subclass ? `(${d.subclass})` : '', d.level ? `Lv${d.level}` : ''].filter(Boolean).join(' ');

  // HP
  updateHPBar(parseInt(rd.hpcur || d.hpcur) || 0, parseInt(rd.hpmax || d.hpmax) || 1);

  // Stats
  document.getElementById('sb-ac').textContent    = d.ac    || '—';
  document.getElementById('sb-speed').textContent = d.speed || '30';
  document.getElementById('sb-pp').textContent    = d.pp    || '10';
  document.getElementById('sb-init').textContent  = rd.init || abilityMod(d.dex);

  // Ability scores
  ABILITIES.forEach(a => {
    const score = parseInt(d[a]) || 10;
    const mod = abilityMod(score);
    document.getElementById(`ab-${a}`).textContent  = score;
    document.getElementById(`abm-${a}`).textContent = mod;
  });

  // Skills
  const skillList = document.getElementById('skill-list');
  skillList.innerHTML = '';
  SKILL_NAMES.forEach((name, i) => {
    const prof  = d[`sk-prof-${i}`];
    const exp   = d[`sk-exp-${i}`];
    const mod   = rd[`sk-${i}`] || d[`sk-${i}`] || '0';
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div class="skill-prof${prof ? (exp ? ' expert' : ' proficient') : ''}"></div>
      <span class="skill-name">${esc(name)}</span>
      <span class="skill-mod">${fmtMod(mod)}</span>
    `;
    skillList.appendChild(row);
  });

  // Saving throws
  const saveList = document.getElementById('save-list');
  saveList.innerHTML = '';
  ABILITIES.forEach(a => {
    const prof = d[`save-prof-${a}`];
    const mod  = rd[`save-${a}`] || d[`save-${a}`] || abilityMod(d[a]);
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div class="skill-prof${prof ? ' proficient' : ''}"></div>
      <span class="skill-name">${ABILITY_LABELS[a]}</span>
      <span class="skill-mod">${fmtMod(mod)}</span>
    `;
    saveList.appendChild(row);
  });
}

function updateHPBar(cur, max) {
  document.getElementById('sb-hp-text').textContent = `${cur}/${max}`;
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const fill = document.getElementById('sb-hp-fill');
  fill.style.width = `${pct}%`;
  fill.style.background = pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--gold)' : 'var(--red)';
}

// ── Sidebar toggle ────────────────────────────────────────────────────────────
function setSidebarOpen(open) {
  state.sidebarOpen = open;
  const sidebar  = document.getElementById('char-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (window.innerWidth < 900) {
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('active', open);
  } else {
    sidebar.classList.toggle('hidden', !open);
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
  }
}
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => setSidebarOpen(!state.sidebarOpen));
document.getElementById('sidebar-backdrop').addEventListener('click', () => setSidebarOpen(false));

// Close sidebar overlay when viewport resizes to desktop
window.addEventListener('resize', () => {
  if (window.innerWidth >= 900) {
    document.getElementById('char-sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('active');
  }
});

// ── Mobile overflow menu ──────────────────────────────────────────────────────
(function () {
  const overflowBtn = document.getElementById('btn-header-overflow');
  const overflowDd  = document.getElementById('adv-overflow-dropdown');
  overflowBtn.addEventListener('click', e => {
    e.stopPropagation();
    overflowDd.classList.toggle('open');
  });
  document.addEventListener('click', () => overflowDd.classList.remove('open'));
  overflowDd.querySelectorAll('.overflow-item[data-for]').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      overflowDd.classList.remove('open');
      document.getElementById(item.dataset.for)?.click();
    });
  });
})();

// ── UI busy state — block actions while AI is generating ──────────────────────
function setAdventureUIBusy(busy) {
  const overlay = document.getElementById('adv-busy-overlay');
  if (overlay) overlay.style.display = busy ? 'flex' : 'none';
  ['btn-rest','btn-end-session','btn-summary','btn-change-model','btn-regenerate','btn-adv-back','btn-header-overflow']
    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = busy; });
}

// ── Chat rendering ────────────────────────────────────────────────────────────
function scrollChatBottom() {
  const w = document.getElementById('chat-window');
  w.scrollTop = w.scrollHeight;
}

function appendPlayerMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-player';
  div.innerHTML = `<div class="msg-label">You</div><div class="msg-content">${esc(text)}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChatBottom();
  return div;
}

function appendDMMessage(text, animate = true, showRolls = true) {
  const div = document.createElement('div');
  div.className = 'msg msg-dm';

  // Parse roll requests from text
  const { cleanText, rolls } = parseRollRequests(text);

  div.innerHTML = `<div class="msg-label">Dungeon Master</div><div class="msg-content"></div>`;
  const contentEl = div.querySelector('.msg-content');

  if (animate) {
    contentEl.innerHTML = formatDMText(text);
  } else {
    contentEl.innerHTML = formatDMText(cleanText);
  }

  // Only append roll buttons for the current/live message (not history)
  if (rolls.length > 0 && !state.sessionEnded && showRolls) {
    const rollWrap = document.createElement('div');
    rollWrap.className = 'roll-request-wrap';
    rolls.forEach(roll => rollWrap.appendChild(createRollButton(roll)));
    div.appendChild(rollWrap);
  }

  // Append clickable option buttons (only for live or last history message)
  if (!animate && !state.sessionEnded && showRolls) {
    const options = parseOptions(cleanText);
    if (options.length >= 2) {
      div.appendChild(buildOptionButtons(options));
    }
  }

  document.getElementById('chat-messages').appendChild(div);
  scrollChatBottom();
  return div;
}

// ── Option detection ──────────────────────────────────────────────────────────
function parseOptions(text) {
  // Match numbered list items: "1. text", "**1.** text", "1) text"
  const matches = [...text.matchAll(/^\*?\*?(\d+)[.)]\*?\*?\s+(.{3,150})/gm)];
  if (matches.length < 2) return [];
  const nums = matches.map(m => parseInt(m[1]));
  // Must be sequential starting from 1
  if (nums[0] !== 1) return [];
  if (!nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) return [];
  return matches.map(m => m[2].replace(/\*\*/g, '').trim());
}

function buildOptionButtons(options) {
  const wrap = document.createElement('div');
  wrap.className = 'option-buttons-wrap';

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = `${i + 1}. ${opt}`;
    btn.addEventListener('click', () => {
      if (state.sending || state.sessionEnded) return;
      // Disable all option buttons in this group
      wrap.querySelectorAll('.option-btn, .option-custom-btn').forEach(b => b.disabled = true);
      btn.classList.add('selected');
      appendPlayerMessage(opt);
      sendMessage(opt);
    });
    wrap.appendChild(btn);
  });

  // "Write my own" button
  const customBtn = document.createElement('button');
  customBtn.className = 'option-custom-btn';
  customBtn.textContent = '✏ Write my own response…';
  customBtn.addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  wrap.appendChild(customBtn);

  return wrap;
}

function appendSystemNote(text) {
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;color:var(--muted);font-size:12px;padding:10px;';
  div.textContent = text;
  document.getElementById('chat-messages').appendChild(div);
  scrollChatBottom();
}

function formatDMText(text) {
  // Basic markdown: bold, italic, line breaks
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Roll request parsing ──────────────────────────────────────────────────────
const ROLL_PATTERN = /\[\[ROLL:([^\]]+)\]\]/g;

function parseRollRequests(text) {
  const rolls = [];
  let match;
  ROLL_PATTERN.lastIndex = 0;
  while ((match = ROLL_PATTERN.exec(text)) !== null) {
    const parts = match[1].split(':');
    const key    = parts[0]; // sk-N, save-XX, init, atk, raw
    const label  = parts[1] || 'Roll';
    const param1 = parts[2] || '';  // 'DC' or dice notation or weapon
    const param2 = parts[3] || '';  // DC value or modifier
    const adv    = parts[4] || '';  // 'advantage' | 'disadvantage' | ''
    rolls.push({ key, label, param1, param2, adv, raw: match[0] });
  }
  const cleanText = text.replace(ROLL_PATTERN, '').trim();
  return { cleanText, rolls };
}

function resolveModifier(key) {
  const rd = state.rollData || {};
  const d  = state.charData || {};

  if (key.startsWith('sk-')) {
    const val = rd[key] !== undefined ? rd[key] : (d[key] || '0');
    return parseInt(val) || 0;
  }
  if (key.startsWith('save-')) {
    const val = rd[key] !== undefined ? rd[key] : (d[key] || '0');
    return parseInt(val) || 0;
  }
  if (key === 'init') {
    const val = rd.init !== undefined ? rd.init : abilityMod(d.dex);
    return parseInt(val) || 0;
  }
  return 0;
}

function createRollButton(roll) {
  const btn = document.createElement('button');
  btn.className = 'roll-btn';

  const { key, label, param1, param2, adv } = roll;
  const isAtk = key === 'atk';
  const isRaw = key === 'raw';
  const hasDC = param1 === 'DC' && param2;
  const dcVal = hasDC ? parseInt(param2) : null;

  let btnLabel = `🎲 Roll ${label}`;
  if (hasDC) btnLabel += ` <span class="roll-dc">DC ${dcVal}</span>`;
  if (adv === 'advantage')    btnLabel += `<span class="roll-adv">ADV</span>`;
  if (adv === 'disadvantage') btnLabel += `<span class="roll-adv">DIS</span>`;
  btn.innerHTML = btnLabel;

  btn.addEventListener('click', () => {
    btn.disabled = true;
    const result = performRoll(roll);
    appendRollResult(result, dcVal, roll);
    sendMessage(formatRollMessage(result, roll, dcVal));
  });

  return btn;
}

function performRoll(roll) {
  const { key, param1, param2, adv } = roll;
  const isAtk = key === 'atk';
  const isRaw = key === 'raw';

  if (isRaw) {
    // Raw dice roll, no modifier
    const diceNotation = param1 || '1d20';
    const result = rollDice(diceNotation);
    return { die1: result.total, die2: null, kept: result.total, modifier: 0, total: result.total, notation: diceNotation, isRaw: true };
  }

  // d20 roll
  const die1 = Math.floor(Math.random() * 20) + 1;
  let die2 = null;
  let kept = die1;

  if (adv === 'advantage') {
    die2 = Math.floor(Math.random() * 20) + 1;
    kept = Math.max(die1, die2);
  } else if (adv === 'disadvantage') {
    die2 = Math.floor(Math.random() * 20) + 1;
    kept = Math.min(die1, die2);
  }

  let modifier = 0;
  if (isAtk) {
    modifier = parseInt(param2) || 0;
  } else {
    modifier = resolveModifier(key);
  }

  const total = kept + modifier;
  const isNat20 = kept === 20;
  const isNat1  = kept === 1;

  return { die1, die2, kept, modifier, total, isNat20, isNat1, adv, isRaw: false };
}

function appendRollResult(result, dcVal, roll) {
  const { die1, die2, kept, modifier, total, isNat20, isNat1, adv, isRaw, notation } = result;
  const success = dcVal !== null ? total >= dcVal : null;

  let diceStr;
  if (isRaw) {
    diceStr = `${notation}: ${total}`;
  } else if (die2 !== null) {
    const advStr = adv === 'advantage' ? 'ADV' : 'DIS';
    diceStr = `d20(${die1}, ${die2}) [${advStr}: kept ${kept}]`;
  } else {
    diceStr = `d20(${kept})`;
  }

  const modStr = (!isRaw && modifier !== 0) ? (modifier >= 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`) : '';
  const totalStr = isRaw ? '' : ` = ${total}`;
  const dcStr = dcVal !== null ? ` vs DC ${dcVal}` : '';
  const outcomeStr = success !== null ? (success ? ' — ✓ Success!' : ' — ✗ Failure!') : '';
  const nat = isNat20 ? ' 🌟 Natural 20!' : (isNat1 ? ' 💀 Natural 1!' : '');

  const resultLine = `${diceStr}${modStr}${totalStr}${dcStr}${outcomeStr}${nat}`;

  const div = document.createElement('div');
  div.className = `msg msg-roll${success === false ? ' fail' : ''}`;
  const lineClass = isNat20 ? 'roll-nat20' : (isNat1 ? 'roll-nat1' : '');
  div.innerHTML = `
    <div class="msg-label">${esc(roll.label)}</div>
    <div class="msg-content"><span class="roll-result-line ${lineClass}">${esc(resultLine)}</span></div>
  `;
  document.getElementById('chat-messages').appendChild(div);
  scrollChatBottom();
}

function formatRollMessage(result, roll, dcVal) {
  const { kept, modifier, total, isNat20, isNat1, die1, die2, adv, isRaw, notation } = result;
  const success = dcVal !== null ? total >= dcVal : null;

  if (isRaw) {
    return `I rolled ${notation}: ${total} for ${roll.label}.`;
  }

  let msg = `I rolled a ${kept} on the d20`;
  if (die2 !== null) msg += ` (rolled ${die1} and ${die2}, ${adv === 'advantage' ? 'kept higher' : 'kept lower'})`;
  if (modifier !== 0) msg += ` with a modifier of ${modifier >= 0 ? '+' + modifier : modifier}`;
  msg += `, for a total of ${total}`;
  if (dcVal !== null) msg += ` against DC ${dcVal} — ${success ? 'success' : 'failure'}`;
  if (isNat20) msg += ' (Natural 20!)';
  if (isNat1) msg += ' (Natural 1!)';
  msg += `.`;
  return msg;
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function showTypingIndicator() {
  removeTypingIndicator();
  const div = document.createElement('div');
  div.className = 'msg msg-dm msg-typing';
  div.id = 'typing-indicator';
  div.innerHTML = `<div class="msg-label">Dungeon Master</div><div class="msg-content"><span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span><span class="retry-text" style="display:none"></span><button class="btn-stop-retry" id="btn-stop-retry" title="Stop and use current response">⏹ Stop</button></div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChatBottom();
  return div;
}

function updateTypingAttempt(attempt, max) {
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  el.querySelector('.typing-dots').style.display = 'none';
  const textEl = el.querySelector('.retry-text');
  textEl.style.display = '';
  textEl.textContent = `Trying again… (${attempt}/${max})`;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// ── Streaming message (with retry validation) ─────────────────────────────────
async function sendMessage(text) {
  if (state.sending || state.sessionEnded) return;
  state.sending = true;
  setAdventureUIBusy(true);

  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  inputEl.disabled = true;
  sendBtn.disabled = true;

  showTypingIndicator();

  const abortCtrl = new AbortController();
  let userStopped = false;

  // Wire stop button
  const wireStopBtn = () => {
    const btn = document.getElementById('btn-stop-retry');
    if (btn) btn.onclick = () => { userStopped = true; abortCtrl.abort(); };
  };
  wireStopBtn();

  let msgDiv = null;
  let contentEl = null;
  let accumulated = '';
  let lastCompleteContent = '';
  let finalized = false;

  const createDMBubble = () => {
    const div = document.createElement('div');
    div.className = 'msg msg-dm';
    div.innerHTML = `<div class="msg-label">Dungeon Master</div><div class="msg-content"></div>`;
    document.getElementById('chat-messages').appendChild(div);
    return div;
  };

  const finalizeBubble = (div, content) => {
    if (!div || finalized) return;
    finalized = true;
    const { cleanText, rolls } = parseRollRequests(content);
    const el = div.querySelector('.msg-content');
    if (el) el.innerHTML = formatDMText(cleanText);
    if (rolls.length > 0 && !state.sessionEnded) {
      const rollWrap = document.createElement('div');
      rollWrap.className = 'roll-request-wrap';
      rolls.forEach(roll => rollWrap.appendChild(createRollButton(roll)));
      div.appendChild(rollWrap);
    }
    if (!state.sessionEnded) {
      const options = parseOptions(cleanText);
      if (options.length >= 2) div.appendChild(buildOptionButtons(options));
    }
    scrollChatBottom();
  };

  try {
    const res = await fetch(`/api/ai-dm/sessions/${state.sessionId}/message`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content: text }),
      signal: abortCtrl.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          if (!finalized && msgDiv) finalizeBubble(msgDiv, accumulated);
          continue;
        }
        try {
          const obj = JSON.parse(data);

          if (obj.type === 'attempt_start') {
            if (obj.attempt > 1) {
              // Clear current bubble — this attempt failed, retrying
              if (msgDiv) { msgDiv.remove(); msgDiv = null; finalized = false; }
              accumulated = '';
              showTypingIndicator();
              wireStopBtn();
              updateTypingAttempt(obj.attempt, obj.max);
            }

          } else if (obj.type === 'token' && obj.content) {
            if (!msgDiv) {
              removeTypingIndicator();
              msgDiv = createDMBubble();
              contentEl = msgDiv.querySelector('.msg-content');
            }
            accumulated += obj.content;
            const { cleanText } = parseRollRequests(accumulated);
            contentEl.innerHTML = formatDMText(cleanText);
            scrollChatBottom();

          } else if (obj.type === 'attempt_rejected') {
            // Save this attempt's content as fallback, then clear for retry
            lastCompleteContent = accumulated;
            accumulated = '';
            if (msgDiv) { msgDiv.remove(); msgDiv = null; finalized = false; }

          } else if (obj.type === 'response_burst') {
            // A retry produced a valid (or best-effort) response — show it all at once
            removeTypingIndicator();
            if (msgDiv) { msgDiv.remove(); finalized = false; }
            msgDiv = createDMBubble();
            contentEl = msgDiv.querySelector('.msg-content');
            accumulated = obj.content;
            const { cleanText } = parseRollRequests(accumulated);
            contentEl.innerHTML = formatDMText(cleanText);
            scrollChatBottom();

          } else if (obj.type === 'attempt_accepted' || obj.type === 'best_effort') {
            finalizeBubble(msgDiv, accumulated);

          } else if (obj.type === 'error') {
            removeTypingIndicator();
            if (msgDiv) {
              msgDiv.querySelector('.msg-content').innerHTML = `<span style="color:var(--red)">Error: ${esc(obj.error)}</span>`;
            } else {
              appendSystemNote(`Error: ${esc(obj.error)}`);
            }
          }
        } catch {}
      }
    }

  } catch (e) {
    removeTypingIndicator();
    if (e.name === 'AbortError' || userStopped) {
      // User stopped — finalize with whatever we have
      const useContent = accumulated || lastCompleteContent;
      if (useContent) {
        if (!msgDiv) { msgDiv = createDMBubble(); finalized = false; }
        finalizeBubble(msgDiv, useContent);
      } else if (msgDiv) {
        finalizeBubble(msgDiv, '');
      }
    } else {
      if (msgDiv) msgDiv.remove();
      appendSystemNote(`Error: ${e.message}`);
    }
  } finally {
    state.sending = false;
    setAdventureUIBusy(false);
    if (!state.sessionEnded) {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }
}

// ── Send button / input ───────────────────────────────────────────────────────
document.getElementById('btn-send').addEventListener('click', () => {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || state.sending || state.sessionEnded) return;
  input.value = '';
  input.style.height = '';
  appendPlayerMessage(text);
  sendMessage(text);
});

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btn-send').click();
  }
});

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 160) + 'px';
});

// ── End session ───────────────────────────────────────────────────────────────
document.getElementById('btn-end-session').addEventListener('click', () => {
  document.getElementById('modal-end-confirm').style.display = 'flex';
});

document.getElementById('end-cancel').addEventListener('click', () => {
  document.getElementById('modal-end-confirm').style.display = 'none';
});

document.getElementById('end-confirm').addEventListener('click', async () => {
  document.getElementById('modal-end-confirm').style.display = 'none';
  try {
    await apiFetch(`/api/ai-dm/sessions/${state.sessionId}/end`, { method: 'POST', body: '{}' });
    state.sessionEnded = true;
    document.getElementById('chat-input').disabled = true;
    document.getElementById('btn-send').disabled = true;
    document.getElementById('btn-end-session').style.display = 'none';
    appendSystemNote('Session ended. Your adventure has been saved.');
    // Disable all remaining roll buttons
    document.querySelectorAll('.roll-btn').forEach(b => b.disabled = true);
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

// ── Settings modal ────────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', async () => {
  try {
    const cfg = await apiFetch('/api/ai-dm/config');
    document.getElementById('cfg-provider').value = cfg.provider || 'lmstudio';
    document.getElementById('cfg-lm-url').value = cfg.lmStudioUrl || 'http://localhost:1234';
    document.getElementById('cfg-apikey-status').textContent = cfg.hasApiKey ? 'API key is saved. Enter a new one to replace it.' : '';
  } catch {}
  document.getElementById('modal-settings').style.display = 'flex';
});

document.getElementById('settings-close').addEventListener('click', () => { document.getElementById('modal-settings').style.display = 'none'; });
document.getElementById('settings-cancel').addEventListener('click', () => { document.getElementById('modal-settings').style.display = 'none'; });
document.getElementById('settings-save').addEventListener('click', async () => {
  const provider = document.getElementById('cfg-provider').value;
  const lmUrl   = document.getElementById('cfg-lm-url').value.trim();
  const apiKey  = document.getElementById('cfg-apikey').value.trim();
  try {
    await apiFetch('/api/ai-dm/config', {
      method: 'POST',
      body: JSON.stringify({ provider, lmStudioUrl: lmUrl, apiKey: apiKey || undefined }),
    });
    document.getElementById('modal-settings').style.display = 'none';
  } catch (e) { alert(`Error saving: ${e.message}`); }
});

// Close modals on overlay click
document.getElementById('modal-settings').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
document.getElementById('modal-end-confirm').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
document.getElementById('modal-change-model').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

// ── Change Model modal ────────────────────────────────────────────────────────
let cmProvider = 'lmstudio';

function setCmProviderUI(provider) {
  cmProvider = provider;
  document.querySelectorAll('[data-cm-provider]').forEach(t => t.classList.toggle('active', t.dataset.cmProvider === provider));
  document.getElementById('cm-prov-lmstudio').style.display  = provider === 'lmstudio'   ? '' : 'none';
  document.getElementById('cm-prov-openrouter').style.display = provider === 'openrouter' ? '' : 'none';
  document.getElementById('cm-model-select').innerHTML = '<option value="">— click Load —</option>';
  document.getElementById('cm-models-error').style.display = 'none';
}

document.querySelectorAll('[data-cm-provider]').forEach(t => {
  t.addEventListener('click', () => setCmProviderUI(t.dataset.cmProvider));
});

document.getElementById('btn-change-model').addEventListener('click', async () => {
  if (state.sessionEnded) return;
  // Pre-fill with current session values
  cmProvider = state.provider || 'lmstudio';
  setCmProviderUI(cmProvider);
  document.getElementById('cm-lm-url').value = state.lmStudioUrl || 'http://localhost:1234';
  document.getElementById('cm-apikey').value = '';
  document.getElementById('cm-model-select').innerHTML = '<option value="">— click Load —</option>';
  document.getElementById('cm-models-error').style.display = 'none';
  document.getElementById('modal-change-model').style.display = 'flex';
});

document.getElementById('cm-close').addEventListener('click', () => { document.getElementById('modal-change-model').style.display = 'none'; });
document.getElementById('cm-cancel').addEventListener('click', () => { document.getElementById('modal-change-model').style.display = 'none'; });

document.getElementById('cm-load-models').addEventListener('click', async () => {
  const btn = document.getElementById('cm-load-models');
  const sel = document.getElementById('cm-model-select');
  const errEl = document.getElementById('cm-models-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '…';
  sel.innerHTML = '<option>Loading…</option>';
  try {
    const lmUrl  = document.getElementById('cm-lm-url').value.trim();
    const apiKey = document.getElementById('cm-apikey').value.trim();
    const params = new URLSearchParams({ provider: cmProvider });
    if (cmProvider === 'lmstudio')   params.set('lmStudioUrl', lmUrl || 'http://localhost:1234');
    if (cmProvider === 'openrouter' && apiKey) params.set('apiKey', apiKey);
    const models = await apiFetch(`/api/ai-dm/models?${params}`);
    sel.innerHTML = '';
    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
    } else {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        if (m.id === state.model) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load</option>';
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Load';
  }
});

document.getElementById('cm-save').addEventListener('click', async () => {
  const model  = document.getElementById('cm-model-select').value;
  const lmUrl  = document.getElementById('cm-lm-url').value.trim();
  const apiKey = document.getElementById('cm-apikey').value.trim();
  if (!model) { alert('Please select a model first.'); return; }

  const saveBtn = document.getElementById('cm-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Applying…';
  try {
    await apiFetch(`/api/ai-dm/sessions/${state.sessionId}/model`, {
      method: 'PATCH',
      body: JSON.stringify({
        provider:    cmProvider,
        model,
        lmStudioUrl: cmProvider === 'lmstudio' ? (lmUrl || 'http://localhost:1234') : undefined,
        apiKey:      cmProvider === 'openrouter' && apiKey ? apiKey : undefined,
      }),
    });
    // Update local state
    state.provider    = cmProvider;
    state.model       = model;
    if (cmProvider === 'lmstudio') state.lmStudioUrl = lmUrl || 'http://localhost:1234';
    if (cmProvider === 'openrouter' && apiKey) state.apiKey = apiKey;
    document.getElementById('adv-model-badge').textContent = model.split('/').pop();
    document.getElementById('modal-change-model').style.display = 'none';
    appendSystemNote(`Model changed to ${model}.`);
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Apply';
  }
});

// ── Regenerate ────────────────────────────────────────────────────────────────
document.getElementById('btn-regenerate').addEventListener('click', async () => {
  if (state.sending || state.sessionEnded) return;

  // Find and remove the last DM message from the DOM
  const dmMessages = document.querySelectorAll('.msg-dm');
  if (!dmMessages.length) { appendSystemNote('Nothing to retry yet.'); return; }
  const lastDM = dmMessages[dmMessages.length - 1];
  lastDM.remove();

  state.sending = true;
  setAdventureUIBusy(true);
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  inputEl.disabled = true;
  sendBtn.disabled = true;

  const typingEl = showTypingIndicator();

  try {
    const res = await fetch(`/api/ai-dm/sessions/${state.sessionId}/regenerate`, {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    removeTypingIndicator();

    // Stream the new response exactly like sendMessage does
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg msg-dm';
    msgDiv.innerHTML = `<div class="msg-label">Dungeon Master</div><div class="msg-content"></div>`;
    const contentEl = msgDiv.querySelector('.msg-content');
    document.getElementById('chat-messages').appendChild(msgDiv);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          if (obj.type === 'token' && obj.content) {
            accumulated += obj.content;
            const { cleanText } = parseRollRequests(accumulated);
            contentEl.innerHTML = formatDMText(cleanText);
            scrollChatBottom();
          } else if (obj.type === 'error') {
            contentEl.innerHTML = `<span style="color:var(--red)">Error: ${esc(obj.error)}</span>`;
          }
        } catch {}
      }
    }

    const { cleanText, rolls } = parseRollRequests(accumulated);
    contentEl.innerHTML = formatDMText(cleanText);
    if (rolls.length > 0) {
      const rollWrap = document.createElement('div');
      rollWrap.className = 'roll-request-wrap';
      rolls.forEach(roll => rollWrap.appendChild(createRollButton(roll)));
      msgDiv.appendChild(rollWrap);
    }
    if (!state.sessionEnded) {
      const options = parseOptions(cleanText);
      if (options.length >= 2) msgDiv.appendChild(buildOptionButtons(options));
    }
    scrollChatBottom();

  } catch (e) {
    removeTypingIndicator();
    appendSystemNote(`Retry failed: ${e.message}`);
  } finally {
    state.sending = false;
    setAdventureUIBusy(false);
    if (!state.sessionEnded) {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }
});

// ── Rest system ───────────────────────────────────────────────────────────────

let restState = { type: 'short', hdSpent: 0, hpGained: 0 };

function hitDieSize(hdStr) {
  const m = String(hdStr || '').match(/d(\d+)/i);
  return m ? parseInt(m[1]) : 8;
}

function openRestModal() {
  if (state.sessionEnded) return;
  restState = { type: 'short', hdSpent: 0, hpGained: 0 };
  refreshShortRestUI();
  refreshLongRestUI();
  setRestTab('short');
  document.getElementById('modal-rest').style.display = 'flex';
}

function refreshShortRestUI() {
  const d  = state.charData  || {};
  const rd = state.rollData  || {};
  const hpCur  = parseInt(rd.hpcur   ?? d.hpcur)  || 0;
  const hpMax  = parseInt(rd.hpmax   ?? d.hpmax)  || 1;
  const level  = parseInt(d.level)   || 1;
  const hdSpent= parseInt(d.hdspent) || 0;
  const hdLeft = Math.max(0, level - hdSpent);
  const conMod = Math.floor(((parseInt(d.con) || 10) - 10) / 2);
  const dieSize= hitDieSize(d.hd);

  document.getElementById('sr-hp').textContent      = `${hpCur}/${hpMax}`;
  document.getElementById('sr-hd').textContent      = `${hdLeft}/${level} (d${dieSize})`;
  document.getElementById('sr-con').textContent     = conMod >= 0 ? `+${conMod}` : `${conMod}`;
  document.getElementById('sr-formula').innerHTML   = `Each hit die: <strong>d${dieSize} ${conMod >= 0 ? '+' : ''}${conMod}</strong> (min 1 per die)`;
  document.getElementById('sr-total').textContent  = '+0';
  document.getElementById('sr-roll-log').innerHTML  = '';
  document.getElementById('sr-roll-btn').disabled   = hdLeft === 0 || hpCur >= hpMax;
  restState.hdSpent  = 0;
  restState.hpGained = 0;
}

function refreshLongRestUI() {
  const d = state.charData || {};

  // Spell slot summary
  const slotLines = [];
  for (let lvl = 1; lvl <= 9; lvl++) {
    const total = parseInt(d[`slot-${lvl}-total`]) || 0;
    const used  = parseInt(d[`slot-${lvl}-used`])  || 0;
    if (total > 0) slotLines.push(`L${lvl}: ${used} used`);
  }
  document.getElementById('lr-slots-line').textContent =
    slotLines.length ? `✅ Spell slots restored (${slotLines.join(', ')})` : '✅ Spell slots restored';

  // Spell preparation section
  let spells = [];
  try { spells = JSON.parse(d._spells || '[]'); } catch {}
  const spellSection = document.getElementById('lr-spell-section');
  if (!spells.some(s => s[1])) { spellSection.style.display = 'none'; return; }
  spellSection.style.display = '';

  // Prep limit hint
  const level    = parseInt(d.level) || 1;
  const className= (d.class || '').toLowerCase();
  let hint = 'Choose which spells to have prepared after this rest.';
  if (['cleric','druid'].includes(className)) {
    const m = Math.floor(((parseInt(d.wis)||10)-10)/2);
    hint = `${d.class} — prepare up to ${Math.max(1, level + m)} spells (level ${level} + WIS mod ${m>=0?'+':''}${m}).`;
  } else if (className === 'wizard') {
    const m = Math.floor(((parseInt(d.int)||10)-10)/2);
    hint = `Wizard — prepare up to ${Math.max(1, level + m)} spells (level ${level} + INT mod ${m>=0?'+':''}${m}).`;
  } else if (className === 'paladin') {
    const m = Math.floor(((parseInt(d.cha)||10)-10)/2);
    hint = `Paladin — prepare up to ${Math.max(1, Math.floor(level/2) + m)} spells (½ level + CHA mod ${m>=0?'+':''}${m}).`;
  } else if (className === 'artificer') {
    const m = Math.floor(((parseInt(d.int)||10)-10)/2);
    hint = `Artificer — prepare up to ${Math.max(1, Math.floor(level/2) + m)} spells (½ level + INT mod ${m>=0?'+':''}${m}).`;
  }
  document.getElementById('lr-prep-hint').textContent = hint;

  // Build spell list — cantrips always prepared (static), leveled spells are toggleable
  const list = document.getElementById('lr-spell-list');
  list.innerHTML = '';

  const cantrips = spells.map((s,i) => ({ s, i })).filter(({s}) => s[1] && parseInt(s[0]) === 0);
  const leveled  = spells.map((s,i) => ({ s, i })).filter(({s}) => s[1] && parseInt(s[0]) > 0);

  if (cantrips.length) {
    const hdr = document.createElement('div');
    hdr.className = 'spell-group-hdr';
    hdr.textContent = 'Cantrips — always available';
    list.appendChild(hdr);
    cantrips.forEach(({ s }) => {
      const row = document.createElement('div');
      row.className = 'spell-prep-row';
      row.innerHTML = `<span class="spell-always">★</span> <span class="spell-prep-name">${esc(s[1])}</span>`;
      list.appendChild(row);
    });
  }

  if (leveled.length) {
    const hdr = document.createElement('div');
    hdr.className = 'spell-group-hdr';
    hdr.textContent = 'Leveled spells — select to prepare';
    list.appendChild(hdr);
    leveled.forEach(({ s, i }) => {
      const tags = [s[4] && 'Conc', s[5] && 'Ritual'].filter(Boolean);
      const row = document.createElement('div');
      row.className = 'spell-prep-row';
      row.innerHTML = `
        <label class="spell-prep-label">
          <input type="checkbox" class="spell-prep-chk" data-idx="${i}" ${s[7] ? 'checked' : ''}>
          <span class="spell-prep-name">${esc(s[1])}</span>
          <span class="spell-prep-lvl">Lv${s[0] || '?'}</span>
          ${tags.map(t => `<span class="spell-tag">${t}</span>`).join('')}
        </label>`;
      list.appendChild(row);
    });
  }
}

function setRestTab(type) {
  restState.type = type;
  document.querySelectorAll('.rest-tab').forEach(t => t.classList.toggle('active', t.dataset.rest === type));
  document.getElementById('rest-short-panel').style.display = type === 'short' ? '' : 'none';
  document.getElementById('rest-long-panel').style.display  = type === 'long'  ? '' : 'none';
  document.getElementById('rest-apply').textContent = type === 'short' ? 'Take Short Rest' : 'Take Long Rest';
}

document.querySelectorAll('.rest-tab').forEach(t => t.addEventListener('click', () => setRestTab(t.dataset.rest)));

document.getElementById('btn-rest').addEventListener('click', openRestModal);
document.getElementById('rest-close').addEventListener('click',  () => { document.getElementById('modal-rest').style.display = 'none'; });
document.getElementById('rest-cancel').addEventListener('click', () => { document.getElementById('modal-rest').style.display = 'none'; });
document.getElementById('modal-rest').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

// Short rest: roll hit die button
document.getElementById('sr-roll-btn').addEventListener('click', () => {
  const d   = state.charData || {};
  const rd  = state.rollData || {};
  const hpCur   = parseInt(rd.hpcur   ?? d.hpcur)  || 0;
  const hpMax   = parseInt(rd.hpmax   ?? d.hpmax)  || 1;
  const level   = parseInt(d.level)   || 1;
  const hdSpent = parseInt(d.hdspent) || 0;
  const hdLeft  = Math.max(0, level - hdSpent) - restState.hdSpent;
  const conMod  = Math.floor(((parseInt(d.con) || 10) - 10) / 2);
  const dieSize = hitDieSize(d.hd);

  if (hdLeft <= 0 || (hpCur + restState.hpGained) >= hpMax) return;

  const roll   = Math.floor(Math.random() * dieSize) + 1;
  const gained = Math.max(1, roll + conMod);
  restState.hdSpent++;
  restState.hpGained = Math.min(hpMax - hpCur, restState.hpGained + gained);

  // Render roll
  const entry = document.createElement('span');
  entry.className = 'roll-log-entry';
  const modStr = conMod >= 0 ? `+${conMod}` : `${conMod}`;
  entry.textContent = `d${dieSize}(${roll})${modStr}=${gained}`;
  document.getElementById('sr-roll-log').appendChild(entry);
  document.getElementById('sr-total').textContent = `+${restState.hpGained}`;

  // Update hit dice display
  const newLeft = Math.max(0, level - hdSpent) - restState.hdSpent;
  document.getElementById('sr-hd').textContent = `${newLeft}/${level} (d${dieSize})`;
  document.getElementById('sr-roll-btn').disabled = newLeft <= 0 || (hpCur + restState.hpGained) >= hpMax;
});

document.getElementById('sr-clear-btn').addEventListener('click', () => {
  refreshShortRestUI();
});

// Apply rest button
document.getElementById('rest-apply').addEventListener('click', async () => {
  const applyBtn = document.getElementById('rest-apply');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying…';

  try {
    const body = { characterId: state.selectedChar.id, restType: restState.type };

    if (restState.type === 'short') {
      body.hpGained     = restState.hpGained;
      body.hitDiceSpent = restState.hdSpent;
    } else {
      // Collect checked spell indices + all cantrips
      const checked = [...document.querySelectorAll('.spell-prep-chk:checked')]
        .map(el => parseInt(el.dataset.idx));
      let spells = [];
      try { spells = JSON.parse(state.charData?._spells || '[]'); } catch {}
      const cantrips = spells.map((s, i) => ({ s, i }))
        .filter(({ s }) => parseInt(s[0]) === 0 && s[1]).map(({ i }) => i);
      body.preparedIndices = [...new Set([...checked, ...cantrips])];
    }

    const result = await apiFetch('/api/ai-dm/rest', { method: 'POST', body: JSON.stringify(body) });

    // Update local state
    if (result.data) {
      state.charData = { ...state.charData, ...result.data };
      if (state.rollData) {
        state.rollData.hpcur = result.data.hpcur;
        state.rollData.hpmax = result.data.hpmax;
      }
    }
    const newHpCur = parseInt(result.data?.hpcur) || 0;
    const newHpMax = parseInt(result.data?.hpmax) || 1;
    updateHPBar(newHpCur, newHpMax);
    populateSidebar();

    document.getElementById('modal-rest').style.display = 'none';

    // Build AI context message about the rest
    const restName = restState.type === 'short' ? 'short rest' : 'long rest';
    let note = `${state.selectedChar?.name || 'The character'} takes a ${restName}.`;
    if (restState.type === 'short') {
      note += restState.hpGained > 0 ? ` Regains ${restState.hpGained} HP — now ${newHpCur}/${newHpMax} HP.` : ` HP unchanged (${newHpCur}/${newHpMax}).`;
    } else {
      note += ` HP fully restored to ${newHpMax}. All spell slots and hit dice restored.`;
      // Mention new prepared spells
      const prepNames = [];
      try {
        const spells = JSON.parse(result.data?._spells || '[]');
        spells.forEach(s => { if (s[7] && s[1]) prepNames.push(s[1]); });
      } catch {}
      if (prepNames.length) note += ` Prepared spells: ${prepNames.join(', ')}.`;
    }

    appendSystemNote(`✓ ${restState.type === 'short' ? 'Short' : 'Long'} rest taken — ${newHpCur}/${newHpMax} HP`);
    // Tell the AI DM about the rest so it can continue appropriately
    sendMessage(`(Out of character — rest update: ${note})`);

  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = restState.type === 'short' ? 'Take Short Rest' : 'Take Long Rest';
  }
});

// ── New Scenario Modal ────────────────────────────────────────────────────────
function openNewScenarioModal() {
  document.getElementById('ns-name').value = '';
  document.getElementById('ns-location').value = '';
  document.getElementById('ns-difficulty').value = 'Medium';
  document.getElementById('ns-description').value = '';
  document.getElementById('ns-hook').value = '';
  document.getElementById('ns-keywords').value = '';
  document.getElementById('ns-gen-status').textContent = '';
  document.getElementById('ns-gen-status').className = 'ns-gen-status';
  document.getElementById('ns-save-error').style.display = 'none';
  document.getElementById('modal-new-scenario').style.display = 'flex';
}

function fillScenarioForm(s) {
  if (s.name)        document.getElementById('ns-name').value = s.name;
  if (s.location)    document.getElementById('ns-location').value = s.location;
  if (s.difficulty)  document.getElementById('ns-difficulty').value = s.difficulty;
  if (s.description) document.getElementById('ns-description').value = s.description;
  if (s.hook)        document.getElementById('ns-hook').value = s.hook;
}

document.getElementById('btn-new-scenario').addEventListener('click', openNewScenarioModal);
document.getElementById('ns-close').addEventListener('click',  () => { document.getElementById('modal-new-scenario').style.display = 'none'; });
document.getElementById('ns-cancel').addEventListener('click', () => { document.getElementById('modal-new-scenario').style.display = 'none'; });
document.getElementById('modal-new-scenario').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

document.getElementById('ns-generate-btn').addEventListener('click', async () => {
  const keywords = document.getElementById('ns-keywords').value.trim();
  const genBtn   = document.getElementById('ns-generate-btn');
  const status   = document.getElementById('ns-gen-status');

  if (!state.model) {
    status.textContent = 'Select a model on this screen first, then generate.';
    status.className = 'ns-gen-status error';
    return;
  }

  genBtn.disabled = true;
  genBtn.textContent = '⏳…';
  status.textContent = 'Generating scenario…';
  status.className = 'ns-gen-status';

  try {
    const result = await apiFetch('/api/ai-dm/scenarios/generate', {
      method: 'POST',
      body: JSON.stringify({
        keywords,
        provider:    state.provider,
        model:       state.model,
        lmStudioUrl: state.lmStudioUrl,
        apiKey:      state.apiKey || undefined,
      }),
    });
    fillScenarioForm(result.scenario);
    status.textContent = '✓ Scenario generated — review and save below.';
    status.className = 'ns-gen-status ok';
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = 'ns-gen-status error';
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = '✨ Generate';
  }
});

document.getElementById('ns-save').addEventListener('click', async () => {
  const name        = document.getElementById('ns-name').value.trim();
  const location    = document.getElementById('ns-location').value.trim();
  const difficulty  = document.getElementById('ns-difficulty').value;
  const description = document.getElementById('ns-description').value.trim();
  const hook        = document.getElementById('ns-hook').value.trim();
  const errEl       = document.getElementById('ns-save-error');
  errEl.style.display = 'none';

  if (!name)        { errEl.textContent = 'Scenario name is required.';  errEl.style.display = 'block'; return; }
  if (!description) { errEl.textContent = 'Description is required.';    errEl.style.display = 'block'; return; }
  if (!hook)        { errEl.textContent = 'Opening hook is required.';   errEl.style.display = 'block'; return; }

  const saveBtn = document.getElementById('ns-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const result = await apiFetch('/api/ai-dm/scenarios', {
      method: 'POST',
      body: JSON.stringify({ name, location: location || 'Forgotten Realms', difficulty, description, hook }),
    });
    document.getElementById('modal-new-scenario').style.display = 'none';
    await loadScenarios();
    // Auto-select the new scenario
    const newCard = document.querySelector(`[data-id="${result.id}"]`);
    if (newCard) {
      const newScenario = { id: result.id, name, location, difficulty, description, hook, isCustom: true };
      selectScenario(newScenario, newCard);
      newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
    errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Scenario';
  }
});

// ── Back button (adventure → character select) ────────────────────────────────
document.getElementById('btn-adv-back').addEventListener('click', () => {
  showScreen('screen-select');
  if (state.selectedChar) loadRecentSessions();
});

// ── Session Detail Modal (view ended adventures) ──────────────────────────────
let detailSessionId = null;

async function openSessionDetail(sessionId) {
  detailSessionId = sessionId;
  document.getElementById('sd-title').textContent = 'Loading…';
  document.getElementById('sd-meta').textContent = '';
  document.getElementById('sd-messages').innerHTML = '<div class="loading-msg">Loading adventure log…</div>';
  document.getElementById('modal-session-detail').style.display = 'flex';

  try {
    const data = await apiFetch(`/api/ai-dm/sessions/${sessionId}`);
    const { session, messages } = data;
    const date = new Date(session.startedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('sd-title').textContent = session.scenarioName;
    document.getElementById('sd-meta').textContent = `${session.characterName} · ${date} · ${session.model.split('/').pop()}`;

    const container = document.getElementById('sd-messages');
    container.innerHTML = '';
    const visible = messages.filter(m => m.role !== 'system');
    if (!visible.length) {
      container.innerHTML = '<div class="loading-msg">No messages in this adventure.</div>';
    } else {
      visible.forEach(m => {
        const div = document.createElement('div');
        div.className = `sd-msg sd-msg-${m.role === 'assistant' ? 'dm' : 'player'}`;
        div.innerHTML = `
          <div class="sd-msg-label">${m.role === 'assistant' ? 'Dungeon Master' : 'You'}</div>
          <div class="sd-msg-content">${esc(m.content)}</div>
        `;
        container.appendChild(div);
      });
    }
  } catch (e) {
    document.getElementById('sd-messages').innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
}

document.getElementById('sd-close').addEventListener('click', () => { document.getElementById('modal-session-detail').style.display = 'none'; });
document.getElementById('sd-cancel').addEventListener('click', () => { document.getElementById('modal-session-detail').style.display = 'none'; });
document.getElementById('modal-session-detail').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

document.getElementById('sd-delete').addEventListener('click', async () => {
  if (!detailSessionId) return;
  if (!confirm('Delete this adventure permanently? This cannot be undone.')) return;
  try {
    await apiFetch(`/api/ai-dm/sessions/${detailSessionId}`, { method: 'DELETE', body: '{}' });
    document.getElementById('modal-session-detail').style.display = 'none';
    await loadRecentSessions();
  } catch (e) { alert(`Error: ${e.message}`); }
});

document.getElementById('sd-continue').addEventListener('click', async () => {
  if (!detailSessionId) return;
  const btn = document.getElementById('sd-continue');
  btn.disabled = true;
  btn.textContent = 'Reopening…';
  try {
    await apiFetch(`/api/ai-dm/sessions/${detailSessionId}/reopen`, { method: 'PATCH', body: '{}' });
    document.getElementById('modal-session-detail').style.display = 'none';
    state.sessionEnded = false;
    await resumeSession(detailSessionId);
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Continue Adventure';
  }
});

// ── Summary badge (shows if summary exists) ───────────────────────────────────
function updateSummaryBadge() {
  const btn = document.getElementById('btn-summary');
  if (!btn) return;
  if (state.currentSummary) {
    btn.innerHTML = '📋 Summary <span class="summary-badge">✓</span>';
  } else {
    btn.textContent = '📋 Summary';
  }
}

// ── Summary Modal ─────────────────────────────────────────────────────────────
document.getElementById('btn-summary').addEventListener('click', () => {
  const status = document.getElementById('sum-status');
  const box    = document.getElementById('sum-text');
  if (state.currentSummary) {
    status.textContent = 'This summary was auto-generated to keep the AI context efficient. The full log is always saved.';
    box.textContent = state.currentSummary;
    box.classList.remove('empty');
  } else {
    status.textContent = 'No summary yet. Generate one to compress the adventure history for the AI.';
    box.textContent = 'No summary generated yet.';
    box.classList.add('empty');
  }
  document.getElementById('modal-summary').style.display = 'flex';
});

document.getElementById('sum-close').addEventListener('click',  () => { document.getElementById('modal-summary').style.display = 'none'; });
document.getElementById('sum-cancel').addEventListener('click', () => { document.getElementById('modal-summary').style.display = 'none'; });
document.getElementById('modal-summary').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

document.getElementById('sum-generate').addEventListener('click', async () => {
  const btn    = document.getElementById('sum-generate');
  const status = document.getElementById('sum-status');
  const box    = document.getElementById('sum-text');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  status.textContent = 'Asking the AI to summarize the adventure… this may take a moment.';
  box.textContent = '';
  box.classList.add('empty');

  try {
    const result = await apiFetch(`/api/ai-dm/sessions/${state.sessionId}/summarize`, { method: 'POST', body: '{}' });
    if (result.summary) {
      state.currentSummary = result.summary;
      updateSummaryBadge();
      box.textContent = result.summary;
      box.classList.remove('empty');
      status.textContent = 'Summary generated. Older messages will now use this summary instead of the full log when talking to the AI.';
    } else {
      status.textContent = 'The adventure is too short to summarize yet (needs at least a few exchanges).';
      box.textContent = 'Not enough conversation to summarize.';
      box.classList.add('empty');
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generate Summary';
  }
});

// ── Init — check for handoff from main app ────────────────────────────────────
(async function init() {
  await loadCharacters();

  // Check if user navigated here from the main character sheet with a character already loaded
  try {
    const raw = localStorage.getItem('aiDmHandoff');
    if (!raw) return;
    localStorage.removeItem('aiDmHandoff'); // consume immediately
    const handoff = JSON.parse(raw);
    if (!handoff?.charId) return;
    if (Date.now() - (handoff.ts || 0) > 30000) return; // expired (> 30 s)

    // Find the matching character card by name (cards don't store id, so use name)
    const card = [...document.querySelectorAll('.char-card')]
      .find(el => el.querySelector('.char-card-name')?.textContent?.trim() === handoff.charName?.trim());

    // Set state as if the user picked this character + entered their password
    state.selectedChar   = { id: handoff.charId, name: handoff.charName, has_password: !!handoff.password };
    state.charPassword   = handoff.password || '';

    if (card) card.classList.add('selected');

    // Fetch character data (validates password server-side)
    try {
      const charInfo = await apiFetch(`/api/ai-dm/characters/${handoff.charId}/data`);
      state.charData = charInfo.data;
    } catch { return; } // wrong password or char not found — fall through to normal flow

    await loadRecentSessions();
    document.getElementById('recent-sessions-wrap').style.display = 'block';
  } catch {}
})();
