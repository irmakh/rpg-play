
// ── Tab switching ──
function showTab(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'shop')     loadShopTab();
  if (name === 'loot')     loadLootTab();
  if (name === 'calendar') pcalLoad();
}

// ── D&D rules: skill → ability mapping (indices 0-17) ──
const SKILL_AB = ['dex','wis','int','str','cha','int','wis','cha','int','wis','int','wis','cha','cha','int','dex','dex','wis'];
// Acrobatics, Animal Handling, Arcana, Athletics, Deception, History,
// Insight, Intimidation, Investigation, Medicine, Nature, Perception,
// Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival

function getMod(stat) {
  const score = parseInt(document.querySelector(`[data-key="${stat}"]`)?.value) || 10;
  return Math.floor((score - 10) / 2);
}
function fmt(n) { return (n >= 0 ? '+' : '') + n; }

// ── Auto-calculate proficiency bonus from level ──
function recalcProfBonus() {
  const level = parseInt(document.querySelector('[data-key="level"]')?.value) || 0;
  if (!level) return;
  const bonus = Math.floor((level - 1) / 4) + 2;
  const el = document.querySelector('[data-key="profbonus"]');
  if (el) el.value = bonus;
}

// ── Full recalculation from ability scores + proficiency checkboxes ──
function recalcAll() {
  const prof = parseInt(document.querySelector('[data-key="profbonus"]')?.value) || 0;

  // Ability modifier circles
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (el) el.value = fmt(getMod(s));
  });

  // Saving throws: ability mod + proficiency bonus if proficient
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const isProficient = document.querySelector(`[data-key="save-prof-${s}"]`)?.checked;
    const el = document.querySelector(`[data-key="save-${s}"]`);
    if (el) el.value = fmt(getMod(s) + (isProficient ? prof : 0));
  });

  // Skills: ability mod + prof (×2 if expertise, ×1 if proficient, ×0 otherwise)
  SKILL_AB.forEach((ab, i) => {
    const isProficient = document.querySelector(`[data-key="sk-prof-${i}"]`)?.checked;
    const isExpert     = document.querySelector(`[data-key="sk-exp-${i}"]`)?.checked;
    const mult = isExpert ? 2 : (isProficient ? 1 : 0);
    const el = document.querySelector(`[data-key="sk-${i}"]`);
    if (el) el.value = fmt(getMod(ab) + prof * mult);
  });

  // Passive Perception = 10 + Perception modifier (skill index 11, WIS)
  const percProf = document.querySelector('[data-key="sk-prof-11"]')?.checked;
  const ppEl = document.querySelector('[data-key="pp"]');
  if (ppEl) ppEl.value = 10 + getMod('wis') + (percProf ? prof : 0);

  // Spellcasting: DC = 8 + prof + mod, Atk = prof + mod, Modifier = mod
  const ABILITY_MAP = {
    strength:'str', str:'str', dexterity:'dex', dex:'dex',
    constitution:'con', con:'con', intelligence:'int', int:'int',
    wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha'
  };
  const spKey = ABILITY_MAP[(document.querySelector('[data-key="sp-ability"]')?.value || '').toLowerCase().trim()];
  if (spKey) {
    const spMod = getMod(spKey);
    const dcEl  = document.querySelector('[data-key="sp-dc"]');
    const atkEl = document.querySelector('[data-key="sp-atk"]');
    const modEl = document.querySelector('[data-key="sp-mod"]');
    if (dcEl)  dcEl.value  = 8 + prof + spMod;
    if (atkEl) atkEl.value = fmt(prof + spMod);
    if (modEl) modEl.value = fmt(spMod);
  }

  recalcPreparedCount();

  // ── Auto-calc Initiative: DEX mod + equipped item bonuses + manual bonus ──
  {
    const dexMod = getMod('dex');
    const itemBonus = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.initBonus) || 0), 0);
    const manualBonus = parseInt(document.querySelector('[data-key="init-bonus"]')?.value) || 0;
    const total = dexMod + itemBonus + manualBonus;
    const initEl = document.querySelector('[data-key="init"]');
    if (initEl) initEl.value = (total >= 0 ? '+' : '') + total;
  }

  // ── Auto-calc Speed: base speed + equipped item speed bonuses ──
  {
    const speedBonus = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
    const baseEl = document.querySelector('[data-key="speed-base"]');
    const speedEl = document.querySelector('[data-key="speed"]');
    const base = parseInt(baseEl?.value) || 30;
    if (speedEl) speedEl.value = (base + speedBonus) + ' ft';
  }

  // ── Auto-calc AC: equipped armor + DEX mod + item bonuses ──
  {
    const dexMod = getMod('dex');
    const equipped = items.filter(i => i.equipped);
    const armor = equipped.find(i => i.itemType === 'armor');
    let baseAC;
    if (!armor) {
      baseAC = 10 + dexMod;
    } else if (armor.armorType === 'heavy') {
      baseAC = armor.acBase || 10;
    } else if (armor.armorType === 'medium') {
      baseAC = (armor.acBase || 10) + Math.min(2, dexMod);
    } else {
      baseAC = (armor.acBase || 10) + dexMod;
    }
    const flatBonus = equipped.reduce((s, i) => s + (parseInt(i.acBonus) || 0), 0);
    const acEl = document.querySelector('[data-key="ac"]');
    if (acEl && document.activeElement !== acEl) acEl.value = baseAC + flatBonus;
  }
}

// ── Prepared spell counter: non-cantrip rows with Prep checked ──
// Max prepared = spell ability modifier + character level (min 1)
function recalcPreparedCount() {
  let count = 0;
  document.querySelectorAll('#spell-tbl tr:not(:first-child)').forEach(tr => {
    const lvlInput = tr.querySelector('input[type=text]');          // first text input = level
    const prepChk  = tr.querySelector('input[type=checkbox]');       // 1st checkbox = Prep
    if (parseInt(lvlInput?.value) > 0 && prepChk?.checked) count++;
  });
  const ABILITY_MAP = {
    strength:'str', str:'str', dexterity:'dex', dex:'dex',
    constitution:'con', con:'con', intelligence:'int', int:'int',
    wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha'
  };
  const spKey = ABILITY_MAP[(document.querySelector('[data-key="sp-ability"]')?.value || '').toLowerCase().trim()];
  const spMod = spKey ? getMod(spKey) : 0;
  const level = parseInt(document.querySelector('[data-key="level"]')?.value) || 0;
  const maxPrep = Math.max(1, level + spMod);
  const el = document.getElementById('prep-count');
  if (el) {
    el.value = `${count} / ${maxPrep}`;
    el.style.color = count > maxPrep ? '#ff8888' : '#88ff88';
  }
}

// ── Ability score change: triggers full recalc ──
function updMod(stat) { recalcAll(); }

// ── Inspiration toggle ──
function toggleInspire() {
  document.getElementById('inspire').classList.toggle('on');
}

// ── Add / Delete rows ──
function delRow(btn) {
  const tr = btn.closest('tr');
  const isSpell = tr.closest('#spell-tbl') !== null;
  if (isSpell) {
    const name = tr.querySelector('input[type=text]')?.value?.trim() || 'this spell';
    showConfirm('Delete ' + name + '?', () => { tr.remove(); recalcPreparedCount(); });
  } else {
    tr.remove(); recalcPreparedCount(); renderWeaponsSummary();
  }
}
function toggleSpellExpand(el) { el.closest('tr').classList.toggle('spell-expanded'); }

function addWeapon() {
  const tbl = document.getElementById('wpn-tbl');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" placeholder="Name"></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="+0" style="width:46px"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack">🎲</button></div></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" placeholder="1d6 slashing"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage">🎲</button></div></td><td><input type="text" placeholder="Notes"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
  tbl.appendChild(tr);
  renderWeaponsSummary();
}

function addSpell() {
  const tbl = document.getElementById('spell-tbl');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td style="text-align:center"><input type="checkbox" onchange="recalcPreparedCount()"></td><td><input type="text" value="0" style="width:28px"></td><td><div style="display:flex;align-items:center;gap:3px"><span class="spell-tog" onclick="toggleSpellExpand(this)"></span><input type="text" placeholder="Spell name"><a href="#" class="tools-link" onclick="openSpell5e(this);return false" title="Open in 5e.tools">↗</a></div></td><td><input type="text" value="Action" style="width:70px"></td><td><input type="text" placeholder="Range" style="width:65px"></td><td style="text-align:center"><input type="checkbox"></td><td style="text-align:center"><input type="checkbox"></td><td><select class="spell-school" style="width:60px;font-size:11px;padding:1px 2px"><option value="">—</option><option value="Abj">Abj</option><option value="Conj">Conj</option><option value="Div">Div</option><option value="Ench">Ench</option><option value="Evoc">Evoc</option><option value="Illu">Illu</option><option value="Necro">Necro</option><option value="Trans">Trans</option></select></td><td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:3px"><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-v" style="width:11px;height:11px">V</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-s" style="width:11px;height:11px">S</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-m" style="width:11px;height:11px" onchange="spellMChange(this)">M</label></div></td><td><input type="text" placeholder="Notes"><input type="text" class="spell-mat" placeholder="Material…" style="display:none;width:100%;font-size:10px;margin-top:2px"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
  tbl.appendChild(tr);
}

function spellMChange(cb) {
  const mat = cb.closest('tr').querySelector('.spell-mat');
  if (mat) mat.style.display = cb.checked ? 'block' : 'none';
}

// ── Data collection / application ──
function collectData() {
  const out = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.type === 'checkbox') out[el.dataset.key] = el.checked;
    else out[el.dataset.key] = el.value;
  });
  out['_inspire'] = document.getElementById('inspire').classList.contains('on');
  // Weapon rows
  const wpnRows = [];
  document.querySelectorAll('#wpn-tbl tr:not(:first-child)').forEach(tr => {
    const inp = tr.querySelectorAll('input[type=text], input[type=number]');
    if (inp.length >= 4) wpnRows.push([inp[0].value, inp[1].value, inp[2].value, inp[3].value, tr.dataset.itemId ? parseInt(tr.dataset.itemId) : null]);
  });
  out['_weapons'] = JSON.stringify(wpnRows);
  // Spell rows: [lvl, name, time, range, conc, ritual, notes, prepared, school, v, s, m, material]
  const spRows = [];
  document.querySelectorAll('#spell-tbl tr:not(:first-child)').forEach(tr => {
    const txts = tr.querySelectorAll('input[type=text], input[type=number]');
    const chks = tr.querySelectorAll('input[type=checkbox]');
    if (txts.length >= 4) spRows.push([
      txts[0].value, txts[1].value, txts[2].value, txts[3].value,
      chks[1]?.checked || false, chks[2]?.checked || false,
      txts[4]?.value || '', chks[0]?.checked || false,
      tr.querySelector('.spell-school')?.value || '',
      tr.querySelector('.spell-v')?.checked || false,
      tr.querySelector('.spell-s')?.checked || false,
      tr.querySelector('.spell-m')?.checked || false,
      tr.querySelector('.spell-mat')?.value || ''
    ]);
  });
  out['_spells'] = JSON.stringify(spRows);
  out['_rollHistory'] = JSON.stringify(rollHistory.map(e => ({...e, time: e.time.toISOString()})));
  out['_items'] = JSON.stringify(items);
  out['_itemIdCounter'] = itemIdCounter;
  out['_loots'] = JSON.stringify(claimedLoots);
  return out;
}

function clearSheet() {
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  });
  document.getElementById('inspire').classList.remove('on');
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (el) el.value = '+0';
  });
  document.querySelectorAll('#wpn-tbl tr:not(:first-child)').forEach(r => r.remove());
  document.querySelectorAll('#spell-tbl tr:not(:first-child)').forEach(r => r.remove());
  const pc = document.getElementById('prep-count');
  if (pc) { pc.value = ''; pc.style.color = ''; }
  rollHistory.length = 0;
  renderRollHistory();
  items = [];
  itemIdCounter = 0;
  renderItems();
  claimedLoots = [];
  renderClaimedLoots();
  mediaList = [];
  renderMedia();
  updatePortraitHeader();
}

