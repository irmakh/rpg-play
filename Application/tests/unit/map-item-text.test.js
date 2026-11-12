// Written by Irmak Hakman — 2026-11-12 16:42
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * public/js/lib/map-item-text.js: how big a hidden item's icon and label (and
 * a DM note's title) are drawn, on the table and on Prepare Map.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const src = fs.readFileSync(path.resolve(__dirname, '../../public/js/lib/map-item-text.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__t = { mapItemTextPx, fitMapText };', ctx);
const { mapItemTextPx, fitMapText } = ctx.__t;

// A canvas stand-in where every character is 10px wide.
const fakeCtx = { measureText: (s) => ({ width: String(s).length * 10 }) };

describe('mapItemTextPx', () => {
  it('grows with the cell instead of stopping at 9px', () => {
    expect(mapItemTextPx(50, 1, 1, 1)).toEqual({ label: 11, icon: 25 });
    expect(mapItemTextPx(70, 1, 1, 1)).toEqual({ label: 15, icon: 35 });
  });

  it('sizes the icon to the item, the label to the cell', () => {
    const big = mapItemTextPx(50, 3, 2, 1);
    expect(big.icon).toBe(40);        // half of the shorter side (2 cells = 50), capped at 40
    expect(mapItemTextPx(30, 2, 2, 1).icon).toBe(30);
    expect(big.label).toBe(11);
  });

  it('keeps a readable size on screen when the map is zoomed out', () => {
    const t = mapItemTextPx(30, 1, 1, 0.5);
    expect(t.label * 0.5).toBeGreaterThanOrEqual(11);
    expect(t.icon * 0.5).toBeGreaterThanOrEqual(14);
  });

  it('stops growing on a huge grid', () => {
    expect(mapItemTextPx(400, 4, 4, 1)).toEqual({ label: 40, icon: 40 });
  });

  it('copes with a missing cell size or zoom', () => {
    expect(mapItemTextPx(0, undefined, undefined, 0)).toEqual({ label: 11, icon: 25 });
  });
});

describe('fitMapText', () => {
  it('leaves text that fits alone', () => {
    expect(fitMapText(fakeCtx, 'Chest', 50)).toBe('Chest');
  });

  it('cuts long text and ends it with an ellipsis', () => {
    const out = fitMapText(fakeCtx, 'Poisoned needle trap', 80);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length * 10).toBeLessThanOrEqual(80);
  });

  it('returns nothing when not even one letter fits', () => {
    expect(fitMapText(fakeCtx, 'Trap', 5)).toBe('');
  });
});
