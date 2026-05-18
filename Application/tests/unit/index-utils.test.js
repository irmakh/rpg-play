/**
 * Unit tests for pure helpers in index-utils.js and session helpers in index-state.js.
 *
 * Both files are browser globals scripts.  We use vm.runInContext so the real
 * production code runs — not copies — in isolated contexts.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const UTILS_SRC = readFileSync(
  resolve(__dirname, '../../public/js/index/index-utils.js'), 'utf-8'
);
const STATE_SRC = readFileSync(
  resolve(__dirname, '../../public/js/index/index-state.js'), 'utf-8'
);

// ── fmt ───────────────────────────────────────────────────────────────────────
// fmt is a one-liner; load utils with a minimal DOM stub.
function loadUtils() {
  const ctx = createContext({
    document: {
      querySelector: () => null,
      querySelectorAll: () => ({ forEach: () => {} }),
      getElementById: () => ({ textContent: '', className: '', style: {}, classList: { add(){}, remove(){} } }),
    },
    clearTimeout: () => {},
    setTimeout: () => 0,
  });
  runInContext(UTILS_SRC, ctx);
  return { fmt: ctx.fmt };
}

describe('fmt', () => {
  const { fmt } = loadUtils();

  it('prefixes non-negative numbers with +', () => {
    expect(fmt(0)).toBe('+0');
    expect(fmt(1)).toBe('+1');
    expect(fmt(5)).toBe('+5');
  });

  it('does not prefix negative numbers', () => {
    expect(fmt(-1)).toBe('-1');
    expect(fmt(-10)).toBe('-10');
  });

  it('handles large positive and negative values', () => {
    expect(fmt(100)).toBe('+100');
    expect(fmt(-100)).toBe('-100');
  });
});

// ── session helpers (index-state.js) ─────────────────────────────────────────
// _indexSession is read once at load time from sessionStorage.
// Each call to loadState() creates a fresh context with a controlled session.

function loadState(sessionObj) {
  const stored = sessionObj === null ? 'null' : JSON.stringify(sessionObj);
  const ctx = createContext({
    sessionStorage: { getItem: (key) => key === 'rpgSession' ? stored : null },
  });
  runInContext(STATE_SRC, ctx);
  return {
    indexIsDM:      ctx.indexIsDM,
    indexCharId:    ctx.indexCharId,
    indexCharPw:    ctx.indexCharPw,
    indexMasterPw:  ctx.indexMasterPw,
  };
}

describe('indexIsDM', () => {
  it('returns true when role is dm', () => {
    const { indexIsDM } = loadState({ role: 'dm', masterPw: 'secret' });
    expect(indexIsDM()).toBe(true);
  });

  it('returns false when role is character', () => {
    const { indexIsDM } = loadState({ role: 'character', characterId: 'abc' });
    expect(indexIsDM()).toBe(false);
  });

  it('returns false when session is null', () => {
    const { indexIsDM } = loadState(null);
    expect(indexIsDM()).toBe(false);
  });
});

describe('indexCharId', () => {
  it('returns characterId when role is character', () => {
    const { indexCharId } = loadState({ role: 'character', characterId: 'char-42', charPw: 'pw' });
    expect(indexCharId()).toBe('char-42');
  });

  it('returns null when role is dm', () => {
    const { indexCharId } = loadState({ role: 'dm', masterPw: 'x' });
    expect(indexCharId()).toBeNull();
  });

  it('returns null when session is null', () => {
    const { indexCharId } = loadState(null);
    expect(indexCharId()).toBeNull();
  });
});

describe('indexCharPw', () => {
  it('returns charPw when role is character', () => {
    const { indexCharPw } = loadState({ role: 'character', characterId: 'x', charPw: 'secret123' });
    expect(indexCharPw()).toBe('secret123');
  });

  it('returns null when role is dm', () => {
    const { indexCharPw } = loadState({ role: 'dm', masterPw: 'x' });
    expect(indexCharPw()).toBeNull();
  });
});

describe('indexMasterPw', () => {
  it('returns masterPw when role is dm', () => {
    const { indexMasterPw } = loadState({ role: 'dm', masterPw: 'dmpass' });
    expect(indexMasterPw()).toBe('dmpass');
  });

  it('returns null when role is character', () => {
    const { indexMasterPw } = loadState({ role: 'character', characterId: 'x', charPw: 'p' });
    expect(indexMasterPw()).toBeNull();
  });

  it('returns null when session is null', () => {
    const { indexMasterPw } = loadState(null);
    expect(indexMasterPw()).toBeNull();
  });
});