function applyData(d) {
  if (!d) return;
  document.querySelectorAll('[data-key]').forEach(el => {
    const v = d[el.dataset.key];
    if (v === undefined) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  // Inspiration
  if (d['_inspire']) document.getElementById('inspire').classList.add('on');
  else document.getElementById('inspire').classList.remove('on');
  // Weapons
  if (d['_weapons']) {
    let rows; try { rows = JSON.parse(d['_weapons']); } catch { rows = []; }
    const tbl = document.getElementById('wpn-tbl');
    tbl.querySelectorAll('tr:not(:first-child)').forEach(r => r.remove());
    rows.forEach(r => {
      const tr = document.createElement('tr');
      if (r[4]) tr.dataset.itemId = r[4];
      tr.innerHTML = `<td><input type="text" value="${esc(r[0])}"></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(r[1])}" style="width:46px"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack">🎲</button></div></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(r[2])}"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage">🎲</button></div></td><td><input type="text" value="${esc(r[3]||'')}" ></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
      tbl.appendChild(tr);
    });
  }
  // Spells — index 7 = prepared checkbox
  if (d['_spells']) {
    let rows; try { rows = JSON.parse(d['_spells']); } catch { rows = []; }
    const tbl = document.getElementById('spell-tbl');
    tbl.querySelectorAll('tr:not(:first-child)').forEach(r => r.remove());
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const bold = r[0] !== '0' ? 'bold' : 'normal';
      const school = r[8] || '';
      const rv = !!r[9], rs = !!r[10], rm = !!r[11], rmat = r[12] || '';
      const schoolOpts = ['','Abj','Conj','Div','Ench','Evoc','Illu','Necro','Trans'].map(o => `<option value="${o}" ${school===o?'selected':''}>${o||'—'}</option>`).join('');
      tr.innerHTML = `<td style="text-align:center"><input type="checkbox" onchange="recalcPreparedCount()" ${r[7]?'checked':''}></td><td><input type="text" value="${esc(r[0])}" style="width:28px"></td><td><div style="display:flex;align-items:center;gap:3px"><span class="spell-tog" onclick="toggleSpellExpand(this)"></span><input type="text" value="${esc(r[1])}" style="font-weight:${bold}"><a href="#" class="tools-link" onclick="openSpell5e(this);return false" title="Open in 5e.tools">↗</a></div></td><td><input type="text" value="${esc(r[2])}" style="width:70px"></td><td><input type="text" value="${esc(r[3])}" style="width:65px"></td><td style="text-align:center"><input type="checkbox" ${r[4]?'checked':''}></td><td style="text-align:center"><input type="checkbox" ${r[5]?'checked':''}></td><td><select class="spell-school" style="width:60px;font-size:11px;padding:1px 2px">${schoolOpts}</select></td><td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:3px"><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-v" style="width:11px;height:11px" ${rv?'checked':''}>V</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-s" style="width:11px;height:11px" ${rs?'checked':''}>S</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-m" style="width:11px;height:11px" onchange="spellMChange(this)" ${rm?'checked':''}>M</label></div></td><td><input type="text" value="${esc(r[6]||'')}"><input type="text" class="spell-mat" placeholder="Material…" value="${esc(rmat)}" style="display:${rm?'block':'none'};width:100%;font-size:10px;margin-top:2px"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
      tbl.appendChild(tr);
    });
  }
  // Migrate speed: if speed-base not saved, derive from speed field
  if (!d['speed-base'] && d['speed']) {
    const parsed = parseInt(d['speed']);
    if (!isNaN(parsed)) d['speed-base'] = String(parsed);
  }
  // Items — migrate legacy 'item' type to 'wondrous'
  items = [];
  itemIdCounter = 0;
  if (d['_items']) {
    try { items = JSON.parse(d['_items']); } catch {}
  }
  items.forEach(i => { if (i.itemType === 'item') i.itemType = 'wondrous'; });
  itemIdCounter = parseInt(d['_itemIdCounter']) || (items.length > 0 ? Math.max(...items.map(i => i.id)) : 0);
  renderItems();
  // Roll history
  rollHistory.length = 0;
  if (d['_rollHistory']) {
    let hist; try { hist = JSON.parse(d['_rollHistory']); } catch { hist = []; }
    hist.forEach(e => rollHistory.push({...e, time: new Date(e.time)}));
  }
  renderRollHistory();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  // Loots
  claimedLoots = [];
  if (d['_loots']) { try { claimedLoots = JSON.parse(d['_loots']); } catch {} }
  renderClaimedLoots();
  // Recalc all derived values from the freshly loaded data
  recalcAll();
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ── Status display ──
let statusTimer = null;
function setStatus(msg, isError) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.className = isError ? 'error' : (msg ? 'info' : '');
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 2500);
}

// ── Loading overlay ──
function showLoading(msg = 'Loading…') {
  document.getElementById('loading-label').textContent = msg;
  document.getElementById('loading-overlay').classList.add('active');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ── API + Password ──
let currentCharId = null;
let charPasswords  = {};   // { id: plaintext password for this session }
let charHasPassword = {};  // { id: bool }
let charTypes = {};        // { id: 'pc'|'npc' }
let pwMode = null;         // 'unlock' | 'set'
let pwUnlockCharId = null;
let pwSetCharId    = null;
let ncImportData   = null; // parsed XML data for new-char import

// ── Character list ──
async function loadCharacterList(skipAutoLoad = false) {
  try {
    const res = await fetch('/api/characters');
    const chars = await res.json();
    charHasPassword = {};
    charTypes = {};
    chars.forEach(c => { charHasPassword[c.id] = c.has_password; charTypes[c.id] = c.char_type || 'pc'; });
    const sel = document.getElementById('char-select');
    sel.innerHTML = '<option value="">— Select character —</option>' + chars.map(c =>
      `<option value="${c.id}">${c.has_password ? '🔒 ' : ''}${c.char_type === 'npc' ? '[NPC] ' : ''}${esc(c.name)}</option>`
    ).join('');
    if (currentCharId) sel.value = currentCharId;
    if (!skipAutoLoad && chars.length > 0) await loadCharacter(chars[0].id);
  } catch(e) {
    setStatus('Failed to load characters', true);
  }
}

// ── Show / hide the main character body ──────────────────────────────────────
function showCharBody() {
  document.getElementById('no-char-screen').style.display = 'none';
  document.getElementById('char-body').style.display = '';
}
function showNoCharScreen() {
  document.getElementById('char-body').style.display = 'none';
  document.getElementById('no-char-screen').style.display = '';
}

// ── Apply a successfully loaded character to the sheet ──
async function _applyChar(char) {
  showCharBody();
  document.getElementById('unlock-screen').style.display = 'none';
  document.querySelector('.tabs').style.display = '';
  document.querySelectorAll('.page').forEach(p => { p.style.display = ''; });
  document.querySelector('.btn-bar').style.display = '';
  currentCharId = char.id;
  document.getElementById('char-select').value = char.id;
  clearSheet();
  applyData(char.data);
  document.getElementById('char-title').textContent = char.name || 'Character Sheet';
  await loadMedia();
  renderShopWallet();
  syncLootDescVisibility();
}

// ── Inline unlock screen helpers ──
let unlockPendingId = null;

function showUnlockScreen(id, charName) {
  unlockPendingId = id;
  clearSheet();
  showCharBody();
  document.getElementById('char-title').textContent = 'Character Sheet';
  document.getElementById('unlock-pw-input').value = '';
  document.getElementById('unlock-err').textContent = '';
  document.getElementById('unlock-screen').style.display = '';
  document.querySelector('.tabs').style.display = 'none';
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelector('.btn-bar').style.display = 'none';
  setTimeout(() => document.getElementById('unlock-pw-input').focus(), 50);
}

function hideUnlockScreen() {
  const screen = document.getElementById('unlock-screen');
  if (!screen || screen.style.display === 'none') return; // already hidden, skip
  screen.style.display = 'none';
  document.querySelector('.tabs').style.display = '';
  document.querySelectorAll('.page').forEach(p => { p.style.display = ''; });
  document.querySelector('.btn-bar').style.display = '';
  unlockPendingId = null;
}

function unlockCancel() {
  hideUnlockScreen();
  const sel = document.getElementById('char-select');
  if (currentCharId) {
    sel.value = currentCharId;
  } else {
    sel.value = '';
    showNoCharScreen();
  }
}

async function unlockSubmit() {
  const pw = document.getElementById('unlock-pw-input').value;
  const errEl = document.getElementById('unlock-err');
  if (!pw) { errEl.textContent = 'Enter a password.'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch(`/api/characters/${unlockPendingId}`, {
      headers: { 'X-Character-Password': pw }
    });
    if (res.status === 401) {
      errEl.textContent = 'Wrong password — try again.';
      document.getElementById('unlock-pw-input').value = '';
      document.getElementById('unlock-pw-input').focus();
      return;
    }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    charPasswords[unlockPendingId] = pw;
    hideUnlockScreen();
    showLoading('Loading character…');
    try {
      await _applyChar(await res.json());
    } finally {
      hideLoading();
    }
  } catch { errEl.textContent = 'Request failed.'; }
}

// ── Load character ──
async function loadCharacter(id) {
  if (!id) return;
  // Always dismiss any visible unlock screen before attempting a new load
  hideUnlockScreen();
  showLoading('Loading character…');
  try {
    const headers = {};
    if (charPasswords[id]) headers['X-Character-Password'] = charPasswords[id];
    const res = await fetch(`/api/characters/${id}`, { headers });

    if (res.status === 401) {
      hideLoading();
      const rawName = document.querySelector(`#char-select option[value="${id}"]`)
        ?.textContent?.replace(/^🔒\s*/, '').replace(/^\[NPC\]\s*/, '') || 'Character';
      showUnlockScreen(id, rawName);
      return;
    }
    if (!res.ok) { setStatus('Character not found', true); return; }
    await _applyChar(await res.json());
  } catch(e) {
    setStatus('Failed to load character', true);
  } finally {
    hideLoading();
  }
}

// ── Save character ──
async function saveCharacter(silent = false) {
  if (!currentCharId) return;
  const data = collectData();
  _suppressSSEReload = true;
  if (!silent) showLoading('Saving…');
  const headers = { 'Content-Type': 'application/json' };
  if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
  try {
    const res = await fetch(`/api/characters/${currentCharId}`, {
      method: 'PUT', headers, body: JSON.stringify({ data })
    });
    if (!res.ok) { setStatus('Save failed', true); return; }
    const result = await res.json();
    const lockPfx = charHasPassword[currentCharId] ? '🔒 ' : '';
    const typePfx = charTypes[currentCharId] === 'npc' ? '[NPC] ' : '';
    const opt = document.querySelector(`#char-select option[value="${currentCharId}"]`);
    if (opt) opt.textContent = lockPfx + typePfx + result.name;
    document.getElementById('char-title').textContent = result.name;
    setStatus('Saved!', false);
  } catch(e) {
    setStatus('Save failed', true);
  } finally {
    if (!silent) hideLoading();
    setTimeout(() => { _suppressSSEReload = false; }, 1500);
  }
}

async function reloadCharacter() {
  if (!currentCharId) return;
  await loadCharacter(currentCharId);
  const shopTabActive = document.getElementById('tab-shop')?.classList.contains('active');
  if (shopTabActive) await loadShopTab();
  setStatus('Reloaded', false);
}

async function newCharacter() {
  ncImportData = null;
  document.querySelector('#nc-modal input[name="nc-type"][value="pc"]').checked = true;
  document.querySelector('#nc-modal input[name="nc-mode"][value="blank"]').checked = true;
  document.getElementById('nc-name').value = '';
  document.getElementById('nc-password').value = '';
  document.getElementById('nc-blank-wrap').style.display = 'block';
  document.getElementById('nc-import-wrap').style.display = 'none';
  document.getElementById('nc-template-wrap').style.display = 'none';
  document.getElementById('nc-import-name-wrap').style.display = 'none';
  document.getElementById('nc-filename').textContent = 'No file chosen';
  document.getElementById('nc-file').value = '';
  document.getElementById('nc-err').textContent = '';
  try {
    const res = await fetch('/api/characters');
    const chars = await res.json();
    const tplSel = document.getElementById('nc-template');
    tplSel.innerHTML = '<option value="">— Blank NPC —</option>' +
      chars.map(c => `<option value="${c.id}">${esc(c.name)}${c.char_type === 'npc' ? ' [NPC]' : ''}</option>`).join('');
  } catch(e) {}
  document.getElementById('nc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('nc-name').focus(), 50);
}

function ncTypeChange() {
  const type = document.querySelector('#nc-modal input[name="nc-type"]:checked').value;
  document.getElementById('nc-template-wrap').style.display = type === 'npc' ? 'block' : 'none';
}

function ncModeChange() {
  const mode = document.querySelector('#nc-modal input[name="nc-mode"]:checked').value;
  document.getElementById('nc-blank-wrap').style.display = mode === 'blank' ? 'block' : 'none';
  document.getElementById('nc-import-wrap').style.display = mode === 'import' ? 'block' : 'none';
  document.getElementById('nc-err').textContent = '';
}

function ncClose() {
  document.getElementById('nc-modal').style.display = 'none';
}

async function ncFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('nc-filename').textContent = file.name;
  ncImportData = null;
  try {
    ncImportData = xmlToCharacterData(await file.text());
    document.getElementById('nc-import-name').value = ncImportData.name || '';
    document.getElementById('nc-import-name-wrap').style.display = 'block';
    document.getElementById('nc-err').textContent = '';
  } catch(e) {
    document.getElementById('nc-err').textContent = 'Failed to parse XML: ' + e.message;
  }
}

async function ncConfirm() {
  const mode = document.querySelector('#nc-modal input[name="nc-mode"]:checked').value;
  const charType = document.querySelector('#nc-modal input[name="nc-type"]:checked').value;
  const password = document.getElementById('nc-password').value;
  const templateId = charType === 'npc' ? document.getElementById('nc-template').value : '';

  let name, dataToApply = null;
  if (mode === 'blank') {
    name = document.getElementById('nc-name').value.trim();
    if (!name) { document.getElementById('nc-err').textContent = 'Enter a character name.'; return; }
  } else {
    if (!ncImportData) { document.getElementById('nc-err').textContent = 'Choose an XML file first.'; return; }
    name = document.getElementById('nc-import-name').value.trim() || ncImportData.name || 'Imported Character';
    dataToApply = { ...ncImportData, name };
  }

  document.getElementById('nc-modal').style.display = 'none';
  try {
    const createBody = { name, char_type: charType };
    if (password) createBody.password = password;
    const createRes = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody)
    });
    const char = await createRes.json();
    charHasPassword[char.id] = char.has_password;
    charTypes[char.id] = charType;
    if (password) charPasswords[char.id] = password;

    if (!dataToApply && templateId) {
      const tplHeaders = {};
      if (charPasswords[templateId]) tplHeaders['X-Character-Password'] = charPasswords[templateId];
      const tplRes = await fetch(`/api/characters/${templateId}`, { headers: tplHeaders });
      if (tplRes.ok) {
        const tplChar = await tplRes.json();
        dataToApply = { ...tplChar.data, name, hpcur: tplChar.data.hpmax || tplChar.data.hpcur || '', conditions: '' };
      } else {
        setStatus('Template is locked — NPC created blank', false);
      }
    }

    if (dataToApply) {
      const putHeaders = { 'Content-Type': 'application/json' };
      if (password) putHeaders['X-Character-Password'] = password;
      await fetch(`/api/characters/${char.id}`, {
        method: 'PUT',
        headers: putHeaders,
        body: JSON.stringify({ data: dataToApply })
      });
    }

    const sel = document.getElementById('char-select');
    const opt = document.createElement('option');
    opt.value = char.id;
    const lockPfx = char.has_password ? '🔒 ' : '';
    const typePfx = charType === 'npc' ? '[NPC] ' : '';
    opt.textContent = lockPfx + typePfx + name;
    sel.appendChild(opt);
    await loadCharacter(char.id);
    if (mode === 'import') setStatus('Imported!', false);
    else if (templateId && dataToApply) setStatus('Created from template!', false);
  } catch(e) { setStatus('Failed to create character', true); }
}

function deleteCharacter() {
  if (!currentCharId) return;
  const sel = document.getElementById('char-select');
  const rawName = sel.options[sel.selectedIndex]?.textContent?.replace(/^🔒\s*/, '').replace(/^\[NPC\]\s*/, '') || 'this character';
  showConfirm(`Delete "${rawName}"?\nThis cannot be undone.`, async () => {
    try {
      const headers = {};
      if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
      await fetch(`/api/characters/${currentCharId}`, { method: 'DELETE', headers });
      delete charPasswords[currentCharId];
      delete charHasPassword[currentCharId];
      currentCharId = null;
      clearSheet();
      showNoCharScreen();
      await loadCharacterList(true);
    } catch(e) {
      setStatus('Failed to delete character', true);
    }
  });
}

// ── Password modal (set / change / remove) ──
function pwClose() {
  document.getElementById('pw-modal').style.display = 'none';
  pwMode = null;
}

function pwConfirm() {
  if (pwMode === 'set') _pwConfirmSet();
}

