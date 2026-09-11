
let masterPw = '';
let initData = { entries: [], currentId: null };
let editingId = null;
let initDataMap = {};
let dmMonsters = [];
let pendingInitMonsterId = null;

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escape a value embedded in a single-quoted JS string inside an HTML attribute,
// e.g. onclick="fn('${escJs(value)}')". Backslash-escapes JS metacharacters (entity
// encoding alone fails — the browser decodes &#39; back to ' before the JS parses),
// then HTML-escapes the structural chars so the attribute stays well-formed.
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyTheme() {
  // Single lamplit theme now; the swappable themes and their CSS are gone.
  // Kept as a no-op so a stale localStorage value cannot reapply a theme
  // class that no longer has any rules behind it, and so the inline
  // onchange handlers on any remaining theme selects do not throw.
  document.body.className = '';
}
(function(){ applyTheme(); })();

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

// The shared DM gate (js/lib/auth-ui.js): maths captcha, lockout, and a session
// token kept in masterPw where the typed password used to go.
const _gate = AuthUI.dmGate({
  capEl:   document.getElementById('gate-cap'),
  pwInput: document.getElementById('gate-pw'),
  errEl:   document.getElementById('gate-err'),
  onUnlock: async (token) => {
    masterPw = token;
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    await loadInitiative();
    loadDmMonsters(); // non-blocking — loads in background while page is already interactive
  },
});
function authenticate() { return _gate.submit(); }

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
  // The tracker card is no longer on this page, but a realtime 'initiative'
  // event still calls loadInitiative() here — without this it would throw on
  // every turn change. Same early return renderDmMonsters() uses.
  if (!list) return;
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
      ? `<span class="init-row-name" style="cursor:pointer;text-decoration:underline dotted;color:var(--arc-hi)" onclick="showMonsterInfo('${escJs(e.monsterId)}')" title="View monster details">${esc(e.name)}</span>`
      : `<span class="init-row-name">${esc(e.name)}</span>`;
    return `<div class="init-row${isCur ? ' init-cur' : ''}">
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      ${nameEl}
      <span class="init-row-roll">${e.roll}</span>
      <button class="edit-btn" onclick="openEditModal('${escJs(e.id)}')" title="Edit"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-pencil"></use></svg></button>
      <button class="del-btn" onclick="deleteEntry('${escJs(e.id)}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

async function refreshAll() {
  await Promise.all([loadInitiative(), loadDmMonsters()]);
  showStatus('Refreshed.', false);
}

function openBackupModal() {
  document.getElementById('arc-status').textContent = '';
  document.getElementById('dbbk-status').textContent = '';
  document.getElementById('backup-modal').style.display = 'flex';
}
function closeBackupModal() {
  document.getElementById('backup-modal').style.display = 'none';
}

const BACKUP_SECTIONS = ['characters', 'monsters', 'treasury', 'maps', 'waiting', 'handouts', 'events', 'music', 'chat', 'chatmedia'];
const _selectedBackupParts = () => BACKUP_SECTIONS.filter(p => document.getElementById('bk-' + p)?.checked);

/**
 * The archive downloads. `kind` is 'records' (the selected sections as JSON, no
 * images inside) or 'images' (every picture as its own file). Both are built and
 * streamed server-side, so a large campaign no longer has to fit in memory —
 * the old per-part JSON embedded every image as base64 and assembled the whole
 * thing before sending, which is what ran the server out of memory.
 */
let _archiveInFlight = false;
async function downloadArchive(kind) {
  if (_archiveInFlight) return;
  const statusEl = document.getElementById('arc-status');
  const btn = document.getElementById(kind === 'images' ? 'arc-img-btn' : 'arc-dl-btn');
  // Both archives take the same section list, so a records archive and an images
  // archive downloaded from one selection describe exactly the same thing.
  const parts = _selectedBackupParts();
  if (parts.length === 0) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Select at least one section.'; return; }
  const url = kind === 'records'
    ? `/api/admin/backup-archive?parts=${encodeURIComponent(parts.join(','))}`
    : `/api/admin/backup-images?parts=${encodeURIComponent(parts.join(','))}`;
  _archiveInFlight = true;
  btn.disabled = true;
  statusEl.style.color = 'var(--ash)';
  statusEl.textContent = kind === 'images' ? 'Collecting images…' : 'Building archive…';
  try {
    const res = await fetch(url, { headers: { 'x-master-password': masterPw } });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).error || msg; } catch {}
      statusEl.style.color = 'var(--blood)';
      statusEl.textContent = 'Failed: ' + msg;
      return;
    }
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1]
      || `dnd-${kind}-${new Date().toISOString().split('T')[0]}.tar.gz`;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(href);
    statusEl.style.color = 'var(--verdigris)';
    statusEl.textContent = `${name} — ${_fmtBytes(blob.size)}`;
  } catch (err) {
    statusEl.style.color = 'var(--blood)';
    statusEl.textContent = 'Failed: ' + err.message;
  } finally {
    _archiveInFlight = false;
    btn.disabled = false;
  }
}

function _fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

// The per-part JSON download (GET /api/admin/backup?part=) is no longer offered
// in the backup modal — the two archives supersede it. The endpoint is still
// served and Import still restores the .json files it produced, so backups taken
// before the archives existed keep working.

let _dbBackupInFlight = false;
async function downloadRawDbBackup() {
  if (_dbBackupInFlight) return;
  _dbBackupInFlight = true;
  const btn = document.getElementById('dbbk-dl-btn');
  const statusEl = document.getElementById('dbbk-status');
  btn.disabled = true;
  statusEl.style.color = 'var(--ash)';
  statusEl.textContent = 'Preparing database snapshot…';
  try {
    const res = await fetch('/api/admin/db-backup', { headers: { 'x-master-password': masterPw } });
    if (res.status === 401) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Unauthorized.'; return; }
    if (res.status === 409) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'A backup is already running — please wait.'; return; }
    if (!res.ok) {
      let msg = 'Backup failed.';
      try { msg = (await res.json()).error || msg; } catch {}
      statusEl.style.color = 'var(--blood)'; statusEl.textContent = msg; return;
    }
    const blob = await res.blob();
    const date = new Date().toISOString().split('T')[0];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dnd-db-backup-${date}.tar.gz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    statusEl.style.color = 'var(--verdigris)';
    statusEl.textContent = `Downloaded (${(blob.size / 1048576).toFixed(1)} MB).`;
  } catch (err) {
    console.error(err);
    statusEl.style.color = 'var(--blood)';
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    _dbBackupInFlight = false;
    btn.disabled = false;
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

const _isArchiveFile = (f) => /\.t(ar\.)?gz$/i.test(f.name) || f.type === 'application/gzip';

/**
 * Uploads one .tar.gz to the archive restore, which unpacks it server-side. The
 * body is the File itself, so the browser streams it rather than reading a
 * possibly-huge archive into a string first. The content type is deliberately
 * NOT json — that keeps the global express.json() parser off the request so the
 * server can consume it as a stream.
 */
async function _importArchive(file) {
  const res = await fetch('/api/admin/restore-archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', 'x-master-password': masterPw },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function doImport(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  // .tar.gz archives are handed to the server whole; .json files are parsed here
  // so the confirm can name the sections they carry.
  const archives = files.filter(_isArchiveFile);
  const jsonFiles = files.filter(f => !_isArchiveFile(f));

  const parsed = [];
  for (const file of jsonFiles) {
    let backup;
    try { backup = JSON.parse(await file.text()); } catch {
      showStatus(`Import failed: "${file.name}" is not valid JSON.`, true); return;
    }
    if (!backup.version) { showStatus(`Import failed: "${file.name}" is not a valid backup file.`, true); return; }
    parsed.push({ file, backup });
  }

  if (archives.length) {
    const names = archives.map(f => `${f.name} (${_fmtBytes(f.size)})`).join('\n');
    if (!confirm(`Restore these archives?\n\n${names}\n\nExisting records with the same ID will be renamed with an "_old" suffix and kept. Images are written back into place.`)) return;
    let ok = 0; const bad = [];
    for (const f of archives) {
      showStatus(`Restoring "${f.name}" — this can take a while for a large archive…`, false);
      try {
        const r = await _importArchive(f);
        const bits = [];
        if (r.parts && r.parts.length) bits.push(r.parts.join(', '));
        if (r.images) bits.push(`${r.images} image${r.images !== 1 ? 's' : ''}`);
        showStatus(`"${f.name}": restored ${bits.join(' + ') || 'nothing'}.`, false);
        ok++;
      } catch (err) { console.error(err); bad.push(`${f.name}: ${err.message}`); }
    }
    if (bad.length) { showStatus(`${ok} archive(s) restored, ${bad.length} failed: ${bad.join('; ')}`, true); return; }
    if (!parsed.length) {
      showStatus(`${ok} archive${ok !== 1 ? 's' : ''} restored — reloading…`, false);
      setTimeout(() => location.reload(), 1400);
      return;
    }
  }

  if (!parsed.length) return;

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
    const res = await fetch('/api/initiative/entries', {
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
    const res = await fetch(`/api/initiative/entries/${editingId}`, {
      method: 'PATCH',
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
    const res = await fetch(`/api/initiative/entries/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({})
    });
    if (res.status === 401 || res.status === 403) { handleUnauth(); return; }
    if (!res.ok) showStatus('Failed to remove entry.', true);
  } catch { showStatus('Network error.', true); }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// Escape must not silently discard a part-filled NPC or character edit.
