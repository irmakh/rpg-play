// Written by Irmak Hakman — 2026-10-28 15:19
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for the pure helpers at the top of js/table/table-ux.js.
 *
 * The rest of that file wires listeners onto the live map and wraps functions
 * of the other table modules, so it cannot be loaded without the whole page.
 * The helpers are kept together above the "Remembered settings" marker exactly
 * so this test can run that slice - the real production code - on its own. If
 * the marker is renamed, the slice is empty and loading throws loudly.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public', p), 'utf-8');

const UX = read('js/table/table-ux.js');
const MARK = '// ── Remembered settings';
if (!UX.includes(MARK)) throw new Error('table-ux.js: "Remembered settings" marker not found');
const PURE = UX.slice(0, UX.indexOf(MARK));

// The helpers lean on the real esc()/escJs(), the real condition list and the
// real HP colours, so those are loaded from their own files, not re-typed here.
function load() {
  const ctx = createContext({ console });
  runInContext(read('js/lib/esc.js'), ctx);
  runInContext(read('js/lib/dnd-data.js'), ctx);
  runInContext(
    'function parseConditions(raw){ if(!raw) return []; if(Array.isArray(raw)) return raw; try { return JSON.parse(raw); } catch { return []; } }'
    + 'function hpBarColor(p){ return p >= 0.5 ? "green" : "red"; }',
    ctx
  );
  runInContext(PURE + '\n;globalThis.__ux = { uxWheelZoom, uxPinchZoom, uxParseHp, uxHpAfter, uxToolForKey, uxKeyForTool, uxHintText, uxSeesStats, uxHoverHTML, uxCondsHTML, uxTokenMenuHTML, uxTokenPicture, uxPictureMenuHTML };', ctx);
  return ctx.__ux;
}
const ux = load();

// Anything typed by a person must reach the page as text.
const EVIL = `<img src=x onerror=alert(1)>'"`;
function expectInert(html) {
  expect(html).not.toContain('<img');
  expect(html).not.toMatch(/onerror=alert\(1\)>/);
}

describe('uxWheelZoom', () => {
  it('zooms in when the wheel rolls away from you, out when it rolls toward you', () => {
    expect(ux.uxWheelZoom(100, -100, 0)).toBeGreaterThan(100);
    expect(ux.uxWheelZoom(100, 100, 0)).toBeLessThan(100);
  });

  it('moves about 15% for one mouse notch', () => {
    expect(ux.uxWheelZoom(100, -100, 0)).toBe(116);
    expect(ux.uxWheelZoom(100, 100, 0)).toBe(86);
  });

  it('still moves 1% on the smallest trackpad tick', () => {
    expect(ux.uxWheelZoom(100, -1, 0)).toBe(101);
    expect(ux.uxWheelZoom(100, 1, 0)).toBe(99);
  });

  it('reads a Firefox line-mode notch like a pixel-mode one', () => {
    expect(ux.uxWheelZoom(100, -3, 1)).toBe(ux.uxWheelZoom(100, -99, 0));
  });

  it('stays inside the slider\'s 50-200% range', () => {
    expect(ux.uxWheelZoom(195, -500, 0)).toBe(200);
    expect(ux.uxWheelZoom(52, 500, 0)).toBe(50);
    expect(ux.uxWheelZoom(200, -100, 0)).toBe(200);
  });

  it('does nothing for a wheel event with no vertical movement', () => {
    expect(ux.uxWheelZoom(130, 0, 0)).toBe(130);
  });
});

describe('uxPinchZoom', () => {
  it('scales the zoom by how far the fingers have spread', () => {
    expect(ux.uxPinchZoom(100, 200, 300)).toBe(150);
    expect(ux.uxPinchZoom(100, 200, 150)).toBe(75);
  });

  it('stays inside 50-200%', () => {
    expect(ux.uxPinchZoom(150, 100, 400)).toBe(200);
    expect(ux.uxPinchZoom(80, 400, 100)).toBe(50);
  });

  it('keeps the zoom when the fingers start on the same spot', () => {
    expect(ux.uxPinchZoom(120, 0, 50)).toBe(120);
  });
});

