'use strict';

const FR_MONTHS = [
  { num:1,  name:'Hammer',    epithet:'Deepwinter' },
  { num:2,  name:'Alturiak',  epithet:'The Claw of Winter' },
  { num:3,  name:'Ches',      epithet:'The Claw of the Sunsets' },
  { num:4,  name:'Tarsakh',   epithet:'The Claw of the Storms' },
  { num:5,  name:'Mirtul',    epithet:'The Melting' },
  { num:6,  name:'Kythorn',   epithet:'The Time of Flowers' },
  { num:7,  name:'Flamerule', epithet:'Summertide' },
  { num:8,  name:'Eleasis',   epithet:'Highsun' },
  { num:9,  name:'Eleint',    epithet:'The Fading' },
  { num:10, name:'Marpenoth', epithet:'Leaffall' },
  { num:11, name:'Uktar',     epithet:'The Rotting' },
  { num:12, name:'Nightal',   epithet:'The Drawing Down' },
];

// Festival days; afterMonth = occurs after the last day of that month number
const FR_FESTIVALS = [
  { key:'midwinter',      name:'Midwinter',             afterMonth:1,  every4Years:false },
  { key:'greengrass',     name:'Greengrass',             afterMonth:4,  every4Years:false },
  { key:'midsummer',      name:'Midsummer',              afterMonth:7,  every4Years:false },
  { key:'shieldmeet',     name:'Shieldmeet',             afterMonth:7,  every4Years:true  },
  { key:'highharvestide', name:'Highharvestide',         afterMonth:9,  every4Years:false },
  { key:'feast_of_moon',  name:'The Feast of the Moon',  afterMonth:11, every4Years:false },
];

const FR_YEAR_NAMES = {
  1480:'Year of Storms', 1481:'Year of the Grinning Halfling',
  1482:'Year of the Stars Falling', 1483:'Year of the Tasked Weasel',
  1484:'Year of the Awakened Sleepers', 1485:"Year of the Iron Dwarf's Vengeance",
  1486:'Year of the Nether Mountain Scrolls', 1487:'Year of the Rune Lords Triumphant',
  1488:'Year of Dwarvenkind Reborn', 1489:'Year of the Warrior Princess',
  1490:"Year of the Star Walker's Return", 1491:'Year of the Scarlet Witch',
  1492:'Year of Three Ships Sailing', 1493:'Year of the Purple Dragons',
  1494:'Year of the Ageless One', 1495:'Year of the Pink Flumph',
  1496:'Year of the Nether Mountain Scrolls', 1497:"Year of the Triton's Horn",
  1498:'Year of the Leaning Post', 1499:'Year of the Smiling Halfling',
  1500:'Year of the New Age',
};

function frIsLeapYear(y) { return y % 4 === 0; }

function frYearName(y) {
  const n = FR_YEAR_NAMES[y];
  return n ? `${y} DR — ${n}` : `${y} DR`;
}

function frMonthName(num) { return FR_MONTHS.find(m => m.num === num)?.name || '?'; }

function frFestivalName(key) { return FR_FESTIVALS.find(f => f.key === key)?.name || key; }

function frFormatDate(d) {
  if (!d) return '—';
  if (d.frFestival) return `${frFestivalName(d.frFestival)}, ${d.frYear} DR`;
  return `${d.frDay} ${frMonthName(d.frMonth)}, ${d.frYear} DR`;
}

function frDatesEqual(a, b) {
  if (!a || !b) return false;
  if (a.frYear !== b.frYear) return false;
  if (a.frFestival || b.frFestival) return (a.frFestival || '') === (b.frFestival || '') && !a.frMonth && !b.frMonth;
  return a.frMonth === b.frMonth && a.frDay === b.frDay;
}

function frFestivalsAfterMonth(monthNum, year) {
  return FR_FESTIVALS.filter(f => {
    if (f.afterMonth !== monthNum) return false;
    if (f.every4Years && !frIsLeapYear(year)) return false;
    return true;
  });
}

