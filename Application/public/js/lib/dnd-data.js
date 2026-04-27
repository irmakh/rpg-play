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
  'Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned',
  'Prone','Restrained','Stunned','Unconscious'
];
const COND_ABBREV = {
  Blinded:'BL', Charmed:'CH', Deafened:'DF', Exhaustion:'EX', Frightened:'FR',
  Grappled:'GR', Incapacitated:'IC', Invisible:'IV', Paralyzed:'PA', Petrified:'PT',
  Poisoned:'PO', Prone:'PR', Restrained:'RS', Stunned:'ST', Unconscious:'UC'
};
