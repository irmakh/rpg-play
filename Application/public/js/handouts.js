// ── Handout manager (DM) ──────────────────────────────────────────────────────
// Master-detail: every handout on the left, the selected one's two bodies and
// its recipient roster on the right.
//
// The DC only suggests. Nothing a player can read changes until the DM presses
// Success or Fail — that PATCH is the single gate, enforced server-side.

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escJs(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

const SKILL_NAMES = [
  'Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History',
  'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception',
  'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival',
];

let _handouts = [];
let _chars = [];
let _selId = null;
let _dirty = false;             // unsaved edits in the detail form
let _imgTarget = null;          // which image slot the file picker is filling

const masterPw = sessionStorage.getItem('dmMasterPw') || sessionStorage.getItem('tableMasterPw') || '';
const H = () => ({ 'Content-Type': 'application/json', 'X-Master-Password': masterPw });

function charName(id) {
  const c = _chars.find(x => x.id === id);
  return c ? c.name : id;
}

function setStatus(msg, cls) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status ' + (cls || '');
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const [hRes, cRes] = await Promise.all([
      fetch('/api/handouts', { headers: H() }),
      fetch('/api/characters'),
    ]);
    if (!hRes.ok) throw new Error('load failed');
    _handouts = await hRes.json();
    _chars = cRes.ok ? (await cRes.json()).filter(c => (c.char_type || 'pc') === 'pc') : [];
  } catch {
    document.getElementById('ho-list').innerHTML =
      '<div class="detail-empty"><div>Could not load handouts.</div></div>';
    return;
  }
  renderList();
  if (_selId) {
    const still = _handouts.find(h => h.id === _selId);
    if (still) renderDetail(still); else clearDetail();
  }
}

function renderList() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const box = document.getElementById('ho-list');
  const rows = _handouts.filter(h =>
    !q || (h.title + ' ' + (h.tag || '')).toLowerCase().includes(q));

  if (!rows.length) {
    box.innerHTML = '<div class="detail-empty"><div>'
      + (_handouts.length ? 'Nothing matches.' : 'No handouts yet.')
      + '</div></div>';
    return;
  }

  box.innerHTML = rows.map(h => {
    const thumb = h.successImageThumb || h.failImageThumb || '';
    const check = h.checkSkill >= 0
      ? `${esc(h.checkSkillName)}${h.checkDc ? ' DC ' + h.checkDc : ''}`
      : 'No check';
    const out = (h.recipients || []).filter(r => r.outcome === 'success' || r.outcome === 'fail').length;
    const waiting = (h.recipients || []).filter(r => r.outcome === 'rolled').length;
    return `
      <button class="ho-card${_selId === h.id ? ' active' : ''}" onclick="selectHandout('${escJs(h.id)}')">
        <div class="ho-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-document"></use></svg>'}</div>
        <div class="ho-meta">
          <div class="ho-name">${esc(h.title)}</div>
          <div class="ho-sub">${check} · ${h.handedOut} handed out${out ? ` · ${out} resolved` : ''}${waiting ? ` · <span style="color:var(--blood)">${waiting} awaiting you</span>` : ''}</div>
        </div>
      </button>`;
  }).join('');
}

// ── Detail ────────────────────────────────────────────────────────────────────

function clearDetail() {
  _selId = null; _dirty = false;
  document.body.classList.remove('detail-open');
  document.getElementById('detail').innerHTML =
    '<div class="detail-empty"><div class="big"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-document"></use></svg></div><div>Select a handout, or create one.</div></div>';
  renderList();
}

async function selectHandout(id) {
  if (_dirty && !await hoConfirm('Discard unsaved changes?',
      { okLabel: 'Discard', danger: true, title: 'Unsaved changes' })) return;
  _selId = id; _dirty = false;
  document.body.classList.add('detail-open');
  const h = _handouts.find(x => x.id === id);
  if (h) { renderList(); renderDetail(h); }
}

function imgSlot(kind, urlMedium, urlFull) {
  const has = !!(urlMedium || urlFull);
  return `
    <div class="img-slot" onclick="pickImage('${kind}')">
      ${has ? `<img src="${esc(urlMedium || urlFull)}" alt="">
               <button class="btn danger sm img-clear" onclick="event.stopPropagation();clearImage('${kind}')"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>`
            : '<div class="ph">Click to add an image</div>'}
    </div>`;
}