async function _pwConfirmSet() {
  const id = pwSetCharId;
  const curPw = document.getElementById('pw-cur').value;
  const newPw = document.getElementById('pw-new').value;
  if (charHasPassword[id] && !curPw) {
    document.getElementById('pw-err').textContent = 'Enter your current password.';
    return;
  }
  try {
    const body = {};
    if (curPw) body.current_password = curPw;
    if (newPw) body.new_password = newPw;
    const res = await fetch(`/api/characters/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) {
      document.getElementById('pw-err').textContent = 'Wrong current password.';
      document.getElementById('pw-cur').value = '';
      document.getElementById('pw-cur').focus();
      return;
    }
    if (!res.ok) { document.getElementById('pw-err').textContent = 'Failed to update password.'; return; }
    document.getElementById('pw-modal').style.display = 'none';
    pwMode = null;
    if (newPw) {
      charPasswords[id] = newPw;
      charHasPassword[id] = true;
    } else {
      delete charPasswords[id];
      charHasPassword[id] = false;
    }
    // Update the selector option lock icon
    const opt = document.querySelector(`#char-select option[value="${id}"]`);
    if (opt) {
      const name = opt.textContent.replace(/^🔒\s*/, '').replace(/^\[NPC\]\s*/, '');
      const lp = charHasPassword[id] ? '🔒 ' : '';
      const tp = charTypes[id] === 'npc' ? '[NPC] ' : '';
      opt.textContent = lp + tp + name;
    }
    setStatus(newPw ? 'Password set' : 'Password removed', false);
  } catch(e) {
    document.getElementById('pw-err').textContent = 'Request failed.';
  }
}

// ── Open the set/change/remove password modal ──
function managePassword() {
  if (!currentCharId) return;
  pwMode = 'set';
  pwSetCharId = currentCharId;
  const hasPw = charHasPassword[currentCharId] || false;
  document.getElementById('pw-title').textContent = hasPw ? 'Change / Remove Password' : 'Set Password';
  document.getElementById('pw-cur-wrap').style.display = hasPw ? 'block' : 'none';
  document.getElementById('pw-new-wrap').style.display  = 'block';
  document.getElementById('pw-cur').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-err').textContent = '';
  document.getElementById('pw-modal').style.display = 'flex';
  setTimeout(() => {
    if (hasPw) document.getElementById('pw-cur').focus();
    else document.getElementById('pw-new').focus();
  }, 50);
}

// ── Export character as XML download ──
function exportCharacter() {
  if (!currentCharId) return;
  const data = collectData();
  const xml = characterToXML(data);
  const filename = (data.name || 'character').replace(/[^\w\-]/g, '_') + '.xml';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'text/xml;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── XML ↔ character data ──

// Export character as <character> format — full lossless roundtrip
function characterToXML(d) {
  const xe = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cd = s => `<![CDATA[${String(s??'').replace(/]]>/g,']]&gt;')}]]>`;
  const b  = v => v ? 'true' : 'false';
  const L  = []; const p = s => L.push(s);

  p('<?xml version="1.0" encoding="UTF-8"?>');
  p('<character>');

  p('  <info>');
  ['name','class','subclass','level','background','species','xp','alignment','languages','profbonus']
    .forEach(k => p(`    <${k}>${xe(d[k])}</${k}>`));
  p('  </info>');

  p('  <abilities>');
  ['str','dex','con','int','wis','cha'].forEach(s => p(`    <${s}>${xe(d[s])}</${s}>`));
  p('  </abilities>');

  p('  <saving_throws>');
  ['str','dex','con','int','wis','cha'].forEach(s =>
    p(`    <save name="${s}" proficient="${b(d['save-prof-'+s])}">${xe(d['save-'+s])}</save>`));
  p('  </saving_throws>');

  p('  <skills>');
  SKILL_AB.forEach((ab, i) =>
    p(`    <skill id="${i}" proficient="${b(d['sk-prof-'+i])}" expertise="${b(d['sk-exp-'+i])}">${xe(d['sk-'+i])}</skill>`));
  p('  </skills>');

  p('  <combat>');
  p(`    <ac>${xe(d.ac)}</ac>`);
  p(`    <initiative>${xe(d.init)}</initiative>
    <initiative_bonus>${xe(d['init-bonus'])}</initiative_bonus>`);
  p(`    <speed>${xe(d.speed)}</speed>`);
  p(`    <hp_current>${xe(d.hpcur)}</hp_current>`);
  p(`    <hp_max>${xe(d.hpmax)}</hp_max>`);
  p(`    <hp_temp>${xe(d.hptemp)}</hp_temp>`);
  p(`    <hit_dice>${xe(d.hd)}</hit_dice>`);
  p(`    <hit_dice_spent>${xe(d.hdspent)}</hit_dice_spent>`);
  p(`    <passive_perception>${xe(d.pp)}</passive_perception>`);
  p(`    <inspiration>${b(d._inspire)}</inspiration>`);
  p(`    <death_saves successes="${[d.ds0,d.ds1,d.ds2].map(v=>v?1:0).join(',')}" failures="${[d.df0,d.df1,d.df2].map(v=>v?1:0).join(',')}"/>`);
  p('  </combat>');

  let weapons = []; try { weapons = JSON.parse(d._weapons||'[]'); } catch {}
  p('  <weapons>');
  weapons.forEach(w => {
    p(`    <weapon><name>${xe(w[0])}</name><attack>${xe(w[1])}</attack><damage>${xe(w[2])}</damage><notes>${xe(w[3])}</notes></weapon>`);
  });
  p('  </weapons>');

  p('  <spellcasting>');
  p(`    <ability>${xe(d['sp-ability'])}</ability>`);
  p(`    <spell_save_dc>${xe(d['sp-dc'])}</spell_save_dc>`);
  p(`    <spell_attack_bonus>${xe(d['sp-atk'])}</spell_attack_bonus>`);
  p(`    <spell_modifier>${xe(d['sp-mod'])}</spell_modifier>`);
  p('    <spell_slots>');
  for (let i = 1; i <= 6; i++)
    p(`      <slot level="${i}" total="${xe(d['slot-'+i+'-total'])}" used="${xe(d['slot-'+i+'-used'])}"/>`);
  p('    </spell_slots>');
  let spells = []; try { spells = JSON.parse(d._spells||'[]'); } catch {}
  p('    <spells>');
  spells.forEach(s => {
    p(`      <spell level="${xe(s[0])}" conc="${b(s[4])}" ritual="${b(s[5])}" prepared="${b(s[7])}" school="${xe(s[8]||'')}" v="${b(s[9])}" s="${b(s[10])}" m="${b(s[11])}">`);
    p(`        <name>${xe(s[1])}</name><time>${xe(s[2])}</time><range>${xe(s[3])}</range><notes>${xe(s[6]||'')}</notes>${s[11]?`<material>${xe(s[12]||'')}</material>`:''}`);
    p(`      </spell>`);
  });
  p('    </spells>');
  p('  </spellcasting>');

  p(`  <class_features>${cd(d.features)}</class_features>`);
  p(`  <feats>${cd(d.feats)}</feats>`);
  p(`  <species_traits>${cd(d.traits)}</species_traits>`);
  p('  <proficiencies>');
  p(`    <armor>${xe(d['prof-armor'])}</armor>`);
  p(`    <weapons_prof>${xe(d['prof-wpn'])}</weapons_prof>`);
  p(`    <tools>${xe(d['prof-tools'])}</tools>`);
  p(`    <equipment>${cd(d.equipment)}</equipment>`);
  p('  </proficiencies>');
  p(`  <coins cp="${xe(d.cp)}" sp="${xe(d.sp)}" ep="${xe(d.ep)}" gp="${xe(d.gp)}" pp="${xe(d.pp2)}"/>`);
  p('  <attunement>');
  p(`    <slot1>${xe(d.attune1)}</slot1><slot2>${xe(d.attune2)}</slot2><slot3>${xe(d.attune3)}</slot3>`);
  p('  </attunement>');
  p('  <items>');
  items.forEach(item => {
    p(`    <item id="${item.id}" type="${xe(item.itemType)}" armorType="${xe(item.armorType||'')}" acBase="${item.acBase||0}" equipped="${item.equipped}" requiresAttunement="${item.requiresAttunement}" attuned="${item.attuned}" acBonus="${item.acBonus||0}" initBonus="${item.initBonus||0}" speedBonus="${item.speedBonus||0}" weaponAtk="${xe(item.weaponAtk||'')}" weaponDmg="${xe(item.weaponDmg||'')}" weaponProperties="${xe(JSON.stringify(item.weaponProperties||[]))}">`);
    p(`      <name>${xe(item.name)}</name><notes>${xe(item.notes)}</notes>`);
    p(`    </item>`);
  });
  p('  </items>');
  p(`  <itemIdCounter>${itemIdCounter}</itemIdCounter>`);
  let loots = []; try { loots = JSON.parse(d._loots||'[]'); } catch {}
  p('  <loots>');
  loots.forEach(l => {
    p(`    <loot id="${xe(l.id)}"><name>${xe(l.name)}</name><description>${cd(l.description||'')}</description></loot>`);
  });
  p('  </loots>');
  p('  <notes>');
  p(`    <backstory>${cd(d.backstory)}</backstory>`);
  p(`    <appearance>${cd(d.appearance)}</appearance>`);
  p(`    <session>${cd(d.session)}</session>`);
  p(`    <conditions>${cd(d.conditions)}</conditions>`);
  p('  </notes>');
  p('</character>');
  return L.join('\n');
}

// Parse <creator> format (./gaston.xml template)
function parseCreatorFormat(doc) {
  const get = sel => doc.querySelector(sel)?.textContent?.trim() || '';
  const d = {};

  d.name       = get('name');
  d.class      = get('className');
  d.subclass   = get('subClassName');
  d.level      = get('level1') || '1';
  d.background = get('backName');
  d.species    = get('speciesName');
  d.xp         = get('XP') || '0';

  // Alignment (0=LG,1=LN,2=LE,3=NG,4=TN,5=NE,6=CG,7=CN,8=CE)
  const ALIGNS = ['Lawful Good','Lawful Neutral','Lawful Evil','Neutral Good','True Neutral',
    'Neutral Evil','Chaotic Good','Chaotic Neutral','Chaotic Evil'];
  d.alignment = ALIGNS[parseInt(get('align'))] || '';

  // Ability scores: base + racial bonus
  ['str','dex','con','int','wis','cha'].forEach(s => {
    d[s] = String((parseInt(get(s))||0) + (parseInt(get('b'+s))||0));
  });

  const lvl = parseInt(d.level) || 1;
  d.profbonus = String(Math.floor((lvl - 1) / 4) + 2);

  // Skills: proficiency from skillC + skillB; expertise from skillE
  const parseIdxList = raw => raw.split(',').map(x=>parseInt(x.trim())).filter(n=>!isNaN(n) && n>0);
  const profSet = new Set([...parseIdxList(get('skillC')), ...parseIdxList(get('skillB'))]);
  const expRaw  = get('skillE');
  const expIdxs = expRaw ? expRaw.split(',').map(x=>parseInt(x.trim())).filter(n=>!isNaN(n) && n>=0) : [];
  const expSet  = new Set(expIdxs);
  expIdxs.forEach(i => profSet.add(i)); // expertise implies proficiency
  for (let i = 0; i < 18; i++) {
    d['sk-prof-'+i] = profSet.has(i);
    d['sk-exp-'+i]  = expSet.has(i);
  }

  // Save proficiencies by class
  const SAVES = {
    'Wizard':['int','wis'],'Sorcerer':['con','cha'],'Warlock':['wis','cha'],
    'Cleric':['wis','cha'],'Druid':['int','wis'],'Bard':['dex','cha'],
    'Fighter':['str','con'],'Ranger':['str','dex'],'Rogue':['dex','int'],
    'Paladin':['wis','cha'],'Barbarian':['str','con'],'Monk':['str','dex'],
    'Artificer':['con','int']
  };
  const saveSet = new Set(SAVES[d.class] || []);
  ['str','dex','con','int','wis','cha'].forEach(s => { d['save-prof-'+s] = saveSet.has(s); });

  // HP: sum per-level values (index 1..level) + CON mod per level
  const hpRaw  = get('hp').split(',').map(x => parseInt(x));
  const conMod = Math.floor(((parseInt(d.con)||10) - 10) / 2);
  let hpSum = 0;
  for (let i = 1; i <= lvl; i++) hpSum += (isNaN(hpRaw[i]) ? 0 : hpRaw[i]) + conMod;
  d.hpmax = String(Math.max(hpSum, lvl));
  d.hpcur = d.hpmax; d.hptemp = '0';

  // Hit dice by class
  const HD = {'Wizard':'d6','Sorcerer':'d6','Warlock':'d8','Cleric':'d8','Druid':'d8',
    'Bard':'d8','Rogue':'d8','Monk':'d8','Artificer':'d8',
    'Ranger':'d10','Fighter':'d10','Paladin':'d10','Barbarian':'d12'};
  d.hd = lvl + (HD[d.class] || 'd8'); d.hdspent = '0';

  // Spellcasting ability by class
  const SP_AB = {'Wizard':'Intelligence','Sorcerer':'Charisma','Warlock':'Charisma',
    'Cleric':'Wisdom','Druid':'Wisdom','Bard':'Charisma','Paladin':'Charisma',
    'Ranger':'Wisdom','Artificer':'Intelligence'};
  d['sp-ability'] = SP_AB[d.class] || '';

  // Full caster spell slot table (slots for levels 1-6, indexed by char level 1-20)
  const FC = [null,
    [2,0,0,0,0,0],[3,0,0,0,0,0],[4,2,0,0,0,0],[4,3,0,0,0,0],[4,3,2,0,0,0],
    [4,3,3,0,0,0],[4,3,3,1,0,0],[4,3,3,2,0,0],[4,3,3,3,1,0],[4,3,3,3,2,0],
    [4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1],
    [4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,3,1],[4,3,3,3,3,2],[4,3,3,3,3,2]
  ];
  const FULL = new Set(['Wizard','Sorcerer','Cleric','Druid','Bard']);
  const slots = (FULL.has(d.class) ? FC[Math.min(lvl,20)] : null) || [0,0,0,0,0,0];
  for (let i = 1; i <= 6; i++) {
    d['slot-'+i+'-total'] = String(slots[i-1]||0); d['slot-'+i+'-used'] = '0';
  }

  // Spells from spells0-spells9 (filter empty names)
  const spells = [];
  for (let sl = 0; sl <= 9; sl++) {
    const raw = get('spells'+sl);
    if (raw) raw.split(',').map(s=>s.trim()).filter(s=>s).forEach(name => {
      spells.push([String(sl), name, 'Action', '', false, false, '', false]);
    });
  }
  d._spells = JSON.stringify(spells);

  // Weapons: one per line "name,count,..." — multi-weapon support
  const weapons = [];
  get('weapons').split('\n').forEach(line => {
    line = line.trim(); if (!line) return;
    const parts = line.split(',');
    const wName = (parts[0]||'').trim(), wCount = parseInt(parts[1])||1;
    if (wName) weapons.push([wName + (wCount > 1 ? ` (${wCount})` : ''), '', '', '']);
  });
  d._weapons = JSON.stringify(weapons);

  d.equipment  = get('equipment');
  d.cp=get('cp')||'0'; d.sp=get('sp')||'0'; d.ep=get('ep')||'0';
  d.gp=get('gp')||'0'; d.pp2=get('pp')||'0';
  d.attune1=get('attun1'); d.attune2=get('attun2'); d.attune3=get('attun3');

  // Feats: filter empty entries from comma-separated list
  d.feats = get('feats').split(',').map(s=>s.trim()).filter(s=>s).join('\n');

  // Tool proficiencies
  d['prof-tools'] = get('tool').split(',').map(s=>s.trim()).filter(s=>s).join(', ');
  d['prof-armor'] = ''; d['prof-wpn'] = ''; d.languages = '';

  d.ac = '10'; d.init = '+0'; d['init-bonus'] = '0'; d.speed = '30 ft';
  d._inspire = false; d.ds0=d.ds1=d.ds2=d.df0=d.df1=d.df2 = false;

  const bs = get('backstory'), ap = get('appearance');
  d.backstory  = bs === '...' ? '' : bs;
  d.appearance = ap === '...' ? '' : ap;
  d.session = ''; d.conditions = '';

  return d;
}

// Auto-detect XML format and dispatch to appropriate parser
function xmlToCharacterData(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  // <creator> format (./gaston.xml template)
  if (doc.querySelector('creator')) return parseCreatorFormat(doc);

  // <character> format (our own export format)
  const get  = sel => doc.querySelector(sel)?.textContent?.trim() || '';
  const attr = (sel, a) => doc.querySelector(sel)?.getAttribute(a) || '';
  const d = {};

  ['name','subclass','level','background','species','xp','alignment','languages','profbonus']
    .forEach(k => { d[k] = get('info > ' + k); });
  d.class = get('info > class');
  ['str','dex','con','int','wis','cha'].forEach(s => { d[s] = get('abilities > ' + s); });

  doc.querySelectorAll('saving_throws > save').forEach(el => {
    const n = el.getAttribute('name');
    d['save-prof-'+n] = el.getAttribute('proficient') === 'true';
    d['save-'+n] = el.textContent.trim();
  });
  doc.querySelectorAll('skills > skill').forEach(el => {
    const i = el.getAttribute('id');
    d['sk-prof-'+i] = el.getAttribute('proficient') === 'true';
    d['sk-exp-'+i]  = el.getAttribute('expertise')  === 'true';
    d['sk-'+i] = el.textContent.trim();
  });

  d.ac=get('combat > ac'); d.init=get('combat > initiative'); d['init-bonus']=get('combat > initiative_bonus')||'0'; d.speed=get('combat > speed');
  d.hpcur=get('combat > hp_current'); d.hpmax=get('combat > hp_max'); d.hptemp=get('combat > hp_temp');
  d.hd=get('combat > hit_dice'); d.hdspent=get('combat > hit_dice_spent');
  d.pp=get('combat > passive_perception'); d._inspire=get('combat > inspiration')==='true';
  const ds=attr('combat > death_saves','successes').split(',');
  const df=attr('combat > death_saves','failures').split(',');
  d.ds0=ds[0]==='1'; d.ds1=ds[1]==='1'; d.ds2=ds[2]==='1';
  d.df0=df[0]==='1'; d.df1=df[1]==='1'; d.df2=df[2]==='1';

  const weapons = [];
  doc.querySelectorAll('weapons > weapon').forEach(w => weapons.push([
    w.querySelector('name')?.textContent?.trim()||'',
    w.querySelector('attack')?.textContent?.trim()||'',
    w.querySelector('damage')?.textContent?.trim()||'',
    w.querySelector('notes')?.textContent?.trim()||''
  ]));
  d._weapons = JSON.stringify(weapons);

  d['sp-ability']=get('spellcasting > ability');
  d['sp-dc']=get('spellcasting > spell_save_dc');
  d['sp-atk']=get('spellcasting > spell_attack_bonus');
  d['sp-mod']=get('spellcasting > spell_modifier');
  doc.querySelectorAll('spell_slots > slot').forEach(el => {
    const lv=el.getAttribute('level');
    d['slot-'+lv+'-total']=el.getAttribute('total')||'0';
    d['slot-'+lv+'-used']=el.getAttribute('used')||'0';
  });
  const spells = [];
  doc.querySelectorAll('spellcasting > spells > spell').forEach(el => spells.push([
    el.getAttribute('level')||'0',
    el.querySelector('name')?.textContent?.trim()||'',
    el.querySelector('time')?.textContent?.trim()||'',
    el.querySelector('range')?.textContent?.trim()||'',
    el.getAttribute('conc')==='true',
    el.getAttribute('ritual')==='true',
    el.querySelector('notes')?.textContent?.trim()||'',
    el.getAttribute('prepared')==='true',
    el.getAttribute('school')||'',
    el.getAttribute('v')==='true',
    el.getAttribute('s')==='true',
    el.getAttribute('m')==='true',
    el.querySelector('material')?.textContent?.trim()||''
  ]));
  d._spells = JSON.stringify(spells);

  d.features=get('class_features'); d.feats=get('feats'); d.traits=get('species_traits');
  d['prof-armor']=get('proficiencies > armor');
  d['prof-wpn']=get('proficiencies > weapons_prof');
  d['prof-tools']=get('proficiencies > tools');
  d.equipment=get('proficiencies > equipment');

  const coins=doc.querySelector('coins');
  d.cp=coins?.getAttribute('cp')||'0'; d.sp=coins?.getAttribute('sp')||'0';
  d.ep=coins?.getAttribute('ep')||'0'; d.gp=coins?.getAttribute('gp')||'0';
  d.pp2=coins?.getAttribute('pp')||'0';

  d.attune1=get('attunement > slot1'); d.attune2=get('attunement > slot2'); d.attune3=get('attunement > slot3');
  d.backstory=get('notes > backstory'); d.appearance=get('notes > appearance');
  d.session=get('notes > session'); d.conditions=get('notes > conditions');

  const itemEls = doc.querySelectorAll('items > item');
  const parsedItems = [];
  itemEls.forEach(el => {
    parsedItems.push({
      id: parseInt(el.getAttribute('id')) || 0,
      name: el.querySelector('name')?.textContent?.trim() || '',
      itemType: el.getAttribute('type') || 'item',
      armorType: el.getAttribute('armorType') || 'light',
      acBase: parseInt(el.getAttribute('acBase')) || 10,
      equipped: el.getAttribute('equipped') === 'true',
      requiresAttunement: el.getAttribute('requiresAttunement') === 'true',
      attuned: el.getAttribute('attuned') === 'true',
      acBonus: parseInt(el.getAttribute('acBonus')) || 0,
      initBonus: parseInt(el.getAttribute('initBonus')) || 0,
      speedBonus: parseInt(el.getAttribute('speedBonus')) || 0,
      weaponAtk: el.getAttribute('weaponAtk') || '',
      weaponDmg: el.getAttribute('weaponDmg') || '',
      weaponProperties: (() => { try { return JSON.parse(el.getAttribute('weaponProperties') || '[]'); } catch { return []; } })(),
      notes: el.querySelector('notes')?.textContent?.trim() || ''
    });
  });
  d._items = JSON.stringify(parsedItems);
  d._itemIdCounter = get('itemIdCounter') || '0';

  const parsedLoots = [];
  doc.querySelectorAll('loots > loot').forEach(el => {
    parsedLoots.push({
      id: el.getAttribute('id') || ('manual-' + Date.now()),
      name: el.querySelector('name')?.textContent?.trim() || '',
      description: el.querySelector('description')?.textContent?.trim() || ''
    });
  });
  d._loots = JSON.stringify(parsedLoots);

  return d;
}

// ── 5e.tools links ──
function openSpell5e(el) {
  const name = el.closest('td').querySelector('input[type=text]').value.trim();
  if (!name) return;
  window.open('https://5e.tools/spells.html#' + name.toLowerCase() + '_xphb', '_blank');
}

function open5e(dataKey, page) {
  const val = document.querySelector(`[data-key="${dataKey}"]`)?.value?.trim();
  if (!val) return;
  window.open('https://5e.tools/' + page + '.html#' + val.toLowerCase() + '_xphb', '_blank');
}

function openFeats5e() {
  const val = document.querySelector('[data-key="feats"]')?.value || '';
  val.split('\n').map(s => s.trim()).filter(s => s).forEach(feat => {
    window.open('https://5e.tools/feats.html#' + feat.toLowerCase() + '_xphb', '_blank');
  });
}

// ── Theme ──
function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('dnd-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('dnd-theme') || 'parchment'); })();

// ── Dice rolling ──
const SKILL_NAMES = ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];
const AB_NAMES = {str:'Strength',dex:'Dexterity',con:'Constitution',int:'Intelligence',wis:'Wisdom',cha:'Charisma'};

let rollPending = null;
const rollHistory = [];
let toastTimer = null;
let items = [];
let itemIdCounter = 0;
let editingItemId = null;
let toastDismissHandler = null;

function startRoll(label, modifier) {
  rollPending = { label, modifier: parseInt(modifier) || 0 };
  document.getElementById('adv-label').textContent = 'Roll: ' + label;
  document.getElementById('adv-modal').style.display = 'flex';
}

function advClose() {
  document.getElementById('adv-modal').style.display = 'none';
  rollPending = null;
}

function confirmRoll(type) {
  if (!rollPending) return;
  document.getElementById('adv-modal').style.display = 'none';
  const { label, modifier, isInitiative, initCharName } = rollPending;
  rollPending = null;
  const d1 = Math.ceil(Math.random() * 20);
  const d2 = Math.ceil(Math.random() * 20);
  let used, detail;
  if (type === 'adv') {
    used = Math.max(d1, d2);
    detail = `d20(${d1}, ${d2} → ${used})`;
  } else if (type === 'dis') {
    used = Math.min(d1, d2);
    detail = `d20(${d1}, ${d2} → ${used})`;
  } else {
    used = d1;
    detail = `d20(${d1})`;
  }
  if (modifier !== 0) detail += (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier);
  const total = used + modifier;
  const entry = { time: new Date(), label, type, detail, total, isCrit: used === 20, isFail: used === 1, isDamage: false };
  pushRoll(entry);
  showToast(entry);
  if (isInitiative) submitInitiativeRoll(total, initCharName);
  const chatLabel = type === 'adv' ? `${label} (Adv)` : type === 'dis' ? `${label} (Dis)` : label;
  postToChat({ sender: getChatSender(), dice: '1d20', results: [used], modifier, total, label: chatLabel });
}

function parseDice(expr) {
  if (!expr) return null;
  // Strip all whitespace and trailing damage type text (e.g. "slashing", "piercing")
  const cleaned = String(expr).trim().replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)((?:[+\-]\d+)*)/);
  if (!m) {
    const flat = parseInt(cleaned);
    if (!isNaN(flat)) return { total: flat, detail: String(flat) };
    return null;
  }
  const num = parseInt(m[1]), die = parseInt(m[2]);
  // Sum all bonus groups (handles "1d8+3+1" or "1d8-2+5" correctly)
  let mod = 0;
  (m[3] || '').match(/[+\-]\d+/g)?.forEach(s => { mod += parseInt(s); });
  const rolls = Array.from({ length: num }, () => Math.ceil(Math.random() * die));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  let detail = `${num}d${die}(${rolls.join(',')})`;
  if (mod !== 0) detail += (mod > 0 ? '+' : '') + mod;
  return { total, detail, rolls, die, num, mod, diceExpr: `${num}d${die}` };
}

