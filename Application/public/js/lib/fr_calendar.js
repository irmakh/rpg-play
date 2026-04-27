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
  1500:"Year of the Sea's Secrets Revealed",
  1501:'Year of the Shining Mythal', 1502:'Year of the Pox Plague',
  1503:'Year of the Haunted Inn', 1504:'Year of the Conquering Queen',
  1505:'Year of the Ogres Marching', 1506:'Year of the Discarded Shields',
  1507:'Year of the Glowing Onyx', 1508:'Year of the Legend Reborn',
  1509:'Year of the Sea Lion', 1510:'Year of the Treasure Abandoned',
  1511:'Year of the Lion Rampant', 1512:'Year of the Shattered Mirror',
  1513:'Year of the Tawny Feline', 1514:'Year of the Lost Wagers',
  1515:'Year of the Howling Ghouls', 1516:"Year of the Hangman's Joke",
  1517:'Year of the Coward Rewarded', 1518:'Year of the Adomal Tapestry',
  1519:'Year of the Deceitful Brother', 1520:'Year of the Arcane',
  1521:'Year of the Moon Harp Restored', 1522:'Year of the Bored Phylls',
  1523:"Year of the Brownie's Delight", 1524:'Year of the Captive Harper',
  1525:'Year of the Drawn Line', 1526:'Year of the Hazy Coast',
  1527:'Year of the Hoard Retaken', 1528:'Year of the Insufferable Mystic',
  1529:"Year of the Horseman's Triumph", 1530:'Year of the Long-toothed Tiger',
  1531:'Year of the Oozing Bog', 1532:'Year of the Locked Crypt',
  1533:'Year of the Mishapen Mage', 1534:'Year of the Pale Lords',
  1535:'Year of the Laurel Wreath', 1536:'Year of the Mirrored Face',
  1537:"Year of the Jungle's Vengeance", 1538:'Year of the Stalking Tiger',
  1539:'Year of the Thoughtless Suitor', 1540:'Year of the Lifeless Archdruid',
  1541:'Year of the Mirthful House', 1542:'Year of the Painted Grin',
  1543:'Year of the Sacred Sceptre', 1544:'Year of the Shadow Fiends',
  1545:'Year of the Undying March', 1546:'Year of the Winter Rose',
  1547:'Year of the Dungeons Reclaimed', 1548:'Year of the Handsome Deal',
  1549:'Year of the Meandering Archipelago', 1550:'Year of the Scarlet Tabard',
  1551:'Year of the Misty Grave', 1552:'Year of the Overflowing Cup',
  1553:'Year of the Request', 1554:'Year of the Dark Chosen',
  1555:'Year of the Argent Scarab', 1556:'Year of the Stone Steps',
  1557:'Year of the Murdered Sage', 1558:'Year of the Watchful Guardian',
  1559:"Year of the Shepherd's Son", 1560:"Year of the Trees' Receding",
  1561:'Year of the Wild Hunt', 1562:'Year of the Pointing Finger',
  1563:'Year of the Starlit Necklace', 1564:'Year of the Slaughtered Lamb',
  1565:'Year of the Unkindest Cut', 1566:'Year of the Weasel',
  1567:'Year of the Sacred Lash', 1568:'Year of the Studious Enchanter',
  1569:'Year of the Turned Page', 1570:'Year of the Vacant Cairn',
  1571:'Year of the Red Mantle', 1572:'Year of the Stingray',
  1573:'Year of the Wicked Jailor', 1574:'Year of the Rebuked Storm',
  1575:'Year of the Twin Pavilions', 1576:'Year of the Vanishing Throne',
  1577:'Year of the Whispering Hood', 1578:'Year of the Steadfast Patrol',
  1579:'Year of the Underking', 1580:"Year of the Widow's Tears",
  1581:'Year of the Rings', 1582:'Year of the Howling Winds',
  1583:'Year of the Decay', 1584:'Year of the Skirling Pipes',
  1585:'Year of the Bloodied Manacles', 1586:'Year of the Pax Draconomica',
  1587:'Year of the Long Silence', 1588:'Year of the Swarming Ravens',
  1589:'Year of the Watching Ancestors', 1590:'Year of the Coming Twilight',
  1591:'Year of the Skeletons', 1592:'Year of the Dying Hate',
  1593:'Year of the Rising Stars', 1594:'Year of the Fragrant Orchards',
  1595:'Year of the Raging Baatezu', 1596:'Year of the Heavenly Scriptures',
  1597:'Year of the Stolen Gold', 1598:'Year of the Doom Cauldron',
  1599:'Year of the Black Pearls', 1600:'Year of the Unseen Enemies',
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