function renderDetail(h) {
  const skillOpts = ['<option value="-1">No skill check</option>']
    .concat(SKILL_NAMES.map((n, i) => `<option value="${i}"${h.checkSkill === i ? ' selected' : ''}>${esc(n)}</option>`))
    .join('');

  document.getElementById('detail').innerHTML = `
    <button class="btn ghost sm back-btn" style="margin-bottom:12px" onclick="clearDetail()"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-arrow-left"></use></svg> All handouts</button>

    <div class="sect">
      <div class="sect-hdr">
        <span>Handout</span><span class="spacer"></span>
        <span class="status" id="save-status"></span>
      </div>
      <div class="row">
        <div class="field" style="flex:3 1 240px">
          <label>Title</label>
          <input id="f-title" value="${esc(h.title)}" maxlength="200" oninput="markDirty()">
        </div>
        <div class="field" style="flex:1 1 120px">
          <label>Tag</label>
          <input id="f-tag" value="${esc(h.tag || '')}" maxlength="40" oninput="markDirty()">
        </div>
      </div>
      <div class="field">
        <label>Prompt — shown before the check resolves (optional)</label>
        <textarea id="f-prompt" style="min-height:56px" maxlength="20000"
                  placeholder="You find a weathered stone half-buried in the ash."
                  oninput="markDirty()">${esc(h.promptText || '')}</textarea>
      </div>
      <div class="row">
        <div class="field" style="flex:2 1 180px">
          <label>Skill check</label>
          <select id="f-skill" onchange="markDirty()">${skillOpts}</select>
        </div>
        <div class="field" style="flex:1 1 100px">
          <label>DC (0 = judge by eye)</label>
          <input type="number" id="f-dc" value="${h.checkDc || 0}" min="0" max="50" oninput="markDirty()">
        </div>
      </div>
      <div class="hint">
        Players never see the skill name, the DC or their roll — the check is blind.
        The DC only pre-selects an outcome for you below; nothing reaches a player
        until you press <b>Success</b> or <b>Fail</b>.
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" onclick="saveHandout()">Save</button>
        <button class="btn danger sm" onclick="deleteHandout()">Delete</button>
      </div>
    </div>

    <div class="two-col">
      <div class="sect">
        <div class="sect-hdr"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg> On success</div>
        <div class="field">
          <label>What they read</label>
          <textarea id="f-success" maxlength="20000" oninput="markDirty()">${esc(h.successText || '')}</textarea>
        </div>
        ${imgSlot('success', h.successImageMedium, h.successImageUrl)}
      </div>
      <div class="sect">
        <div class="sect-hdr"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg> On failure</div>
        <div class="field">
          <label>What they read instead</label>
          <textarea id="f-fail" maxlength="20000" oninput="markDirty()">${esc(h.failText || '')}</textarea>
        </div>
        ${imgSlot('fail', h.failImageMedium, h.failImageUrl)}
      </div>
    </div>

    <div class="sect">
      <div class="sect-hdr">
        <span>Recipients</span><span class="spacer"></span>
        <button class="btn sm" onclick="handOut()">Hand out…</button>
        ${h.handedOut ? `<button class="btn ghost sm" onclick="recallAll()">Recall all</button>` : ''}
      </div>
      ${renderRecipients(h)}
    </div>
  `;
}

