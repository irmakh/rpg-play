// ── Player Calendar ───────────────────────────────────────────────────────────
let pcalView        = { type: 'month', month: 1, year: 1492 };
let pcalCurrentDate = { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
let pcalEvents      = [];
let pcalWeather     = {};   // date-key → weather entry (read-only on the player calendar)
let pcalLoaded      = false;
let pcalSelectedDay = null; // { month, day } or { festival } when a cell is clicked
let pcalEditingId    = null; // id of the journal being edited, or null when adding
let pcalPendingMedia = [];   // media descriptors staged for the open journal modal

async function pcalLoad() {
  if (pcalLoaded) return;
  pcalLoaded = true;
  await pcalFetch();
}

async function pcalFetch() {
  try {
    const headers = pcalAuthHeaders();
    const [stateRes, evRes] = await Promise.all([
      fetch('/api/calendar/state?_=' + Date.now(), { headers }),
      fetch('/api/calendar/events?_=' + Date.now(), { headers }),
    ]);
    if (stateRes.ok) pcalCurrentDate = await stateRes.json();
    if (evRes.ok)    pcalEvents       = await evRes.json();
  } catch {}
  // Weather (public read) — drives the calendar hover tooltips for players.
  try {
    const wxRes = await fetch('/api/weather/log?_=' + Date.now());
    const log = wxRes.ok ? await wxRes.json() : [];
    pcalWeather = {};
    for (const e of log) pcalWeather[e.id] = e;
    weatherSetRegistry(pcalWeather);
  } catch {}
  pcalView = frDateToView(pcalCurrentDate);
  pcalRender();
}

// Auth headers for calendar requests: master pw for the DM, character id +
// password for a player session (so private own-journals are returned).
function pcalAuthHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (indexIsDM()) {
    if (indexMasterPw()) h['X-Master-Password'] = indexMasterPw();
  } else if (indexCharId()) {
    h['X-Character-Id'] = indexCharId();
    const pw = charPasswords[indexCharId()] || indexCharPw();
    if (pw) h['X-Character-Password'] = pw;
  }
  return h;
}

