
let masterPw = '';
let initData = { entries: [], currentId: null };
let editingId = null;
let initDataMap = {};
let dmMonsters = [];
let pendingInitMonsterId = null;

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('dm-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('dm-theme') || 'dark-gold'); })();

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

function handleUnauth() {
  masterPw = '';
  document.getElementById('gate').style.display = '';
  document.getElementById('main-content').style.display = 'none';
}

async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  const errEl = document.getElementById('gate-err');
  if (!pw) { errEl.textContent = 'Enter the master password.'; return; }
  errEl.textContent = '';
  try {
    // Validate against an endpoint that requires master password
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    await loadInitiative();
    loadDmMonsters(); // non-blocking — loads in background while page is already interactive
  } catch { errEl.textContent = 'Connection error.'; }
}

async function loadInitiative() {
  try {
    const res = await fetch('/api/initiative');
    if (!res.ok) return;
    initData = await res.json();
    renderInitiative();
  } catch {}
}

function renderInitiative() {
  const list = document.getElementById('init-list');
  const sorted = [...(initData.entries || [])].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  initDataMap = {};
  sorted.forEach(e => { initDataMap[e.id] = e; });
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty">No combatants in tracker.</div>';
    return;
  }
  list.innerHTML = sorted.map(e => {
    const isCur = e.id === initData.currentId;
    const nameEl = e.monsterId
      ? `<span class="init-row-name" style="cursor:pointer;text-decoration:underline dotted;color:var(--ahi)" onclick="showMonsterInfo('${e.monsterId}')" title="View monster details">${esc(e.name)}</span>`
      : `<span class="init-row-name">${esc(e.name)}</span>`;
    return `<div class="init-row${isCur ? ' init-cur' : ''}">
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      ${nameEl}
      <span class="init-row-roll">${e.roll}</span>
      <button class="edit-btn" onclick="openEditModal('${e.id}')" title="Edit">✎</button>
      <button class="del-btn" onclick="deleteEntry('${e.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

async function refreshAll() {
  await Promise.all([loadInitiative(), loadDmMonsters()]);
  showStatus('Refreshed.', false);
}

function openBackupModal() {
  document.getElementById('backup-status').textContent = '';
  document.getElementById('backup-dl-btn').disabled = false;
  document.getElementById('backup-modal').style.display = 'flex';
}
function closeBackupModal() {
  document.getElementById('backup-modal').style.display = 'none';
}

let _backupInFlight = false;
async function runSelectiveBackup() {
  if (_backupInFlight) return;
  const parts = ['characters', 'monsters', 'shop', 'loot', 'maps'].filter(p =>
    document.getElementById('bk-' + p)?.checked
  );
  if (parts.length === 0) {
    document.getElementById('backup-status').textContent = 'Select at least one section.';
    return;
  }
  _backupInFlight = true;
  const btn = document.getElementById('backup-dl-btn');
  const statusEl = document.getElementById('backup-status');
  btn.disabled = true;
  const date = new Date().toISOString().split('T')[0];
  let failed = [];
  for (const part of parts) {
    statusEl.textContent = `Downloading ${part}…`;
    try {
      const res = await fetch(`/api/admin/backup?part=${part}`, {
        headers: { 'x-master-password': masterPw }
      });
      if (res.status === 401) { showStatus('Unauthorized.', true); break; }
      if (res.status === 409) { failed.push(part + ' (server busy)'); continue; }
      if (!res.ok) {
        let msg = part;
        try { msg += ': ' + (await res.json()).error; } catch {}
        failed.push(msg); continue;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dnd-backup-${part}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(err);
      failed.push(part + ': ' + err.message);
    }
  }
  _backupInFlight = false;
  btn.disabled = false;
  if (failed.length) {
    statusEl.style.color = 'var(--err)';
    statusEl.textContent = 'Failed: ' + failed.join(', ');
  } else {
    statusEl.style.color = 'var(--ok)';
    statusEl.textContent = `${parts.length} file${parts.length !== 1 ? 's' : ''} downloaded successfully.`;
  }
}

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
    showStatus('Export failed: ' + err.message, true);
  }
}

function triggerImport() {
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-file-input').click();
}

async function doImport(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  // Parse all files first so we can show a meaningful confirm
  const parsed = [];
  for (const file of files) {
    let backup;
    try { backup = JSON.parse(await file.text()); } catch {
      showStatus(`Import failed: "${file.name}" is not valid JSON.`, true); return;
    }
    if (!backup.version) { showStatus(`Import failed: "${file.name}" is not a valid backup file.`, true); return; }
    parsed.push({ file, backup });
  }

  const labels = parsed.map(({ file, backup }) => backup.type ? `${backup.type} (${file.name})` : `full backup (${file.name})`);
  if (!confirm(`Import the following sections?\n\n${labels.join('\n')}\n\nExisting records with the same ID will be renamed with an "_old" suffix and kept. New records will be added alongside them.`)) return;

  let succeeded = 0, failed = [];
  for (const { file, backup } of parsed) {
    showStatus(`Importing ${backup.type || 'full backup'} from "${file.name}"…`, false);
    try {
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-master-password': masterPw },
        body: JSON.stringify(backup),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      succeeded++;
    } catch (err) {
      console.error(err);
      failed.push(`${backup.type || file.name}: ${err.message}`);
    }
  }

  if (failed.length) {
    showStatus(`${succeeded} restored, ${failed.length} failed: ${failed.join('; ')}`, true);
  } else {
    showStatus(`${succeeded} file${succeeded !== 1 ? 's' : ''} restored — reloading…`, false);
    setTimeout(() => location.reload(), 1200);
  }
}

// ── Add NPC ──────────────────────────────────────────────────────────────────
function openAddNpcModal() {
  document.getElementById('npc-name').value = '';
  document.getElementById('npc-bonus').value = '0';
  document.getElementById('npc-err').textContent = '';
  document.getElementById('npc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('npc-name').focus(), 50);
}
function closeAddNpcModal() {
  document.getElementById('npc-modal').style.display = 'none';
  pendingInitMonsterId = null;
}

async function submitAddNpc() {
  const name  = document.getElementById('npc-name').value.trim();
  const bonus = parseInt(document.getElementById('npc-bonus').value) || 0;
  const errEl = document.getElementById('npc-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  const roll = Math.ceil(Math.random() * 20) + bonus;
  errEl.textContent = '';
  try {
    const res = await fetch('/api/initiative/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name, roll, monsterId: pendingInitMonsterId || '' })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { errEl.textContent = 'Failed to add NPC.'; return; }
    closeAddNpcModal();
    showStatus(`${name} added with roll ${roll}.`, false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Next / Prev turn ──────────────────────────────────────────────────────────
async function nextTurn() {
  try {
    const res = await fetch('/api/initiative/next', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) showStatus('Failed to advance turn.', true);
  } catch { showStatus('Network error.', true); }
}

async function prevTurn() {
  try {
    const res = await fetch('/api/initiative/prev', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) showStatus('Failed to go to previous turn.', true);
  } catch { showStatus('Network error.', true); }
}

// ── Clear all ─────────────────────────────────────────────────────────────────
async function clearInitiative() {
  if (!confirm('Clear all initiative entries?')) return;
  try {
    const res = await fetch('/api/initiative/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to clear initiative.', true); return; }
    showStatus('Initiative cleared.', false);
  } catch { showStatus('Network error.', true); }
}

async function cleanupInitiative() {
  try {
    const res = await fetch('/api/initiative/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to clean up initiative.', true); return; }
    const data = await res.json();
    showStatus(`Cleaned up ${data.removed} orphaned initiative record${data.removed !== 1 ? 's' : ''}.`, false);
  } catch { showStatus('Network error.', true); }
}

// ── Edit entry ────────────────────────────────────────────────────────────────
function openEditModal(id) {
  const e = initDataMap[id];
  if (!e) return;
  editingId = id;
  document.getElementById('edit-name').value = e.name;
  document.getElementById('edit-roll').value = e.roll;
  document.getElementById('edit-err').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('edit-name').focus(), 50);
}
function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingId = null;
}

async function submitEdit() {
  if (!editingId) return;
  const name  = document.getElementById('edit-name').value.trim();
  const roll  = parseInt(document.getElementById('edit-roll').value);
  const errEl = document.getElementById('edit-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  if (isNaN(roll)) { errEl.textContent = 'Invalid roll.'; return; }
  try {
    const res = await fetch(`/api/initiative/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name, roll })
    });
    if (res.status === 401 || res.status === 403) { handleUnauth(); return; }
    if (!res.ok) { errEl.textContent = 'Failed to update.'; return; }
    closeEditModal();
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Delete entry ──────────────────────────────────────────────────────────────
async function deleteEntry(id) {
  const e = initDataMap[id];
  if (!e || !confirm(`Remove "${e.name}" from initiative?`)) return;
  try {
    const res = await fetch(`/api/initiative/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({})
    });
    if (res.status === 401 || res.status === 403) { handleUnauth(); return; }
    if (!res.ok) showStatus('Failed to remove entry.', true);
  } catch { showStatus('Network error.', true); }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('npc-modal').style.display !== 'none') closeAddNpcModal();
    if (document.getElementById('edit-modal').style.display !== 'none') closeEditModal();
    if (document.getElementById('monster-info-modal').style.display !== 'none') closeMonsterInfoModal();
    if (document.getElementById('backup-modal').style.display !== 'none') closeBackupModal();
  }
});

// ── Auto-auth from stored session password ────────────────────────────────────
(async function() {
  const stored = sessionStorage.getItem('dmMasterPw');
  if (!stored) return;
  document.getElementById('gate-pw').value = stored;
  await authenticate();
})();

// ── Media Share ───────────────────────────────────────────────────────────────
let pendingMediaDataUrl = null;
let pendingMediaMime = null;

function handleMediaDrop(e) {
  e.preventDefault();
  document.getElementById('media-drop').classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleMediaFile(file);
}

function handleMediaFile(file) {
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/wave','audio/vnd.wave','audio/mp4','audio/webm'];
  const isWavByExt = file.name.toLowerCase().endsWith('.wav');
  if (!allowed.includes(file.type) && !isWavByExt) { setMediaStatus('File type not allowed.', true); return; }
  const mimeType = (isWavByExt && !file.type) ? 'audio/wav' : file.type;
  if (file.size > 25 * 1024 * 1024) { setMediaStatus('File too large (max 25 MB).', true); return; }
  setMediaStatus('Reading file…', false);
  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingMediaDataUrl = ev.target.result;
    pendingMediaMime = mimeType;
    const previewWrap = document.getElementById('media-preview');
    const previewEl   = document.getElementById('media-preview-el');
    previewWrap.style.display = 'block';
    if (mimeType.startsWith('image/')) {
      previewEl.innerHTML = `<img src="${pendingMediaDataUrl}" style="max-width:100%;max-height:180px;border-radius:4px;object-fit:contain;border:1px solid var(--a44);display:block">`;
    } else if (mimeType.startsWith('video/')) {
      previewEl.innerHTML = `<video src="${pendingMediaDataUrl}" controls style="max-width:100%;max-height:180px;border-radius:4px;display:block"></video>`;
    } else {
      previewEl.innerHTML = `<audio src="${pendingMediaDataUrl}" controls style="width:100%;margin-top:4px;display:block"></audio>`;
    }
    document.getElementById('media-caption-row').style.display = 'block';
    document.getElementById('media-share-btn').style.display = '';
    document.getElementById('media-clear-btn').style.display = '';
    setMediaStatus('✓ File ready to share.', false);
  };
  reader.onerror = () => setMediaStatus('Failed to read file.', true);
  reader.readAsDataURL(file);
  document.getElementById('media-file-input').value = '';
}

function clearMedia() {
  pendingMediaDataUrl = null;
  pendingMediaMime = null;
  document.getElementById('media-preview').style.display = 'none';
  document.getElementById('media-preview-el').innerHTML = '';
  document.getElementById('media-caption-row').style.display = 'none';
  document.getElementById('media-share-btn').style.display = 'none';
  document.getElementById('media-clear-btn').style.display = 'none';
  setMediaStatus('');
}

async function shareMedia() {
  if (!pendingMediaDataUrl) return;
  const caption = document.getElementById('media-caption').value.trim();
  const btn = document.getElementById('media-share-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';
  setMediaStatus('Uploading media…', false);
  try {
    const res = await fetch('/api/chat/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ dataUrl: pendingMediaDataUrl, originalName: 'media', caption: caption || null })
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json();
    if (!res.ok) { setMediaStatus(data.error || 'Share failed.', true); return; }
    setMediaStatus('✓ Shared to chat!', false);
    clearMedia();
    document.getElementById('media-caption').value = '';
    setTimeout(() => setMediaStatus(''), 3000);
  } catch { setMediaStatus('Network error.', true); }
  finally { btn.disabled = false; btn.textContent = '📤 Share to Chat'; }
}

function setMediaStatus(msg, isErr) {
  const el = document.getElementById('media-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--err)' : 'var(--ok)';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function rollDie(sides) { return Math.ceil(Math.random() * sides); }

function parseDiceCommand(text) {
  const m = text.match(/^\/r(?:oll)?\s+(\d+)?d(\d+)\s*([+-]\d+)?\s*(.*)?$/i);
  if (!m) return null;
  return {
    count: Math.max(1, Math.min(20, parseInt(m[1] || '1'))),
    sides: parseInt(m[2]),
    modifier: parseInt(m[3] || '0'),
    label: (m[4] || '').trim() || null
  };
}

async function sendChatInput() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  const roll = parseDiceCommand(text);
  if (roll) {
    const { count, sides, modifier, label } = roll;
    const results = Array.from({ length: count }, () => rollDie(sides));
    const total = results.reduce((s, r) => s + r, 0) + modifier;
    const lbl = label || `${count}d${sides}`;
    const duration = 1000 + Math.random() * 2000;
    const rollId = Math.random().toString(36).slice(2);
    try {
      await fetch('/api/dice/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollId, sides, dieResults: results, modifier, total, label: lbl, duration, sender: 'DM' })
      });
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'DM', dice: `${count}d${sides}`, results, modifier, total, label: lbl })
      });
    } catch { showStatus('Network error.', true); }
    return;
  }
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'DM', type: 'text', message: text })
    });
  } catch { showStatus('Network error.', true); }
}

async function clearChat() {
  if (!confirm('Clear all chat messages?')) return;
  const pw = sessionStorage.getItem('dmMasterPw') || '';
  try {
    await fetch('/api/chat/clear', { method: 'POST', headers: { 'X-Master-Password': pw } });
    document.getElementById('chat-log').innerHTML = '';
  } catch {}
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
  const rawTs = e.timestamp || '';
  const dt = rawTs ? new Date(rawTs + (rawTs.endsWith('Z') ? '' : 'Z')) : new Date();
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  if (e.id) div.dataset.entryId = e.id;
  const delBtn = e.id ? `<button onclick="deleteChatMsg('${esc(e.id)}')" style="background:none;border:none;cursor:pointer;color:var(--txd);font-size:11px;padding:0 0 0 4px;opacity:.6;line-height:1;flex-shrink:0" title="Delete message">✕</button>` : '';
  const timeCol = `<span style="display:flex;align-items:center"><span style="color:var(--txd);font-size:10px">${time}</span>${delBtn}</span>`;

  if (e.type === 'text') {
    div.className = 'chat-entry chat-text';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span class="ce-sender">${esc(e.sender || '?')}</span>
      ${timeCol}
    </div>
    <div style="word-break:break-word">${esc(e.message || '')}</div>`;
    log.appendChild(div);
    return;
  }

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    let mediaEl = '';
    if (e.mimeType.startsWith('image/')) {
      const inlineUrl = (e.mediumUrl && e.mimeType.startsWith('image/')) ? e.mediumUrl : url;
      mediaEl = `<img class="chat-media-img" loading="lazy" src="${inlineUrl}" style="max-height:220px;object-fit:contain" onclick="window.open('${url}','_blank')" title="Click to open full size">`;
    } else if (e.mimeType.startsWith('video/')) {
      mediaEl = `<video class="chat-media-video" src="${url}" controls style="max-height:220px"></video>`;
    } else {
      mediaEl = `<audio class="chat-media-audio" src="${url}" controls></audio>`;
    }
    const cap = e.caption ? `<div style="font-size:11px;color:var(--txd);margin-top:4px">${esc(e.caption)}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender)} <span style="font-size:10px;color:var(--txd);font-weight:normal">shared media</span></span>
      ${timeCol}
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr   = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1 ? ` <span style="color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` <span style="color:var(--txd)">— ${esc(e.label)}</span>` : '';
  const natStr   = isNat20 ? '<span style="color:var(--ok);font-size:10px;font-weight:bold"> ✨ NAT 20!</span>'
                 : isNat1  ? '<span style="color:var(--err);font-size:10px;font-weight:bold"> 💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender)}</span>
    ${timeCol}
  </div>
  <span style="color:var(--txd)">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--ok)' : isNat1 ? 'var(--err)' : 'var(--tx)'}">${e.total}${natStr}</div>`;
  log.appendChild(div);
}

