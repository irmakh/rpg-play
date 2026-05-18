/**
 * Unit tests for table-utils.js pure / near-pure functions.
 *
 * table-utils.js is a classic browser script (no ESM exports, uses global
 * variables). We load it into a Node vm context so we test the real
 * production code — not a copy — with controlled global state injected.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/table/table-utils.js'),
  'utf-8'
);

// Run the script in a fresh vm context with the given globals injected.
// Returns an object whose keys are the function names defined in the script.
function load({ masterPw = '', tokens = [], initData = { entries: [], currentId: null } } = {}) {
  // Minimal DOM stubs — only what the script accesses at define time (none),
  // plus what showToast/showConfirm touch at call time (we don't call those here).
  const ctx = createContext({
    masterPw,
    tokens,
    initData,
    document: {
      getElementById: () => ({
        style: {}, textContent: '', display: '',
        addEventListener: () => {}, removeEventListener: () => {},
      }),
    },
    clearTimeout: () => {},
    setTimeout: () => 0,
    console,
  });
  runInContext(SRC, ctx);
  return {
    parseConditions:      ctx.parseConditions,
    initials:             ctx.initials,
    tokDisplayName:       ctx.tokDisplayName,
    tokenRingColor:       ctx.tokenRingColor,
    hpBarColor:           ctx.hpBarColor,
    getActiveTurnTokenId: ctx.getActiveTurnTokenId,
    isDM:                 ctx.isDM,
  };
}

// ── parseConditions ───────────────────────────────────────────────────────────
describe('parseConditions', () => {
  const { parseConditions } = load();

  it('returns [] for null', () => {
    expect(parseConditions(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseConditions(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseConditions('')).toEqual([]);
  });

  it('passes an array through unchanged', () => {
    const arr = ['poisoned', 'stunned'];
    expect(parseConditions(arr)).toBe(arr);
  });

  it('parses a valid JSON array string', () => {
    expect(parseConditions('["poisoned","blinded"]')).toEqual(['poisoned', 'blinded']);
  });

  it('parses an empty JSON array string', () => {
    expect(parseConditions('[]')).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseConditions('{not valid')).toEqual([]);
  });

  it('returns [] for a plain non-JSON string', () => {
    expect(parseConditions('poisoned')).toEqual([]);
  });
});

// ── initials ──────────────────────────────────────────────────────────────────
describe('initials', () => {
  const { initials } = load();

  it('returns first 4 chars for a single short word', () => {
    expect(initials('Aria')).toBe('Aria');
  });

  it('caps single word at 4 characters', () => {
    expect(initials('Thoradin')).toBe('Thor');
  });

  it('returns first 3 chars of the first word for multi-word names', () => {
    expect(initials('Aria Swiftfoot')).toBe('Ari');
  });

  it('returns first 3 chars for three-word names', () => {
    expect(initials('Aria the Swift')).toBe('Ari');
  });

  it('handles leading/trailing spaces', () => {
    expect(initials('  Aria  ')).toBe('Aria');
  });

  it('returns ? for empty string', () => {
    expect(initials('')).toBe('?');
  });

  it('returns ? for null', () => {
    expect(initials(null)).toBe('?');
  });

  it('handles a single 1-character name', () => {
    expect(initials('A')).toBe('A');
  });
});

// ── isDM ──────────────────────────────────────────────────────────────────────
describe('isDM', () => {
  it('returns true when masterPw is set', () => {
    const { isDM } = load({ masterPw: 'secret' });
    expect(isDM()).toBe(true);
  });

  it('returns false when masterPw is empty string', () => {
    const { isDM } = load({ masterPw: '' });
    expect(isDM()).toBe(false);
  });
});

// ── tokDisplayName ────────────────────────────────────────────────────────────
describe('tokDisplayName', () => {
  describe('as DM (masterPw set)', () => {
    const { tokDisplayName } = load({ masterPw: 'secret' });

    it('returns full name for a monster', () => {
      expect(tokDisplayName({ type: 'monster', name: 'Goblin A3', label: 'A3' })).toBe('Goblin A3');
    });

    it('returns full name for a character', () => {
      expect(tokDisplayName({ type: 'character', name: 'Aria Swiftfoot' })).toBe('Aria Swiftfoot');
    });

    it('returns full name for an NPC', () => {
      expect(tokDisplayName({ type: 'npc', name: 'Innkeeper Bob' })).toBe('Innkeeper Bob');
    });
  });

  describe('as player (no masterPw)', () => {
    const { tokDisplayName } = load({ masterPw: '' });

    it('returns the label for a monster that has a label', () => {
      expect(tokDisplayName({ type: 'monster', name: 'Goblin A3', label: 'A3' })).toBe('A3');
    });

    it('returns the last word of name when monster has no label', () => {
      expect(tokDisplayName({ type: 'monster', name: 'Goblin A3', label: '' })).toBe('A3');
    });

    it('falls back to last word when label is undefined', () => {
      expect(tokDisplayName({ type: 'monster', name: 'Orc Brute B1' })).toBe('B1');
    });

    it('returns the full name for a character', () => {
      expect(tokDisplayName({ type: 'character', name: 'Aria Swiftfoot' })).toBe('Aria Swiftfoot');
    });

    it('returns the full name for an NPC', () => {
      expect(tokDisplayName({ type: 'npc', name: 'Innkeeper Bob' })).toBe('Innkeeper Bob');
    });

    it('handles a monster with a single-word name and no label', () => {
      expect(tokDisplayName({ type: 'monster', name: 'Dragon' })).toBe('Dragon');
    });
  });
});

// ── tokenRingColor ────────────────────────────────────────────────────────────
describe('tokenRingColor', () => {
  const { tokenRingColor } = load();

  it('returns gold for character', () => {
    expect(tokenRingColor('character')).toBe('#c8a04a');
  });

  it('returns red for monster', () => {
    expect(tokenRingColor('monster')).toBe('#ff4444');
  });

  it('returns blue for npc', () => {
    expect(tokenRingColor('npc')).toBe('#7ec8e3');
  });

  it('returns grey for unknown type', () => {
    expect(tokenRingColor('custom')).toBe('#888888');
  });

  it('returns grey for undefined', () => {
    expect(tokenRingColor(undefined)).toBe('#888888');
  });
});

// ── hpBarColor ────────────────────────────────────────────────────────────────
describe('hpBarColor', () => {
  const { hpBarColor } = load();

  it('returns green at full HP (1.0)', () => {
    expect(hpBarColor(1.0)).toBe('#44cc44');
  });

  it('returns green at exactly 0.5', () => {
    expect(hpBarColor(0.5)).toBe('#44cc44');
  });

  it('returns yellow just below 0.5 (0.49)', () => {
    expect(hpBarColor(0.49)).toBe('#ffcc00');
  });

  it('returns yellow at exactly 0.25', () => {
    expect(hpBarColor(0.25)).toBe('#ffcc00');
  });

  it('returns red just below 0.25 (0.24)', () => {
    expect(hpBarColor(0.24)).toBe('#ff4444');
  });

  it('returns red at 0 HP', () => {
    expect(hpBarColor(0)).toBe('#ff4444');
  });

  it('returns red at negative value', () => {
    expect(hpBarColor(-0.1)).toBe('#ff4444');
  });
});

// ── getActiveTurnTokenId ──────────────────────────────────────────────────────
describe('getActiveTurnTokenId', () => {
  it('returns null when currentId is null', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: null },
      tokens: [{ id: 'tok-1', initiativeId: 'init-1' }],
    });
    expect(getActiveTurnTokenId()).toBeNull();
  });

  it('returns null when currentId is empty string', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: '' },
      tokens: [{ id: 'tok-1', initiativeId: 'init-1' }],
    });
    expect(getActiveTurnTokenId()).toBeNull();
  });

  it('returns the token id when a token matches currentId', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: 'init-1' },
      tokens: [
        { id: 'tok-A', initiativeId: 'init-2' },
        { id: 'tok-B', initiativeId: 'init-1' },
      ],
    });
    expect(getActiveTurnTokenId()).toBe('tok-B');
  });

  it('returns null when no token matches currentId', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: 'init-99' },
      tokens: [
        { id: 'tok-A', initiativeId: 'init-1' },
        { id: 'tok-B', initiativeId: 'init-2' },
      ],
    });
    expect(getActiveTurnTokenId()).toBeNull();
  });

  it('returns null when token list is empty', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: 'init-1' },
      tokens: [],
    });
    expect(getActiveTurnTokenId()).toBeNull();
  });

  it('returns first matching token when multiple tokens share the same initiativeId', () => {
    const { getActiveTurnTokenId } = load({
      initData: { entries: [], currentId: 'init-1' },
      tokens: [
        { id: 'tok-A', initiativeId: 'init-1' },
        { id: 'tok-B', initiativeId: 'init-1' },
      ],
    });
    expect(getActiveTurnTokenId()).toBe('tok-A');
  });
});