function rollDamage(label, expr) {
  const result = parseDice(expr.trim());
  if (!result) return;
  const entry = { time: new Date(), label, type: 'dmg', detail: result.detail, total: result.total, isCrit: false, isFail: false, isDamage: true };
  pushRoll(entry);
  showToast(entry);
  postToChat({ sender: getChatSender(), dice: result.diceExpr || String(result.total), results: result.rolls || [result.total], modifier: result.mod || 0, total: result.total, label });
}

function rollWeaponAtk(btn) {
  const row = btn.closest('tr');
  const inputs = row.querySelectorAll('input[type=text], input[type=number]');
  startRoll((inputs[0]?.value || 'Weapon') + ' Attack', inputs[1]?.value || '+0');
}

function rollWeaponDmg(btn) {
  const row = btn.closest('tr');
  const inputs = row.querySelectorAll('input[type=text], input[type=number]');
  rollDamage((inputs[0]?.value || 'Weapon') + ' Damage', inputs[2]?.value || '1d6');
}

function showToast(entry) {
  clearTimeout(toastTimer);
  if (toastDismissHandler) { document.removeEventListener('click', toastDismissHandler); toastDismissHandler = null; }
  document.getElementById('toast-label').textContent = entry.label;
  const badge = document.getElementById('toast-badge');
  if (entry.isDamage)        { badge.textContent = 'Damage';       badge.className = 'toast-badge dmg'; }
  else if (entry.type==='adv') { badge.textContent = 'Advantage';   badge.className = 'toast-badge adv'; }
  else if (entry.type==='dis') { badge.textContent = 'Disadvantage';badge.className = 'toast-badge dis'; }
  else                         { badge.textContent = 'Normal';      badge.className = 'toast-badge norm'; }
  const tot = document.getElementById('toast-total');
  tot.textContent = entry.total;
  tot.className = 'toast-total' + (entry.isCrit ? ' crit' : entry.isFail ? ' fail' : '');
  document.getElementById('toast-detail').textContent = entry.detail;
  document.getElementById('roll-toast').style.display = 'block';
  toastTimer = setTimeout(hideToast, 30000);
  setTimeout(() => {
    toastDismissHandler = () => hideToast();
    document.addEventListener('click', toastDismissHandler, { once: true });
  }, 200);
}

function hideToast() {
  clearTimeout(toastTimer);
  if (toastDismissHandler) { document.removeEventListener('click', toastDismissHandler); toastDismissHandler = null; }
  document.getElementById('roll-toast').style.display = 'none';
}

let _autoSaveTimer = null;
let _suppressSSEReload = false;
let _initEditMode = false;
let _spAtkEditMode = false;

function setInitEditMode() {
  const el = document.querySelector('[data-key="init"]');
  if (!el) return;
  _initEditMode = true;
  el.classList.remove('rollable');
  el.focus();
  el.select();
}
function setSpAtkEditMode() {
  const el = document.querySelector('[data-key="sp-atk"]');
  if (!el) return;
  _spAtkEditMode = true;
  el.classList.remove('rollable');
  el.focus();
  el.select();
}
function pushRoll(entry) {
  rollHistory.unshift(entry);
  if (rollHistory.length > 100) rollHistory.pop();
  renderRollHistory();
  // Auto-save so the roll history syncs to all connected browsers in real time
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => saveCharacter(true), 600);
}

function renderRollHistory() {
  const list = document.getElementById('rh-list');
  if (!list) return;
  if (rollHistory.length === 0) {
    list.innerHTML = '<li style="color:var(--txd);font-size:12px;padding:8px">No rolls yet — click any modifier on the sheet to roll!</li>';
    return;
  }
  const pad = n => String(n).padStart(2,'0');
  list.innerHTML = rollHistory.map(e => {
    const t = e.time;
    const tStr = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    const bc = e.isDamage ? 'dmg' : e.type === 'adv' ? 'adv' : e.type === 'dis' ? 'dis' : 'norm';
    const bl = e.isDamage ? 'DMG' : e.type === 'adv' ? 'ADV' : e.type === 'dis' ? 'DIS' : 'NRM';
    const tc = e.isCrit ? ' crit' : e.isFail ? ' fail' : '';
    return `<li class="rh-row"><span class="rh-time">${tStr}</span><span class="rh-label">${esc(e.label)}</span><span class="rh-badge ${bc}">${bl}</span><span class="rh-detail">${esc(e.detail)}</span><span class="rh-total${tc}">${e.total}</span></li>`;
  }).join('');
}

function clearRollHistory() {
  rollHistory.length = 0;
  renderRollHistory();
}

// ── Equipment & Items ──
function openItemModal(id) {
  editingItemId = id;
  document.getElementById('item-modal-title').textContent = id === null ? 'Add Item' : 'Edit Item';
  if (id === null) {
    document.getElementById('im-name').value = '';
    document.getElementById('im-type').value = 'wondrous';
    document.getElementById('im-armor-type').value = 'light';
    document.getElementById('im-ac-base').value = '10';
    document.getElementById('im-value').value = '';
    document.getElementById('im-equipped').checked = true;
    document.getElementById('im-req-attune').checked = false;
    document.getElementById('im-attuned').checked = false;
    document.getElementById('im-ac-bonus').value = '0';
    document.getElementById('im-init-bonus').value = '0';
    document.getElementById('im-speed-bonus').value = '0';
    document.getElementById('im-weapon-atk').value = '0';
    document.getElementById('im-weapon-dmg').value = '';
    initItemPropsGrid(); setSelectedItemProps([]);
    document.getElementById('im-notes').value = '';
  } else {
    const item = items.find(i => i.id === id);
    if (!item) return;
    document.getElementById('im-name').value = item.name;
    // Map legacy 'item' type to 'wondrous'
    document.getElementById('im-type').value = item.itemType === 'item' ? 'wondrous' : item.itemType;
    document.getElementById('im-armor-type').value = item.armorType || 'light';
    document.getElementById('im-ac-base').value = item.acBase || 10;
    document.getElementById('im-value').value = item.value || '';
    document.getElementById('im-equipped').checked = item.equipped;
    document.getElementById('im-req-attune').checked = item.requiresAttunement;
    document.getElementById('im-attuned').checked = item.attuned;
    document.getElementById('im-ac-bonus').value = item.acBonus || 0;
    document.getElementById('im-init-bonus').value = item.initBonus || 0;
    document.getElementById('im-speed-bonus').value = item.speedBonus || 0;
    document.getElementById('im-weapon-atk').value = item.weaponAtk || '0';
    document.getElementById('im-weapon-dmg').value = item.weaponDmg || '';
    initItemPropsGrid(); setSelectedItemProps(item.weaponProperties || []);
    document.getElementById('im-notes').value = item.notes || '';
  }
  itemTypeChange();
  itemAttuneChange();
  document.getElementById('item-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('im-name').focus(), 50);
}

function closeItemModal() {
  document.getElementById('item-modal').style.display = 'none';
  editingItemId = null;
}

// ── Weapon properties for item modal ──
const ITEM_WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

function initItemPropsGrid() {
  const grid = document.getElementById('im-props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = ITEM_WEAPON_PROPS.map(p =>
    `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px">
      <input type="checkbox" id="iw-prop-${p.replace(/[^a-zA-Z]/g,'').toLowerCase()}" value="${p}" onchange="onItemPropChange()" style="width:13px;height:13px;accent-color:var(--ac)">
      ${p}</label>`
  ).join('');
}

function getSelectedItemProps() {
  return ITEM_WEAPON_PROPS.filter(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    return el && el.checked;
  });
}

