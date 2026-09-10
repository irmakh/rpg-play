/**
 * Unit tests for characterToXML() in index-char.js — the per-character XML export.
 *
 * Verifies the newer character fields added in later sessions survive export:
 *   - spell action category (s[13]) and duration (s[14]) as <spell> attributes
 *   - custom actions (_actions / _actionIdCounter) as an <actions> block
 *
 * The companion importer xmlToCharacterData() relies on DOMParser, which is not
 * available in the node test environment, so only the export side (pure string
 * building) is covered here. applyData() tests already verify that [13]/[14] and
 * _actions render correctly once present in the data object.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC  = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');
const CHAR_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-char.js'), 'utf-8');

function extractFunction(src, name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m  = re.exec(src);
  if (!m) throw new Error(`Function "${name}" not found — was it renamed?`);
  let depth = 0, i = m.index;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return src.slice(m.index, i + 1);
}

const FN_SRC = extractFunction(CHAR_SRC, 'characterToXML');

function load({ items = [], itemIdCounter = 0 } = {}) {
  const ctx = createContext({
    items: items.map(i => ({ ...i })),
    itemIdCounter,
    // SKILL_AB drives the <skills> loop — index list is irrelevant to these tests.
    SKILL_AB: ['str','dex','con','int','wis','cha','int','wis','cha','dex','wis','cha','cha','int','wis','wis','cha','dex'],
    JSON, String,
  });
  runInContext(ESC_SRC, ctx);
  runInContext(FN_SRC,  ctx);
  return ctx.characterToXML;
}

describe('characterToXML — spell action category & duration', () => {
  it('writes action and duration attributes on the spell tag', () => {
    const characterToXML = load();
    const spell = ['1', 'Entangle', 'Action', '90 ft', true, false, 'Restrains', true,
                   'Conj', true, true, false, '', 'action', 'Concentration, 1 minute'];
    const xml = characterToXML({ _spells: JSON.stringify([spell]) });
    expect(xml).toContain('action="action"');
    expect(xml).toContain('duration="Concentration, 1 minute"');
    expect(xml).toContain('<name>Entangle</name>');
  });

  it('emits empty action/duration attributes for legacy spells without them', () => {
    const characterToXML = load();
    const spell = ['0', 'Fire Bolt', 'Action', '120 ft', false, false, '', false, 'Evoc'];
    const xml = characterToXML({ _spells: JSON.stringify([spell]) });
    expect(xml).toContain('action=""');
    expect(xml).toContain('duration=""');
  });
});

describe('characterToXML — custom actions block', () => {
  it('writes an <actions> block with idCounter and each custom action', () => {
    const characterToXML = load();
    const actions = [
      { id: 1, name: 'Second Wind', category: 'bonus', dice: '1d10+5', uses: 1, used: 0, recharge: 'short', description: 'Regain HP' },
      { id: 2, name: 'Action Surge', category: 'other', dice: '', uses: 1, used: 1, recharge: 'short', description: '' },
    ];
    const xml = characterToXML({ _actions: JSON.stringify(actions), _actionIdCounter: 2 });
    expect(xml).toContain('<actions idCounter="2">');
    expect(xml).toContain('id="1" category="bonus" dice="1d10+5" uses="1" used="0" recharge="short"');
    expect(xml).toContain('<name>Second Wind</name>');
    expect(xml).toContain('id="2" category="other"');
    expect(xml).toContain('<name>Action Surge</name>');
  });

  it('emits an empty <actions> block when the character has no custom actions', () => {
    const characterToXML = load();
    const xml = characterToXML({ _actions: '[]', _actionIdCounter: 0 });
    expect(xml).toContain('<actions idCounter="0">');
    expect(xml).toContain('</actions>');
  });

  it('escapes special characters in action description and name', () => {
    const characterToXML = load();
    const actions = [{ id: 1, name: 'Bite & Claw', category: 'action', description: 'Deal <fire> damage', dice: '', uses: 0, used: 0, recharge: '' }];
    const xml = characterToXML({ _actions: JSON.stringify(actions) });
    expect(xml).toContain('Bite &amp; Claw');
    expect(xml).toContain('<![CDATA[Deal <fire> damage]]>');
  });
});

// ── Regression: fields that used to be dropped by the exporter ────────────────
describe('characterToXML — speed_base survives export', () => {
  it('writes speed_base alongside the computed speed and the bonus', () => {
    const characterToXML = load();
    const xml = characterToXML({ speed: '40 ft', 'speed-base': '30', 'speed-bonus': '10' });
    expect(xml).toContain('<speed>40 ft</speed>');
    expect(xml).toContain('<speed_base>30</speed_base>');
    expect(xml).toContain('<speed_bonus>10</speed_bonus>');
  });

  /**
   * <speed> is the COMPUTED total. Exporting only that made applyData()'s
   * "derive base from speed" fallback treat the total as the base, so speed grew
   * by the bonus on every export/import cycle (30+10: 40 -> 50 -> 60 -> 70).
   * The base must be written as its own element, not folded into the total.
   */
  it('does not conflate the base with the computed total', () => {
    const characterToXML = load();
    const xml = characterToXML({ speed: '40 ft', 'speed-base': '30', 'speed-bonus': '10' });
    expect(xml).not.toContain('<speed_base>40');
  });

  it('still emits speed_base when the character has no bonus', () => {
    const characterToXML = load();
    const xml = characterToXML({ speed: '30 ft', 'speed-base': '30', 'speed-bonus': '0' });
    expect(xml).toContain('<speed_base>30</speed_base>');
  });

  it('emits an empty speed_base rather than omitting it when unset', () => {
    const characterToXML = load();
    expect(characterToXML({ speed: '30 ft' })).toContain('<speed_base></speed_base>');
  });
});

describe('characterToXML — item value survives export', () => {
  const item = {
    id: 1, name: 'Flame Tongue', itemType: 'weapon', value: '500 gp',
    weaponAtk: 1, weaponDmg: '1d8 slashing, 2d6 fire', weaponProperties: ['Versatile'],
    armorType: '', acBase: 10, equipped: true, requiresAttunement: true, attuned: true,
    acBonus: 0, initBonus: 0, speedBonus: 0, spellAtkBonus: 0, spellDcBonus: 0,
    bonuses: [], notes: 'hums faintly',
  };

  it('writes the item value attribute', () => {
    const xml = load({ items: [item] })({});
    expect(xml).toContain('value="500 gp"');
  });

  it('escapes a value containing markup characters', () => {
    const xml = load({ items: [{ ...item, value: '5 "gp" & <rare>' }] })({});
    expect(xml).toContain('value="5 &quot;gp&quot; &amp; &lt;rare&gt;"');
  });

  it('emits an empty value attribute when the item has none', () => {
    const { value, ...noValue } = item;
    expect(load({ items: [noValue] })({})).toContain('value=""');
  });

  it('preserves an empty armorType instead of defaulting it on export', () => {
    expect(load({ items: [item] })({})).toContain('armorType=""');
  });

  it('keeps a multi-type damage string intact', () => {
    expect(load({ items: [item] })({})).toContain('weaponDmg="1d8 slashing, 2d6 fire"');
  });
});
