'use strict';

let masterPw = '';
let calView        = { type: 'month', month: 1, year: 1492 };
let calCurrentDate = { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
let calEvents      = [];
let editingEventId = null;

function genId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  if (!pw) return;
  try {
    const res = await fetch('/api/characters', { headers: { 'X-Master-Password': pw } });
    if (!res.ok) { document.getElementById('gate-err').textContent = 'Wrong password.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    applyTheme(localStorage.getItem('ev-theme') || 'dark-gold');
    await calLoad();
  } catch { document.getElementById('gate-err').textContent = 'Connection error.'; }
}

(async function tryAutoLogin() {
  const saved = sessionStorage.getItem('dmMasterPw');
  if (!saved) return;
  document.getElementById('gate-pw').value = saved;
  await authenticate();
})();

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('ev-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function calLoad() {
  setSaveStatus('Loading…');
  try {
    const [stateRes, evRes] = await Promise.all([
      fetch('/api/calendar/state?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } }),
      fetch('/api/calendar/events?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } }),
    ]);
    if (stateRes.ok) calCurrentDate = await stateRes.json();
    if (evRes.ok)    calEvents       = await evRes.json();
    calView = frDateToView(calCurrentDate);
    setSaveStatus('');
  } catch (e) { setSaveStatus('Load error', true); console.error('calLoad:', e); }
  calRender();
}

function setSaveStatus(msg, isErr) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--err)' : 'var(--txd)';
}

// ── Render ────────────────────────────────────────────────────────────────────
function calRender() {
  calRenderTodayBar();
  calRenderNavTitle();
  calRenderGrid();
  calRenderEventsList();
}

function calRenderTodayBar() {
  document.getElementById('cal-cur-date-display').textContent = frFormatDate(calCurrentDate);
  const yn = calCurrentDate.frYear ? frYearName(calCurrentDate.frYear) : '';
  document.getElementById('cal-cur-date-year').textContent = yn;
}

function calRenderNavTitle() {
  let title, subtitle;
  if (calView.type === 'festival') {
    title    = '✦ ' + frFestivalName(calView.festival);
    subtitle = frYearName(calView.year);
  } else {
    const m  = FR_MONTHS.find(mo => mo.num === calView.month);
    title    = (m ? `${m.name} — ${m.epithet}` : '?');
    subtitle = frYearName(calView.year);
  }
  document.getElementById('cal-page-title').textContent    = title;
  document.getElementById('cal-page-subtitle').textContent = subtitle;
}

function calRenderGrid() {
  const area = document.getElementById('cal-grid-area');
  if (calView.type === 'festival') {
    const isToday = frDatesEqual(calCurrentDate, { frYear: calView.year, frFestival: calView.festival, frMonth: null, frDay: null });
    const fest = FR_FESTIVALS.find(f => f.key === calView.festival);
    const dots = calEventsForView().map(e =>
      `<span class="cal-dot ${e.isPublic?'pub':'priv'}" title="${esc(e.title)}"></span>`
    ).join('');
    area.innerHTML = `
      <div class="cal-festival-row${isToday?' cal-is-today':''}" onclick="calDayClick(null,null,'${calView.festival}')">
        <span class="cal-fest-icon">✦</span>
        <span class="cal-fest-name">${esc(fest ? fest.name : calView.festival)}</span>
        ${dots ? `<div class="cal-fest-dots">${dots}</div>` : ''}
        ${isToday ? '<span class="cal-fest-mark">Today</span>' : ''}
      </div>`;
    return;
  }

  // Month grid — 3 tendays × 10 days
  const evByDay = {};
  for (const e of calEventsForView()) {
    const k = e.frDay;
    if (!evByDay[k]) evByDay[k] = [];
    evByDay[k].push(e);
  }

  const TENDAY_LABELS = ['First Tenday', 'Second Tenday', 'Third Tenday'];
  let rows = '';
  for (let td = 0; td < 3; td++) {
    let cells = `<td class="cal-tenday-lbl">${TENDAY_LABELS[td]}</td>`;
    for (let d = 1; d <= 10; d++) {
      const day = td * 10 + d;
      const isToday = frDatesEqual(calCurrentDate, { frYear: calView.year, frMonth: calView.month, frDay: day, frFestival: '' });
      const dayEvs  = evByDay[day] || [];
      const dots    = dayEvs.map(e => `<span class="cal-dot ${e.isPublic?'pub':'priv'}" title="${esc(e.title)}"></span>`).join('');
      cells += `
        <td class="cal-day-cell${isToday?' cal-is-today':''}" onclick="calDayClick(${calView.month},${day},null)">
          <span class="cal-day-num">${day}</span>
          ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
        </td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  area.innerHTML = `<table class="cal-grid"><tbody>${rows}</tbody></table>`;
}

function calRenderEventsList() {
  const viewEvs = calEventsForView();
  const el      = document.getElementById('cal-events-list');
  const titleEl = document.getElementById('cal-events-section-title');
  if (calView.type === 'festival') {
    titleEl.textContent = `Events on ${frFestivalName(calView.festival)}`;
  } else {
    const m = FR_MONTHS.find(mo => mo.num === calView.month);
    titleEl.textContent = `Events in ${m ? m.name : '?'} ${calView.year} DR`;
  }

  if (!viewEvs.length) {
    el.innerHTML = '<div class="cal-empty">No events recorded for this period.</div>';
    return;
  }

  el.innerHTML = viewEvs.map(e => {
    const badge = e.isPublic
      ? '<span class="cal-event-badge pub">Public</span>'
      : '<span class="cal-event-badge priv">DM Only</span>';
    const dateStr = frFormatDate({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival });
    return `
      <div class="cal-event-item">
        <div class="cal-event-info">
          <div class="cal-event-title">${esc(e.title)}</div>
          <div class="cal-event-date">${esc(dateStr)} &middot; ${esc(e.eventType)}</div>
          ${e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : ''}
        </div>
        ${badge}
        <div class="cal-event-actions">
          <button class="btn sm" onclick="calOpenEditEvent('${e.id}')">Edit</button>
          <button class="btn danger sm" onclick="calConfirmDelete('${e.id}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

// ── Navigation ────────────────────────────────────────────────────────────────
function calNavPage(dir) {
  calView = frNavigate(calView, dir);
  calRenderNavTitle();
  calRenderGrid();
  calRenderEventsList();
}

function calGoToToday() {
  calView = frDateToView(calCurrentDate);
  calRender();
}

// ── Campaign Date Controls ────────────────────────────────────────────────────
async function calSaveCurrentDate(newDate) {
  setSaveStatus('Saving…');
  try {
    const res = await fetch('/api/calendar/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(newDate),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { setSaveStatus('Save failed', true); return; }
    calCurrentDate = newDate;
    setSaveStatus('Saved');
    setTimeout(() => setSaveStatus(''), 2000);
    calRender();
  } catch { setSaveStatus('Save failed', true); }
}

function calNextDay() { calSaveCurrentDate(frNextDay(calCurrentDate)); }
function calPrevDay() { calSaveCurrentDate(frPrevDay(calCurrentDate)); }

function calOpenJumpModal() {
  const d = calCurrentDate;
  if (d.frFestival) {
    document.getElementById('cal-jump-type').value      = 'festival';
    document.getElementById('cal-jump-fest-year').value = d.frYear;
    document.getElementById('cal-jump-festival').value  = d.frFestival;
  } else {
    document.getElementById('cal-jump-type').value  = 'day';
    document.getElementById('cal-jump-year').value  = d.frYear;
    document.getElementById('cal-jump-month').value = d.frMonth || 1;
    document.getElementById('cal-jump-day').value   = d.frDay   || 1;
  }
  calToggleJumpType();
  document.getElementById('cal-jump-modal').style.display = 'flex';
}

function calCloseJumpModal() { document.getElementById('cal-jump-modal').style.display = 'none'; }

function calToggleJumpType() {
  const isFest = document.getElementById('cal-jump-type').value === 'festival';
  document.getElementById('cal-jump-day-fields').style.display      = isFest ? 'none' : '';
  document.getElementById('cal-jump-festival-fields').style.display = isFest ? ''     : 'none';
}

function calSetCurrentDate() {
  const type = document.getElementById('cal-jump-type').value;
  let newDate;
  if (type === 'festival') {
    newDate = {
      frYear: parseInt(document.getElementById('cal-jump-fest-year').value) || 1492,
      frMonth: null, frDay: null,
      frFestival: document.getElementById('cal-jump-festival').value,
    };
  } else {
    newDate = {
      frYear:    parseInt(document.getElementById('cal-jump-year').value)  || 1492,
      frMonth:   parseInt(document.getElementById('cal-jump-month').value) || 1,
      frDay:     Math.min(30, Math.max(1, parseInt(document.getElementById('cal-jump-day').value) || 1)),
      frFestival: '',
    };
  }
  calCloseJumpModal();
  calSaveCurrentDate(newDate);
}

// ── Events CRUD ───────────────────────────────────────────────────────────────
function calEventsForView() {
  if (calView.type === 'festival') {
    return calEvents.filter(e => e.frFestival === calView.festival && e.frYear === calView.year);
  }
  return calEvents.filter(e => !e.frFestival && e.frMonth === calView.month && e.frYear === calView.year);
}

function calDayClick(month, day, festival) {
  calOpenAddEventOn(calView.year, month, day, festival);
}

function calOpenAddEvent() {
  if (calView.type === 'festival') {
    calOpenAddEventOn(calView.year, null, null, calView.festival);
  } else {
    calOpenAddEventOn(calView.year, calView.month, 1, null);
  }
}

function calOpenAddEventOn(year, month, day, festival) {
  editingEventId = null;
  document.getElementById('cal-modal-title').textContent = 'Add Event';
  document.getElementById('cal-ev-delete-btn').style.display = 'none';
  document.getElementById('cal-ev-title').value = '';
  document.getElementById('cal-ev-desc').value  = '';
  document.getElementById('cal-ev-type').value  = 'event';
  document.getElementById('cal-ev-public').checked = false;

  if (festival) {
    document.getElementById('cal-ev-date-type').value  = 'festival';
    document.getElementById('cal-ev-fest-year').value  = year;
    document.getElementById('cal-ev-festival').value   = festival;
  } else {
    document.getElementById('cal-ev-date-type').value  = 'day';
    document.getElementById('cal-ev-year').value       = year;
    document.getElementById('cal-ev-month').value      = month || calView.month || 1;
    document.getElementById('cal-ev-day').value        = day   || 1;
  }
  calToggleDateType();
  document.getElementById('cal-event-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cal-ev-title').focus(), 50);
}

function calOpenEditEvent(id) {
  const ev = calEvents.find(e => e.id === id);
  if (!ev) return;
  editingEventId = id;
  document.getElementById('cal-modal-title').textContent    = 'Edit Event';
  document.getElementById('cal-ev-delete-btn').style.display = '';
  document.getElementById('cal-ev-title').value   = ev.title;
  document.getElementById('cal-ev-desc').value    = ev.description || '';
  document.getElementById('cal-ev-type').value    = ev.eventType || 'event';
  document.getElementById('cal-ev-public').checked = !!ev.isPublic;

  if (ev.frFestival) {
    document.getElementById('cal-ev-date-type').value = 'festival';
    document.getElementById('cal-ev-fest-year').value = ev.frYear;
    document.getElementById('cal-ev-festival').value  = ev.frFestival;
  } else {
    document.getElementById('cal-ev-date-type').value = 'day';
    document.getElementById('cal-ev-year').value      = ev.frYear;
    document.getElementById('cal-ev-month').value     = ev.frMonth || 1;
    document.getElementById('cal-ev-day').value       = ev.frDay   || 1;
  }
  calToggleDateType();
  document.getElementById('cal-event-modal').style.display = 'flex';
}

function calCloseEventModal() {
  document.getElementById('cal-event-modal').style.display = 'none';
  editingEventId = null;
}

function calToggleDateType() {
  const isFest = document.getElementById('cal-ev-date-type').value === 'festival';
  document.getElementById('cal-ev-day-fields').style.display      = isFest ? 'none' : '';
  document.getElementById('cal-ev-festival-fields').style.display = isFest ? ''     : 'none';
}

async function calSaveEvent() {
  const title = document.getElementById('cal-ev-title').value.trim();
  if (!title) { document.getElementById('cal-ev-title').focus(); return; }

  const type = document.getElementById('cal-ev-date-type').value;
  let ev;
  if (type === 'festival') {
    ev = {
      title,
      description: document.getElementById('cal-ev-desc').value.trim(),
      frYear:      parseInt(document.getElementById('cal-ev-fest-year').value) || 1492,
      frMonth:     null,
      frDay:       null,
      frFestival:  document.getElementById('cal-ev-festival').value,
      isPublic:    document.getElementById('cal-ev-public').checked,
      eventType:   document.getElementById('cal-ev-type').value,
    };
  } else {
    ev = {
      title,
      description: document.getElementById('cal-ev-desc').value.trim(),
      frYear:      parseInt(document.getElementById('cal-ev-year').value)  || 1492,
      frMonth:     parseInt(document.getElementById('cal-ev-month').value) || 1,
      frDay:       Math.min(30, Math.max(1, parseInt(document.getElementById('cal-ev-day').value) || 1)),
      frFestival:  '',
      isPublic:    document.getElementById('cal-ev-public').checked,
      eventType:   document.getElementById('cal-ev-type').value,
    };
  }

  setSaveStatus('Saving…');
  try {
    let res;
    if (editingEventId) {
      res = await fetch(`/api/calendar/events/${editingEventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify(ev),
      });
    } else {
      ev.id = genId();
      res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify(ev),
      });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { setSaveStatus('Save failed', true); return; }
    setSaveStatus('Saved');
    setTimeout(() => setSaveStatus(''), 2000);
    calCloseEventModal();
    await calRefreshEvents();
  } catch { setSaveStatus('Save failed', true); }
}

function calConfirmDelete(id) {
  if (!confirm('Delete this event?')) return;
  calDoDelete(id);
}

function calDeleteEditingEvent() {
  if (!editingEventId) return;
  if (!confirm('Delete this event?')) return;
  calCloseEventModal();
  calDoDelete(editingEventId);
}

async function calDoDelete(id) {
  setSaveStatus('Deleting…');
  try {
    const res = await fetch(`/api/calendar/events/${id}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { setSaveStatus('Delete failed', true); return; }
    setSaveStatus('');
    await calRefreshEvents();
  } catch { setSaveStatus('Delete failed', true); }
}

async function calRefreshEvents() {
  try {
    const res = await fetch('/api/calendar/events?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } });
    if (res.ok) calEvents = await res.json();
    calRenderGrid();
    calRenderEventsList();
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    calCloseEventModal();
    calCloseJumpModal();
  }
  if (e.key === 'Enter' && document.getElementById('gate').style.display !== 'none') authenticate();
});