function setSelectedItemProps(props) {
  ITEM_WEAPON_PROPS.forEach(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    if (el) el.checked = Array.isArray(props) && props.includes(p);
  });
  updateItemPropsLimit();
}

function onItemPropChange() {
  const selected = getSelectedItemProps();
  if (selected.length > 3) {
    document.getElementById('iw-prop-' + selected[selected.length - 1].replace(/[^a-zA-Z]/g,'').toLowerCase()).checked = false;
  }
  updateItemPropsLimit();
}

function updateItemPropsLimit() {
  const selected = getSelectedItemProps();
  const atMax = selected.length >= 3;
  const counter = document.getElementById('im-props-count');
  if (counter) counter.textContent = `(${selected.length}/3)`;
  ITEM_WEAPON_PROPS.forEach(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    if (el) el.disabled = atMax && !el.checked;
  });
}

function calcWeaponAtkStr(magicBonus, props) {
  const strMod = getMod('str'), dexMod = getMod('dex');
  const prof = parseInt(document.querySelector('[data-key="profbonus"]')?.value) || 0;
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod : strMod;
  const total = prof + abilityMod + magicBonus;
  return (total >= 0 ? '+' : '') + total;
}

function calcWeaponDmgStr(magicBonus, dmgRaw, props) {
  const strMod = getMod('str'), dexMod = getMod('dex');
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod : strMod;
  const raw = (dmgRaw || '1d4').trim();
  const spaceIdx = raw.indexOf(' ');
  const dicePart = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
  const typePart = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();
  const dmgBonus = abilityMod + magicBonus;
  return dmgBonus > 0 ? `${dicePart}+${dmgBonus}${typePart ? ' ' + typePart : ''}`
       : dmgBonus < 0 ? `${dicePart}${dmgBonus}${typePart ? ' ' + typePart : ''}`
       : raw;
}

function syncWeaponItemToAttacks(item) {
  const props = item.weaponProperties || [];
  const magic = parseInt(item.weaponAtk) || 0;
  const atkStr = calcWeaponAtkStr(magic, props);
  const dmgStr = calcWeaponDmgStr(magic, item.weaponDmg, props);
  const notes = item.notes || '';
  const existing = document.querySelector(`#wpn-tbl tr[data-item-id="${item.id}"]`);
  if (existing) {
    const inp = existing.querySelectorAll('input[type=text], input[type=number]');
    if (inp[0]) inp[0].value = item.name;
    if (inp[1]) inp[1].value = atkStr;
    if (inp[2]) inp[2].value = dmgStr;
    if (inp[3]) inp[3].value = notes;
  } else {
    const tbl = document.getElementById('wpn-tbl');
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.innerHTML = `<td><input type="text" value="${esc(item.name)}"></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(atkStr)}" style="width:46px"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack">🎲</button></div></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(dmgStr)}"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage">🎲</button></div></td><td><input type="text" value="${esc(notes)}"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
    tbl.appendChild(tr);
  }
  renderWeaponsSummary();
}

function itemTypeChange() {
  const t = document.getElementById('im-type').value;
  const isArmor = t === 'armor';
  const isWeapon = t === 'weapon';
  document.getElementById('im-armor-type-wrap').style.display = isArmor ? 'block' : 'none';
  document.getElementById('im-ac-base-wrap').style.display = isArmor ? 'block' : 'none';
  document.getElementById('im-weapon-fields').style.display = isWeapon ? 'block' : 'none';
  if (isWeapon) initItemPropsGrid();
  if (t === 'shield' && parseInt(document.getElementById('im-ac-bonus').value) === 0) {
    document.getElementById('im-ac-bonus').value = '2';
  }
}

function itemAttuneChange() {
  const reqAttune = document.getElementById('im-req-attune').checked;
  document.getElementById('im-attune-wrap').style.display = reqAttune ? 'block' : 'none';
  if (!reqAttune) document.getElementById('im-attuned').checked = false;
}

function saveItemModal() {
  const name = document.getElementById('im-name').value.trim();
  if (!name) { document.getElementById('im-name').focus(); return; }
  const itemType = document.getElementById('im-type').value;
  const item = {
    id: editingItemId !== null ? editingItemId : ++itemIdCounter,
    name,
    itemType,
    weaponAtk: itemType === 'weapon' ? (parseInt(document.getElementById('im-weapon-atk').value) || 0) : 0,
    weaponDmg: itemType === 'weapon' ? document.getElementById('im-weapon-dmg').value.trim() : '',
    weaponProperties: itemType === 'weapon' ? getSelectedItemProps() : [],
    armorType: document.getElementById('im-armor-type').value,
    acBase: parseInt(document.getElementById('im-ac-base').value) || 10,
    value: document.getElementById('im-value').value.trim(),
    equipped: document.getElementById('im-equipped').checked,
    requiresAttunement: document.getElementById('im-req-attune').checked,
    attuned: document.getElementById('im-attuned').checked,
    acBonus: parseInt(document.getElementById('im-ac-bonus').value) || 0,
    initBonus: parseInt(document.getElementById('im-init-bonus').value) || 0,
    speedBonus: parseInt(document.getElementById('im-speed-bonus').value) || 0,
    notes: document.getElementById('im-notes').value
  };
  if (editingItemId !== null) {
    const idx = items.findIndex(i => i.id === editingItemId);
    if (idx >= 0) items[idx] = item; else items.push(item);
  } else {
    items.push(item);
  }
  if (item.itemType === 'weapon') syncWeaponItemToAttacks(item);
  closeItemModal();
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
}

function toggleItemEquipped(id) {
  const item = items.find(i => i.id === id);
  if (item) { item.equipped = !item.equipped; renderItems(); renderWeaponsSummary(); renderEquippedItemsSummary(); recalcAll(); }
}

function deleteItem(id) {
  const wpnRow = document.querySelector(`#wpn-tbl tr[data-item-id="${id}"]`);
  if (wpnRow) wpnRow.remove();
  items = items.filter(i => i.id !== id);
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
}

let detailItemId = null;

function openItemDetail(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  detailItemId = id;
  document.getElementById('item-detail-title').textContent = item.name;
  const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                  : item.itemType === 'shield' ? 'Shield'
                  : item.itemType === 'weapon' ? 'Weapon'
                  : item.itemType === 'wondrous' || item.itemType === 'item' ? 'Wondrous / Magic Item'
                  : 'Other';
  const rows = [['Type', typeLabel]];
  if (item.value) rows.push(['Value', item.value]);
  if (item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',         (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus', (item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',      (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  rows.push(['Equipped', item.equipped ? 'Yes' : 'No']);
  if (item.requiresAttunement) rows.push(['Attuned', item.attuned ? 'Yes' : 'No']);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 6px;color:var(--txd);width:42%">${k}</td><td style="padding:4px 6px;font-weight:bold">${esc(String(v))}</td></tr>`).join('') +
    `</table>`;
  if (item.notes) html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Notes</div><div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(item.notes)}</div></div>`;
  document.getElementById('item-detail-body').innerHTML = html;
  document.getElementById('item-detail-modal').style.display = 'flex';
}

function closeItemDetail() {
  document.getElementById('item-detail-modal').style.display = 'none';
  detailItemId = null;
}

function editFromDetail() {
  const id = detailItemId;
  closeItemDetail();
  openItemModal(id);
}

function renderItems() {
  const body = document.getElementById('items-body');
  if (!body) return;
  if (items.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No items — click "+ Add Item" to begin.</div>';
    return;
  }

  const equipped = items.filter(i => i.equipped);
  const totalAC = equipped.reduce((s, i) => s + (parseInt(i.acBonus) || 0), 0);
  const totalInit = equipped.reduce((s, i) => s + (parseInt(i.initBonus) || 0), 0);
  const totalSpeed = equipped.reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
  const armorItem = equipped.find(i => i.itemType === 'armor');

  let summaryParts = [];
  if (armorItem) summaryParts.push(`${armorItem.name} (base ${armorItem.acBase})`);
  if (totalAC !== 0) summaryParts.push(`AC ${totalAC > 0 ? '+' : ''}${totalAC}`);
  if (totalInit !== 0) summaryParts.push(`Init ${totalInit > 0 ? '+' : ''}${totalInit}`);
  if (totalSpeed !== 0) summaryParts.push(`Spd ${totalSpeed > 0 ? '+' : ''}${totalSpeed} ft`);

  const rows = items.map(item => {
    const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                   : item.itemType === 'shield' ? 'shield'
                   : item.itemType === 'weapon' ? 'weapon'
                   : item.itemType === 'wondrous' || item.itemType === 'item' ? 'wondrous'
                   : 'other';
    const bonusParts = [];
    if (item.itemType === 'armor') bonusParts.push(`AC${item.acBase}`);
    if (item.acBonus) bonusParts.push(`AC${item.acBonus > 0 ? '+' : ''}${item.acBonus}`);
    if (item.initBonus) bonusParts.push(`Init${item.initBonus > 0 ? '+' : ''}${item.initBonus}`);
    if (item.speedBonus) bonusParts.push(`Spd${item.speedBonus > 0 ? '+' : ''}${item.speedBonus}`);
    const bonusStr = bonusParts.join(' ');
    const attuneStr = item.attuned ? ' 🔮' : '';
    const equippedStyle = item.equipped ? 'color:var(--ahi);font-weight:bold' : 'color:var(--txd)';
    const valueStr = item.value ? ` · <span style="color:var(--exp)">${esc(item.value)}</span>` : '';

    return `<div class="item-row">
      <input type="checkbox" class="item-chk" ${item.equipped ? 'checked' : ''} onchange="toggleItemEquipped(${item.id})" title="Equipped">
      <span class="item-name" style="${equippedStyle};cursor:pointer" onclick="openItemDetail(${item.id})">${esc(item.name)}${attuneStr}</span>
      <span class="item-meta">${typeLabel}${bonusStr ? ' · ' + bonusStr : ''}${valueStr}</span>
      <button class="char-btn" style="padding:2px 8px;font-size:11px" onclick="openItemModal(${item.id})">Edit</button>
      <button class="del-btn" onclick="deleteItem(${item.id})">✕</button>
    </div>`;
  }).join('');

  const summary = summaryParts.length > 0
    ? `<div style="font-size:10px;color:var(--txd);margin-top:6px;padding-top:4px;border-top:1px solid var(--sep)">⚡ Equipped: ${summaryParts.join(' · ')}</div>`
    : '';

  body.innerHTML = rows + summary;
}

function renderWeaponsSummary() {
  const el = document.getElementById('main-weapons-summary');
  if (!el) return;
  const wpnRows = [];
  document.querySelectorAll('#wpn-tbl tr:not(:first-child)').forEach(tr => {
    const inp = tr.querySelectorAll('input[type=text], input[type=number]');
    if (inp.length >= 3) wpnRows.push([inp[0].value, inp[1].value, inp[2].value, inp[3]?.value || '']);
  });
  if (wpnRows.length === 0) {
    el.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No weapons — add them in the Inventory tab.</div>';
    return;
  }
  const tableRows = wpnRows.map(([name, atk, dmg, notes]) => {
    const n = esc(name || '—'), a = esc(atk || '+0'), d = esc(dmg || '—');
    return `<tr>
      <td style="font-weight:bold">${n}</td>
      <td><div style="display:flex;align-items:center;gap:2px">${a}<button class="roll-btn" data-name="${n}" data-val="${a}" onclick="rollWeaponAtkVal(this.dataset.name,this.dataset.val)" title="Roll attack">🎲</button></div></td>
      <td><div style="display:flex;align-items:center;gap:2px">${d}<button class="roll-btn" data-name="${n}" data-val="${esc(dmg||'1d6')}" onclick="rollWeaponDmgVal(this.dataset.name,this.dataset.val)" title="Roll damage">🎲</button></div></td>
      <td style="color:var(--txd);font-size:11px">${esc(notes)}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="tbl-wrap"><table><tr><th>Name</th><th>Atk</th><th>Damage</th><th>Notes</th></tr>${tableRows}</table></div>`;
}

function rollWeaponAtkVal(name, atk) { startRoll(name + ' Attack', atk); }
function rollWeaponDmgVal(name, dmg)  { rollDamage(name + ' Damage', dmg); }

function renderEquippedItemsSummary() {
  const el = document.getElementById('main-items-summary');
  if (!el) return;
  const equipped = items.filter(i => i.equipped && i.itemType !== 'other');
  if (equipped.length === 0) {
    el.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No equipped items — add them in the Inventory tab.</div>';
    return;
  }
  const html = equipped.map(item => {
    const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                    : item.itemType === 'shield' ? 'shield'
                    : item.itemType === 'weapon' ? 'weapon'
                    : 'wondrous';
    const chips = [];
    if (item.itemType === 'armor') chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Base AC ${item.acBase}</span>`);
    if (item.acBonus)    chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">AC ${item.acBonus > 0 ? '+' : ''}${item.acBonus}</span>`);
    if (item.initBonus)  chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Init ${item.initBonus > 0 ? '+' : ''}${item.initBonus}</span>`);
    if (item.speedBonus) chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Speed ${item.speedBonus > 0 ? '+' : ''}${item.speedBonus} ft</span>`);
    const attuneStr = item.attuned ? ' 🔮' : '';
    const notesSnip = item.notes ? `<div style="font-size:10px;color:var(--txd);margin-top:2px">${esc(item.notes.slice(0,80))}${item.notes.length > 80 ? '…' : ''}</div>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid var(--sep)">
      <div style="flex:1;min-width:0">
        <span style="font-weight:bold;color:var(--ahi);cursor:pointer" onclick="showTab('inventory',document.querySelector('.tab[onclick*=inventory]'));openItemDetail(${item.id})">${esc(item.name)}${attuneStr}</span>
        <span style="color:var(--txd);font-size:10px;margin-left:4px">${typeLabel}</span>
        ${chips.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">${chips.join('')}</div>` : ''}
        ${notesSnip}
      </div>
    </div>`;
  }).join('');
  el.innerHTML = html;
}

function initRollClickHandlers() {
  // Skills: insert a roll button after each skill value input (no click-on-input)
  for (let i = 0; i < 18; i++) {
    const el = document.querySelector(`[data-key="sk-${i}"]`);
    if (!el) continue;
    const btn = document.createElement('button');
    btn.className = 'sk-roll-btn';
    btn.title = 'Roll ' + SKILL_NAMES[i];
    btn.textContent = '🎲';
    btn.type = 'button';
    (function(idx) {
      btn.addEventListener('click', function() {
        const valEl = document.querySelector(`[data-key="sk-${idx}"]`);
        startRoll(SKILL_NAMES[idx], valEl ? valEl.value : '0');
      });
    })(i);
    el.parentNode.insertBefore(btn, el.nextSibling);
  }
  // Saving throws: insert a roll button after each save value input (no click-on-input)
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.querySelector(`[data-key="save-${s}"]`);
    if (!el) return;
    const btn = document.createElement('button');
    btn.className = 'sk-roll-btn';
    btn.title = 'Roll ' + AB_NAMES[s] + ' Save';
    btn.textContent = '🎲';
    btn.type = 'button';
    btn.addEventListener('click', function() {
      const valEl = document.querySelector(`[data-key="save-${s}"]`);
      startRoll(AB_NAMES[s] + ' Save', valEl ? valEl.value : '0');
    });
    el.parentNode.insertBefore(btn, el.nextSibling);
  });
  // Ability modifier circles (readonly — click-to-roll fine here)
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (!el) return;
    el.classList.add('rollable');
    el.title = 'Click to roll ' + AB_NAMES[s] + ' check';
    el.addEventListener('click', function() { startRoll(AB_NAMES[s] + ' Check', this.value); });
  });
  // Initiative (auto-calculated, effectively readonly — click-to-roll fine)
  const initEl = document.querySelector('[data-key="init"]');
  if (initEl) {
    initEl.classList.add('rollable');
    initEl.title = 'Click to roll Initiative';
    initEl.addEventListener('click', function() { if (_initEditMode) return; rollMyInitiative(); });
    initEl.addEventListener('blur', function() { _initEditMode = false; this.classList.add('rollable'); });
  }
  // Spell attack bonus (auto-calculated — click-to-roll fine)
  const spAtkEl = document.querySelector('[data-key="sp-atk"]');
  if (spAtkEl) {
    spAtkEl.classList.add('rollable');
    spAtkEl.title = 'Click to roll spell attack';
    spAtkEl.addEventListener('click', function() { if (_spAtkEditMode) return; startRoll('Spell Attack', this.value); });
    spAtkEl.addEventListener('blur', function() { _spAtkEditMode = false; this.classList.add('rollable'); });
  }
}

// ── Init: wire proficiency checkboxes + derived inputs to recalcAll ──
document.querySelectorAll('[data-key^="sk-prof-"], [data-key^="sk-exp-"], [data-key^="save-prof-"]').forEach(el => {
  el.addEventListener('change', recalcAll);
});
document.querySelector('[data-key="profbonus"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="sp-ability"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="init-bonus"]')?.addEventListener('input', recalcAll);
document.querySelector('[data-key="level"]')?.addEventListener('input', () => { recalcProfBonus(); recalcAll(); recalcPreparedCount(); });
// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (document.getElementById('adv-modal').style.display === 'flex') {
    if      (e.key === 'a' || e.key === 'A') { e.preventDefault(); confirmRoll('adv'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); confirmRoll('norm'); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); confirmRoll('dis'); }
    else if (e.key === 'Escape') advClose();
    return;
  }
  if (e.key !== 'Escape') return;
  if (document.getElementById('unlock-screen').style.display !== 'none') unlockCancel();
  else if (document.getElementById('pw-modal').style.display !== 'none') pwClose();
  else if (document.getElementById('nc-modal').style.display !== 'none') ncClose();
  else if (document.getElementById('shop-detail-modal').style.display !== 'none') closeShopDetail();
  else if (document.getElementById('item-detail-modal').style.display !== 'none') closeItemDetail();
  else if (document.getElementById('item-modal').style.display !== 'none') closeItemModal();
  else if (document.getElementById('loot-add-modal').style.display !== 'none') closeLootAddModal();
});

document.getElementById('wpn-tbl').addEventListener('input', renderWeaponsSummary);

initRollClickHandlers();
loadCharacterList(true);
// Initiative data loaded on first panel open — panel starts collapsed so no need to fetch upfront

// ── Media ──

let mediaList = [];

const ALLOWED_CLIENT_TYPES = new Set(['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm']);
const MAX_CLIENT_SIZE = 25 * 1024 * 1024; // 25 MB

function showTabByName(name) {
  const btn = document.getElementById('tab-btn-' + name);
  if (btn) showTab(name, btn);
}

async function loadMedia() {
  if (!currentCharId) { mediaList = []; renderMedia(); updatePortraitHeader(); return; }
  try {
    const headers = {};
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    const res = await fetch(`/api/characters/${currentCharId}/media`, { headers });
    if (!res.ok) { mediaList = []; renderMedia(); updatePortraitHeader(); return; }
    mediaList = await res.json();
  } catch { mediaList = []; }
  renderMedia();
  updatePortraitHeader();
}

function updatePortraitHeader() {
  const portrait = mediaList.find(m => m.isPortrait);
  const wrap = document.getElementById('portrait-wrap');
  const img  = document.getElementById('portrait-img');
  const prev = document.getElementById('portrait-preview');
  const ph   = document.getElementById('portrait-placeholder');
  if (portrait) {
    const displayUrl = portrait.mediumUrl || portrait.dataUrl;
    if (img)  { img.src = displayUrl;  wrap.style.display = ''; }
    if (prev) { prev.src = displayUrl; prev.style.display = 'block'; }
    if (ph)   ph.style.display = 'none';
  } else {
    if (wrap) wrap.style.display = 'none';
    if (prev) prev.style.display = 'none';
    if (ph)   ph.style.display = '';
  }
}

function renderMedia() {
  const gallery = document.getElementById('media-gallery');
  if (!gallery) return;
  if (mediaList.length === 0) {
    gallery.className = '';
    gallery.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No media yet — upload images or videos above.</div>';
    return;
  }
  gallery.className = 'media-gallery';
  gallery.innerHTML = mediaList.map(m => {
    const isImg = m.mimeType.startsWith('image/');
    const badge = m.isPortrait ? '<div class="portrait-badge">Portrait</div>' : '';
    const cardSrc = (isImg && m.mediumUrl) ? m.mediumUrl : m.dataUrl;
    const media = isImg
      ? `<img src="${esc(cardSrc)}" alt="${esc(m.name)}" loading="lazy" onclick="lightboxOpen('${m.id}')">`
      : `<video src="${esc(m.dataUrl)}" controls preload="metadata"></video>`;
    const setPortBtn = isImg && !m.isPortrait
      ? `<button class="char-btn" style="padding:2px 7px;font-size:10px" onclick="setPortrait('${m.id}')">Set Portrait</button>`
      : '';
    return `<div class="media-card${m.isPortrait ? ' is-portrait' : ''}">
      ${badge}${media}
      <div class="media-card-name">${esc(m.name)}</div>
      <div class="media-card-actions">
        ${setPortBtn}
        <button class="del-btn" style="font-size:11px;padding:2px 8px" onclick="deleteMedia('${m.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function uploadMedia(input, isPortrait) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;

  // Client-side validation
  if (!ALLOWED_CLIENT_TYPES.has(file.type)) {
    showAlert('File type not allowed.\nAllowed: JPEG, PNG, GIF, WebP, MP4, WebM');
    return;
  }
  if (file.size > MAX_CLIENT_SIZE) {
    showAlert('File too large. Maximum 25 MB.');
    return;
  }

  const statusId = isPortrait ? 'portrait-upload-status' : 'media-upload-status';
  const setStatus = (msg, ok) => {
    const el = document.getElementById(statusId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok === true ? 'var(--ok)' : ok === false ? 'var(--err)' : 'var(--inf)';
  };
  setStatus('Reading file…', null);

  let dataUrl;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = ()  => reject(new Error('Read failed'));
      r.readAsDataURL(file);
    });
  } catch { setStatus('Could not read file.', false); return; }

  // Verify data URL MIME prefix matches declared type (defence-in-depth)
  const mimeCheck = dataUrl.match(/^data:([^;]+);base64,/);
  if (!mimeCheck || mimeCheck[1] !== file.type) {
    setStatus('File content does not match declared type.', false);
    return;
  }

  setStatus('Uploading…', null);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    const res = await fetch(`/api/characters/${currentCharId}/media`, {
      method: 'POST', headers,
      body: JSON.stringify({ dataUrl, originalName: file.name, isPortrait })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.error || 'Upload failed.', false);
      return;
    }
    setStatus('Uploaded!', true);
    setTimeout(() => setStatus('', null), 3000);
    await loadMedia();
  } catch { setStatus('Network error.', false); }
}