function renderRecipients(h) {
  const rs = h.recipients || [];
  if (!rs.length) {
    return '<div class="hint" style="margin:0">Not handed out yet. '
         + 'Use <b>Hand out…</b> to give it to your players.</div>';
  }
  const anySuggested = rs.some(r => r.suggested && r.outcome === 'rolled');
  const rows = rs.map(r => {
    const rolled = r.rollTotal != null;
    return `
      <tr>
        <td>${esc(charName(r.charId))}</td>
        <td>${rolled
              ? `<span class="roll-total">${r.rollTotal}</span> <span class="muted" style="font-size:10px">${esc(r.rollDetail || '')}</span>`
              : '<span class="muted">—</span>'}</td>
        <td><span class="pill ${esc(r.outcome)}">${esc(r.outcome)}</span>${
              r.suggested && r.outcome === 'rolled'
                ? `<span class="suggest">suggests ${r.suggested === 'success' ? '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg>' : '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg>'}</span>` : ''}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn ok sm" onclick="tag('${escJs(r.charId)}','success')">Success</button>
          <button class="btn danger sm" onclick="tag('${escJs(r.charId)}','fail')">Fail</button>
          ${rolled ? `<button class="btn ghost sm" onclick="tag('${escJs(r.charId)}','pending')" title="Clear the roll so they can try again"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-refresh"></use></svg></button>` : ''}
          <button class="btn ghost sm" onclick="recallOne('${escJs(r.charId)}')" title="Take it back"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>
        </td>
      </tr>`;
  }).join('');

  return `
    ${anySuggested ? '<div class="row" style="margin-bottom:8px"><button class="btn sm" onclick="applySuggested()">Apply all suggested</button></div>' : ''}
    <div style="overflow-x:auto">
      <table class="recips">
        <thead><tr><th>Character</th><th>Roll</th><th>Outcome</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function markDirty() { _dirty = true; }

// ── Mutations ─────────────────────────────────────────────────────────────────

function currentForm() {
  const g = id => document.getElementById(id);
  return {
    title: g('f-title').value.trim(),
    tag: g('f-tag').value.trim(),
    promptText: g('f-prompt').value,
    successText: g('f-success').value,
    failText: g('f-fail').value,
    checkSkill: parseInt(g('f-skill').value),
    checkDc: parseInt(g('f-dc').value) || 0,
  };
}

async function newHandout() {
  if (_dirty && !await hoConfirm('Discard unsaved changes?',
      { okLabel: 'Discard', danger: true, title: 'Unsaved changes' })) return;
  const title = await hoPrompt('New handout', {
    label: 'Title', placeholder: 'A torn letter, a map fragment…', okLabel: 'Create',
  });
  if (!title) return;
  const res = await fetch('/api/handouts', {
    method: 'POST', headers: H(), body: JSON.stringify({ title, checkSkill: -1 }),
  });
  if (!res.ok) { await hoAlert('Could not create the handout.'); return; }
  const created = await res.json();
  await loadAll();
  selectHandout(created.id);
}

async function saveHandout() {
  if (!_selId) return;
  const body = currentForm();
  if (!body.title) { setStatus('A title is required.', 'err'); return; }
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}`, {
    method: 'PUT', headers: H(), body: JSON.stringify(body),
  });
  if (!res.ok) { setStatus('Save failed.', 'err'); return; }
  _dirty = false;
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList();
  setStatus('Saved.', 'ok');
}

async function deleteHandout() {
  if (!_selId) return;
  const h = _handouts.find(x => x.id === _selId);
  if (!await hoConfirm(`Delete “${h ? h.title : 'this handout'}”? This cannot be undone.`,
      { okLabel: 'Delete', danger: true, title: 'Delete handout' })) return;
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}`, { method: 'DELETE', headers: H() });
  if (!res.ok) { await hoAlert('Delete failed.'); return; }
  _dirty = false;
  clearDetail();
  loadAll();
}

// ── Images ────────────────────────────────────────────────────────────────────

function pickImage(kind) {
  _imgTarget = kind;
  const el = document.getElementById('img-picker');
  el.value = '';
  el.click();
}

document.getElementById('img-picker').addEventListener('change', async function () {
  const file = this.files[0];
  if (!file || !_selId || !_imgTarget) return;
  setStatus('Uploading…');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const up = await fetch('/api/handouts/media', { method: 'POST', headers: H(), body: JSON.stringify({ dataUrl }) });
    if (!up.ok) { const e = await up.json().catch(() => ({})); setStatus(e.error || 'Upload failed.', 'err'); return; }
    const urls = await up.json();
    const p = _imgTarget;   // 'success' | 'fail'
    // Saved together with whatever is in the form, so an upload never discards
    // text the DM has just typed.
    const body = { ...currentForm(),
      [`${p}ImageUrl`]: urls.url, [`${p}ImageThumb`]: urls.thumb, [`${p}ImageMedium`]: urls.medium };
    const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}`, { method: 'PUT', headers: H(), body: JSON.stringify(body) });
    if (!res.ok) { setStatus('Save failed.', 'err'); return; }
    _dirty = false;
    const updated = await res.json();
    _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
    renderList(); renderDetail(updated);
    setStatus('Image added.', 'ok');
  } catch { setStatus('Upload failed.', 'err'); }
});

async function clearImage(kind) {
  if (!_selId) return;
  const body = { ...currentForm(), [`${kind}ImageUrl`]: '', [`${kind}ImageThumb`]: '', [`${kind}ImageMedium`]: '' };
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}`, { method: 'PUT', headers: H(), body: JSON.stringify(body) });
  if (!res.ok) { setStatus('Could not remove the image.', 'err'); return; }
  _dirty = false;
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList(); renderDetail(updated);
}

// ── Handing out and tagging ───────────────────────────────────────────────────

