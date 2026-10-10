// Written by Irmak Hakman — 2026-10-11 00:16
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: Table tab (DM only) ──────────────────────────────────────────
// The DM's view of the whole table: which map is loaded, every token and its
// health, and the fog regions and hidden items that can be revealed to players.

// ── Every token ──────────────────────────────────────────────────────────────
function sRenderDmHpList() {
  const list = sEl('s-dm-hp-list');
  if (!list) return;
  if (sTokens.length === 0) { list.innerHTML = '<li class="p-empty">No tokens on the map.</li>'; return; }
  const activeTokId = sGetActiveTokId();
  list.innerHTML = sTokens.map(tok => {
    const cur = tok.hpCurrent || 0, max = tok.hpMax || 0;
    const cls = ['p-init', tok.id === activeTokId ? 'on' : '', tok.type === 'monster' ? 'foe' : ''].filter(Boolean).join(' ');
    const note = tok.visible === false ? '<small>hidden from players</small>' : '';
    return `<li class="${cls}">
      <button type="button" class="p-init-main no-roll" onclick="sSelectToken('${escJs(tok.id)}')">
        <span class="name"><span>${esc(sTokDisplayName(tok))}</span>${note}</span>
        ${sHpBarHTML(sHpPct(cur, max))}<span class="hp">${cur}/${max}</span>
      </button>
    </li>`;
  }).join('');
}

// ── Initiative ───────────────────────────────────────────────────────────────
// The same controls as the Turn tab's command bar, kept here as well because
// this is where the DM sets a fight up.
function sRenderTableInit() {
  const box = sEl('s-table-init');
  if (!box) return;
  const running = !!sInitData.currentId;
  const waiting = sTokens.filter(t => t.type === 'monster' && !sInitData.entries.find(e => e.id === t.initiativeId)).length;
  sEl('s-table-init-state').textContent = running ? 'Initiative is running.'
    : `Not running. ${(sInitData.entries || []).length} in the order.`;
  sEl('s-table-init-toggle').textContent = running ? 'End initiative' : 'Start initiative';
  sEl('s-table-init-prev').hidden = sEl('s-table-init-next').hidden = !running;
  const rollAll = sEl('s-table-init-monsters');
  rollAll.hidden = waiting === 0;
  rollAll.textContent = `Roll for ${waiting} monster${waiting === 1 ? '' : 's'} without a roll`;
}

// One d20 for every monster token that is not in the order yet.
async function sRollInitMonsters() {
  if (!sIsDM()) return;
  const todo = sTokens.filter(t => t.type === 'monster' && !sInitData.entries.find(e => e.id === t.initiativeId));
  let done = 0;
  for (const tok of todo) if (await sRollInitFor(tok)) done++;
  sToast(`Rolled initiative for ${done} monster${done === 1 ? '' : 's'}.`);
  try { const r = await fetch('/api/initiative', { headers: sAuthHeaders() }); if (r.ok) sInitData = await r.json(); } catch {}
  sInitChanged();
}

// ── Fog regions ──────────────────────────────────────────────────────────────
// One row per region or item: its name, whether players can see it, and the
// button that flips that.
function sRevealRowHTML(label, visible, revealJs, hideJs) {
  return `<div class="p-reveal">
    <span class="name">${esc(label)}<small>${visible ? 'players can see this' : 'hidden'}</small></span>
    ${visible
      ? `<button type="button" class="c-btn" onclick="${hideJs}">Hide</button>`
      : `<button type="button" class="c-btn ok" onclick="${revealJs}">Reveal</button>`}
  </div>`;
}

function sRenderFogSection() {
  const section = sEl('s-fog-section');
  if (!section) return;
  const show = sIsDM() && sFogRegions.length > 0;
  section.hidden = !show;
  if (!show) return;
  sEl('s-fog-list').innerHTML = sFogRegions.map(r =>
    sRevealRowHTML(r.label || 'Region', r.visible, `sRevealFog('${escJs(r.id)}')`, `sHideFog('${escJs(r.id)}')`)).join('');
}

async function sRevealFog(id) {
  try { await fetch(`/api/table/fog/${id}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
async function sHideFog(id) {
  try { await fetch(`/api/table/fog/${id}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

// ── Hidden items (traps, chests, notes placed on the map) ────────────────────
const S_ITEM_KINDS = { trap: 'Trap', chest: 'Chest', door: 'Door', note: 'Note', other: 'Item' };

function sRenderItemsSection() {
  const section = sEl('s-items-section');
  if (!section) return;
  const show = sIsDM() && sHiddenItems.length > 0;
  section.hidden = !show;
  if (!show) return;
  sEl('s-items-list').innerHTML = sHiddenItems.map(item => {
    const kind = S_ITEM_KINDS[item.type] || 'Item';
    const desc = item.description
      ? `<p class="p-item-desc">${esc(item.description)}</p>`
      : '<p class="p-item-desc none">No description.</p>';
    return sRevealRowHTML(`${kind}: ${item.label || 'unnamed'}`, item.visible,
      `sRevealItem('${escJs(item.id)}')`, `sHideItem('${escJs(item.id)}')`) + desc;
  }).join('');
}

async function sRevealItem(id) {
  try { await fetch(`/api/table/items/${id}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
async function sHideItem(id) {
  try { await fetch(`/api/table/items/${id}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

// ── Maps and tokens ──────────────────────────────────────────────────────────
async function sLoadPrepMaps() {
  if (!sIsDM()) return;
  try {
    const res = await fetch('/api/prepared-maps', { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) return;
    sPrepMaps = await res.json();
    const sel = sEl('s-map-sel');
    if (!sel) return;
    const keep = sel.value;
    sel.replaceChildren(new Option('Choose a map', ''), ...sPrepMaps.map(m => new Option(m.name || '', m.id)));
    if (keep) sel.value = keep;
  } catch {}
}

async function sLoadMap() {
  const sel   = sEl('s-map-sel');
  const mapId = sel?.value;
  if (!mapId || !sIsDM()) { sToast('Choose a map first.'); return; }
  const name = sel.options[sel.selectedIndex]?.textContent || 'this map';
  if (!await sConfirm(`Load ${name} onto the table? It replaces the map that is there now.`, 'Load map')) return;
  try { await fetch(`/api/prepared-maps/${mapId}/load-to-table`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

async function sClearTokens() {
  if (!sIsDM()) return;
  if (!await sConfirm('Remove every token from the map and clear initiative?', 'Remove all tokens')) return;
  try { await fetch('/api/table/clear', { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

// Adding a token needs the map, so the dialog opens on the map screen.
function sOpenAddTokenOnPrimary() {
  _sConsolePost({ type: 'OPEN_ADD_TOKEN' });
  sToast('The add-token window is open on the map screen.');
}