function deleteMedia(id) {
  if (!currentCharId) return;
  showConfirm('Delete this media item?', async () => {
    try {
      const headers = {};
      if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
      const res = await fetch(`/api/characters/${currentCharId}/media/${id}`, { method: 'DELETE', headers });
      if (res.ok) await loadMedia();
      else showAlert('Delete failed.');
    } catch { showAlert('Network error.'); }
  });
}

async function setPortrait(id) {
  if (!currentCharId) return;
  try {
    const headers = {};
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    const res = await fetch(`/api/characters/${currentCharId}/media/${id}/portrait`, { method: 'PUT', headers });
    if (res.ok) await loadMedia();
    else showAlert('Failed to set portrait.');
  } catch { showAlert('Network error.'); }
}

// ── Shop ──

let shopCatalog = [];
let shopCart = [];
let shopDetailId = null;

function cpToGp(cp) {
  if (cp === 0) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}

function renderShopWallet() {
  const el = document.getElementById('shop-wallet');
  if (!el) return;
  if (!currentCharId) { el.textContent = 'Load a character to see wallet.'; return; }
  const cp  = parseInt(document.querySelector('[data-key="cp"]')?.value)  || 0;
  const sp  = parseInt(document.querySelector('[data-key="sp"]')?.value)  || 0;
  const ep  = parseInt(document.querySelector('[data-key="ep"]')?.value)  || 0;
  const gp  = parseInt(document.querySelector('[data-key="gp"]')?.value)  || 0;
  const pp  = parseInt(document.querySelector('[data-key="pp2"]')?.value) || 0;
  const totalCp = cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000;
  el.textContent = `PP: ${pp}  GP: ${gp}  EP: ${ep}  SP: ${sp}  CP: ${cp}  (≈ ${cpToGp(totalCp)} total)`;
}

async function loadShopTab() {
  document.getElementById('shop-loading').style.display = '';
  document.getElementById('shop-loading').textContent = 'Loading…';
  document.getElementById('shop-items-body').innerHTML = '';
  renderShopWallet();
  try {
    const res = await fetch('/api/shop');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.isOpen) {
      document.getElementById('shop-loading').style.display = 'none';
      document.getElementById('shop-items-body').innerHTML =
        '<div style="text-align:center;padding:32px 0;color:var(--txd);font-size:13px">🔒 The shop is currently closed.</div>';
      shopCatalog = [];
      shopCart = [];
      renderCart();
      return;
    }
    shopCatalog = data.items;
  } catch {
    document.getElementById('shop-loading').textContent = 'Failed to load shop.';
    return;
  }
  document.getElementById('shop-loading').style.display = 'none';
  renderShopItems();
}

function bonusSummary(item) {
  if (item.itemType === 'weapon') {
    const parts = [];
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic > 0) parts.push(`+${magic}`);
    if (item.weaponDmg) parts.push(item.weaponDmg);
    if (item.weaponProperties && item.weaponProperties.length) parts.push(item.weaponProperties.join(', '));
    return parts.join(' | ');
  }
  const parts = [];
  if (item.acBonus)    parts.push(`AC+${item.acBonus}`);
  if (item.initBonus)  parts.push(`Init+${item.initBonus}`);
  if (item.speedBonus) parts.push(`Spd+${item.speedBonus}`);
  if (item.requiresAttunement) parts.push('Attune');
  return parts.join(' ');
}

function renderShopItems() {
  const body = document.getElementById('shop-items-body');
  if (shopCatalog.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">The shop is empty.</div>';
    return;
  }
  body.innerHTML = shopCatalog.map(item => {
    const bonuses = bonusSummary(item);
    const qtyText = item.quantity === -1 ? '∞' : `×${item.quantity}`;
    return `<div class="shop-item-row">
      <span class="shop-item-name" style="cursor:pointer;text-decoration:underline dotted" onclick="openShopDetail('${item.id}')" title="View details">${esc(item.name)}</span>
      <span class="shop-item-price">${cpToGp(item.valueCp)}</span>
      <span class="shop-item-qty">Stock: ${qtyText}</span>
      ${bonuses ? `<span class="shop-item-bonuses">${esc(bonuses)}</span>` : ''}
      ${item.notes ? `<span class="shop-item-bonuses" style="flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.notes)}">${esc(item.notes)}</span>` : ''}
      <button class="add-btn" style="width:auto;padding:3px 10px;margin:0" onclick="addToCart('${item.id}')">+ Cart</button>
    </div>`;
  }).join('');
}