async function deleteChatMsg(id) {
  try {
    const res = await fetch(`/api/chat/${id}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    if (!res.ok) showStatus('Failed to delete message.', true);
  } catch { showStatus('Network error.', true); }
}

function scrollChatLog() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

// ── DM Monsters table ─────────────────────────────────────────────────────────
async function loadDmMonsters() {
  try {
    const res = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) return;
    dmMonsters = await res.json();
    renderDmMonsters();
  } catch {}
}

function getMonsterInitBonus(data) {
  const dexMod = Math.floor(((data.dex || 10) - 10) / 2);
  if (data.initiative && data.initiative.proficiency) {
    const crVal = (data.cr && typeof data.cr === 'object') ? parseFloat(data.cr.cr) : parseFloat(data.cr);
    const prof = isNaN(crVal) ? 2 : crVal < 5 ? 2 : crVal < 9 ? 3 : crVal < 13 ? 4 : crVal < 17 ? 5 : crVal < 21 ? 6 : crVal < 25 ? 7 : crVal < 29 ? 8 : 9;
    return dexMod + prof;
  }
  return dexMod;
}

function renderDmMonsters() {
  const wrap = document.getElementById('dm-monster-table-wrap');
  if (!wrap) return;
  const q = (document.getElementById('dm-monster-search').value || '').toLowerCase();
  const filtered = dmMonsters.filter(m => {
    if (!q) return true;
    const d = m.data || {};
    const t = typeof d.type === 'string' ? d.type : (d.type ? (d.type.type || '') : '');
    return m.name.toLowerCase().includes(q) || t.toLowerCase().includes(q);
  });
  if (dmMonsters.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--txd);font-size:12px;padding:10px 0">No monsters imported yet. Use the <a href="monsters.html" style="color:var(--ac)">Monsters</a> page to import.</div>';
    return;
  }
  if (filtered.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--txd);font-size:12px;padding:10px 0">No monsters match your search.</div>';
    return;
  }
  const rows = filtered.map(m => {
    const d = m.data || {};
    const typeStr = typeof d.type === 'string' ? d.type : (d.type ? (d.type.type || '') + (d.type.tags && d.type.tags.length ? ' (' + d.type.tags.join(', ') + ')' : '') : '');
    const acVal = !d.ac ? '—' : (typeof [].concat(d.ac)[0] === 'number' ? [].concat(d.ac)[0] : ([].concat(d.ac)[0] || {}).ac || '—');
    const hpVal = !d.hp ? '—' : d.hp.average !== undefined ? d.hp.average : d.hp;
    const spdParts = []; if(d.speed){if(d.speed.walk)spdParts.push(d.speed.walk+' ft.');if(d.speed.fly)spdParts.push('✈'+d.speed.fly);if(d.speed.swim)spdParts.push('🌊'+d.speed.swim);if(d.speed.climb)spdParts.push('climb '+d.speed.climb);if(d.speed.burrow)spdParts.push('burrow '+d.speed.burrow);} const spd=spdParts.join(', ')||'—';
    return `<tr>
      <td><strong>${esc(m.name)}</strong></td>
      <td><span class="cr-badge">${esc(m.cr || '?')}</span></td>
      <td style="color:var(--txd);font-style:italic;font-size:11px">${esc(typeStr)}</td>
      <td>${esc(String(acVal))}</td>
      <td>${esc(String(hpVal))}</td>
      <td>${esc(spd)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn sm" onclick="showMonsterInfo('${m.id}')" title="View stat block">Info</button>
        <button class="btn sm success" onclick="openMonsterInitModal('${m.id}')" title="Add to initiative">+ Init</button>
        <button class="btn sm" onclick="exportMonster('${m.id}','${m.name.replace(/'/g,"\\'")}')" title="Export monster to file">Export</button>
      </td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Name</th><th>CR</th><th>Type</th><th>AC</th><th>HP</th><th>Speed</th>
      <th style="text-align:right">Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function openMonsterInitModal(monsterId) {
  const m = dmMonsters.find(x => x.id === monsterId);
  if (!m) return;
  pendingInitMonsterId = monsterId;
  const bonus = getMonsterInitBonus(m.data || {});
  document.getElementById('npc-name').value = m.name;
  document.getElementById('npc-bonus').value = bonus;
  document.getElementById('npc-err').textContent = '';
  document.getElementById('npc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('npc-bonus').focus(), 50);
}

// ── Monster Info ──────────────────────────────────────────────────────────────
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

function closeMonsterInfoModal() {
  document.getElementById('monster-info-modal').style.display = 'none';
}

async function showMonsterInfo(monsterId) {
  try {
    const res = await fetch(`/api/monsters/${monsterId}`, { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) { showStatus('Failed to load monster.', true); return; }
    const m = await res.json();
    document.getElementById('monster-info-title').textContent = m.name || 'Monster Info';
    document.getElementById('monster-info-body').innerHTML = renderMonsterInfo(m.data || {});
    document.getElementById('monster-info-modal').style.display = 'flex';
  } catch { showStatus('Failed to load monster info.', true); }
}

// ── Real-time updates ─────────────────────────────────────────────────────────
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

connectRealtime({
  initiative: () => {
    if (masterPw) loadInitiative();
  },
  chat: (entry) => {
    appendChatEntry(entry);
    scrollChatLog();
  },
  'chat-clear': () => {
    document.getElementById('chat-log').innerHTML = '';
  },
  'chat-delete': (d) => {
    const div = document.querySelector(`[data-entry-id="${CSS.escape(d.id)}"]`);
    if (div) div.remove();
  },
});

window.addEventListener('load', loadChat);