function pcalCanEdit(e) {
  return indexIsDM() || (e.authorCharId && e.authorCharId === indexCharId());
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
  const addBtn = document.getElementById('pcal-add-journal-btn');
  if (addBtn) addBtn.style.display = indexCharId() ? '' : 'none';
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
      `<span class="cal-dot pub" title="${esc(e.title)}"></span>`
    ).join('');
    const festKey = `${pcalView.year}-F-${pcalView.festival}`;
    const festWx  = pcalWeather[festKey];
    area.innerHTML = `
      <div class="cal-festival-row${isToday?' cal-is-today':''}${isSelected?' cal-is-today':''}"
           onclick="pcalDayClick(null,'${pcalView.festival}')" style="cursor:pointer">
        <span class="cal-fest-icon">✦</span>
        <span class="cal-fest-name">${esc(fest ? fest.name : pcalView.festival)}</span>
        ${dots ? `<div class="cal-fest-dots">${dots}</div>` : ''}
        ${isToday ? '<span class="cal-fest-mark">Today</span>' : ''}
        ${festWx ? weatherDayMarkHTML(festWx, festKey) : ''}
      </div>`;
    return;
  }

  const evByDay = {};
  for (const e of pcalEventsForView()) {
    if (!evByDay[e.frDay]) evByDay[e.frDay] = [];
    evByDay[e.frDay].push(e);
  }

  const TENDAY_LABELS = ['1st. Tenday', '2nd. Tenday', '3rd. Tenday'];
  let rows = '';
  for (let td = 0; td < 3; td++) {
    let cells = `<td class="cal-tenday-lbl">${TENDAY_LABELS[td]}</td>`;
    for (let d = 1; d <= 10; d++) {
      const day        = td * 10 + d;
      const isToday    = frDatesEqual(pcalCurrentDate, { frYear: pcalView.year, frMonth: pcalView.month, frDay: day, frFestival: '' });
      const isSelected = pcalSelectedDay && pcalSelectedDay.day === day && !pcalSelectedDay.festival;
      const dayEvs     = evByDay[day] || [];
      const dots       = dayEvs.map(e => `<span class="cal-dot pub" title="${esc(e.title)}"></span>`).join('');
      const classes    = ['cal-day-cell', isToday ? 'cal-is-today' : '', isSelected ? 'cal-selected' : ''].filter(Boolean).join(' ');
      const wxKey      = `${pcalView.year}-${pcalView.month}-${day}`;
      const wx         = pcalWeather[wxKey];
      cells += `
        <td class="${classes}" onclick="pcalDayClick(${day},null)">
          <span class="cal-day-num">${day}</span>
          ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
          ${wx ? weatherDayMarkHTML(wx, wxKey) : ''}
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

  if (titleEl) titleEl.innerHTML = esc(heading) + showAllLink;

  if (!evs.length) {
    el.innerHTML = '<div class="cal-empty">No events recorded for this period.</div>';
    return;
  }

  el.innerHTML = evs.map(e => {
    const dateStr = frFormatDate({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival });
    const isJournal = !!e.authorCharId;
    const authorLine = isJournal
      ? `<div class="cal-event-author">📖 ${esc(e.authorName || 'Journal')}${e.isPublic ? '' : ' · 🔒 Private'}</div>`
      : '';
    const actions = pcalCanEdit(e)
      ? `<div class="cal-event-actions">
           <button class="btn sm" onclick="pcalEditJournal('${escJs(e.id)}')">Edit</button>
           <button class="btn danger sm" onclick="pcalDeleteJournal('${escJs(e.id)}')">✕</button>
         </div>`
      : '';
    return `
      <div class="cal-event-item">
        <div class="cal-event-info">
          <div class="cal-event-title">${esc(e.title)}</div>
          <div class="cal-event-date">${esc(dateStr)} &middot; ${esc(e.eventType)}</div>
          ${authorLine}
          ${e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : ''}
          ${pcalRenderMedia(e.media)}
        </div>
        ${actions}
      </div>`;
  }).join('');
}

// Render attachment thumbnails / players for a calendar event.
function pcalRenderMedia(media) {
  if (!Array.isArray(media) || !media.length) return '';
  const items = media.map(m => {
    if (m.type === 'image') return `<img class="cal-media-thumb" src="${esc(m.thumb || m.url)}" onclick="pcalLightbox('${escJs(m.url)}','image')">`;
    if (m.type === 'audio') return `<audio class="cal-media-audio" controls preload="none" src="${esc(m.url)}"></audio>`;
    if (m.type === 'video') return `<video class="cal-media-video" controls preload="metadata" src="${esc(m.url)}"></video>`;
    return '';
  }).join('');
  return `<div class="cal-media-row">${items}</div>`;
}

function pcalLightbox(url, type) {
  lightboxOpen(url, type === 'image' ? 'image/jpeg' : 'video/mp4');
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

// ── Journal entries (player-authored calendar events) ─────────────────────────
function pcalJournalErr(msg) {
  const el = document.getElementById('pcal-journal-err');
  if (el) el.textContent = msg || '';
}

// Compute the target date for a new journal from the current view + selection.
function pcalJournalTargetDate() {
  if (pcalView.type === 'festival') {
    return { frYear: pcalView.year, frMonth: null, frDay: null, frFestival: pcalView.festival };
  }
  const day = (pcalSelectedDay && !pcalSelectedDay.festival) ? pcalSelectedDay.day : 1;
  return { frYear: pcalView.year, frMonth: pcalView.month, frDay: day, frFestival: '' };
}

function pcalOpenAddJournal() {
  if (!indexCharId()) return;
  pcalEditingId = null;
  pcalPendingMedia = [];
  const d = pcalJournalTargetDate();
  document.getElementById('pcal-journal-modal-title').textContent = 'New Journal Entry';
  document.getElementById('pcal-journal-title-input').value = '';
  document.getElementById('pcal-journal-desc').value = '';
  document.querySelector('input[name="pcal-journal-vis"][value="shared"]').checked = true;
  document.getElementById('pcal-journal-media-input').value = '';
  document.getElementById('pcal-journal-delete').style.display = 'none';
  pcalSetJournalDate(d, true);
  pcalRenderPendingMedia();
  pcalJournalErr('');
  document.getElementById('pcal-journal-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('pcal-journal-title-input').focus(), 50);
}

function pcalEditJournal(id) {
  const e = pcalEvents.find(ev => ev.id === id);
  if (!e || !pcalCanEdit(e)) return;
  pcalEditingId = id;
  pcalPendingMedia = Array.isArray(e.media) ? e.media.slice() : [];
  document.getElementById('pcal-journal-modal-title').textContent = 'Edit Journal Entry';
  document.getElementById('pcal-journal-title-input').value = e.title || '';
  document.getElementById('pcal-journal-desc').value = e.description || '';
  document.querySelector(`input[name="pcal-journal-vis"][value="${e.isPublic ? 'shared' : 'private'}"]`).checked = true;
  document.getElementById('pcal-journal-media-input').value = '';
  document.getElementById('pcal-journal-delete').style.display = '';
  pcalSetJournalDate({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival }, false);
  pcalRenderPendingMedia();
  pcalJournalErr('');
  document.getElementById('pcal-journal-modal').style.display = 'flex';
}

// Store the target date on the modal + show a friendly label. Day is editable
// for month views (festival entries have no day).
let _pcalJournalDate = null;
function pcalSetJournalDate(d, editableDay) {
  _pcalJournalDate = d;
  const lbl = document.getElementById('pcal-journal-date');
  const dayRow = document.getElementById('pcal-journal-day-row');
  const dayInput = document.getElementById('pcal-journal-day');
  if (d.frFestival) {
    if (dayRow) dayRow.style.display = 'none';
    if (lbl) lbl.textContent = frFormatDate(d);
  } else {
    if (dayRow) dayRow.style.display = editableDay ? '' : 'none';
    if (dayInput) dayInput.value = d.frDay || 1;
    if (lbl) lbl.textContent = `${frMonthName(d.frMonth)}, ${d.frYear} DR`;
  }
}

function pcalCloseJournalModal() {
  document.getElementById('pcal-journal-modal').style.display = 'none';
  pcalEditingId = null;
  pcalPendingMedia = [];
}

async function pcalAddMediaFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  for (const file of files) {
    if (pcalPendingMedia.length >= 12) { pcalJournalErr('Maximum 12 attachments.'); break; }
    pcalJournalErr('Uploading ' + file.name + '…');
    try {
      const dataUrl = await pcalFileToDataUrl(file);
      const res = await fetch('/api/calendar/media', {
        method: 'POST',
        headers: pcalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) { pcalJournalErr(json.error || ('Upload failed: ' + file.name)); continue; }
      pcalPendingMedia.push(json);
      pcalRenderPendingMedia();
      pcalJournalErr('');
    } catch { pcalJournalErr('Upload failed: ' + file.name); }
  }
}

function pcalFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function pcalRenderPendingMedia() {
  const el = document.getElementById('pcal-journal-media-list');
  if (!el) return;
  el.innerHTML = pcalPendingMedia.map((m, i) => {
    const preview = m.type === 'image'
      ? `<img src="${esc(m.thumb || m.url)}">`
      : `<span class="cal-media-chip-icon">${m.type === 'audio' ? '🎵' : '🎬'}</span>`;
    return `<span class="cal-media-chip">${preview}<button type="button" onclick="pcalRemovePendingMedia(${i})">✕</button></span>`;
  }).join('');
}

function pcalRemovePendingMedia(i) {
  pcalPendingMedia.splice(i, 1);
  pcalRenderPendingMedia();
}

async function pcalSaveJournal() {
  const title = document.getElementById('pcal-journal-title-input').value.trim();
  if (!title) { pcalJournalErr('Title is required.'); return; }
  const d = _pcalJournalDate || pcalJournalTargetDate();
  let frDay = d.frDay;
  if (!d.frFestival) {
    frDay = Math.min(30, Math.max(1, parseInt(document.getElementById('pcal-journal-day').value) || 1));
  }
  const shared = document.querySelector('input[name="pcal-journal-vis"]:checked')?.value === 'shared';
  const body = {
    title,
    description: document.getElementById('pcal-journal-desc').value.trim(),
    frYear: d.frYear,
    frMonth: d.frFestival ? null : d.frMonth,
    frDay: d.frFestival ? null : frDay,
    frFestival: d.frFestival || '',
    shared,
    media: pcalPendingMedia,
  };
  pcalJournalErr('Saving…');
  try {
    const url = pcalEditingId ? `/api/calendar/events/${pcalEditingId}` : '/api/calendar/events';
    const res = await fetch(url, {
      method: pcalEditingId ? 'PUT' : 'POST',
      headers: pcalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { pcalJournalErr(json.error || 'Save failed.'); return; }
    pcalCloseJournalModal();
    pcalLoaded = false;
    await pcalLoad();
  } catch { pcalJournalErr('Save failed.'); }
}

function pcalDeleteJournal(id) {
  const targetId = id || pcalEditingId;
  if (!targetId) return;
  showConfirm('Delete this journal entry?', async () => {
    try {
      const res = await fetch(`/api/calendar/events/${targetId}`, {
        method: 'DELETE',
        headers: pcalAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { showAlert(json.error || 'Delete failed.'); return; }
      pcalCloseJournalModal();
      pcalLoaded = false;
      await pcalLoad();
    } catch { showAlert('Delete failed.'); }
  });
}
