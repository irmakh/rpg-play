/**
 * Unit tests for coordinate/geometry functions in table-map.js.
 *
 * table-map.js opens canvas DOM elements at the top of the file and registers
 * event listeners — loading the whole 979-line file into a vm context would
 * need enormous DOM stubs. Instead we surgically extract only the three
 * pure-math functions and run them in a minimal vm context that provides
 * only `tableState`. If any function is renamed, the extractor throws loudly.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/table/table-map.js'),
  'utf-8'
);

/**
 * Extracts named function declarations from a JS source string by brace
 * counting (handles any level of nested braces correctly).
 * Returns the concatenated source of all requested functions.
 */
function extractFunctions(src, ...names) {
  return names.map(name => {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(src);
    if (!m) throw new Error(`Function "${name}" not found in source — was it renamed?`);
    let depth = 0, i = m.index;
    while (i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    return src.slice(m.index, i + 1);
  }).join('\n');
}

const COORD_SRC = extractFunctions(SRC, 'getCanvasSize', 'tokenToPixel', 'canvasToGrid');

/**
 * Creates a vm context with the given tableState and returns the three
 * coordinate functions bound to that state.
 */
function load(tableState = {}) {
  const ctx = createContext({ tableState });
  runInContext(COORD_SRC, ctx);
  return {
    getCanvasSize:  ctx.getCanvasSize,
    tokenToPixel:   ctx.tokenToPixel,
    canvasToGrid:   ctx.canvasToGrid,
  };
}

// ── getCanvasSize ─────────────────────────────────────────────────────────────
describe('getCanvasSize', () => {
  it('uses cellSize * 30/20 when mapWidth/mapHeight are not set', () => {
    const { getCanvasSize } = load({ cellSize: 50 });
    expect(getCanvasSize()).toEqual({ w: 1500, h: 1000 });
  });

  it('scales with a custom cellSize', () => {
    const { getCanvasSize } = load({ cellSize: 70 });
    expect(getCanvasSize()).toEqual({ w: 2100, h: 1400 });
  });

  it('defaults cellSize to 50 when not provided', () => {
    const { getCanvasSize } = load({});
    expect(getCanvasSize()).toEqual({ w: 1500, h: 1000 });
  });

  it('uses mapWidth and mapHeight when they are set', () => {
    const { getCanvasSize } = load({ cellSize: 50, mapWidth: 800, mapHeight: 600 });
    expect(getCanvasSize()).toEqual({ w: 800, h: 600 });
  });

  it('enforces minimum width of 600', () => {
    const { getCanvasSize } = load({ cellSize: 50, mapWidth: 300, mapHeight: 800 });
    expect(getCanvasSize()).toEqual({ w: 600, h: 800 });
  });

  it('enforces minimum height of 400', () => {
    const { getCanvasSize } = load({ cellSize: 50, mapWidth: 800, mapHeight: 200 });
    expect(getCanvasSize()).toEqual({ w: 800, h: 400 });
  });

  it('enforces both minimums when map is very small', () => {
    const { getCanvasSize } = load({ cellSize: 50, mapWidth: 100, mapHeight: 100 });
    expect(getCanvasSize()).toEqual({ w: 600, h: 400 });
  });

  it('treats mapWidth = 0 as unset (falls back to cellSize * 30)', () => {
    // 0 is falsy — the function uses || so 0 triggers the fallback
    const { getCanvasSize } = load({ cellSize: 50, mapWidth: 0, mapHeight: 0 });
    expect(getCanvasSize()).toEqual({ w: 1500, h: 1000 });
  });
});

// ── tokenToPixel ──────────────────────────────────────────────────────────────
describe('tokenToPixel', () => {
  it('converts (0, 0) to the center of the first cell with default state', () => {
    const { tokenToPixel } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    // center of cell (0,0) = 0 + 0*50 + 25 = 25
    expect(tokenToPixel(0, 0)).toEqual({ x: 25, y: 25 });
  });

  it('converts (1, 2) correctly with default state', () => {
    const { tokenToPixel } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    // x = 1*50 + 25 = 75, y = 2*50 + 25 = 125
    expect(tokenToPixel(1, 2)).toEqual({ x: 75, y: 125 });
  });

  it('applies offsetX and offsetY', () => {
    const { tokenToPixel } = load({ cellSize: 50, offsetX: 100, offsetY: 50 });
    // x = 100 + 0*50 + 25 = 125, y = 50 + 0*50 + 25 = 75
    expect(tokenToPixel(0, 0)).toEqual({ x: 125, y: 75 });
  });

  it('works with a custom cellSize', () => {
    const { tokenToPixel } = load({ cellSize: 100, offsetX: 0, offsetY: 0 });
    // x = 1*100 + 50 = 150, y = 1*100 + 50 = 150
    expect(tokenToPixel(1, 1)).toEqual({ x: 150, y: 150 });
  });

  it('defaults cellSize to 50 when not provided', () => {
    const { tokenToPixel } = load({});
    expect(tokenToPixel(0, 0)).toEqual({ x: 25, y: 25 });
  });

  it('defaults offset to 0 when not provided', () => {
    const { tokenToPixel } = load({ cellSize: 50 });
    expect(tokenToPixel(2, 3)).toEqual({ x: 125, y: 175 });
  });
});

// ── canvasToGrid ──────────────────────────────────────────────────────────────
describe('canvasToGrid', () => {
  it('converts canvas origin (0, 0) to grid (0, 0)', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    expect(canvasToGrid(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('maps a pixel inside the first cell to grid (0, 0)', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    expect(canvasToGrid(25, 25)).toEqual({ x: 0, y: 0 });
  });

  it('maps the exact start of the second cell to grid (1, 1)', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    expect(canvasToGrid(50, 50)).toEqual({ x: 1, y: 1 });
  });

  it('maps pixel (75, 125) to grid (1, 2)', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 0, offsetY: 0 });
    expect(canvasToGrid(75, 125)).toEqual({ x: 1, y: 2 });
  });

  it('accounts for offsetX and offsetY', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 100, offsetY: 50 });
    // canvasX=150 → floor((150-100)/50) = floor(1.0) = 1
    // canvasY=100 → floor((100-50)/50) = floor(1.0) = 1
    expect(canvasToGrid(150, 100)).toEqual({ x: 1, y: 1 });
  });

  it('returns negative grid coords for pixels before the offset', () => {
    const { canvasToGrid } = load({ cellSize: 50, offsetX: 50, offsetY: 50 });
    // canvasX=25 → floor((25-50)/50) = floor(-0.5) = -1
    expect(canvasToGrid(25, 25)).toEqual({ x: -1, y: -1 });
  });

  it('defaults cellSize to 50 and offset to 0 when state is empty', () => {
    const { canvasToGrid } = load({});
    expect(canvasToGrid(75, 125)).toEqual({ x: 1, y: 2 });
  });
});

// ── roundtrip: tokenToPixel ↔ canvasToGrid ────────────────────────────────────
describe('tokenToPixel / canvasToGrid roundtrip', () => {
  it('canvasToGrid(tokenToPixel(col, row)) returns the original cell', () => {
    const state = { cellSize: 50, offsetX: 0, offsetY: 0 };
    const { tokenToPixel, canvasToGrid } = load(state);
    // tokenToPixel gives center of cell; canvasToGrid floors back to that cell
    for (const [col, row] of [[0,0],[1,0],[0,1],[3,4],[10,7]]) {
      const px = tokenToPixel(col, row);
      expect(canvasToGrid(px.x, px.y)).toEqual({ x: col, y: row });
    }
  });

  it('roundtrip holds with non-zero offsets', () => {
    const state = { cellSize: 60, offsetX: 30, offsetY: 20 };
    const { tokenToPixel, canvasToGrid } = load(state);
    for (const [col, row] of [[0,0],[2,3],[5,1]]) {
      const px = tokenToPixel(col, row);
      expect(canvasToGrid(px.x, px.y)).toEqual({ x: col, y: row });
    }
  });
});
