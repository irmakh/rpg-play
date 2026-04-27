// ── Media ─────────────────────────────────────────────────────────────────────
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
      ? `<img src="${esc(cardSrc)}" alt="${esc(m.name)}" loading="lazy" onclick="_mediaLightbox('${m.id}')">`
      : `<div class="media-vid-thumb" onclick="_mediaLightbox('${m.id}')"><video src="${esc(m.dataUrl)}" preload="metadata" muted playsinline></video><div class="media-vid-play">&#9654;</div></div>`;
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

  if (!ALLOWED_CLIENT_TYPES.has(file.type)) {
    showAlert('File type not allowed.\nAllowed: JPEG, PNG, GIF, WebP, MP4, WebM');
    return;
  }
  if (file.size > MAX_CLIENT_SIZE) {
    showAlert('File too large. Maximum 25 MB.');
    return;
  }

  const statusId = isPortrait ? 'portrait-upload-status' : 'media-upload-status';
  const setUploadStatus = (msg, ok) => {
    const el = document.getElementById(statusId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok === true ? 'var(--ok)' : ok === false ? 'var(--err)' : 'var(--inf)';
  };
  setUploadStatus('Reading file…', null);

  let dataUrl;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = ()  => reject(new Error('Read failed'));
      r.readAsDataURL(file);
    });
  } catch { setUploadStatus('Could not read file.', false); return; }

  const mimeCheck = dataUrl.match(/^data:([^;]+);base64,/);
  if (!mimeCheck || mimeCheck[1] !== file.type) {
    setUploadStatus('File content does not match declared type.', false);
    return;
  }

  setUploadStatus('Uploading…', null);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    const res = await fetch(`/api/characters/${currentCharId}/media`, {
      method: 'POST', headers,
      body: JSON.stringify({ dataUrl, originalName: file.name, isPortrait })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setUploadStatus(err.error || 'Upload failed.', false);
      return;
    }
    setUploadStatus('Uploaded!', true);
    setTimeout(() => setUploadStatus('', null), 3000);
    await loadMedia();
  } catch { setUploadStatus('Network error.', false); }
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

// Thin wrapper — looks up media by id, then delegates to shared lightboxOpen()
function _mediaLightbox(id) {
  const m = mediaList.find(x => x.id === id);
  if (m) lightboxOpen(m.dataUrl, m.mimeType);
}