describe('uxParseHp', () => {
  it('reads a bare number as damage', () => {
    expect(ux.uxParseHp('7')).toEqual({ mode: 'dmg', amount: 7 });
    expect(ux.uxParseHp(' 12 ')).toEqual({ mode: 'dmg', amount: 12 });
  });

  it('reads a minus sign as damage too', () => {
    expect(ux.uxParseHp('-7')).toEqual({ mode: 'dmg', amount: 7 });
  });

  it('reads a plus sign as healing', () => {
    expect(ux.uxParseHp('+7')).toEqual({ mode: 'heal', amount: 7 });
    expect(ux.uxParseHp('+ 7')).toEqual({ mode: 'heal', amount: 7 });
  });

  it('refuses zero, nothing, words, fractions and absurd lengths', () => {
    for (const bad of ['', '0', '+0', '+', '-', 'seven', '7.5', '1e3', '12345', '7 8', null, undefined]) {
      expect(ux.uxParseHp(bad)).toBeNull();
    }
  });
});

describe('uxHpAfter follows the side panel\'s HP rules', () => {
  const tok = { hpCurrent: 20, hpMax: 30, hpTemp: 5 };

  it('takes damage out of temporary HP first', () => {
    expect(ux.uxHpAfter(tok, 'dmg', 3)).toEqual({ hpCurrent: 20, hpTemp: 2 });
    expect(ux.uxHpAfter(tok, 'dmg', 8)).toEqual({ hpCurrent: 17, hpTemp: 0 });
  });

  it('stops at 0', () => {
    expect(ux.uxHpAfter(tok, 'dmg', 999)).toEqual({ hpCurrent: 0, hpTemp: 0 });
  });

  it('heals up to the maximum and leaves temporary HP alone', () => {
    expect(ux.uxHpAfter(tok, 'heal', 4)).toEqual({ hpCurrent: 24 });
    expect(ux.uxHpAfter(tok, 'heal', 999)).toEqual({ hpCurrent: 30 });
  });

  it('copes with a token that has no HP fields yet', () => {
    expect(ux.uxHpAfter({}, 'dmg', 5)).toEqual({ hpCurrent: 0, hpTemp: 0 });
    expect(ux.uxHpAfter({}, 'heal', 5)).toEqual({ hpCurrent: 0 });
  });
});

describe('tool keys', () => {
  it('gives every tool one key, in either case', () => {
    expect(ux.uxToolForKey('v', false)).toBe('move');
    expect(ux.uxToolForKey('H', false)).toBe('pan');
    expect(ux.uxToolForKey('r', false)).toBe('ruler');
    expect(ux.uxToolForKey('p', false)).toBe('ping');
    expect(ux.uxToolForKey('d', false)).toBe('draw');
  });

  it('keeps multi-select for the DM', () => {
    expect(ux.uxToolForKey('m', true)).toBe('multi');
    expect(ux.uxToolForKey('m', false)).toBeNull();
  });

  it('ignores every other key', () => {
    for (const k of ['x', '1', ' ', 'Enter', '', undefined]) expect(ux.uxToolForKey(k, true)).toBeNull();
  });

  it('never claims the turn keys or the roll pop-up\'s A and N', () => {
    for (const k of ['a', 'n', 'b']) expect(ux.uxToolForKey(k, true)).toBeNull();
  });

  it('names the key for a tool', () => {
    expect(ux.uxKeyForTool('move')).toBe('V');
    expect(ux.uxKeyForTool('multi')).toBe('M');
    expect(ux.uxKeyForTool('nothing')).toBe('');
  });
});

describe('uxHintText', () => {
  it('has a line for every tool', () => {
    for (const tool of ['move', 'pan', 'ruler', 'ping', 'draw', 'multi']) {
      expect(ux.uxHintText(tool, {}).length).toBeGreaterThan(10);
    }
  });

  it('talks about the selected token, and about damage only to someone who may change it', () => {
    expect(ux.uxHintText('move', { selected: 'G3', canEdit: true })).toContain('type a number');
    const other = ux.uxHintText('move', { selected: 'G3', canEdit: false });
    expect(other).toContain('G3');
    expect(other).not.toContain('type a number');
  });

  it('does not mention the mouse on a touch screen', () => {
    const t = ux.uxHintText('move', { touch: true });
    expect(t).toContain('pinch');
    expect(t).not.toContain('wheel');
    expect(t).not.toContain('right-click');
  });
});

