// Written by Irmak Hakman — 2026-11-12 21:00
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * public/js/table/table-areas.js: a spell's area drawn to size in feet — its
 * outline, what counts as inside it, how it snaps to the grid and turns, and
 * its label.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const src = fs.readFileSync(path.resolve(__dirname, '../../public/js/table/table-areas.js'), 'utf8');
// _ptSegDist lives in table-map.js; the same function, for the edge slack.
const ctx = {
  _ptSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
    if (!l) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  },
};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__t = { areaPx, areaGeometry, areaTip, areaHit, areaSnap, areaAngleTo, areaText };', ctx);
const { areaPx, areaGeometry, areaTip, areaHit, areaSnap, areaAngleTo, areaText } = ctx.__t;

const CS = 50;   // a 50px cell is 5 ft
const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('size in feet', () => {
  it('is 5 ft a cell, at any cell size', () => {
    expect(areaPx(10, 50)).toBe(100);
    expect(areaPx(20, 70)).toBe(280);
    expect(areaPx(-5, 50)).toBe(0);
  });
});

describe('outline', () => {
  it('a 10 ft square is two cells a side around its centre', () => {
    expect(areaGeometry({ kind: 'square', sizeFt: 10, x1: 100, y1: 100 }, CS).poly)
      .toEqual([[50, 50], [150, 50], [150, 150], [50, 150]]);
  });
  it('a 20 ft radius circle', () => {
    expect(areaGeometry({ kind: 'circle', sizeFt: 20, x1: 100, y1: 100 }, CS).circle).toEqual([100, 100, 200]);
  });
  it('a 15 ft cone is as wide at its end as it is long, aimed by its angle', () => {
    const east = areaGeometry({ kind: 'cone', sizeFt: 15, angle: 0, x1: 0, y1: 0 }, CS).poly;
    near(east[0], [0, 0]); near(east[1], [150, 75]); near(east[2], [150, -75]);
    const south = areaGeometry({ kind: 'cone', sizeFt: 15, angle: 90, x1: 0, y1: 0 }, CS).poly;
    near(south[1], [-75, 150]); near(south[2], [75, 150]);
  });
  it('a 30 × 5 ft line starts at its anchor and is one cell wide', () => {
    const p = areaGeometry({ kind: 'line', sizeFt: 30, widthFt: 5, angle: 0, x1: 0, y1: 0 }, CS).poly;
    near(p[0], [0, 25]); near(p[1], [300, 25]); near(p[2], [300, -25]); near(p[3], [0, -25]);
  });
  it('the turning handle is the middle of the far end', () => {
    near(areaTip({ kind: 'line', sizeFt: 30, angle: 180, x1: 0, y1: 0 }, CS), [-300, 0]);
  });
});

describe('inside', () => {
  const cone = { kind: 'cone', sizeFt: 15, angle: 0, x1: 0, y1: 0 };
  it('a point in the cone is, one beside it is not', () => {
    expect(areaHit(cone, 100, 10, CS)).toBe(true);
    expect(areaHit(cone, 20, 60, CS)).toBe(false);
    expect(areaHit(cone, -40, 0, CS)).toBe(false);
  });
  it('a circle, with a little slack at its edge', () => {
    const c = { kind: 'circle', sizeFt: 10, x1: 0, y1: 0 };
    expect(areaHit(c, 103, 0, CS)).toBe(true);
    expect(areaHit(c, 120, 0, CS)).toBe(false);
  });
});

describe('snapping to the grid', () => {
  it('a square\'s edges land on grid lines, whatever its size', () => {
    expect(areaSnap({ kind: 'square', sizeFt: 10 }, 112, 87, CS, 0, 0)).toEqual([100, 100]);   // 2 cells: centre on a corner
    expect(areaSnap({ kind: 'square', sizeFt: 15 }, 112, 87, CS, 0, 0)).toEqual([125, 75]);    // 3 cells: centre in a cell
  });
  it('a circle\'s centre lands on a grid corner, with the map\'s grid offset', () => {
    expect(areaSnap({ kind: 'circle', sizeFt: 20 }, 74, 26, CS, 0, 0)).toEqual([50, 50]);
    expect(areaSnap({ kind: 'circle', sizeFt: 20 }, 74, 26, CS, 10, 10)).toEqual([60, 10]);
  });
  it('a cone or line starts on a corner, an edge\'s middle or a cell\'s centre', () => {
    expect(areaSnap({ kind: 'cone', sizeFt: 15 }, 37, 12, CS, 0, 0)).toEqual([25, 0]);
    expect(areaSnap({ kind: 'line', sizeFt: 30 }, 40, 40, CS, 0, 0)).toEqual([50, 50]);
  });
});

describe('turning', () => {
  const s = { x1: 0, y1: 0 };
  it('turns in 15° steps', () => {
    expect(areaAngleTo(s, 100, 30, false)).toBe(15);
    expect(areaAngleTo(s, 0, 100, false)).toBe(90);
    expect(areaAngleTo(s, -100, -1, false)).toBe(180);
    expect(areaAngleTo(s, 10, -100, false)).toBe(270);
  });
  it('turns freely with Shift', () => {
    expect(areaAngleTo(s, 100, 30, true)).toBeCloseTo(16.699, 2);
  });
});

describe('label', () => {
  it('says what it is, with the name first when there is one', () => {
    expect(areaText({ kind: 'circle', sizeFt: 20 })).toBe('20 ft radius');
    expect(areaText({ kind: 'square', sizeFt: 10, label: 'Web' })).toBe('Web · 10 ft square');
    expect(areaText({ kind: 'cone', sizeFt: 15, label: '  ' })).toBe('15 ft cone');
    expect(areaText({ kind: 'line', sizeFt: 100, widthFt: 5, label: 'Lightning Bolt' })).toBe('Lightning Bolt · 100 × 5 ft line');
  });
});
