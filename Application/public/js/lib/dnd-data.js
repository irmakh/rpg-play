// ── D&D 5e game data constants ────────────────────────────────────────────────

// Skill list (index matches data-key sk-N)
const SKILL_NAMES = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'
];

// Governing ability for each skill (same index order as SKILL_NAMES)
const SKILL_AB = ['dex','wis','int','str','cha','int','wis','cha','int','wis','int','wis','cha','cha','int','dex','dex','wis'];

// Ability score display names
const AB_NAMES = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };

// Saving throw display labels and data-key suffixes
const SAVE_NAMES = ['STR','DEX','CON','INT','WIS','CHA'];
const SAVE_KEYS  = ['str','dex','con','int','wis','cha'];

// D&D 5e conditions
const CONDITIONS = [
  'Blinded','Charmed','Deafened','Exhaustion','Fly','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned',
  'Prone','Restrained','Stunned','Unconscious'
];
const COND_ABBREV = {
  Blinded:'BLD', Charmed:'CHR', Deafened:'DEF', Exhaustion:'EXH', Fly:'FLY',
  Frightened:'FRI', Grappled:'GRP', Incapacitated:'INC', Invisible:'INV',
  Paralyzed:'PAR', Petrified:'PET', Poisoned:'POI', Prone:'PRN',
  Restrained:'RST', Stunned:'STN', Unconscious:'UNC'
};

// ── Item bonus targets & aggregation ──────────────────────────────────────────
// Equipped items may grant bonuses to saving throws, skills, and ability checks
// (alongside the dedicated AC / initiative / speed / spell fields). A bonus is
// { target, value }; target is one of the encoded strings below. The 'save-all',
// 'skill-all' and 'check-all' targets apply to every member of that group.
const ITEM_BONUS_GROUPS = [
  { label: 'Saving Throws',  opts: [['save-all',  'All Saves'],          ...SAVE_KEYS.map((k, i) => ['save-'  + k, SAVE_NAMES[i] + ' Save'])] },
  { label: 'Skills',         opts: [['skill-all', 'All Skills'],         ...SKILL_NAMES.map((n, i) => ['skill-' + i, n])] },
  { label: 'Ability Checks', opts: [['check-all', 'All Ability Checks'], ...SAVE_KEYS.map((k, i) => ['check-' + k, SAVE_NAMES[i] + ' Check'])] },
];

// Human-readable label for an encoded bonus target (used in item detail view).
function itemBonusTargetLabel(target) {
  for (const g of ITEM_BONUS_GROUPS) {
    const found = g.opts.find(o => o[0] === target);
    if (found) return found[1];
  }
  return target;
}

// Aggregate the bonuses of all EQUIPPED items into per-key totals.
// Returns { saves:{str…cha}, skills:{0…17}, checks:{str…cha} }.
function aggregateItemBonuses(itemList) {
  const totals = {
    saves:  { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    checks: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  };
  for (let i = 0; i < 18; i++) totals.skills[i] = 0;
  (itemList || []).forEach(it => {
    if (!it || !it.equipped || !Array.isArray(it.bonuses)) return;
    it.bonuses.forEach(b => {
      const v = parseInt(b && b.value) || 0;
      if (!v || !b || !b.target) return;
      const tg = b.target;
      if (tg === 'save-all')               SAVE_KEYS.forEach(k => totals.saves[k] += v);
      else if (tg.indexOf('save-')  === 0) { const k = tg.slice(5);            if (k in totals.saves)  totals.saves[k]  += v; }
      else if (tg === 'skill-all')         { for (let i = 0; i < 18; i++) totals.skills[i] += v; }
      else if (tg.indexOf('skill-') === 0) { const i = parseInt(tg.slice(6));  if (i >= 0 && i < 18)   totals.skills[i] += v; }
      else if (tg === 'check-all')         SAVE_KEYS.forEach(k => totals.checks[k] += v);
      else if (tg.indexOf('check-') === 0) { const k = tg.slice(6);            if (k in totals.checks) totals.checks[k] += v; }
    });
  });
  return totals;
}
