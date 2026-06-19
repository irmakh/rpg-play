'use strict';

let masterPw = '';
let calView        = { type: 'month', month: 1, year: 1492 };
let calCurrentDate = { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
let calEvents      = [];
let editingEventId = null;
let calPendingMedia = [];   // media descriptors staged for the open event modal

function genId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escape a value for a single-quoted JS string inside an HTML attribute (see escJs note in esc.js).
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('rpgSession') || 'null')?.masterPw; } catch {}
  if (!saved) saved = sessionStorage.getItem('dmMasterPw');
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
    await weatherLoadLog();
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
    const festKey = `${calView.year}-F-${calView.festival}`;
    const festWx  = calWeather[festKey];
    area.innerHTML = `
      <div class="cal-festival-row${isToday?' cal-is-today':''}" onclick="calDayClick(null,null,'${calView.festival}')">
        <span class="cal-fest-icon">✦</span>
        <span class="cal-fest-name">${esc(fest ? fest.name : calView.festival)}</span>
        ${dots ? `<div class="cal-fest-dots">${dots}</div>` : ''}
        ${isToday ? '<span class="cal-fest-mark">Today</span>' : ''}
        ${festWx ? weatherDayMarkHTML(festWx, festKey) : ''}
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

  const TENDAY_LABELS = ['1st. Tenday', '2nd. Tenday', '3rd. Tenday'];
  let rows = '';
  for (let td = 0; td < 3; td++) {
    let cells = `<td class="cal-tenday-lbl">${TENDAY_LABELS[td]}</td>`;
    for (let d = 1; d <= 10; d++) {
      const day = td * 10 + d;
      const isToday = frDatesEqual(calCurrentDate, { frYear: calView.year, frMonth: calView.month, frDay: day, frFestival: '' });
      const dayEvs  = evByDay[day] || [];
      const dots    = dayEvs.map(e => `<span class="cal-dot ${e.isPublic?'pub':'priv'}" title="${esc(e.title)}"></span>`).join('');
      const wxKey   = `${calView.year}-${calView.month}-${day}`;
      const wx      = calWeather[wxKey];
      cells += `
        <td class="cal-day-cell${isToday?' cal-is-today':''}" onclick="calDayClick(${calView.month},${day},null)">
          <span class="cal-day-num">${day}</span>
          ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
          ${wx ? weatherDayMarkHTML(wx, wxKey) : ''}
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
    const badge = e.authorCharId
      ? `<span class="cal-event-badge ${e.isPublic ? 'pub' : 'priv'}">${e.isPublic ? 'Shared' : 'Private'}</span>`
      : (e.isPublic
        ? '<span class="cal-event-badge pub">Public</span>'
        : '<span class="cal-event-badge priv">DM Only</span>');
    const author = e.authorCharId ? `<div class="cal-event-author">📖 ${esc(e.authorName || 'Journal')}</div>` : '';
    const dateStr = frFormatDate({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival });
    return `
      <div class="cal-event-item">
        <div class="cal-event-info">
          <div class="cal-event-title">${esc(e.title)}</div>
          <div class="cal-event-date">${esc(dateStr)} &middot; ${esc(e.eventType)}</div>
          ${author}
          ${e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : ''}
          ${calRenderMedia(e.media)}
        </div>
        ${badge}
        <div class="cal-event-actions">
          <button class="btn sm" onclick="calOpenEditEvent('${escJs(e.id)}')">Edit</button>
          <button class="btn danger sm" onclick="calConfirmDelete('${escJs(e.id)}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

// Render attachment thumbnails / players for a calendar event (DM view).
function calRenderMedia(media) {
  if (!Array.isArray(media) || !media.length) return '';
  const items = media.map(m => {
    if (m.type === 'image') return `<img class="cal-media-thumb" src="${esc(m.thumb || m.url)}" onclick="lightboxOpen('${escJs(m.url)}','image/jpeg')">`;
    if (m.type === 'audio') return `<audio class="cal-media-audio" controls preload="none" src="${esc(m.url)}"></audio>`;
    if (m.type === 'video') return `<video class="cal-media-video" controls preload="metadata" src="${esc(m.url)}"></video>`;
    return '';
  }).join('');
  return `<div class="cal-media-row">${items}</div>`;
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

// ── Weather ───────────────────────────────────────────────────────────────────
// calWeather maps date-key → entry; drives the calendar hover tooltips. The
// weather modal edits weatherTargetDate (defaults to the campaign date, but a
// history click re-targets any past day). weatherDateKey / tooltip helpers live
// in js/lib/weather-ui.js.
let calWeather = {};
let weatherTargetDate = null;

async function weatherLoadLog() {
  try {
    const res = await fetch('/api/weather/log?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } });
    const log = res.ok ? await res.json() : [];
    calWeather = {};
    for (const e of log) calWeather[e.id] = e;
    weatherSetRegistry(calWeather);
    return log;
  } catch { return []; }
}

async function weatherOpenModal() {
  document.getElementById('weather-modal').style.display = 'flex';
  try {
    const cfgRes = await fetch('/api/weather/config?_=' + Date.now(), { headers: { 'X-Master-Password': masterPw } });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      document.getElementById('weather-session-normal').value = cfg.sessionNormal;
      document.getElementById('weather-l1-min').value = cfg.level1Min;
      document.getElementById('weather-l2-min').value = cfg.level2Min;
    }
  } catch (e) { console.error('weatherOpenModal:', e); }
  weatherRangeHelp();
  await weatherLoadLog();
  weatherSetTarget(calCurrentDate);
  weatherRenderHistory();
}

function weatherCloseModal() { document.getElementById('weather-modal').style.display = 'none'; weatherHideTip(); }

// ── Roll date + level-range controls ──────────────────────────────────────────
function weatherToggleDateTypeView() {
  const fest = document.getElementById('weather-date-type').value === 'festival';
  document.getElementById('weather-date-day-fields').style.display  = fest ? 'none' : '';
  document.getElementById('weather-date-fest-fields').style.display = fest ? '' : 'none';
}
function weatherToggleDateType() { weatherToggleDateTypeView(); weatherOnDateChange(); }

function weatherReadDateInputs() {
  if (document.getElementById('weather-date-type').value === 'festival') {
    return {
      frYear: parseInt(document.getElementById('weather-date-fest-year').value) || 1492,
      frMonth: null, frDay: null,
      frFestival: document.getElementById('weather-date-festival').value,
    };
  }
  return {
    frYear: parseInt(document.getElementById('weather-date-year').value) || 1492,
    frMonth: parseInt(document.getElementById('weather-date-month').value) || 1,
    frDay: Math.min(30, Math.max(1, parseInt(document.getElementById('weather-date-day').value) || 1)),
    frFestival: '',
  };
}
// Date inputs changed → re-target and load that day's existing weather.
function weatherOnDateChange() {
  weatherTargetDate = weatherReadDateInputs();
  document.getElementById('weather-target-date').textContent = frFormatDate(weatherTargetDate);
  const existing = calWeather[weatherDateKey(weatherTargetDate)];
  if (existing) weatherFillForm(existing); else weatherClearForm();
}

// Point the editor at a date: reflect it into the date inputs, then load its
// existing weather (if any) into the form.
function weatherSetTarget(date) {
  weatherTargetDate = date;
  if (date.frFestival) {
    document.getElementById('weather-date-type').value      = 'festival';
    document.getElementById('weather-date-fest-year').value = date.frYear;
    document.getElementById('weather-date-festival').value  = date.frFestival;
  } else {
    document.getElementById('weather-date-type').value  = 'day';
    document.getElementById('weather-date-year').value  = date.frYear;
    document.getElementById('weather-date-month').value = date.frMonth || 1;
    document.getElementById('weather-date-day').value   = date.frDay || 1;
  }
  weatherToggleDateTypeView();
  document.getElementById('weather-target-date').textContent = frFormatDate(date);
  const existing = calWeather[weatherDateKey(date)];
  if (existing) weatherFillForm(existing); else weatherClearForm();
}
function weatherUseCurrentDate() { weatherSetTarget(calCurrentDate); }

// Clamp the two thresholds (1 ≤ l1 ≤ l2 ≤ 20), refresh the range hint, persist.
function weatherOnThresholds() {
  let l1 = parseInt(document.getElementById('weather-l1-min').value);
  let l2 = parseInt(document.getElementById('weather-l2-min').value);
  l1 = Math.min(20, Math.max(1, Number.isFinite(l1) ? l1 : 15));
  l2 = Math.min(20, Math.max(l1, Number.isFinite(l2) ? l2 : 18));
  document.getElementById('weather-l1-min').value = l1;
  document.getElementById('weather-l2-min').value = l2;
  weatherRangeHelp();
  fetch('/api/weather/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
    body: JSON.stringify({ level1Min: l1, level2Min: l2 }),
  }).catch(e => console.error('weatherOnThresholds:', e));
}
function weatherRangeHelp() {
  const l1 = parseInt(document.getElementById('weather-l1-min').value) || 15;
  const l2 = parseInt(document.getElementById('weather-l2-min').value) || 18;
  const rng = (a, b) => a > b ? 'never' : a === b ? String(a) : `${a}–${b}`;
  document.getElementById('weather-range-help').textContent =
    `Normal ${rng(1, l1 - 1)} · Level 1 ${rng(l1, l2 - 1)} · Level 2 ${rng(l2, 20)}`;
}

function weatherFillForm(e) {
  document.getElementById('weather-temp-level').value  = e.temperature.level || 'normal';
  document.getElementById('weather-temp-value').value  = e.temperature.value;
  document.getElementById('weather-wind-value').value  = e.wind.value || 'Normal';
  document.getElementById('weather-precip-value').value = e.precipitation.value || 'None';
}
function weatherClearForm() {
  document.getElementById('weather-temp-level').value  = 'normal';
  document.getElementById('weather-temp-value').value  = parseInt(document.getElementById('weather-session-normal').value) || 60;
  document.getElementById('weather-wind-value').value  = 'Normal';
  document.getElementById('weather-precip-value').value = 'None';
}
// When the temperature level is set back to Normal, reset the value to the base.
function weatherOnTempLevel() {
  if (document.getElementById('weather-temp-level').value === 'normal') {
    document.getElementById('weather-temp-value').value = parseInt(document.getElementById('weather-session-normal').value) || 60;
  }
}

async function weatherSaveConfig() {
  const n = parseInt(document.getElementById('weather-session-normal').value);
  if (!Number.isFinite(n)) return;
  try {
    await fetch('/api/weather/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ sessionNormal: n }),
    });
  } catch (e) { console.error('weatherSaveConfig:', e); }
}

async function weatherRoll() {
  const n = parseInt(document.getElementById('weather-session-normal').value);
  if (!Number.isFinite(n)) { setSaveStatus('Enter a Session Normal value', true); return; }
  weatherTargetDate = weatherReadDateInputs();   // honour any just-typed date
  const btn = document.getElementById('weather-roll-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/weather/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({
        date: weatherTargetDate,
        sessionNormal: n,
        level1Min: parseInt(document.getElementById('weather-l1-min').value),
        level2Min: parseInt(document.getElementById('weather-l2-min').value),
        dateLabel: frFormatDate(weatherTargetDate),
      }),
    });
    if (!res.ok) { setSaveStatus('Weather roll failed', true); return; }
    weatherFillForm(await res.json());
    await weatherLoadLog();
    weatherRenderHistory();
    calRenderGrid();
  } catch (e) { console.error('weatherRoll:', e); setSaveStatus('Weather roll failed', true); }
  finally { btn.disabled = false; }
}

// Derive a severity level from a chosen wind / precipitation value.
function _weatherWindLevel(v) { return v === 'Strong' ? 'level2' : v === 'Light' ? 'level1' : 'normal'; }
function _weatherPrecipLevel(v) {
  const s = String(v).toLowerCase();
  if (s.startsWith('heavy')) return 'level2';
  if (s.startsWith('light')) return 'level1';
  return 'normal';
}

async function weatherSave() {
  const tempVal = parseInt(document.getElementById('weather-temp-value').value);
  if (!Number.isFinite(tempVal)) { setSaveStatus('Enter a temperature', true); return; }
  weatherTargetDate = weatherReadDateInputs();   // honour any just-typed date
  const windVal   = document.getElementById('weather-wind-value').value;
  const precipVal = document.getElementById('weather-precip-value').value;
  const body = {
    date: weatherTargetDate,
    dateLabel: frFormatDate(weatherTargetDate),
    sessionNormal: parseInt(document.getElementById('weather-session-normal').value) || 60,
    temperature:   { level: document.getElementById('weather-temp-level').value, value: tempVal },
    wind:          { level: _weatherWindLevel(windVal), value: windVal },
    precipitation: { level: _weatherPrecipLevel(precipVal), value: precipVal },
  };
  try {
    const res = await fetch('/api/weather/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setSaveStatus('Weather save failed', true); return; }
    setSaveStatus('Weather saved');
    setTimeout(() => setSaveStatus(''), 1500);
    await weatherLoadLog();
    weatherRenderHistory();
    calRenderGrid();
  } catch (e) { console.error('weatherSave:', e); setSaveStatus('Weather save failed', true); }
}

async function weatherDeleteEntry(id) {
  try {
    await fetch('/api/weather/log/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { 'X-Master-Password': masterPw },
    });
    await weatherLoadLog();
    weatherRenderHistory();
    calRenderGrid();
  } catch (e) { console.error('weatherDeleteEntry:', e); }
}

function weatherRenderHistory() {
  const el = document.getElementById('weather-history');
  const log = Object.values(calWeather);
  if (!log.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txd);padding:6px 0">No weather recorded yet.</div>';
    return;
  }
  el.innerHTML = log.map(e => `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--sep);font-size:12px">
      <span style="flex:1;min-width:0;cursor:pointer" onclick="weatherEditFromHistory('${escJs(e.id)}')" title="Edit this day">
        ${weatherIconSpan(weatherTempIconClass(e), 18)}
        <b style="margin-left:4px">${esc(e.dateLabel || frFormatDate(e))}</b>
        <span style="color:var(--txd)"> — ${esc(weatherSummary(e))}</span>
      </span>
      <button class="btn sm" style="flex-shrink:0" onclick="weatherDeleteEntry('${escJs(e.id)}')" title="Delete">✕</button>
    </div>`).join('');
}

function weatherEditFromHistory(id) {
  const e = calWeather[id];
  if (!e) return;
  weatherSetTarget({ frYear: e.frYear, frMonth: e.frMonth, frDay: e.frDay, frFestival: e.frFestival || '' });
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
  calPendingMedia = [];
  document.getElementById('cal-ev-media-input').value = '';
  calRenderPendingMedia();

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
  calPendingMedia = Array.isArray(ev.media) ? ev.media.slice() : [];
  document.getElementById('cal-ev-media-input').value = '';
  calRenderPendingMedia();

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
      media:       calPendingMedia,
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
      media:       calPendingMedia,
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

// ── Event Media ───────────────────────────────────────────────────────────────
async function calAddMediaFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  for (const file of files) {
    if (calPendingMedia.length >= 12) { setSaveStatus('Max 12 attachments', true); break; }
    setSaveStatus('Uploading ' + file.name + '…');
    try {
      const dataUrl = await calFileToDataUrl(file);
      const res = await fetch('/api/calendar/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) { setSaveStatus(json.error || ('Upload failed: ' + file.name), true); continue; }
      calPendingMedia.push(json);
      calRenderPendingMedia();
      setSaveStatus('');
    } catch { setSaveStatus('Upload failed: ' + file.name, true); }
  }
}

function calFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function calRenderPendingMedia() {
  const el = document.getElementById('cal-ev-media-list');
  if (!el) return;
  el.innerHTML = calPendingMedia.map((m, i) => {
    const preview = m.type === 'image'
      ? `<img src="${esc(m.thumb || m.url)}">`
      : `<span class="cal-media-chip-icon">${m.type === 'audio' ? '🎵' : '🎬'}</span>`;
    return `<span class="cal-media-chip">${preview}<button type="button" onclick="calRemovePendingMedia(${i})">✕</button></span>`;
  }).join('');
}

function calRemovePendingMedia(i) {
  calPendingMedia.splice(i, 1);
  calRenderPendingMedia();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    calCloseEventModal();
    calCloseJumpModal();
  }
  if (e.key === 'Enter' && document.getElementById('gate').style.display !== 'none') authenticate();
});