function openShopDetail(shopItemId) {
  const item = shopCatalog.find(i => i.id === shopItemId);
  if (!item) return;
  shopDetailId = shopItemId;
  document.getElementById('shop-detail-title').textContent = item.name;
  const typeLabel = item.itemType === 'armor'   ? `${item.armorType} armor`
                  : item.itemType === 'shield'  ? 'Shield'
                  : item.itemType === 'weapon'  ? 'Weapon'
                  : item.itemType === 'wondrous' ? 'Wondrous / Magic Item'
                  : 'Other';
  const qtyText = item.quantity === -1 ? '∞' : item.quantity;
  const rows = [
    ['Type',  typeLabel],
    ['Price', cpToGp(item.valueCp)],
    ['Stock', qtyText],
  ];
  if (item.itemType === 'weapon') {
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic) rows.push(['Magic Bonus', `+${magic}`]);
    if (item.weaponDmg) rows.push(['Damage Dice', item.weaponDmg]);
    if (item.weaponProperties && item.weaponProperties.length)
      rows.push(['Properties', item.weaponProperties.join(', ')]);
    const atkNote = item.weaponProperties && item.weaponProperties.includes('Finesse')
      ? 'STR or DEX (highest) + Prof + magic bonus'
      : item.weaponProperties && item.weaponProperties.includes('Ammunition')
      ? 'DEX + Prof + magic bonus'
      : 'STR + Prof + magic bonus';
    rows.push(['ATK Calc', atkNote]);
  }
  if (item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',        (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus',(item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',     (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  if (item.requiresAttunement) rows.push(['Attunement', 'Required']);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">` +
    rows.map(([k, v]) =>
      `<tr><td style="padding:4px 6px;color:var(--txd);width:42%">${k}</td><td style="padding:4px 6px;font-weight:bold">${esc(String(v))}</td></tr>`
    ).join('') + `</table>`;
  if (item.notes) html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Description</div><div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(item.notes)}</div></div>`;
  document.getElementById('shop-detail-body').innerHTML = html;
  const cartBtn = document.getElementById('shop-detail-cart-btn');
  const outOfStock = item.quantity === 0;
  cartBtn.disabled = outOfStock;
  cartBtn.textContent = outOfStock ? 'Out of Stock' : '+ Add to Cart';
  document.getElementById('shop-detail-modal').style.display = 'flex';
}

function closeShopDetail() {
  document.getElementById('shop-detail-modal').style.display = 'none';
  shopDetailId = null;
}

function addToCartFromDetail() {
  if (shopDetailId !== null) addToCart(shopDetailId);
  closeShopDetail();
}

function addToCart(shopItemId) {
  const item = shopCatalog.find(i => i.id === shopItemId);
  if (!item) return;
  const existing = shopCart.find(e => e.shopItem.id === shopItemId);
  const maxQty = item.quantity === -1 ? Infinity : item.quantity;
  if (existing) {
    if (existing.qty < maxQty) existing.qty++;
  } else {
    shopCart.push({ shopItem: item, qty: 1 });
  }
  renderCart();
}

function removeFromCart(shopItemId) {
  shopCart = shopCart.filter(e => e.shopItem.id !== shopItemId);
  renderCart();
}

function renderCart() {
  const body = document.getElementById('shop-cart-body');
  const totalEl = document.getElementById('shop-cart-total');
  const buyBtn = document.getElementById('shop-buy-btn');
  document.getElementById('shop-purchase-err').textContent = '';
  if (shopCart.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "Add to Cart" on items above.</div>';
    totalEl.textContent = '';
    buyBtn.disabled = true;
    return;
  }
  let totalCp = 0;
  body.innerHTML = shopCart.map(e => {
    const subtotal = e.shopItem.valueCp * e.qty;
    totalCp += subtotal;
    return `<div class="shop-cart-row">
      <span class="shop-cart-name">${esc(e.shopItem.name)} ×${e.qty}</span>
      <span class="shop-cart-subtotal">${cpToGp(subtotal)}</span>
      <button class="del-btn" onclick="removeFromCart('${e.shopItem.id}')">✕</button>
    </div>`;
  }).join('');
  totalEl.textContent = `Total: ${cpToGp(totalCp)}`;
  buyBtn.disabled = !currentCharId;
}

async function purchaseCart() {
  if (!currentCharId || shopCart.length === 0) return;
  const errEl = document.getElementById('shop-purchase-err');
  errEl.textContent = '';
  const headers = { 'Content-Type': 'application/json' };
  if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
  try {
    const res = await fetch('/api/shop/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        charId: currentCharId,
        items: shopCart.map(e => ({ shopItemId: e.shopItem.id, qty: e.qty }))
      })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Purchase failed.'; return; }
    shopCart = [];
    renderCart();
    await loadCharacter(currentCharId);
    await loadShopTab();
    setStatus('Purchase complete!', false);
  } catch {
    errEl.textContent = 'Network error.';
  }
}

// Simple lightbox for images
function lightboxOpen(id) {
  const m = mediaList.find(x => x.id === id);
  if (!m || !m.mimeType.startsWith('image/')) return;
  let lb = document.getElementById('media-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'media-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:4000;cursor:zoom-out';
    lb.onclick = () => lb.remove();
    const img = document.createElement('img');
    img.style.cssText = 'max-width:94vw;max-height:94vh;border-radius:6px;box-shadow:0 8px 40px #000';
    lb.appendChild(img);
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = m.dataUrl;
  lb.style.display = 'flex';
}

// ── Loot tab ──────────────────────────────────────────────────────────────────
let lootCatalog = [];
let lootCart    = [];
let claimedLoots = [];

async function loadLootTab() {
  document.getElementById('loot-loading').style.display = '';
  document.getElementById('loot-loading').textContent = 'Loading…';
  document.getElementById('loot-items-body').innerHTML = '';
  try {
    const res = await fetch('/api/loot');
    if (!res.ok) throw new Error();
    lootCatalog = await res.json();
  } catch {
    document.getElementById('loot-loading').textContent = 'Failed to load loot.';
    return;
  }
  document.getElementById('loot-loading').style.display = 'none';
  renderLootItems();
}

function renderLootItems() {
  const body = document.getElementById('loot-items-body');
  if (lootCatalog.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No loot available yet.</div>';
    return;
  }
  body.innerHTML = lootCatalog.map(item => {
    const alreadyClaimed = claimedLoots.some(l => l.id === item.id);
    const inCart = lootCart.some(l => l.id === item.id);
    return `<div class="shop-item-row" style="align-items:flex-start;flex-wrap:nowrap;gap:8px">
      <div style="flex:1;min-width:0">
        <div class="shop-item-name">${esc(item.name)}</div>
        ${item.description ? `<div style="font-size:10px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(item.description)}</div>` : ''}
      </div>
      ${alreadyClaimed ? `<span style="font-size:10px;color:var(--ok);flex-shrink:0;padding-top:2px">✓ Claimed</span>` : ''}
      <button class="add-btn" style="width:auto;padding:3px 10px;margin:0;flex-shrink:0" onclick="addToLootCart('${item.id}')" ${inCart ? 'disabled' : ''}>${inCart ? 'In Cart' : '+ Cart'}</button>
    </div>`;
  }).join('');
}

function addToLootCart(id) {
  const item = lootCatalog.find(i => i.id === id);
  if (!item || lootCart.some(l => l.id === id)) return;
  lootCart.push(item);
  renderLootItems();
  renderLootCart();
}

function removeFromLootCart(id) {
  lootCart = lootCart.filter(l => l.id !== id);
  renderLootItems();
  renderLootCart();
}

function renderLootCart() {
  const body = document.getElementById('loot-cart-body');
  const claimBtn = document.getElementById('loot-claim-btn');
  document.getElementById('loot-claim-err').textContent = '';
  if (lootCart.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "+ Cart" on items above.</div>';
    claimBtn.disabled = true;
    return;
  }
  body.innerHTML = lootCart.map(item => `<div class="shop-cart-row">
    <span class="shop-cart-name">${esc(item.name)}</span>
    <button class="del-btn" onclick="removeFromLootCart('${item.id}')">✕</button>
  </div>`).join('');
  claimBtn.disabled = !currentCharId;
}

async function claimLoot() {
  if (!currentCharId || lootCart.length === 0) return;
  const errEl = document.getElementById('loot-claim-err');
  errEl.textContent = '';
  const headers = { 'Content-Type': 'application/json' };
  if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
  try {
    const res = await fetch('/api/loot/claim', {
      method: 'POST', headers,
      body: JSON.stringify({ charId: currentCharId, items: lootCart.map(i => ({ id: i.id, name: i.name, description: i.description })) })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Claim failed.'; return; }
    lootCart = [];
    renderLootCart();
    await loadCharacter(currentCharId);
    setStatus('Loot claimed!', false);
  } catch { errEl.textContent = 'Network error.'; }
}

function renderClaimedLoots() {
  const body = document.getElementById('claimed-loots-body');
  if (!body) return;
  if (!claimedLoots || claimedLoots.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">No loots claimed yet.</div>';
    return;
  }
  body.innerHTML = claimedLoots.map((l, i) => `<div style="padding:6px 0;display:flex;align-items:flex-start;gap:8px;${i < claimedLoots.length - 1 ? 'border-bottom:1px solid var(--sep)' : ''}">
    <div style="flex:1;min-width:0">
      <div style="font-weight:bold;font-size:12px">${esc(l.name)}</div>
      ${l.descVisible !== false && l.description ? `<div style="font-size:11px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(l.description)}</div>` : ''}
    </div>
    <button class="del-btn" onclick="removeLoot(${i})" title="Remove loot">✕</button>
  </div>`).join('');
}

async function syncLootDescVisibility() {
  if (!claimedLoots || claimedLoots.length === 0) return;
  try {
    const res = await fetch('/api/loot/visibility');
    if (!res.ok) return;
    const map = await res.json();
    let changed = false;
    for (const l of claimedLoots) {
      if (map[l.id] !== undefined) {
        const newDescVisible = map[l.id].descVisible;
        const newDesc = map[l.id].description;
        if (l.descVisible !== newDescVisible || (newDescVisible && l.description !== newDesc)) {
          l.descVisible = newDescVisible;
          if (newDescVisible) l.description = newDesc;
          changed = true;
        }
      }
    }
    if (changed) renderClaimedLoots();
  } catch {}
}

function removeLoot(index) {
  claimedLoots.splice(index, 1);
  renderClaimedLoots();
}

function openLootAddModal() {
  document.getElementById('loot-add-name').value = '';
  document.getElementById('loot-add-desc').value = '';
  document.getElementById('loot-add-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('loot-add-name').focus(), 50);
}

function closeLootAddModal() {
  document.getElementById('loot-add-modal').style.display = 'none';
}

function confirmLootAdd() {
  const name = document.getElementById('loot-add-name').value.trim();
  if (!name) return;
  const description = document.getElementById('loot-add-desc').value.trim();
  claimedLoots.push({ id: 'manual-' + Date.now(), name, description });
  renderClaimedLoots();
  closeLootAddModal();
}

// ── Initiative Tracker ──────────────────────────────────────────────────────
let initData = { entries: [], currentId: null };
let initDataMap = {};
let initEditId = null;
let initEditCharId = null;
let initTrackerCollapsed = true;

function getDmPw() {
  let pw = sessionStorage.getItem('initDmPw') || '';
  if (!pw) {
    pw = prompt('DM password:') || '';
    if (pw) sessionStorage.setItem('initDmPw', pw);
  }
  return pw;
}
function clearDmPw() { sessionStorage.removeItem('initDmPw'); }

let _initDataLoaded = false;

async function loadInitiativeTracker() {
  try {
    const res = await fetch('/api/initiative');
    if (!res.ok) return;
    initData = await res.json();
    _initDataLoaded = true;
    renderInitiativeTracker(false);
  } catch {}
}

function initTogglePanel() {
  initTrackerCollapsed = !initTrackerCollapsed;
  const bodyWrap = document.getElementById('init-body-wrap');
  const chevron  = document.getElementById('init-chevron');
  bodyWrap.classList.toggle('open', !initTrackerCollapsed);
  chevron.textContent = initTrackerCollapsed ? '▲' : '▼';
  if (!initTrackerCollapsed) {
    // close chat if open
    if (chatOpen) chatToggle();
    document.getElementById('init-badge').style.display = 'none';
    if (!_initDataLoaded) {
      _initDataLoaded = true;
      loadInitiativeTracker();
    } else {
      renderInitiativeTracker(false);
    }
  }
}

function renderInitiativeTracker(showBadge = false) {
  const list = document.getElementById('init-tracker-list');
  if (!list) return;
  const visibleEntries = (initData.entries || []).filter(e => !e.monsterId || !!initData.currentId);
  const sorted = [...visibleEntries].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  if (showBadge && initTrackerCollapsed && sorted.length > 0) {
    document.getElementById('init-badge').style.display = '';
  }
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">No combatants yet.</div>';
    return;
  }
  initDataMap = {};
  sorted.forEach(e => { initDataMap[e.id] = e; });
  list.innerHTML = sorted.map(e => {
    const isCur = e.id === initData.currentId;
    return `<div class="init-row${isCur ? ' init-cur' : ''}">
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      <span class="init-row-name">${esc(e.name)}</span>
      <span class="init-row-roll">${e.roll}</span>
      <button class="sk-roll-btn" onclick="openInitEditModal('${e.id}')" title="Edit">✎</button>
      <button class="del-btn" onclick="deleteInitEntry('${e.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function rollMyInitiative() {
  if (!currentCharId) {
    showAlert('Please select a character first.');
    return;
  }
  const initEl = document.querySelector('[data-key="init"]');
  const modifier = parseInt(initEl?.value) || 0;
  const charName = document.querySelector('[data-key="name"]')?.value?.trim() || 'Unknown';
  rollPending = { label: 'Initiative', modifier, isInitiative: true, initCharName: charName };
  document.getElementById('adv-label').textContent = 'Roll: Initiative';
  document.getElementById('adv-modal').style.display = 'flex';
}

async function submitInitiativeRoll(total, name) {
  if (!currentCharId || !name) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    await fetch('/api/initiative/roll', {
      method: 'POST', headers,
      body: JSON.stringify({ charId: currentCharId, name, roll: total })
    });
  } catch {}
}

function openInitNpcModal() {
  document.getElementById('init-npc-name').value = '';
  document.getElementById('init-npc-bonus').value = '0';
  document.getElementById('init-npc-pw').value = sessionStorage.getItem('initDmPw') || '';
  document.getElementById('init-npc-err').textContent = '';
  document.getElementById('init-npc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-npc-name').focus(), 50);
}
function closeInitNpcModal() { document.getElementById('init-npc-modal').style.display = 'none'; }

async function submitInitNpc() {
  const name  = document.getElementById('init-npc-name').value.trim();
  const bonus = parseInt(document.getElementById('init-npc-bonus').value) || 0;
  const pw    = document.getElementById('init-npc-pw').value;
  const errEl = document.getElementById('init-npc-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  if (!pw)   { errEl.textContent = 'DM password required.'; return; }
  const roll = Math.ceil(Math.random() * 20) + bonus;
  errEl.textContent = '';
  try {
    const res = await fetch('/api/initiative/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': pw },
      body: JSON.stringify({ name, roll })
    });
    if (res.status === 401) { clearDmPw(); errEl.textContent = 'Wrong DM password.'; return; }
    if (!res.ok) { errEl.textContent = 'Failed.'; return; }
    sessionStorage.setItem('initDmPw', pw);
    closeInitNpcModal();
  } catch { errEl.textContent = 'Network error.'; }
}

async function initSkipTurn() {
  try {
    await fetch('/api/initiative/next', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch {}
}

function initClear() {
  showConfirm('Clear all initiative entries?', async () => {
    const pw = getDmPw();
    if (!pw) return;
    try {
      const res = await fetch('/api/initiative/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': pw }
      });
      if (res.status === 401) { clearDmPw(); showAlert('Wrong DM password.'); }
    } catch {}
  });
}

function openInitEditModal(id) {
  const e = initDataMap[id];
  if (!e) return;
  initEditId = id;
  initEditCharId = e.charId || '';
  const isOwn = initEditCharId && initEditCharId === currentCharId;
  document.getElementById('init-edit-name').value = e.name;
  document.getElementById('init-edit-roll').value = e.roll;
  document.getElementById('init-edit-err').textContent = '';
  const pwRow = document.getElementById('init-edit-pw-row');
  const pwInput = document.getElementById('init-edit-pw');
  if (isOwn) {
    pwRow.style.display = 'none';
    pwInput.value = '';
  } else {
    pwRow.style.display = '';
    pwInput.value = sessionStorage.getItem('initDmPw') || '';
  }
  document.getElementById('init-edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-edit-name').focus(), 50);
}
function closeInitEditModal() {
  document.getElementById('init-edit-modal').style.display = 'none';
  initEditId = null; initEditCharId = null;
}

async function submitInitEdit() {
  if (!initEditId) return;
  const name  = document.getElementById('init-edit-name').value.trim();
  const roll  = parseInt(document.getElementById('init-edit-roll').value);
  const errEl = document.getElementById('init-edit-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  if (isNaN(roll)) { errEl.textContent = 'Invalid roll.'; return; }
  const isOwn = initEditCharId && initEditCharId === currentCharId;
  const headers = { 'Content-Type': 'application/json' };
  const body = { name, roll };
  if (isOwn) {
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    body.charId = currentCharId;
  } else {
    const pw = document.getElementById('init-edit-pw').value;
    if (!pw) { errEl.textContent = 'DM password required.'; return; }
    headers['X-Master-Password'] = pw;
  }
  try {
    const res = await fetch(`/api/initiative/${initEditId}`, {
      method: 'PUT', headers, body: JSON.stringify(body)
    });
    if (res.status === 401 || res.status === 403) {
      if (!isOwn) clearDmPw();
      errEl.textContent = 'Wrong DM password.'; return;
    }
    if (!res.ok) { errEl.textContent = 'Failed.'; return; }
    if (!isOwn) sessionStorage.setItem('initDmPw', document.getElementById('init-edit-pw').value);
    closeInitEditModal();
  } catch { errEl.textContent = 'Network error.'; }
}

async function deleteInitEntry(id) {
  const e = initDataMap[id];
  const charId = e?.charId || '';
  const isOwn = charId && charId === currentCharId;
  const headers = { 'Content-Type': 'application/json' };
  const body = {};
  if (isOwn) {
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    body.charId = currentCharId;
  } else {
    const pw = getDmPw();
    if (!pw) return;
    headers['X-Master-Password'] = pw;
  }
  try {
    const res = await fetch(`/api/initiative/${id}`, {
      method: 'DELETE', headers, body: JSON.stringify(body)
    });
    if (res.status === 401 || res.status === 403) { if (!isOwn) clearDmPw(); showAlert('Wrong password.'); }
  } catch {}
}

// ── Generic alert / confirm modals ───────────────────────────────────────────
function showAlert(msg) {
  document.getElementById('alert-msg').textContent = msg;
  document.getElementById('alert-modal').style.display = 'flex';
}
function closeAlert() {
  document.getElementById('alert-modal').style.display = 'none';
}

let confirmCallback = null;
function showConfirm(msg, onConfirm) {
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = onConfirm;
  document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirm() {
  document.getElementById('confirm-modal').style.display = 'none';
  confirmCallback = null;
}
function acceptConfirm() {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
}

// ── Real-time updates ────────────────────────────────────────────────────────
async function connectRealtime(handlers) {
  let provider = 'instantdb', wsUrl = null;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    provider = cfg.dbProvider;
    wsUrl = cfg.wsUrl || null;
  } catch {}
  if (provider === 'localdb') {
    function connect() {
      const ws = new WebSocket(wsUrl || `ws://${location.host}/ws`);
      ws.onmessage = e => {
        const { event, data } = JSON.parse(e.data);
        if (handlers[event]) handlers[event](data);
      };
      ws.onclose = () => setTimeout(connect, 3000);
    }
    connect();
  } else {
    const es = new EventSource('/api/events');
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, e => fn(JSON.parse(e.data)));
    }
    es.onerror = () => {};
  }
}

