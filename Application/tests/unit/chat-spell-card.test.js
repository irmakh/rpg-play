// Written by Irmak Hakman — 2026-11-11 22:35
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The spell card in chat (chatSpellCardHTML / spellCardRoll in
 * js/lib/chat-render.js): every field escaped, and roll buttons only for the
 * caster and the DM. Loaded as the real scripts in a vm. Node has no
 * DOMParser, so sanitizeChatHtml (tested on its own in chat-html.test.js) is
 * replaced by a marker here.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public/js', p), 'utf-8');
const BAD = '<img src=x onerror=alert(1)>';
const QUOTE = "x');alert(1);('";

function page(globals = {}) {
  const ctx = createContext({ console, document: { getElementById: () => null }, CSS: { escape: s => s }, ...globals });
  runInContext(read('lib/esc.js'), ctx);
  runInContext(read('lib/chat-render.js'), ctx);
  runInContext('sanitizeChatHtml = () => "[sanitised]";', ctx);
  return ctx;
}

const card = (o = {}) => ({
  id: 'e1', type: 'spell', sender: BAD, charId: 'wiz',
  spell: { name: BAD, level: 3, castLevel: 5, mode: 'slot', school: BAD, castText: BAD, range: BAD, duration: BAD, conc: true, components: BAD },
  desc: BAD, attack: 'ranged', attackBonus: QUOTE, save: BAD, saveDc: BAD, damage: BAD, damageType: BAD,
  ...o,
});

describe('chatSpellCardHTML', () => {
  it('escapes every field and runs the description through the sanitiser', () => {
    const ctx = page({ isDM: () => true, qroll: () => {} });
    const html = ctx.chatSpellCardHTML(card());
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i);
    expect(html).toContain('[sanitised]');
    expect(html).toContain('at level 5');
    expect(html).toContain("spellCardRoll('e1','attack')");
  });

  it('gives the caster and the DM buttons, and everyone else plain text', () => {
    const asDm = page({ isDM: () => true, qroll: () => {} }).chatSpellCardHTML(card({ attackBonus: '+7', damage: '8d6', damageType: 'fire', save: null }));
    expect(asDm).toContain('class="cs-btn"');
    const asCaster = page({ isDM: () => false, sessionCharId: 'wiz', qroll: () => {} }).chatSpellCardHTML(card());
    expect(asCaster).toContain('class="cs-btn"');
    const asOther = page({ isDM: () => false, sessionCharId: 'someone', qroll: () => {} }).chatSpellCardHTML(card());
    expect(asOther).not.toContain('cs-btn');
    expect(asOther).toContain('cs-fact');
    const noDice = page({ isDM: () => true }).chatSpellCardHTML(card());   // a page that cannot roll
    expect(noDice).not.toContain('cs-btn');
  });

  it('says how the spell was cast', () => {
    const ctx = page();
    expect(ctx.chatSpellCardHTML(card({ spell: { name: 'Detect Magic', level: 1, castLevel: 1, mode: 'ritual' } }))).toContain('as a ritual');
    expect(ctx.chatSpellCardHTML(card({ spell: { name: 'Misty Step', level: 2, castLevel: 2, mode: 'free' } }))).toContain('without a slot');
    expect(ctx.chatSpellCardHTML(card({ spell: { name: 'Light', level: 0, castLevel: 0, mode: 'cantrip', school: 'Evocation' } }))).toContain('Evocation cantrip');
  });
});

describe('spellCardRoll', () => {
  it('rolls the attack and the damage through the page\'s own dice', () => {
    const calls = [];
    const ctx = page({ isDM: () => true, qroll: (l, m) => calls.push(['qroll', l, m]), rollDamageStr: (l, e) => calls.push(['dmg', l, e]) });
    ctx.chatSpellCardHTML(card({ spell: { name: 'Fire Bolt', level: 0 }, attackBonus: '7', damage: '2d10', damageType: 'fire' }));
    ctx.spellCardRoll('e1', 'attack');
    ctx.spellCardRoll('e1', 'damage');
    expect(calls).toEqual([['qroll', 'Fire Bolt (Spell Attack)', '+7'], ['dmg', 'Fire Bolt Damage', '2d10 fire']]);
  });
  it('rolls healing without a damage type, and ignores a card it never drew', () => {
    const calls = [];
    const ctx = page({ isDM: () => true, startRoll: () => {}, rollDamage: (l, e) => calls.push([l, e]) });
    ctx.chatSpellCardHTML(card({ id: 'h', spell: { name: 'Cure Wounds', level: 1 }, damage: '2d8', damageType: 'healing', healing: true }));
    ctx.spellCardRoll('h', 'damage');
    ctx.spellCardRoll('missing', 'damage');
    expect(calls).toEqual([['Cure Wounds Healing', '2d8']]);
  });
});
