
let masterPw = '';
let monsters = [];
let pendingInitMonster = null;
let editingMonsterId = null;
let editFormData = null;
let _editPortraitData = null; // base64 data URL or null = no change, '' = remove

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseEntry(s) {
  const escaped = String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return escaped.replace(/\{@(\w+)\s([^}]*)\}/g, (_,tag,content) => {
    const p = content.split('|');
    switch(tag) {
      case 'spell': case 'item': case 'creature': case 'condition': case 'status': case 'variantrule': case 'sense': return '<em>'+p[0]+'</em>';
      case 'hit': return (parseInt(p[0])>=0?'+':'')+p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc': return 'DC '+p[0];
      case 'h': case 'atk': case 'atkr': case 'actSaveSuccessOrFail': return '';
      case 'recharge': return '(Recharge '+p[0]+'–6)';
      case 'actSave': return p[0].charAt(0).toUpperCase()+p[0].slice(1)+' Save';
      case 'actSaveFail': return '<em>Failure:</em>';
      case 'actSaveSuccess': return '<em>Success:</em>';
      default: return p[0]||content;
    }
  }).replace(/\{@\w+\}/g,'');
}

function renderMonsterInfo(data) {
  const SZ={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
  const AL={L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  const size=(data.size||[]).map(s=>SZ[s]||s).join('/');
  const typeStr=typeof data.type==='string'?data.type:data.type?(data.type.type||'')+(data.type.tags&&data.type.tags.length?' ('+data.type.tags.join(', ')+')':''):'';
  const alignment=(data.alignment||[]).map(a=>AL[a]||a).join(' ');
  const cr=(data.cr&&typeof data.cr==='object')?data.cr.cr:(data.cr||'—');
  const acStr=!data.ac?'—':[].concat(data.ac).map(a=>typeof a==='number'?a:typeof a==='object'?String(a.ac||'')+([].concat(a.from||[]).length?' ('+[].concat(a.from).join(', ')+')':''):a).join(', ');
  const hpStr=!data.hp?'—':data.hp.average!==undefined?String(data.hp.average)+(data.hp.formula?' ('+data.hp.formula+')':''):String(data.hp);
  const speedParts=[];
  if(data.speed){if(data.speed.walk)speedParts.push(data.speed.walk+' ft.');if(data.speed.fly)speedParts.push('fly '+data.speed.fly+' ft.');if(data.speed.swim)speedParts.push('swim '+data.speed.swim+' ft.');if(data.speed.climb)speedParts.push('climb '+data.speed.climb+' ft.');if(data.speed.burrow)speedParts.push('burrow '+data.speed.burrow+' ft.');}
  const speedStr=speedParts.join(', ')||'—';
  const scores=['str','dex','con','int','wis','cha'];const snames=['STR','DEX','CON','INT','WIS','CHA'];
  const saveStr=data.save?Object.entries(data.save).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const skillStr=data.skill?Object.entries(data.skill).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const immuneStr=[].concat(data.immune||[]).map(i=>typeof i==='string'?i:[].concat(i.immune||[]).join('/')).join(', ');
  const resistStr=[].concat(data.resist||[]).map(i=>typeof i==='string'?i:[].concat(i.resist||[]).join('/')).join(', ');
  const condImmStr=[].concat(data.conditionImmune||[]).map(i=>typeof i==='string'?i:[].concat(i.conditionImmune||[]).join('/')).join(', ');
  const sensesStr=[...(data.senses||[])].join(', ')+(data.passive?((data.senses||[]).length?', ':'')+('Passive Perception '+data.passive):'');
  const langStr=(data.languages||[]).join(', ')||'—';
  const HR='<hr style="border:none;border-top:1px solid var(--a44);margin:8px 0">';
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 4px">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 4px;padding-left:16px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSpellEntries(list){return(list||[]).map(sc=>{let h='<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+esc(sc.name||'')+'</span> ';if(sc.headerEntries)h+=rEntries(sc.headerEntries);if(sc.will&&sc.will.length)h+='<p style="margin:2px 0 4px"><em>At will:</em> '+sc.will.map(s=>parseEntry(s)).join(', ')+'</p>';if(sc.daily)for(const[k,v]of Object.entries(sc.daily)){const n=k.replace('e','');h+='<p style="margin:2px 0 4px"><em>'+n+'/day'+(k.endsWith('e')?' each':'')+':</em> '+v.map(s=>parseEntry(s)).join(', ')+'</p>';}if(sc.spells)for(const[lvl,sd]of Object.entries(sc.spells)){const slots=sd.slots?' ('+sd.slots+' slot'+(sd.slots!==1?'s':'')+')':'';const ord=['','st','nd','rd'];const lvlStr=lvl==='0'?'Cantrips (at will)':lvl+(ord[+lvl]||'th')+'-level'+slots;h+='<p style="margin:2px 0 4px"><em>'+esc(lvlStr)+':</em> '+[].concat(sd.spells||[]).map(s=>parseEntry(s)).join(', ')+'</p>';}return h+'</div>';}).join('');}
  function rSectionWithSc(items,scList,title){const hi=items&&items.length;const hs=scList&&scList.length;if(!hi&&!hs)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">'+title+'</div>'+(hi?items.map(item=>'<div style="margin:5px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join(''):'')+rSpellEntries(scList);}
  let html='<div style="font-size:12px">';
  html+='<div style="font-size:16px;font-weight:bold;color:var(--ac)">'+esc(data.name||'Unknown')+'</div>';
  html+='<div style="font-size:12px;font-style:italic;color:var(--txd);margin-bottom:6px">'+esc([size,typeStr,alignment].filter(Boolean).join(', '))+(data.source?' <span style="font-size:10px;opacity:.6">('+esc(data.source)+')</span>':'')+'</div>';
  html+=HR;
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">AC</span> '+esc(String(acStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">HP</span> '+esc(String(hpStr))+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Speed</span> '+esc(speedStr)+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Challenge</span> '+esc(String(cr))+'</div>';
  html+=HR+'<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center;margin:6px 0">';
  for(let i=0;i<6;i++){const sc=scores[i];const val=data[sc]||10;const m=Math.floor((val-10)/2);html+='<div style="background:var(--bg3);border-radius:3px;padding:4px 2px"><div style="font-size:9px;color:var(--ac);text-transform:uppercase;font-weight:bold">'+snames[i]+'</div><div style="font-size:13px;font-weight:bold">'+val+'</div><div style="font-size:10px;color:var(--txd)">'+(m>=0?'+':'')+m+'</div></div>';}
  html+='</div>'+HR;
  if(saveStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Saving Throws</span> '+esc(saveStr)+'</div>';
  if(skillStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Skills</span> '+esc(skillStr)+'</div>';
  if(immuneStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Damage Immunities</span> '+esc(immuneStr)+'</div>';
  if(resistStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Resistances</span> '+esc(resistStr)+'</div>';
  if(condImmStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Condition Immunities</span> '+esc(condImmStr)+'</div>';
  if(sensesStr)html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Senses</span> '+esc(sensesStr)+'</div>';
  html+='<div style="margin:3px 0"><span style="color:var(--ac);font-weight:bold">Languages</span> '+esc(langStr)+'</div>';
  const scGroups={};for(const sc of(data.spellcasting||[])){const k=(sc.displayAs||'trait').toLowerCase();(scGroups[k]||(scGroups[k]=[])).push(sc);}
  const traitSc=Object.entries(scGroups).filter(([k])=>!['action','bonus','reaction','legendary','mythic'].includes(k)).flatMap(([,v])=>v);
  html+=rSection(data.trait,'Traits');
  if(traitSc.length)html+=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:4px">Spellcasting</div>'+rSpellEntries(traitSc);
  html+=rSectionWithSc(data.action,scGroups['action'],'Actions');
  html+=rSectionWithSc(data.bonus,scGroups['bonus'],'Bonus Actions');
  html+=rSectionWithSc(data.reaction,scGroups['reaction'],'Reactions');
  html+=rSectionWithSc(data.legendary,scGroups['legendary'],'Legendary Actions');
  html+=rSection(data.mythic,'Mythic Actions');
  html+='</div>';
  return html;
}

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('monsters-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('monsters-theme') || 'dark-gold'); })();

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  const errEl = document.getElementById('gate-err');
  if (!pw) { errEl.textContent = 'Enter the master password.'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    await loadMonsters();
  } catch { errEl.textContent = 'Connection error.'; }
}

async function loadMonsters() {
  try {
    const res = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { showStatus('Failed to load monsters.', true); return; }
    monsters = await res.json();
    renderTable();
  } catch { showStatus('Network error.', true); }
}

function getTypeStr(data) {
  if (!data.type) return '';
  if (typeof data.type === 'string') return data.type;
  let s = data.type.type || '';
  if (data.type.tags && data.type.tags.length) s += ' (' + data.type.tags.join(', ') + ')';
  return s;
}

function getAcStr(data) {
  if (!data.ac) return '—';
  const first = [].concat(data.ac)[0];
  if (typeof first === 'number') return String(first);
  if (typeof first === 'object') return String(first.ac || '—');
  return String(first);
}

function getHpStr(data) {
  if (!data.hp) return '—';
  return data.hp.average !== undefined ? String(data.hp.average) : String(data.hp);
}

function getSpeedStr(data) {
  if (!data.speed) return '—';
  const parts = [];
  if (data.speed.walk) parts.push(data.speed.walk + ' ft.');
  if (data.speed.fly) parts.push('✈' + data.speed.fly);
  if (data.speed.swim) parts.push('🌊' + data.speed.swim);
  return parts.join(' ') || '—';
}

function getInitBonus(data) {
  const dexMod = Math.floor(((data.dex || 10) - 10) / 2);
  if (data.initiative && data.initiative.proficiency) {
    const crVal = (data.cr && typeof data.cr === 'object') ? parseFloat(data.cr.cr) : parseFloat(data.cr);
    const prof = isNaN(crVal) ? 2 : crVal < 5 ? 2 : crVal < 9 ? 3 : crVal < 13 ? 4 : crVal < 17 ? 5 : crVal < 21 ? 6 : crVal < 25 ? 7 : crVal < 29 ? 8 : 9;
    return dexMod + prof;
  }
  return dexMod;
}

function renderTable() {
  const wrap = document.getElementById('monster-table-wrap');
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const filtered = monsters.filter(m => {
    if (!q) return true;
    const type = getTypeStr(m.data).toLowerCase();
    return m.name.toLowerCase().includes(q) || type.includes(q);
  });
  if (filtered.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--txd);padding:20px">' + (monsters.length === 0 ? 'No monsters imported yet.' : 'No monsters match your search.') + '</div>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Name</th>
      <th>CR</th>
      <th>Type</th>
      <th>AC</th>
      <th>HP</th>
      <th>Speed</th>
      <th style="text-align:right">Actions</th>
    </tr></thead>
    <tbody>` +
    filtered.map(m => {
      const d = m.data || {};
      const type = getTypeStr(d);
      return `<tr>
        <td><strong>${esc(m.name)}</strong></td>
        <td><span class="cr-badge">${esc(m.cr || '?')}</span></td>
        <td><span class="type-badge">${esc(type)}</span></td>
        <td>${esc(getAcStr(d))}</td>
        <td>${esc(getHpStr(d))}</td>
        <td>${esc(getSpeedStr(d))}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn sm" onclick="openInfoModal('${m.id}')" title="View stat block">Info</button>
          <button class="btn sm success" onclick="openInitModal('${m.id}')" title="Add to initiative tracker">+ Init</button>
          <button class="btn sm" onclick="openEditMonsterModal('${m.id}')" title="Edit monster JSON">Edit</button>
          <button class="btn sm" onclick="exportMonster('${m.id}','${m.name.replace(/'/g,"\\'")}')" title="Export monster to file">Export</button>
          <button class="btn sm danger" onclick="deleteMonster('${m.id}')" title="Remove monster">✕</button>
        </td>
      </tr>`;
    }).join('') +
    '</tbody></table>';
}

// ── Info modal ────────────────────────────────────────────────────────────────
function openInfoModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  document.getElementById('info-modal-title').textContent = m.name;
  document.getElementById('info-modal-body').innerHTML = renderMonsterInfo(m.data || {});
  document.getElementById('info-modal').style.display = 'flex';
}

function closeInfoModal() {
  document.getElementById('info-modal').style.display = 'none';
}

// ── Add to initiative modal ───────────────────────────────────────────────────
function openInitModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  pendingInitMonster = m;
  const bonus = getInitBonus(m.data || {});
  document.getElementById('init-modal-title').textContent = 'Add to Initiative: ' + m.name;
  document.getElementById('init-modal-desc').textContent = 'Will roll d20 + initiative bonus and add to tracker.';
  document.getElementById('init-name-override').value = m.name;
  document.getElementById('init-bonus-val').value = bonus;
  document.getElementById('init-modal-err').textContent = '';
  document.getElementById('init-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-bonus-val').focus(), 50);
}

function closeInitModal() {
  document.getElementById('init-modal').style.display = 'none';
  pendingInitMonster = null;
}

async function submitAddToInit() {
  if (!pendingInitMonster) return;
  const m = pendingInitMonster;
  const nameOverride = document.getElementById('init-name-override').value.trim() || m.name;
  const bonus = parseInt(document.getElementById('init-bonus-val').value) || 0;
  const d20 = Math.ceil(Math.random() * 20);
  const roll = d20 + bonus;
  const errEl = document.getElementById('init-modal-err');
  try {
    const res = await fetch('/api/initiative/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name: nameOverride, roll, monsterId: m.id })
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { errEl.textContent = 'Failed to add to initiative.'; return; }
    closeInitModal();
    showStatus(`${nameOverride} added with roll ${roll} (d20${bonus>=0?'+':''}${bonus} = ${d20}${bonus>=0?'+':''}${bonus}=${roll}).`, false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Delete monster ────────────────────────────────────────────────────────────
async function deleteMonster(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m || !confirm(`Remove "${m.name}" from monster list?`)) return;
  try {
    const res = await fetch(`/api/monsters/${monsterId}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { showStatus('Failed to delete monster.', true); return; }
    monsters = monsters.filter(x => x.id !== monsterId);
    renderTable();
    showStatus(`${m.name} removed.`, false);
  } catch { showStatus('Network error.', true); }
}

// ── Export single monster ─────────────────────────────────────────────────────
async function exportMonster(id, name) {
  try {
    const res = await fetch(`/api/monsters/${id}/export`, { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const data = await res.json();
    const date = new Date().toISOString().split('T')[0];
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `monster-${slug}-${date}.json`;
    a.click();
  } catch (err) {
    const statusEl = document.getElementById('import-status');
    if (statusEl) { statusEl.style.color = 'var(--err)'; statusEl.textContent = 'Export failed: ' + err.message; }
  }
}

// ── Import ────────────────────────────────────────────────────────────────────
async function importMonsters() {
  const raw = document.getElementById('import-text').value.trim();
  const statusEl = document.getElementById('import-status');
  if (!raw) { statusEl.style.color = 'var(--err)'; statusEl.textContent = 'Paste JSON first.'; return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { statusEl.style.color = 'var(--err)'; statusEl.textContent = 'Invalid JSON: ' + e.message; return; }
  // Normalise: support single object, array, or 5etools {monster:[...]} format
  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.monster)) {
    list = parsed.monster;
  } else if (parsed && typeof parsed === 'object' && parsed.name) {
    list = [parsed];
  } else {
    statusEl.style.color = 'var(--err)'; statusEl.textContent = 'Expected a monster object, array, or {monster:[...]} wrapper.'; return;
  }
  statusEl.style.color = 'var(--txd)'; statusEl.textContent = 'Importing…';
  try {
    const res = await fetch('/api/monsters/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ monsters: list })
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    const data = await res.json();
    if (!res.ok) { statusEl.style.color = 'var(--err)'; statusEl.textContent = data.error || 'Import failed.'; return; }
    statusEl.style.color = 'var(--ok)'; statusEl.textContent = `✓ Imported ${data.count} monster${data.count !== 1 ? 's' : ''}.`;
    document.getElementById('import-text').value = '';
    await loadMonsters();
  } catch { statusEl.style.color = 'var(--err)'; statusEl.textContent = 'Network error.'; }
}

// ── Edit monster (form) ───────────────────────────────────────────────────────
function efSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val === undefined || val === null) ? '' : String(val);
}

function efFormatProfMap(obj) {
  if (!obj) return '';
  return Object.entries(obj).map(([k, v]) => k[0].toUpperCase() + k.slice(1) + ' ' + v).join(', ');
}

function efFormatDmgList(list) {
  if (!list || !list.length) return '';
  return [].concat(list).map(i => typeof i === 'string' ? i : [].concat(i.immune || i.resist || i.conditionImmune || []).join('/')).join(', ');
}

function addEditRow(containerId) {
  efAppendRow(document.getElementById(containerId), { name: '', entries: [] });
  document.getElementById(containerId).lastElementChild.querySelector('[data-field=name]').focus();
}

function efAppendRow(container, item) {
  const div = document.createElement('div');
  div.className = 'ef-entry-row';
  div.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
    <input type="text" placeholder="Name" data-field="name" style="flex:1">
    <button type="button" class="btn sm danger" onclick="this.closest('.ef-entry-row').remove()">✕</button>
  </div>
  <textarea placeholder="Description" data-field="entries" style="min-height:56px;resize:vertical;width:100%"></textarea>`;
  div.querySelector('[data-field=name]').value = item.name || '';
  div.querySelector('[data-field=entries]').value = (item.entries || []).filter(e => typeof e === 'string').join('\n\n');
  container.appendChild(div);
}

function scToItem(sc) {
  const parts = [];
  (sc.headerEntries || []).forEach(e => { if (typeof e === 'string') parts.push(e); });
  if (sc.will && sc.will.length) parts.push('At will: ' + sc.will.join(', '));
  if (sc.daily) for (const [k, v] of Object.entries(sc.daily)) {
    const n = k.replace('e', '');
    parts.push(n + '/day' + (k.endsWith('e') ? ' each' : '') + ': ' + v.join(', '));
  }
  if (sc.spells) for (const [lvl, sd] of Object.entries(sc.spells)) {
    const slots = sd.slots ? ' (' + sd.slots + ' slot' + (sd.slots !== 1 ? 's' : '') + ')' : '';
    const ord = ['', 'st', 'nd', 'rd'];
    const lvlStr = lvl === '0' ? 'Cantrips (at will)' : lvl + (ord[+lvl] || 'th') + '-level' + slots;
    parts.push(lvlStr + ': ' + [].concat(sd.spells || []).join(', '));
  }
  return { name: sc.name || '', entries: parts };
}

function efLoadSection(containerId, items) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  (items || []).forEach(item => efAppendRow(el, item));
}

function efReadSection(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('.ef-entry-row')].map(row => ({
    name: row.querySelector('[data-field=name]').value.trim(),
    entries: row.querySelector('[data-field=entries]').value.trim() ? [row.querySelector('[data-field=entries]').value.trim()] : []
  })).filter(r => r.name || r.entries.length);
}

function efParseProfStr(str) {
  if (!str.trim()) return undefined;
  const result = {};
  str.split(',').forEach(part => {
    const m = part.trim().match(/^(\w+)\s+([+-]?\d+)$/);
    if (m) { const n = parseInt(m[2]); result[m[1].toLowerCase()] = (n >= 0 ? '+' : '') + n; }
  });
  return Object.keys(result).length ? result : undefined;
}

function efParseTypeStr(str) {
  if (!str.trim()) return 'unknown';
  const m = str.trim().match(/^(.+?)\s*\((.+)\)$/);
  if (m) return { type: m[1].trim().toLowerCase(), tags: m[2].split(',').map(s => s.trim().toLowerCase()) };
  return str.trim().toLowerCase();
}

function efParseAlignStr(str) {
  const MAP = { lawful:'L', neutral:'N', chaotic:'C', good:'G', evil:'E', unaligned:'U', any:'A' };
  return str.trim().split(/[\s,]+/).map(w => MAP[w.toLowerCase()] || w.slice(0,1).toUpperCase()).filter(Boolean);
}

function efParseCsvList(str) {
  if (!str.trim()) return undefined;
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function openAddMonsterModal() {
  editingMonsterId = null;
  editFormData = {};
  // Clear portrait
  _editPortraitData = null;
  _setEfPortraitUI(null);
  // Clear all fields
  ['ef-name','ef-cr','ef-type','ef-alignment','ef-source','ef-hp-formula',
   'ef-saves','ef-skills','ef-immune','ef-resist','ef-condimm','ef-senses','ef-languages'].forEach(id => efSet(id, ''));
  ['ef-ac','ef-hp-avg','ef-speed-walk','ef-speed-fly','ef-speed-swim','ef-speed-climb','ef-speed-burrow',
   'ef-str','ef-dex','ef-con','ef-int','ef-wis','ef-cha','ef-passive'].forEach(id => efSet(id, ''));
  document.getElementById('ef-size').value = 'M';
  ['ef-traits','ef-actions','ef-bonus','ef-reactions','ef-legendary'].forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('edit-modal-title').textContent = 'Add Monster';
  document.getElementById('edit-err').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ef-name').focus(), 50);
}

function openEditMonsterModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  editingMonsterId = monsterId;
  editFormData = JSON.parse(JSON.stringify(m.data || {}));
  const d = editFormData;

  // Basic
  efSet('ef-name', d.name);
  efSet('ef-cr', typeof d.cr === 'object' ? d.cr.cr : d.cr);
  efSet('ef-size', (d.size || ['M'])[0] || 'M');
  efSet('ef-type', typeof d.type === 'string' ? d.type : d.type ? (d.type.type || '') + (d.type.tags && d.type.tags.length ? ' (' + d.type.tags.join(', ') + ')' : '') : '');
  const AL = {L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  efSet('ef-alignment', (d.alignment || []).map(a => AL[a] || a).join(' '));
  efSet('ef-source', d.source);
  // Combat
  const acFirst = [].concat(d.ac || [])[0];
  efSet('ef-ac', typeof acFirst === 'number' ? acFirst : (acFirst && acFirst.ac) || '');
  efSet('ef-hp-avg', d.hp ? d.hp.average : '');
  efSet('ef-hp-formula', d.hp ? d.hp.formula : '');
  efSet('ef-speed-walk', d.speed ? d.speed.walk || '' : '');
  efSet('ef-speed-fly', d.speed ? d.speed.fly || '' : '');
  efSet('ef-speed-swim', d.speed ? d.speed.swim || '' : '');
  efSet('ef-speed-climb', d.speed ? d.speed.climb || '' : '');
  efSet('ef-speed-burrow', d.speed ? d.speed.burrow || '' : '');
  // Ability scores
  ['str','dex','con','int','wis','cha'].forEach(s => efSet('ef-' + s, d[s] || ''));
  // Proficiencies
  efSet('ef-saves', efFormatProfMap(d.save));
  efSet('ef-skills', efFormatProfMap(d.skill));
  efSet('ef-immune', efFormatDmgList(d.immune));
  efSet('ef-resist', efFormatDmgList(d.resist));
  efSet('ef-condimm', efFormatDmgList(d.conditionImmune));
  efSet('ef-senses', (d.senses || []).join(', '));
  efSet('ef-passive', d.passive);
  efSet('ef-languages', (d.languages || []).join(', '));
  // Dynamic sections — merge spellcasting entries by displayAs into the matching section
  const scByKey = {};
  for (const sc of (d.spellcasting || [])) {
    const k = (sc.displayAs || 'trait').toLowerCase();
    (scByKey[k] || (scByKey[k] = [])).push(sc);
  }
  efLoadSection('ef-traits', d.trait);
  efLoadSection('ef-actions', [...(d.action || []), ...(scByKey['action'] || []).map(scToItem)]);
  efLoadSection('ef-bonus', [...(d.bonus || []), ...(scByKey['bonus'] || []).map(scToItem)]);
  efLoadSection('ef-reactions', [...(d.reaction || []), ...(scByKey['reaction'] || []).map(scToItem)]);
  efLoadSection('ef-legendary', [...(d.legendary || []), ...(scByKey['legendary'] || []).map(scToItem)]);

  // Portrait
  _editPortraitData = null;
  const existingPortrait = d.portrait || null;
  _setEfPortraitUI(existingPortrait);

  document.getElementById('edit-modal-title').textContent = 'Edit Monster';
  document.getElementById('edit-err').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ef-name').focus(), 50);
}

function closeEditMonsterModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingMonsterId = null;
  editFormData = null;
  _editPortraitData = null;
}

async function submitEditMonster() {
  if (!editingMonsterId) return;
  const errEl = document.getElementById('edit-err');
  const name = document.getElementById('ef-name').value.trim();
  if (!name) { errEl.textContent = 'Name is required.'; return; }

  // Start from original data to preserve untouched fields (spellcasting, tokens, etc.)
  const data = JSON.parse(JSON.stringify(editFormData || {}));

  // Basic
  data.name = name;
  const srcVal = document.getElementById('ef-source').value.trim();
  if (srcVal) data.source = srcVal; else delete data.source;
  const crStr = document.getElementById('ef-cr').value.trim();
  if (crStr) data.cr = typeof data.cr === 'object' ? { ...data.cr, cr: crStr } : crStr;
  const sizeVal = document.getElementById('ef-size').value;
  if (sizeVal) data.size = [sizeVal];
  const typeStr = document.getElementById('ef-type').value.trim();
  if (typeStr) data.type = efParseTypeStr(typeStr);
  data.alignment = efParseAlignStr(document.getElementById('ef-alignment').value);

  // Combat
  const acNum = parseInt(document.getElementById('ef-ac').value);
  if (!isNaN(acNum)) data.ac = [acNum];
  const hpAvg = parseInt(document.getElementById('ef-hp-avg').value);
  const hpFormula = document.getElementById('ef-hp-formula').value.trim();
  if (!isNaN(hpAvg) || hpFormula) data.hp = { average: isNaN(hpAvg) ? (data.hp?.average || 0) : hpAvg, formula: hpFormula || data.hp?.formula || '' };
  const speed = {};
  for (const f of ['walk','fly','swim','climb','burrow']) {
    const v = document.getElementById('ef-speed-' + f).value.trim();
    if (v !== '') { const n = parseInt(v); if (!isNaN(n)) speed[f] = n; }
  }
  if (Object.keys(speed).length) data.speed = speed;

  // Ability scores
  for (const s of ['str','dex','con','int','wis','cha']) {
    const v = parseInt(document.getElementById('ef-' + s).value);
    if (!isNaN(v)) data[s] = v;
  }

  // Proficiencies
  const saves = efParseProfStr(document.getElementById('ef-saves').value);
  if (saves) data.save = saves; else delete data.save;
  const skills = efParseProfStr(document.getElementById('ef-skills').value);
  if (skills) data.skill = skills; else delete data.skill;
  const immune = efParseCsvList(document.getElementById('ef-immune').value);
  if (immune) data.immune = immune; else delete data.immune;
  const resist = efParseCsvList(document.getElementById('ef-resist').value);
  if (resist) data.resist = resist; else delete data.resist;
  const condImm = efParseCsvList(document.getElementById('ef-condimm').value);
  if (condImm) data.conditionImmune = condImm; else delete data.conditionImmune;
  const senses = efParseCsvList(document.getElementById('ef-senses').value);
  if (senses) data.senses = senses; else delete data.senses;
  const passive = parseInt(document.getElementById('ef-passive').value);
  if (!isNaN(passive)) data.passive = passive; else delete data.passive;
  const langs = efParseCsvList(document.getElementById('ef-languages').value);
  if (langs) data.languages = langs; else delete data.languages;

  // Dynamic sections
  const trait = efReadSection('ef-traits'); if (trait.length) data.trait = trait; else delete data.trait;
  const action = efReadSection('ef-actions'); if (action.length) data.action = action; else delete data.action;
  const bonus = efReadSection('ef-bonus'); if (bonus.length) data.bonus = bonus; else delete data.bonus;
  const reaction = efReadSection('ef-reactions'); if (reaction.length) data.reaction = reaction; else delete data.reaction;
  const legendary = efReadSection('ef-legendary'); if (legendary.length) data.legendary = legendary; else delete data.legendary;
  // Remove spellcasting entries that were merged into the sections above
  if (data.spellcasting) {
    data.spellcasting = data.spellcasting.filter(sc => {
      const k = (sc.displayAs || 'trait').toLowerCase();
      return !['action', 'bonus', 'reaction', 'legendary'].includes(k);
    });
    if (!data.spellcasting.length) delete data.spellcasting;
  }

  const crForApi = typeof data.cr === 'object' ? data.cr.cr : (data.cr || '?');
  errEl.textContent = '';
  try {
    let res;
    if (editingMonsterId) {
      res = await fetch(`/api/monsters/${editingMonsterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ name, cr: String(crForApi), dataJson: JSON.stringify(data) })
      });
    } else {
      res = await fetch('/api/monsters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ monsters: [data] })
      });
    }
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { errEl.textContent = 'Failed to save.'; return; }
    // Upload portrait if changed (_editPortraitData='' means remove, string = new image)
    if (_editPortraitData !== null && editingMonsterId) {
      await fetch(`/api/monsters/${editingMonsterId}/portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ dataUrl: _editPortraitData })
      });
    }
    closeEditMonsterModal();
    await loadMonsters();
    showStatus(editingMonsterId ? `${name} updated.` : `${name} added.`, false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Edit-modal portrait helpers ───────────────────────────────────────────────
function _setEfPortraitUI(dataUrl) {
  const preview = document.getElementById('ef-portrait-preview');
  const none = document.getElementById('ef-portrait-none');
  const clearBtn = document.getElementById('ef-portrait-clear');
  if (dataUrl) {
    preview.src = dataUrl;
    preview.style.display = '';
    none.style.display = 'none';
    clearBtn.style.display = '';
  } else {
    preview.src = '';
    preview.style.display = 'none';
    none.style.display = '';
    clearBtn.style.display = 'none';
  }
}
function efPickPortrait() {
  document.getElementById('ef-portrait-input').click();
}
function efClearPortrait() {
  _editPortraitData = '';
  _setEfPortraitUI(null);
}
function efPortraitChosen(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _editPortraitData = e.target.result;
    _setEfPortraitUI(_editPortraitData);
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('info-modal').style.display !== 'none') closeInfoModal();
    if (document.getElementById('init-modal').style.display !== 'none') closeInitModal();
    if (document.getElementById('edit-modal').style.display !== 'none') closeEditMonsterModal();
  }
});

// ── Auto-auth from stored session ─────────────────────────────────────────────
(async function() {
  const stored = sessionStorage.getItem('dmMasterPw');
  if (!stored) return;
  document.getElementById('gate-pw').value = stored;
  await authenticate();
})();