window.addEventListener('load', function startRealtime() {
  connectRealtime({
    characters: async (payload) => {
      loadCharacterList(true);
      // If the character that changed is currently open, update data in-place
      // (no clearSheet → media tab stays untouched)
      if (currentCharId && payload.id === currentCharId && !_suppressSSEReload) {
        try {
          const headers = {};
          if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
          const res = await fetch(`/api/characters/${currentCharId}`, { headers });
          if (res.ok) {
            const char = await res.json();
            applyData(char.data);
            document.getElementById('char-title').textContent = char.name || 'Character Sheet';
            renderShopWallet();
          }
        } catch {}
      }
    },
    shop: () => {
      loadShopTab();
    },
    loot: () => {
      loadLootTab();
      syncLootDescVisibility();
    },
    initiative: async () => {
      try {
        const res = await fetch('/api/initiative');
        if (!res.ok) return;
        initData = await res.json();
        renderInitiativeTracker(true);
      } catch {}
    },
    chat: (entry) => {
      appendChatEntry(entry);
      scrollChatLog();
      if (!chatOpen) {
        chatUnread++;
        const badge = document.getElementById('chat-badge');
        if (badge) { badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread); badge.style.display = ''; }
      }
    },
    'chat-clear': () => {
      document.getElementById('chat-log').innerHTML = '';
    },
    'calendar-updated': () => {
      pcalOnServerUpdate();
    },
  });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
let chatOpen = false;
let chatUnread = 0;

function chatToggle() {
  chatOpen = !chatOpen;
  document.getElementById('chat-body-wrap').classList.toggle('open', chatOpen);
  document.getElementById('chat-chevron').textContent = chatOpen ? '▼' : '▲';
  if (chatOpen) {
    // close initiative if open
    if (!initTrackerCollapsed) initTogglePanel();
    chatUnread = 0;
    const badge = document.getElementById('chat-badge');
    if (badge) badge.style.display = 'none';
    scrollChatLog();
  }
}

function getChatSender() {
  return document.querySelector('[data-key="name"]')?.value?.trim() || 'Player';
}

async function postToChat({ sender, dice, results, modifier, total, label }) {
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, dice, results, modifier, total, label })
    });
  } catch {}
}

function rollDie(sides) { return Math.ceil(Math.random() * sides); }

async function quickRoll(sides) {
  const count = Math.max(1, parseInt(document.getElementById('chat-count').value) || 1);
  const mod   = parseInt(document.getElementById('chat-mod').value) || 0;
  const label = document.getElementById('chat-label').value.trim();
  const results = Array.from({ length: count }, () => rollDie(sides));
  const total   = results.reduce((a, b) => a + b, 0) + mod;
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: getChatSender(), dice: `${count}d${sides}`, results, modifier: mod, total, label: label || null })
    });
  } catch {}
}

async function sendCustomRoll() {
  const sides = parseInt(document.getElementById('chat-sides').value);
  if (sides) await quickRoll(sides);
}

async function loadChat() {
  try {
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    const entries = await res.json();
    const log = document.getElementById('chat-log');
    if (!log) return;
    log.innerHTML = '';
    entries.forEach(e => appendChatEntry(e));
    scrollChatLog();
  } catch {}
}

function appendChatEntry(e) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const dt = new Date(e.timestamp + (e.timestamp.endsWith('Z') ? '' : 'Z'));
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    const capEsc  = e.caption ? esc(e.caption) : '';
    const capAttr = e.caption ? e.caption.replace(/\\/g,'\\\\').replace(/'/g,"\\'") : '';
    let mediaEl = '';
    if (e.mimeType.startsWith('image/')) {
      const inlineUrl = (e.mediumUrl && e.mimeType.startsWith('image/')) ? e.mediumUrl : url;
      mediaEl = `<img loading="lazy" src="${inlineUrl}" style="max-width:100%;max-height:220px;width:auto;object-fit:contain;border-radius:4px;margin-top:4px;cursor:zoom-in;display:block" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')" title="Click to view full size">`;
    } else if (e.mimeType.startsWith('video/')) {
      mediaEl = `<video src="${url}" controls style="max-width:100%;max-height:220px;border-radius:4px;margin-top:4px;display:block"></video><div style="font-size:10px;color:var(--txd);margin-top:2px;cursor:pointer" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')">⛶ Open in viewer</div>`;
    } else {
      mediaEl = `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px;background:var(--bg3);border-radius:4px" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')"><span style="font-size:20px">🎵</span><span style="font-size:11px;color:var(--ac)">Play audio</span></div>`;
    }
    const cap = e.caption ? `<div style="font-size:10px;color:var(--txd);margin-top:4px">${capEsc}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender)} <span style="font-size:10px;color:var(--txd);font-weight:normal">shared media</span></span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1 ? ` <span style="color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` <span style="color:var(--txd)">— ${esc(e.label)}</span>` : '';
  const natStr = isNat20 ? '<span class="ce-nat" style="color:var(--ok)"> ✨ NAT 20!</span>'
               : isNat1  ? '<span class="ce-nat" style="color:var(--err)"> 💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender)}</span>
    <span style="color:var(--txd);font-size:10px">${time}</span>
  </div>
  <span style="color:var(--txd);font-size:11px">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--ok)' : isNat1 ? 'var(--err)' : 'var(--tx)'}">${e.total}${natStr}</div>`;
  log.appendChild(div);
}

function scrollChatLog() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function openMediaModal(url, mimeType, caption) {
  const content = document.getElementById('media-modal-content');
  const capEl   = document.getElementById('media-modal-caption');
  if (mimeType.startsWith('image/')) {
    content.innerHTML = `<img src="${url}" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:6px;display:block;cursor:default" onclick="event.stopPropagation()">`;
  } else if (mimeType.startsWith('video/')) {
    content.innerHTML = `<video src="${url}" controls autoplay style="max-width:92vw;max-height:88vh;border-radius:6px;display:block" onclick="event.stopPropagation()"></video>`;
  } else {
    content.innerHTML = `<div onclick="event.stopPropagation()" style="background:#1a1a2e;border-radius:8px;padding:24px 32px;text-align:center"><div style="font-size:40px;margin-bottom:12px">🎵</div><audio src="${url}" controls autoplay style="min-width:280px"></audio></div>`;
  }
  capEl.textContent = caption || '';
  capEl.style.display = caption ? '' : 'none';
  document.getElementById('media-modal').style.display = 'flex';
}

function closeMediaModal() {
  document.getElementById('media-modal').style.display = 'none';
  document.getElementById('media-modal-content').innerHTML = '';
}

window.addEventListener('load', loadChat);

// ── Player Calendar ───────────────────────────────────────────────────────────
let pcalView        = { type: 'month', month: 1, year: 1492 };
let pcalCurrentDate = { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
let pcalEvents      = [];
let pcalLoaded      = false;
let pcalSelectedDay = null; // { month, day } or { festival } when a cell is clicked

function pcalEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function pcalLoad() {
  if (pcalLoaded) return;
  pcalLoaded = true;
  await pcalFetch();
}

async function pcalFetch() {
  try {
    const [stateRes, evRes] = await Promise.all([
      fetch('/api/calendar/state?_=' + Date.now()),
      fetch('/api/calendar/events?_=' + Date.now()),
    ]);
    if (stateRes.ok) pcalCurrentDate = await stateRes.json();
    if (evRes.ok)    pcalEvents       = await evRes.json();
  } catch {}
  pcalView = frDateToView(pcalCurrentDate);
  pcalRender();
}

function pcalOnServerUpdate() {
  pcalLoaded = false;
  const calTab = document.getElementById('tab-calendar');
  if (calTab && calTab.classList.contains('active')) {
    pcalLoad();
  }
}

function pcalRender() {
  pcalRenderTodayBar();
  pcalRenderNavTitle();
  pcalRenderGrid();
  pcalRenderEventsList();
}

function pcalRenderTodayBar() {
  const dateEl = document.getElementById('pcal-cur-date');
  const yearEl = document.getElementById('pcal-cur-year');
  if (dateEl) dateEl.textContent = frFormatDate(pcalCurrentDate);
  if (yearEl) yearEl.textContent = pcalCurrentDate.frYear ? frYearName(pcalCurrentDate.frYear) : '';
}

function pcalRenderNavTitle() {
  let title, subtitle;
  if (pcalView.type === 'festival') {
    title    = '✦ ' + frFestivalName(pcalView.festival);
    subtitle = frYearName(pcalView.year);
  } else {
    const m  = FR_MONTHS.find(mo => mo.num === pcalView.month);
    title    = m ? `${m.name} — ${m.epithet}` : '?';
    subtitle = frYearName(pcalView.year);
  }
  const tEl = document.getElementById('pcal-page-title');
  const sEl = document.getElementById('pcal-page-subtitle');
  if (tEl) tEl.textContent = title;
  if (sEl) sEl.textContent = subtitle;
}

function pcalRenderGrid() {
  const area = document.getElementById('pcal-grid-area');
  if (!area) return;

  if (pcalView.type === 'festival') {
    const isToday    = frDatesEqual(pcalCurrentDate, { frYear: pcalView.year, frFestival: pcalView.festival, frMonth: null, frDay: null });
    const isSelected = pcalSelectedDay && pcalSelectedDay.festival === pcalView.festival;
    const fest       = FR_FESTIVALS.find(f => f.key === pcalView.festival);
    const dots       = pcalEventsForView().map(e =>
      `<span class="cal-dot pub" title="${pcalEsc(e.title)}"></span>`
    ).join('');
    area.innerHTML = `
      <div class="cal-festival-row${isToday?' cal-is-today':''}${isSelected?' cal-is-today':''}"
           onclick="pcalDayClick(null,'${pcalView.festival}')" style="cursor:pointer">
        <span class="cal-fest-icon">✦</span>
        <span class="cal-fest-name">${pcalEsc(fest ? fest.name : pcalView.festival)}</span>
        ${dots ? `<div class="cal-fest-dots">${dots}</div>` : ''}
        ${isToday ? '<span class="cal-fest-mark">Today</span>' : ''}
      </div>`;
    return;
  }

  const evByDay = {};
  for (const e of pcalEventsForView()) {
    if (!evByDay[e.frDay]) evByDay[e.frDay] = [];
    evByDay[e.frDay].push(e);
  }

  const TENDAY_LABELS = ['First Tenday', 'Second Tenday', 'Third Tenday'];
  let rows = '';
  for (let td = 0; td < 3; td++) {
    let cells = `<td class="cal-tenday-lbl">${TENDAY_LABELS[td]}</td>`;
    for (let d = 1; d <= 10; d++) {
      const day        = td * 10 + d;
      const isToday    = frDatesEqual(pcalCurrentDate, { frYear: pcalView.year, frMonth: pcalView.month, frDay: day, frFestival: '' });
      const isSelected = pcalSelectedDay && pcalSelectedDay.day === day && !pcalSelectedDay.festival;
      const dayEvs     = evByDay[day] || [];
      const dots       = dayEvs.map(e => `<span class="cal-dot pub" title="${pcalEsc(e.title)}"></span>`).join('');
      const classes    = ['cal-day-cell', isToday ? 'cal-is-today' : '', isSelected ? 'cal-selected' : ''].filter(Boolean).join(' ');
      cells += `
        <td class="${classes}" onclick="pcalDayClick(${day},null)">
          <span class="cal-day-num">${day}</span>
          ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
        </td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  area.innerHTML = `<table class="cal-grid"><tbody>${rows}</tbody></table>`;
}

function pcalRenderEventsList() {
  const el      = document.getElementById('pcal-events-list');
  const titleEl = document.getElementById('pcal-events-title');
  if (!el) return;

  let evs, heading, showAllLink = '';

  if (pcalSelectedDay) {
    if (pcalSelectedDay.festival) {
      evs     = pcalEvents.filter(e => e.frFestival === pcalSelectedDay.festival && e.frYear === pcalView.year);
      heading = `Events on ${frFestivalName(pcalSelectedDay.festival)}`;
    } else {
      evs     = pcalEvents.filter(e => !e.frFestival && e.frMonth === pcalView.month && e.frDay === pcalSelectedDay.day && e.frYear === pcalView.year);
      heading = `Events on ${pcalSelectedDay.day} ${frMonthName(pcalView.month)}, ${pcalView.year} DR`;
    }
    const m = FR_MONTHS.find(mo => mo.num === pcalView.month);
    const allMonthLabel = pcalSelectedDay.festival ? frFestivalName(pcalSelectedDay.festival) : (m ? m.name : '');
    showAllLink = `<a href="#" style="font-size:10px;color:var(--txd);text-decoration:none;margin-left:8px" onclick="pcalClearSelection();return false">&#8592; All of ${allMonthLabel}</a>`;
  } else {
    evs = pcalEventsForView();
    if (pcalView.type === 'festival') {
      heading = `Events on ${frFestivalName(pcalView.festival)}`;
    } else {
      const m = FR_MONTHS.find(mo => mo.num === pcalView.month);
      heading = `Events in ${m ? m.name : '?'} ${pcalView.year} DR`;
    }
  }

  if (titleEl) titleEl.innerHTML = pcalEsc(heading) + showAllLink;

  if (!evs.length) {
    el.innerHTML = '<div class="cal-empty">No events recorded for this period.</div>';
    return;
  }

  el.innerHTML = evs.map(e => {
    const dateStr = frFormatDate({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival });
    return `
      <div class="cal-event-item">
        <div class="cal-event-info">
          <div class="cal-event-title">${pcalEsc(e.title)}</div>
          <div class="cal-event-date">${pcalEsc(dateStr)} &middot; ${pcalEsc(e.eventType)}</div>
          ${e.description ? `<div class="cal-event-desc">${pcalEsc(e.description)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function pcalEventsForView() {
  if (pcalView.type === 'festival') {
    return pcalEvents.filter(e => e.frFestival === pcalView.festival && e.frYear === pcalView.year);
  }
  return pcalEvents.filter(e => !e.frFestival && e.frMonth === pcalView.month && e.frYear === pcalView.year);
}

function pcalDayClick(day, festival) {
  if (festival) {
    const already = pcalSelectedDay && pcalSelectedDay.festival === festival;
    pcalSelectedDay = already ? null : { festival };
  } else {
    const already = pcalSelectedDay && pcalSelectedDay.day === day && !pcalSelectedDay.festival;
    pcalSelectedDay = already ? null : { day };
  }
  pcalRenderGrid();
  pcalRenderEventsList();
}

function pcalClearSelection() {
  pcalSelectedDay = null;
  pcalRenderGrid();
  pcalRenderEventsList();
}

function pcalNavPage(dir) {
  pcalSelectedDay = null;
  pcalView = frNavigate(pcalView, dir);
  pcalRenderNavTitle();
  pcalRenderGrid();
  pcalRenderEventsList();
}

function pcalGoToToday() {
  pcalSelectedDay = null;
  pcalView = frDateToView(pcalCurrentDate);
  pcalRender();
}