window.addEventListener('DOMContentLoaded', () => {
  if (!window.guardModal) return;
  guardModal('npc-modal',  closeAddNpcModal,  { backdrop: false });
  guardModal('edit-modal', closeEditModal,    { backdrop: false });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('npc-modal').style.display !== 'none') closeAddNpcModal();
    if (document.getElementById('edit-modal').style.display !== 'none') closeEditModal();
    if (document.getElementById('monster-info-modal').style.display !== 'none') closeMonsterInfoModal();
    if (document.getElementById('backup-modal').style.display !== 'none') closeBackupModal();
  }
});

/**
 * Sign out of the DM panel.
 *
 * Clears every key a session is reconstructed from — the auto-auth block below
 * reads rpgSession first and falls back to dmMasterPw, so leaving either behind
 * would unlock the gate again on the next load — then goes to the campaign
 * picker. Mirrors logout() on the table screen (js/table/table-auth.js).
 */
function logout() {
  // End the session on the server too (js/lib/realtime.js), so a copied token dies with it.
  if (typeof revokeStoredSession === 'function') revokeStoredSession();
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('dmMasterPw');
  sessionStorage.removeItem('tableMasterPw');
  location.replace('/');
}

// ── Auto-auth from the stored session ─────────────────────────────────────────
// A tab already logged in as DM (login.html, or this gate earlier) unlocks
// without asking again, once the server confirms the session is still live.
_gate.start();

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
      previewEl.innerHTML = `<img src="${pendingMediaDataUrl}" style="max-width:100%;max-height:180px;border-radius:4px;object-fit:contain;border:1px solid var(--rule-hi);display:block">`;
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
  finally { btn.disabled = false; btn.innerHTML = '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-upload"></use></svg> Share to Chat'; }
}