// Ordered sequence of pages (months + festivals interleaved) for a given year
function frYearPages(year) {
  const pages = [];
  for (const m of FR_MONTHS) {
    pages.push({ type: 'month', month: m.num });
    for (const f of frFestivalsAfterMonth(m.num, year)) {
      pages.push({ type: 'festival', festival: f.key });
    }
  }
  return pages;
}

// Navigate view one step in direction (+1 forward / -1 back)
function frNavigate(view, dir) {
  const pages = frYearPages(view.year);
  const idx = pages.findIndex(p =>
    p.type === view.type &&
    (p.type === 'month' ? p.month === view.month : p.festival === view.festival)
  );
  if (idx === -1) return { ...frYearPages(view.year)[0], year: view.year };
  const next = idx + dir;
  if (next < 0) {
    const py = frYearPages(view.year - 1);
    return { ...py[py.length - 1], year: view.year - 1 };
  }
  if (next >= pages.length) {
    return { ...frYearPages(view.year + 1)[0], year: view.year + 1 };
  }
  return { ...pages[next], year: view.year };
}

// Convert a date object to its corresponding calendar view page
function frDateToView(d) {
  if (!d || !d.frYear) return { type: 'month', month: 1, year: 1492 };
  if (d.frFestival) return { type: 'festival', festival: d.frFestival, year: d.frYear };
  return { type: 'month', month: d.frMonth || 1, year: d.frYear };
}

// Advance one day forward in the FR calendar
function frNextDay(d) {
  const year = d.frYear;
  const pages = frYearPages(year);
  if (d.frFestival) {
    const pIdx = pages.findIndex(p => p.type === 'festival' && p.festival === d.frFestival);
    const next = pages[pIdx + 1];
    if (!next) return { frYear: year + 1, frMonth: 1, frDay: 1, frFestival: '' };
    if (next.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: next.festival };
    return { frYear: year, frMonth: next.month, frDay: 1, frFestival: '' };
  }
  if (d.frDay < 30) return { frYear: year, frMonth: d.frMonth, frDay: d.frDay + 1, frFestival: '' };
  const mIdx = pages.findIndex(p => p.type === 'month' && p.month === d.frMonth);
  const next = pages[mIdx + 1];
  if (!next) return { frYear: year + 1, frMonth: 1, frDay: 1, frFestival: '' };
  if (next.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: next.festival };
  return { frYear: year, frMonth: next.month, frDay: 1, frFestival: '' };
}

// Step one day backward in the FR calendar
function frPrevDay(d) {
  const year = d.frYear;
  const pages = frYearPages(year);
  if (d.frFestival) {
    const pIdx = pages.findIndex(p => p.type === 'festival' && p.festival === d.frFestival);
    if (pIdx <= 0) {
      const py = frYearPages(year - 1);
      const last = py[py.length - 1];
      if (last.type === 'festival') return { frYear: year - 1, frMonth: null, frDay: null, frFestival: last.festival };
      return { frYear: year - 1, frMonth: last.month, frDay: 30, frFestival: '' };
    }
    const prev = pages[pIdx - 1];
    if (prev.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: prev.festival };
    return { frYear: year, frMonth: prev.month, frDay: 30, frFestival: '' };
  }
  if (d.frDay > 1) return { frYear: year, frMonth: d.frMonth, frDay: d.frDay - 1, frFestival: '' };
  const mIdx = pages.findIndex(p => p.type === 'month' && p.month === d.frMonth);
  if (mIdx <= 0) {
    const py = frYearPages(year - 1);
    const last = py[py.length - 1];
    if (last.type === 'festival') return { frYear: year - 1, frMonth: null, frDay: null, frFestival: last.festival };
    return { frYear: year - 1, frMonth: last.month, frDay: 30, frFestival: '' };
  }
  const prev = pages[mIdx - 1];
  if (prev.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: prev.festival };
  return { frYear: year, frMonth: prev.month, frDay: 30, frFestival: '' };
}
