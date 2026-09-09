// ── Waiting screen manager (DM) ───────────────────────────────────────────────
// Create the images the DM parks the table on between scenes, and show or stop
// showing one. While a screen is showing the server withholds the map and other
// players' tokens from players — see GET /api/table in server/routes/table.js —
// so "Show" here genuinely takes the map away rather than covering it.

const masterPw = sessionStorage.getItem('dmMasterPw') || sessionStorage.getItem('tableMasterPw') || '';
const H = () => ({ 'Content-Type': 'application/json', 'X-Master-Password': masterPw });

let screens = [];
let activeId = '';
let pickingFor = null;   // id of the screen whose image is being replaced

// ── Load & render ─────────────────────────────────────────────────────────────
async function load() {
  try {
    const r = await fetch('/api/waiting-screens', { headers: H() });
    if (!r.ok) throw new Error('load failed');
    const data = await r.json();
    screens = data.screens || [];
    activeId = data.activeId || '';
  } catch {
    screens = []; activeId = '';
    document.getElementById('ws-grid').innerHTML =
      '<div class="empty">Could not load waiting screens.</div>';
    return;
  }
  render();
}

function render() {
  const banner = document.getElementById('active-banner');
  const active = screens.find(s => s.id === activeId);
  if (active) {
    document.getElementById('active-name').textContent = active.name || 'Untitled';
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }

  const grid = document.getElementById('ws-grid');
  if (screens.length === 0) {
    grid.innerHTML =
      '<div class="empty">No waiting screens yet.<br>Create one, give it an image, then show it from here or from the table toolbar.</div>';
    return;
  }

  grid.innerHTML = screens.map(s => {
    const on = s.id === activeId;
    const thumb = s.imageMedium || s.imageThumb || s.imageUrl || '';
    const id = escJs(s.id);
    return `
      <div class="card${on ? ' active' : ''}">
        <div class="thumb" onclick="pickImage('${id}')" title="Click to ${thumb ? 'replace' : 'set'} the image">
          ${thumb
            ? `<img src="${esc(thumb)}" alt=""><div class="overlay">Replace image</div>`
            : '<div class="noimg">No image yet<br>Click to choose one</div>'}
          ${on ? '<div class="badge">Showing</div>' : ''}
        </div>
        <div class="card-body">
          <div>
            <div class="lbl">Name</div>
            <input value="${esc(s.name || '')}" maxlength="80"
                   onchange="saveField('${id}','name',this.value)">
          </div>
          <div>
            <div class="lbl">Caption shown to players (optional)</div>
            <input value="${esc(s.caption || '')}" maxlength="200" placeholder="e.g. Back in 10 minutes"
                   onchange="saveField('${id}','caption',this.value)">
          </div>
        </div>
        <div class="status" id="st-${id}"></div>
        <div class="card-actions">
          ${on
            ? '<button class="btn" onclick="stopShowing()">▶ Bring back</button>'
            : `<button class="btn primary" onclick="showScreen('${id}')" ${thumb ? '' : 'disabled title="Give it an image first"'}>⏸ Show</button>`}
          <button class="btn danger" onclick="removeScreen('${id}')">🗑</button>
        </div>
      </div>`;
  }).join('');
}

function setStatus(id, text, cls = '') {
  const el = document.getElementById('st-' + id);
  if (el) { el.textContent = text; el.className = 'status ' + cls; }
}

// ── Mutations ─────────────────────────────────────────────────────────────────
async function newScreen() {
  try {
    const r = await fetch('/api/waiting-screens', {
      method: 'POST', headers: H(), body: JSON.stringify({ name: 'New waiting screen' }),
    });
    if (r.ok) await load();
  } catch {}
}

async function saveField(id, field, value) {
  try {
    const r = await fetch('/api/waiting-screens/' + encodeURIComponent(id), {
      method: 'PUT', headers: H(), body: JSON.stringify({ [field]: value }),
    });
    setStatus(id, r.ok ? 'Saved' : 'Could not save', r.ok ? 'ok' : 'err');
    const rec = screens.find(s => s.id === id);
    if (rec && r.ok) rec[field] = value;
    if (r.ok && id === activeId) render();     // the banner shows the name
    setTimeout(() => setStatus(id, ''), 1800);
  } catch { setStatus(id, 'Could not save', 'err'); }
}

async function removeScreen(id) {
  const rec = screens.find(s => s.id === id);
  const warn = id === activeId
    ? 'This screen is showing right now. Deleting it brings the players back to the map.\n\n'
    : '';
  if (!confirm(`${warn}Delete "${rec?.name || 'this screen'}"? Its image is removed too.`)) return;
  try {
    const r = await fetch('/api/waiting-screens/' + encodeURIComponent(id), {
      method: 'DELETE', headers: H(),
    });
    if (r.ok) await load();
  } catch {}
}

async function showScreen(id) {
  try {
    const r = await fetch('/api/table/waiting-screen', {
      method: 'POST', headers: H(), body: JSON.stringify({ id }),
    });
    if (r.ok) { activeId = id; render(); }
  } catch {}
}

async function stopShowing() {
  try {
    const r = await fetch('/api/table/waiting-screen', {
      method: 'POST', headers: H(), body: JSON.stringify({ id: '' }),
    });
    if (r.ok) { activeId = ''; render(); }
  } catch {}
}

// ── Image upload ──────────────────────────────────────────────────────────────
function pickImage(id) {
  pickingFor = id;
  const inp = document.getElementById('img-picker');
  inp.value = '';
  inp.click();
}

document.getElementById('img-picker').addEventListener('change', async function () {
  const file = this.files && this.files[0];
  const id = pickingFor;
  pickingFor = null;
  if (!file || !id) return;
  if (!file.type.startsWith('image/')) return setStatus(id, 'Images only', 'err');
  if (file.size > 30 * 1024 * 1024) return setStatus(id, 'Too large (max 30 MB)', 'err');

  setStatus(id, 'Uploading…');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const r = await fetch(`/api/waiting-screens/${encodeURIComponent(id)}/image`, {
      method: 'POST', headers: H(), body: JSON.stringify({ dataUrl }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return setStatus(id, e.error || 'Upload failed', 'err');
    }
    await load();
  } catch { setStatus(id, 'Upload failed', 'err'); }
});

// Another DM window (or the table toolbar) may park or un-park the table.
if (typeof connectRealtime === 'function') {
  connectRealtime({
    'waiting-screen': (d) => {
      activeId = (d && d.active && d.active.id) || '';
      render();
    },
  });
}

load();