async function handOut() {
  if (!_selId) return;
  if (_dirty && !await hoConfirm('You have unsaved changes. Hand out the saved version anyway?',
      { okLabel: 'Hand out saved version', title: 'Unsaved changes' })) return;
  if (!_chars.length) { await hoAlert('No player characters in this campaign.', 'Nobody to hand it to'); return; }

  const picked = await pickCharacters();
  if (!picked) return;
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}/hand-out`, {
    method: 'POST', headers: H(), body: JSON.stringify({ charIds: picked }),
  });
  if (!res.ok) { await hoAlert('Could not hand it out.'); return; }
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList(); renderDetail(updated);
}

/**
 * Pick the recipients: a tick list of the party, with All / None.
 *
 * Resolves an array of character ids, or null if cancelled. Characters who
 * already hold this handout are shown ticked-out rather than hidden, so the DM
 * can see the whole party and who is already covered.
 */
function pickCharacters() {
  const held = new Set(((_handouts.find(h => h.id === _selId) || {}).recipients || []).map(r => r.charId));
  const rows = _chars.map(c => {
    const has = held.has(c.id);
    return `<label class="dlg-char${has ? ' has' : ''}">`
      + `<input type="checkbox" value="${esc(c.id)}"${has ? ' disabled' : ''}>`
      + `<span>${esc(c.name)}</span>`
      + (has ? '<span class="dlg-char-has">already has it</span>' : '')
      + `</label>`;
  }).join('');

  return _dlg({
    cancelValue: null,
    html: `<div class="dlg-hdr">Hand out to</div>`
      + `<div class="dlg-body">`
      +   `<div class="dlg-lbl">Characters`
      +     `<span class="dlg-bulk">`
      +       `<button class="btn sm dlg-all" type="button">All</button>`
      +       `<button class="btn sm dlg-none" type="button">None</button>`
      +     `</span>`
      +   `</div>`
      +   `<div class="dlg-chars">${rows}</div>`
      +   `<div class="dlg-err"></div>`
      + `</div>`
      + `<div class="dlg-ft">`
      +   `<button class="btn dlg-no">Cancel</button>`
      +   `<button class="btn primary dlg-go">Hand Out</button>`
      + `</div>`,
    wire: (box, done) => {
      const boxes = () => [...box.querySelectorAll('.dlg-chars input:not(:disabled)')];
      box.querySelector('.dlg-all').addEventListener('click', () => boxes().forEach(b => { b.checked = true; }));
      box.querySelector('.dlg-none').addEventListener('click', () => boxes().forEach(b => { b.checked = false; }));
      box.querySelector('.dlg-no').addEventListener('click', () => done(null));
      box.querySelector('.dlg-go').addEventListener('click', () => {
        const ids = boxes().filter(b => b.checked).map(b => b.value);
        if (!ids.length) { box.querySelector('.dlg-err').textContent = 'Tick at least one character.'; return; }
        done(ids);
      });
    },
  });
}

async function tag(charId, outcome) {
  if (!_selId) return;
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}/recipients/${encodeURIComponent(charId)}`, {
    method: 'PATCH', headers: H(), body: JSON.stringify({ outcome }),
  });
  if (!res.ok) { setStatus('Could not set the outcome.', 'err'); return; }
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList(); renderDetail(updated);
}