function setMediaStatus(msg, isErr) {
  const el = document.getElementById('media-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--blood)' : 'var(--verdigris)';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function rollDie(sides) { return Math.ceil(Math.random() * sides); }

// parseDiceCommand / parseDamageSpec / rollDamageSpec come from js/lib/dice-engine.js.
// The DM panel has no #dice-overlay, so it broadcasts rolls for the table and the
// players to animate but never animates locally.

async function sendChatInput() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  const roll = parseDiceCommand(text);
  if (roll) {
    // Typed damage — "/dmg 1d6 fire" or "/r 1d6 piercing, 2d8 fire".
    if (roll.damage) {
      const dmg = rollDamageSpec(roll.damage);
      const lbl = roll.expr;
      const first = dmg.parts[0];
      const duration = 1000 + Math.random() * 2000;
      const rollId = Math.random().toString(36).slice(2);
      try {
        await fetch('/api/dice/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rollId, sides: first.sides || 6,
            dieResults: first.rolls.length ? first.rolls : [first.total],
            modifier: first.modifier, total: dmg.total, label: lbl, duration,
            groups: dmg.groups, sender: 'DM'
          })
        });
        await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'DM', ...dmgChatPayload(dmg, lbl) })
        });
      } catch { showStatus('Network error.', true); }
      return;
    }
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
    const res = await fetch('/api/chat', { headers: { 'X-Master-Password': masterPw } });
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
  const delBtn = e.id ? `<button onclick="deleteChatMsg('${escJs(e.id)}')" style="background:none;border:none;cursor:pointer;color:var(--ash);font-size:11px;padding:0 0 0 4px;opacity:.6;line-height:1;flex-shrink:0" title="Delete message">✕</button>` : '';
  const timeCol = `<span style="display:flex;align-items:center"><span style="color:var(--ash);font-size:10px">${time}</span>${delBtn}</span>`;

  if (e.type === 'text') {
    div.className = 'chat-entry chat-text';
    // Messages flagged html:true (e.g. spell descriptions with 5e.tools links)
    // render their body as raw HTML; all other text stays escaped.
    const body = e.html
      ? `<div class="chat-html" style="word-break:break-word;line-height:1.45">${e.message || ''}</div>`
      : `<div style="word-break:break-word;white-space:pre-wrap">${esc(e.message || '')}</div>`;
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span class="ce-sender">${esc(e.sender || '?')}</span>
      ${timeCol}
    </div>${body}`;
    log.appendChild(div);
    return;
  }

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    let mediaEl = '';
    if (e.mimeType.startsWith('image/')) {
      const inlineUrl = (e.mediumUrl && e.mimeType.startsWith('image/')) ? e.mediumUrl : url;
      mediaEl = `<img class="chat-media-img" loading="lazy" src="${inlineUrl}" style="max-height:220px;object-fit:contain" onclick="window.open('${escJs(url)}','_blank')" title="Click to open full size">`;
    } else if (e.mimeType.startsWith('video/')) {
      mediaEl = `<video class="chat-media-video" src="${url}" controls style="max-height:220px"></video>`;
    } else {
      mediaEl = `<audio class="chat-media-audio" src="${url}" controls></audio>`;
    }
    const cap = e.caption ? `<div style="font-size:11px;color:var(--ash);margin-top:4px">${esc(e.caption)}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender)} <span style="font-size:10px;color:var(--ash);font-weight:normal">shared media</span></span>
      ${timeCol}
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr   = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1 ? ` <span style="color:var(--ash)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` <span style="color:var(--ash)">— ${esc(e.label)}</span>` : '';
  const natStr   = isNat20 ? '<span style="color:var(--verdigris);font-size:10px;font-weight:bold"> ✨ NAT 20!</span>'
                 : isNat1  ? '<span style="color:var(--blood);font-size:10px;font-weight:bold"> 💀 NAT 1</span>' : '';
  const descStr = e.description
    ? `<div style="font-size:10px;color:var(--ash);margin-top:3px;font-style:italic;line-height:1.4;white-space:pre-wrap">${esc(e.description)}</div>`
    : '';
  // chatDamageParts() comes from js/lib/chat-render.js; '' for an ordinary roll,
  // in which case the original single-line dice/label row is kept.
  const partsStr = typeof chatDamageParts === 'function' ? chatDamageParts(e) : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender)}</span>
    ${timeCol}
  </div>
  ${partsStr ? '' : `<span style="color:var(--ash)">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}`}
  ${partsStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--verdigris)' : isNat1 ? 'var(--blood)' : 'var(--bone)'}">${e.total}${natStr}</div>${descStr}`;
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
    wrap.innerHTML = '<div style="text-align:center;color:var(--ash);font-size:12px;padding:10px 0">No monsters imported yet. Use the <a href="monsters.html" style="color:var(--bone)">Monsters</a> page to import.</div>';
    return;
  }
  if (filtered.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--ash);font-size:12px;padding:10px 0">No monsters match your search.</div>';
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
      <td style="color:var(--ash);font-style:italic;font-size:11px">${esc(typeStr)}</td>
      <td>${esc(String(acVal))}</td>
      <td>${esc(String(hpVal))}</td>
      <td>${esc(spd)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn sm" onclick="showMonsterInfo('${escJs(m.id)}')" title="View stat block">Info</button>
        <button class="btn sm success" onclick="openMonsterInitModal('${escJs(m.id)}')" title="Add to initiative">+ Init</button>
        <button class="btn sm" onclick="exportMonster('${escJs(m.id)}','${escJs(m.name)}')" title="Export monster to file">Export</button>
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
function closeMonsterInfoModal() {
  document.getElementById('monster-info-modal').style.display = 'none';
}

async function showMonsterInfo(monsterId) {
  try {
    const res = await fetch(`/api/monsters/${monsterId}`, { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) { showStatus('Failed to load monster.', true); return; }
    const m = await res.json();
    document.getElementById('monster-info-title').textContent = m.name || 'Monster Info';
    document.getElementById('monster-info-body').innerHTML = renderMonsterStatBlock(m.data || {});
    document.getElementById('monster-info-modal').style.display = 'flex';
  } catch { showStatus('Failed to load monster info.', true); }
}

// ── Real-time updates ─────────────────────────────────────────────────────────
// connectRealtime() is provided by the shared /js/lib/realtime.js (loaded before
// this script). It attaches the session identity + current page to the
// connection so the maintenance page can list this client.
connectRealtime({
  notification: (payload) => { typeof handleNotification === 'function' && handleNotification(payload); },
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
