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