async function applySuggested() {
  const h = _handouts.find(x => x.id === _selId);
  if (!h) return;
  const todo = (h.recipients || []).filter(r => r.outcome === 'rolled' && r.suggested);
  for (const r of todo) {
    await fetch(`/api/handouts/${encodeURIComponent(_selId)}/recipients/${encodeURIComponent(r.charId)}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ outcome: r.suggested }),
    });
  }
  await loadAll();
}

async function recallOne(charId) {
  if (!_selId) return;
  if (!await hoConfirm(`Take this handout back from ${charName(charId)}?`,
      { okLabel: 'Take it back', danger: true, title: 'Recall handout' })) return;
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}/recall`, {
    method: 'POST', headers: H(), body: JSON.stringify({ charId }),
  });
  if (!res.ok) return;
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList(); renderDetail(updated);
}

async function recallAll() {
  if (!_selId) return;
  if (!await hoConfirm('Take this handout back from everyone?',
      { okLabel: 'Take it back', danger: true, title: 'Recall from everyone' })) return;
  const res = await fetch(`/api/handouts/${encodeURIComponent(_selId)}/recall`, {
    method: 'POST', headers: H(), body: JSON.stringify({}),
  });
  if (!res.ok) return;
  const updated = await res.json();
  _handouts = _handouts.map(h => h.id === updated.id ? updated : h);
  renderList(); renderDetail(updated);
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
// In-page replacements for confirm() / prompt() / alert().
//
// The desktop client is Electron, which does NOT implement prompt(): it returns
// undefined rather than a string or null, so `answer === null` was false and the
// very next `answer.trim()` threw. "New Handout" and "Hand Out" therefore did
// nothing at all there, with the error only visible in a console nobody opens.
// confirm() and alert() do work in Electron, but they are replaced too so the
// page has one look and one behaviour everywhere.

let _dlgClose = null;   // resolver for the dialog currently on screen

/**
 * Put a dialog on screen and resolve with whatever it passes back.
 *
 * `html` is the box's content; `wire(box, done)` attaches its handlers and gets
 * the real element, so nothing has to go looking for it in the document. Escape
 * and a backdrop click both resolve with `cancelValue`, so a dialog can never be
 * left stuck open with no way out.
 */
function _dlg({ html, wire, cancelValue = null }) {
  return new Promise(resolve => {
    if (_dlgClose) _dlgClose();          // never stack two dialogs

    const back = document.createElement('div');
    back.className = 'dlg-back';
    const box = document.createElement('div');
    box.className = 'dlg-box';
    box.innerHTML = html;
    back.appendChild(box);

    function close() {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      _dlgClose = null;
    }
    function done(value) {
      if (_dlgClose !== close) return;   // already closed
      close();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(cancelValue); }
    }

    back.addEventListener('mousedown', e => { if (e.target === back) done(cancelValue); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    _dlgClose = close;

    if (wire) wire(box, done);
    // Give the first field (or the confirming button) the keyboard.
    const focusMe = box.querySelector('.dlg-input, .dlg-go');
    if (focusMe) { focusMe.focus(); if (focusMe.select) focusMe.select(); }
  });
}

/** Replaces confirm(). Resolves true / false. */
function hoConfirm(message, { okLabel = 'OK', danger = false, title = 'Confirm' } = {}) {
  return _dlg({
    cancelValue: false,
    html: `<div class="dlg-hdr">${esc(title)}</div>`
      + `<div class="dlg-body">${esc(message)}</div>`
      + `<div class="dlg-ft">`
      +   `<button class="btn dlg-no">Cancel</button>`
      +   `<button class="btn ${danger ? 'danger' : 'primary'} dlg-go">${esc(okLabel)}</button>`
      + `</div>`,
    wire: (box, done) => {
      box.querySelector('.dlg-go').addEventListener('click', () => done(true));
      box.querySelector('.dlg-no').addEventListener('click', () => done(false));
    },
  });
}

/** Replaces alert(). Resolves once dismissed. */
function hoAlert(message, title = 'Something went wrong') {
  return _dlg({
    cancelValue: true,
    html: `<div class="dlg-hdr">${esc(title)}</div>`
      + `<div class="dlg-body">${esc(message)}</div>`
      + `<div class="dlg-ft"><button class="btn primary dlg-go">OK</button></div>`,
    wire: (box, done) => {
      box.querySelector('.dlg-go').addEventListener('click', () => done(true));
    },
  });
}

/** Replaces prompt(). Resolves the trimmed string, or null if cancelled. */
function hoPrompt(title, { label = '', value = '', placeholder = '', okLabel = 'Create', required = true } = {}) {
  return _dlg({
    cancelValue: null,
    html: `<div class="dlg-hdr">${esc(title)}</div>`
      + `<div class="dlg-body">`
      +   (label ? `<label class="dlg-lbl" for="dlg-text">${esc(label)}</label>` : '')
      +   `<input id="dlg-text" class="dlg-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`
      +   `<div class="dlg-err"></div>`
      + `</div>`
      + `<div class="dlg-ft">`
      +   `<button class="btn dlg-no">Cancel</button>`
      +   `<button class="btn primary dlg-go">${esc(okLabel)}</button>`
      + `</div>`,
    wire: (box, done) => {
      const input = box.querySelector('.dlg-input');
      const err   = box.querySelector('.dlg-err');
      const submit = () => {
        const v = (input.value || '').trim();
        if (required && !v) { err.textContent = 'Enter a value first.'; input.focus(); return; }
        done(v);
      };
      box.querySelector('.dlg-go').addEventListener('click', submit);
      box.querySelector('.dlg-no').addEventListener('click', () => done(null));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    },
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', e => {
  if (_dirty) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('DOMContentLoaded', () => {
  loadAll();
  if (window.connectRealtime) {
    // A player rolling is the event the DM is waiting on, so refresh on it.
    connectRealtime({
      handouts: () => { if (!_dirty) loadAll(); },
      notification: (n) => { typeof handleNotification === 'function' && handleNotification(n); },
    });
  }
});