describe('uxHoverHTML', () => {
  const pc = { type: 'character', hpCurrent: 12, hpMax: 20, hpTemp: 3, ac: 16, speed: 30, movedFt: 10, conditions: '["Prone"]' };
  const goblin = { type: 'monster', hpCurrent: 4, hpMax: 7, ac: 15, speed: 30, conditions: '["Poisoned"]' };

  it('shows a character\'s numbers to everyone', () => {
    const h = ux.uxHoverHTML(pc, { name: 'Vex', dm: false });
    expect(h).toContain('12 / 20');
    expect(h).toContain('+3 temp');
    expect(h).toContain('>16<');
    expect(h).toContain('Prone');
  });

  it('hides a monster\'s HP, AC and speed from players but not its conditions', () => {
    const h = ux.uxHoverHTML(goblin, { name: 'G3', dm: false });
    expect(h).not.toContain('4 / 7');
    expect(h).not.toContain('AC');
    expect(h).not.toContain('Speed');
    expect(h).toContain('G3');
    expect(h).toContain('Poisoned');
  });

  it('shows the DM everything about a monster', () => {
    const h = ux.uxHoverHTML({ ...goblin, visible: false }, { name: 'G3', dm: true });
    expect(h).toContain('4 / 7');
    expect(h).toContain('>15<');
    expect(h).toContain('Hidden from players');
  });

  it('shows a monster a player controls like a character', () => {
    expect(ux.uxHoverHTML({ ...goblin, assignedCharId: 'c1' }, { name: 'Wolf', dm: false })).toContain('4 / 7');
  });

  it('shows movement used during a fight, speed otherwise', () => {
    expect(ux.uxHoverHTML(pc, { name: 'Vex', inCombat: true })).toContain('10 of 30 ft');
    expect(ux.uxHoverHTML(pc, { name: 'Vex', inCombat: false })).toContain('30 ft');
  });

  it('never says "hidden" to a player', () => {
    expect(ux.uxHoverHTML({ ...pc, visible: false }, { name: 'Vex', dm: false })).not.toContain('Hidden');
  });

  it('keeps names, owners, conditions and AC as text', () => {
    const h = ux.uxHoverHTML(
      { type: 'character', hpCurrent: 1, hpMax: 1, ac: EVIL, conditions: JSON.stringify([EVIL]) },
      { name: EVIL, owner: EVIL, dm: true }
    );
    expectInert(h);
  });
});

