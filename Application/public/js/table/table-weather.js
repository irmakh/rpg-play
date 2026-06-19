// ── Table-screen weather widget ───────────────────────────────────────────────
// Shows the weather for the current campaign date in the top toolbar. Reads the
// calendar state (to know "today") + the public weather log, and refreshes when
// the DM rolls/sets weather (calendar-updated SSE). Icon/tooltip helpers live in
// js/lib/weather-ui.js.

let _tableWeatherToday = null;

async function loadTableWeather() {
  try {
    const [stateRes, logRes] = await Promise.all([
      fetch('/api/calendar/state?_=' + Date.now()),
      fetch('/api/weather/log?_=' + Date.now()),
    ]);
    const state = stateRes.ok ? await stateRes.json() : null;
    const log   = logRes.ok ? await logRes.json() : [];
    const key   = state ? weatherDateKey(state) : '';
    _tableWeatherToday = log.find(e => e.id === key) || null;
  } catch { _tableWeatherToday = null; }
  renderTableWeather();
}

function renderTableWeather() {
  const bar = document.getElementById('wx-toolbar');
  if (!bar) return;
  const e = _tableWeatherToday;
  if (!e) { bar.style.display = 'none'; return; }
  document.getElementById('wx-toolbar-icons').innerHTML = weatherIconsHTML(e, 22);
  document.getElementById('wx-toolbar-text').textContent = `${e.temperature.value}°`;
  bar.style.display = 'inline-flex';
}
