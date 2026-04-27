// ── Data collection / application ─────────────────────────────────────────────
function collectData() {
  const out = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.type === 'checkbox') out[el.dataset.key] = el.checked;
    else out[el.dataset.key] = el.value;
  });
  out['_inspire'] = document.getElementById('inspire').classList.contains('on');
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
  recalcAll();
}

// ── API + Password state ───────────────────────────────────────────────────────
let pwMode       = null;   // 'unlock' | 'set'
let pwUnlockCharId = null;
let pwSetCharId    = null;
let ncImportData   = null; // parsed XML data for new-char import

// ── Character list ────────────────────────────────────────────────────────────
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

// ── Show / hide the main character body ───────────────────────────────────────
function showCharBody() {
  document.getElementById('no-char-screen').style.display = 'none';
  document.getElementById('char-body').style.display = '';
}
function showNoCharScreen() {
  document.getElementById('char-body').style.display = 'none';
  document.getElementById('no-char-screen').style.display = '';
}

// ── Apply a successfully loaded character to the sheet ────────────────────────
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

// ── Inline unlock screen ───────────────────────────────────────────────────────
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
  if (!screen || screen.style.display === 'none') return;
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

// ── Load character ────────────────────────────────────────────────────────────
async function loadCharacter(id) {
  if (!id) return;
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

// ── Save character ────────────────────────────────────────────────────────────
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

// ── New character modal ───────────────────────────────────────────────────────
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

// ── Password modal ────────────────────────────────────────────────────────────
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

// ── Export character as XML download ──────────────────────────────────────────
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

// ── XML ↔ character data ──────────────────────────────────────────────────────
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

  const ALIGNS = ['Lawful Good','Lawful Neutral','Lawful Evil','Neutral Good','True Neutral',
    'Neutral Evil','Chaotic Good','Chaotic Neutral','Chaotic Evil'];
  d.alignment = ALIGNS[parseInt(get('align'))] || '';

  ['str','dex','con','int','wis','cha'].forEach(s => {
    d[s] = String((parseInt(get(s))||0) + (parseInt(get('b'+s))||0));
  });

  const lvl = parseInt(d.level) || 1;
  d.profbonus = String(Math.floor((lvl - 1) / 4) + 2);

  const parseIdxList = raw => raw.split(',').map(x=>parseInt(x.trim())).filter(n=>!isNaN(n) && n>0);
  const profSet = new Set([...parseIdxList(get('skillC')), ...parseIdxList(get('skillB'))]);
  const expRaw  = get('skillE');
  const expIdxs = expRaw ? expRaw.split(',').map(x=>parseInt(x.trim())).filter(n=>!isNaN(n) && n>=0) : [];
  const expSet  = new Set(expIdxs);
  expIdxs.forEach(i => profSet.add(i));
  for (let i = 0; i < 18; i++) {
    d['sk-prof-'+i] = profSet.has(i);
    d['sk-exp-'+i]  = expSet.has(i);
  }

  const SAVES = {
    'Wizard':['int','wis'],'Sorcerer':['con','cha'],'Warlock':['wis','cha'],
    'Cleric':['wis','cha'],'Druid':['int','wis'],'Bard':['dex','cha'],
    'Fighter':['str','con'],'Ranger':['str','dex'],'Rogue':['dex','int'],
    'Paladin':['wis','cha'],'Barbarian':['str','con'],'Monk':['str','dex'],
    'Artificer':['con','int']
  };
  const saveSet = new Set(SAVES[d.class] || []);
  ['str','dex','con','int','wis','cha'].forEach(s => { d['save-prof-'+s] = saveSet.has(s); });

  const hpRaw  = get('hp').split(',').map(x => parseInt(x));
  const conMod = Math.floor(((parseInt(d.con)||10) - 10) / 2);
  let hpSum = 0;
  for (let i = 1; i <= lvl; i++) hpSum += (isNaN(hpRaw[i]) ? 0 : hpRaw[i]) + conMod;
  d.hpmax = String(Math.max(hpSum, lvl));
  d.hpcur = d.hpmax; d.hptemp = '0';

  const HD = {'Wizard':'d6','Sorcerer':'d6','Warlock':'d8','Cleric':'d8','Druid':'d8',
    'Bard':'d8','Rogue':'d8','Monk':'d8','Artificer':'d8',
    'Ranger':'d10','Fighter':'d10','Paladin':'d10','Barbarian':'d12'};
  d.hd = lvl + (HD[d.class] || 'd8'); d.hdspent = '0';

  const SP_AB = {'Wizard':'Intelligence','Sorcerer':'Charisma','Warlock':'Charisma',
    'Cleric':'Wisdom','Druid':'Wisdom','Bard':'Charisma','Paladin':'Charisma',
    'Ranger':'Wisdom','Artificer':'Intelligence'};
  d['sp-ability'] = SP_AB[d.class] || '';

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

  const spells = [];
  for (let sl = 0; sl <= 9; sl++) {
    const raw = get('spells'+sl);
    if (raw) raw.split(',').map(s=>s.trim()).filter(s=>s).forEach(name => {
      spells.push([String(sl), name, 'Action', '', false, false, '', false]);
    });
  }
  d._spells = JSON.stringify(spells);

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

  d.feats = get('feats').split(',').map(s=>s.trim()).filter(s=>s).join('\n');
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

  if (doc.querySelector('creator')) return parseCreatorFormat(doc);

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

// ── 5e.tools links ────────────────────────────────────────────────────────────
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

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('dnd-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('dnd-theme') || 'parchment'); })();