describe('token pictures', () => {
  const uploaded = { id: 't1', type: 'monster', portrait: '/uploads/c/tokens/a.png', portraitThumb: '/uploads/c/tokens/a_thumb.webp' };

  it('opens the original, and shows the 500px copy in the card', () => {
    expect(ux.uxTokenPicture(uploaded)).toEqual({ full: '/uploads/c/tokens/a.png', view: '/uploads/c/tokens/a_medium.webp' });
  });

  it('uses the original for a picture with no sized copies', () => {
    const p = ux.uxTokenPicture({ portrait: 'data:image/png;base64,AAAA' });
    expect(p).toEqual({ full: 'data:image/png;base64,AAAA', view: 'data:image/png;base64,AAAA' });
  });

  it('has nothing for a token without a picture', () => {
    expect(ux.uxTokenPicture({ type: 'character' })).toBeNull();
    expect(ux.uxHoverHTML({ type: 'character', hpMax: 5 }, { name: 'Vex', dm: false })).not.toContain('ux-hv-pic');
  });

  it('puts the picture in the hover card, for anyone who can see the token', () => {
    const h = ux.uxHoverHTML(uploaded, { name: 'G3', dm: false });
    expect(h).toContain('class="ux-hv-pic" src="/uploads/c/tokens/a_medium.webp" data-full="/uploads/c/tokens/a.png"');
  });

  it('offers View picture in the full menu only when there is one', () => {
    const base = { type: 'monster', hpCurrent: 4, hpMax: 7, conditions: '[]' };
    expect(ux.uxTokenMenuHTML({ ...uploaded, ...base }, { name: 'G3', dm: false })).toContain("uxViewPicture('t1')");
    expect(ux.uxTokenMenuHTML(base, { name: 'G3', dm: false })).not.toContain('View picture');
  });

  it('gives someone else\'s token a menu with only its picture', () => {
    const h = ux.uxPictureMenuHTML(uploaded, { name: 'G3', kind: 'Monster' });
    expect(h).toContain('View picture');
    expect(h).toContain('Monster');
    expect(h).not.toContain('Dmg');
    expect(h).not.toContain('Conditions');
  });

  it('escapes a name typed by a player', () => {
    expect(ux.uxPictureMenuHTML(uploaded, { name: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('uxTokenMenuHTML', () => {
  const tok = { type: 'monster', hpCurrent: 4, hpMax: 7, hpTemp: 0, conditions: '["Prone","Stunned"]' };

  it('gives a player HP, conditions and details - and none of the DM\'s actions', () => {
    const h = ux.uxTokenMenuHTML(tok, { name: 'Vex', dm: false });
    expect(h).toContain('HP 4 / 7');
    expect(h).toContain('Conditions (2)');
    expect(h).toContain('Show details');
    expect(h).not.toContain('Hide from players');
    expect(h).not.toContain('Roll initiative');
    expect(h).not.toContain('Remove from map');
  });

  it('gives the DM hide, initiative and remove as well', () => {
    const h = ux.uxTokenMenuHTML(tok, { name: 'G3', dm: true });
    expect(h).toContain('Hide from players');
    expect(h).toContain('Roll initiative');
    expect(h).toContain('Remove from map');
  });

  it('offers to show a token that is hidden', () => {
    const h = ux.uxTokenMenuHTML({ ...tok, visible: false }, { name: 'G3', dm: true });
    expect(h).toContain('Show to players');
    expect(h).not.toContain('Hide from players');
  });

  it('marks the conditions the token has', () => {
    const h = ux.uxCondsHTML(tok);
    expect(h).toContain(`class="cond-btn active" title="Prone"`);
    expect(h).toContain(`class="cond-btn" title="Blinded"`);
  });

  it('keeps the token name as text', () => {
    expectInert(ux.uxTokenMenuHTML(tok, { name: EVIL, dm: true }));
  });
});

describe('table.html and table-ux.js agree', () => {
  const HTML = read('table.html');

  it('loads table-ux.js after table-main.js, so its start-up runs second', () => {
    const main = HTML.indexOf('/js/table/table-main.js');
    const uxAt = HTML.indexOf('/js/table/table-ux.js');
    expect(main).toBeGreaterThan(-1);
    expect(uxAt).toBeGreaterThan(main);
  });

  it('still has every button other modules look up by id', () => {
    // table-auth.js (panel toggles), table-popout.js and table-waiting.js
    // (pop-outs), table-main.js (animation switch), table-panel.js (roll mode).
    for (const id of ['btn-leftpanel-toggle', 'btn-sidepanel-toggle', 'btn-pop-left', 'btn-pop-right', 'btn-pop-chat', 'btn-dice-anim', 'rp-dice-mode']) {
      expect(HTML).toContain(`id="${id}"`);
    }
  });

  it('has the elements table-ux.js fills in', () => {
    for (const id of ['ux-hint', 'ux-view-pop', 'ux-dice-mode-lbl', 'btn-dice-opts', 'ux-follow', 'ux-hints']) {
      expect(HTML).toContain(`id="${id}"`);
      expect(UX).toContain(`'${id}'`);
    }
    // Opened from its button's onclick, so only the markup names it.
    expect(HTML).toContain('id="ux-dice-pop"');
    expect(HTML).toContain(`uxTogglePop('ux-dice-pop')`);
  });

  it('is not loaded by the console map screen', () => {
    expect(read('console/table-console.html')).not.toContain('table-ux');
  });
});
