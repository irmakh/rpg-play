// ── Shared weather UI helpers ─────────────────────────────────────────────────
// Used by events.html (DM calendar), index.html (player calendar tab) and
// table.html (toolbar widget). Provides: date keys, sprite-icon HTML, a summary
// string, and a singleton floating tooltip driven from inline cell handlers.

const WX_LEVEL_LABEL = { normal: 'Normal', level1: 'Level 1', level2: 'Level 2' };

// Registry of weather entries by date key, set per page before rendering a grid.
let _wxReg = {};
function weatherSetRegistry(map) { _wxReg = map || {}; }
function weatherGet(key) { return _wxReg[key] || null; }

function weatherDateKey(d) {
  if (!d) return '';
  if (d.frFestival) return `${d.frYear}-F-${d.frFestival}`;
  return `${d.frYear}-${d.frMonth}-${d.frDay}`;
}

function _wxEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function weatherTempIconClass(e) {
  const l = e.temperature.level;
  return l === 'level2' ? 'wx-hot' : l === 'level1' ? 'wx-cold' : 'wx-normal';
}
function weatherPrecipIconClass(e) {
  const v = String(e.precipitation.value || '').toLowerCase();
  if (v.includes('snow')) return 'wx-snow';
  if (v.includes('rain')) return 'wx-rain';
  return '';
}
function weatherWindIconClass(e) {
  return (e.wind.value && e.wind.value !== 'Normal') ? 'wx-wind' : '';
}

// A single sprite glyph (cropped from /img/weather.png via .wx-* classes in
// weather.css) at an arbitrary pixel size (CSS-scales the 48px tile).
function weatherIconSpan(cls, px) {
  const s = (px / 48).toFixed(4);
  return `<span class="wx-mark" style="width:${px}px;height:${px}px">`
    + `<span class="wx-ico ${cls}" style="transform:scale(${s});transform-origin:0 0"></span></span>`;
}

// The set of icons that apply to a day: temperature always, plus precip / wind.
function weatherIconsHTML(e, px) {
  const out = [weatherIconSpan(weatherTempIconClass(e), px)];
  const p = weatherPrecipIconClass(e); if (p) out.push(weatherIconSpan(p, px));
  const w = weatherWindIconClass(e);   if (w) out.push(weatherIconSpan(w, px));
  return out.join('');
}

function weatherSummary(e) {
  return `${e.temperature.value}° · ${e.wind.value} · ${e.precipitation.value}`;
}

function weatherTooltipHTML(e) {
  const lbl = e.dateLabel || '';
  const tl = WX_LEVEL_LABEL[e.temperature.level] || '';
  return `<div class="wx-tip-date">🌦 ${_wxEsc(lbl)}</div>`
    + `<div class="wx-tip-icons">${weatherIconsHTML(e, 40)}</div>`
    + `<div class="wx-tip-row"><span class="wx-tip-lbl">🌡 Temperature</span><span class="wx-tip-val">${_wxEsc(e.temperature.value)}° <small style="opacity:.6">${_wxEsc(tl)}</small></span></div>`
    + `<div class="wx-tip-row"><span class="wx-tip-lbl">💨 Wind</span><span class="wx-tip-val">${_wxEsc(e.wind.value)}</span></div>`
    + `<div class="wx-tip-row"><span class="wx-tip-lbl">🌧 Precipitation</span><span class="wx-tip-val">${_wxEsc(e.precipitation.value)}</span></div>`;
}

// ── Singleton floating tooltip ────────────────────────────────────────────────
function _wxTipEl() {
  let el = document.getElementById('wx-tooltip');
  if (!el) { el = document.createElement('div'); el.id = 'wx-tooltip'; document.body.appendChild(el); }
  return el;
}
function weatherShowTipEntry(evt, e) {
  if (!e) return;
  const el = _wxTipEl();
  el.innerHTML = weatherTooltipHTML(e);
  el.style.display = 'block';
  weatherMoveTip(evt);
}
// Inline-handler entry point: looks the entry up in the registry by date key.
function weatherCellTip(evt, key) {
  weatherShowTipEntry(evt, weatherGet(key));
}
function weatherMoveTip(evt) {
  const el = document.getElementById('wx-tooltip');
  if (!el || el.style.display === 'none') return;
  const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8)  x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  el.style.left = Math.max(4, x) + 'px';
  el.style.top  = Math.max(4, y) + 'px';
}
function weatherHideTip() {
  const el = document.getElementById('wx-tooltip');
  if (el) el.style.display = 'none';
}

// A calendar-cell marker (small temp icon) with hover handlers. `key` must be a
// key present in the page registry.
function weatherDayMarkHTML(e, key) {
  return `<span class="wx-day-mark" onmouseenter="weatherCellTip(event,'${key}')" `
    + `onmousemove="weatherMoveTip(event)" onmouseleave="weatherHideTip()">`
    + weatherIconSpan(weatherTempIconClass(e), 18) + `</span>`;
}
