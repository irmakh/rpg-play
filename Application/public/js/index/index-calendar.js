// ── Player Calendar ───────────────────────────────────────────────────────────
let pcalView        = { type: 'month', month: 1, year: 1492 };
let pcalCurrentDate = { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
let pcalEvents      = [];
let pcalLoaded      = false;
let pcalSelectedDay = null; // { month, day } or { festival } when a cell is clicked

async function pcalLoad() {
  if (pcalLoaded) return;
  pcalLoaded = true;
  await pcalFetch();
}

async function pcalFetch() {
  try {
    const [stateRes, evRes] = await Promise.all([
      fetch('/api/calendar/state?_=' + Date.now()),
      fetch('/api/calendar/events?_=' + Date.now()),
    ]);
    if (stateRes.ok) pcalCurrentDate = await stateRes.json();
    if (evRes.ok)    pcalEvents       = await evRes.json();
  } catch {}
  pcalView = frDateToView(pcalCurrentDate);
  pcalRender();
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
    area.innerHTML = `
      <div class="cal-festival-row${isToday?' cal-is-today':''}${isSelected?' cal-is-today':''}"
           onclick="pcalDayClick(null,'${pcalView.festival}')" style="cursor:pointer">
        <span class="cal-fest-icon">✦</span>
        <span class="cal-fest-name">${esc(fest ? fest.name : pcalView.festival)}</span>
        ${dots ? `<div class="cal-fest-dots">${dots}</div>` : ''}
        ${isToday ? '<span class="cal-fest-mark">Today</span>' : ''}
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
      cells += `
        <td class="${classes}" onclick="pcalDayClick(${day},null)">
          <span class="cal-day-num">${day}</span>
          ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
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
    return `
      <div class="cal-event-item">
        <div class="cal-event-info">
          <div class="cal-event-title">${esc(e.title)}</div>
          <div class="cal-event-date">${esc(dateStr)} &middot; ${esc(e.eventType)}</div>
          ${e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
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
