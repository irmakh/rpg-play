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


// ── vitals ────────────────────────────────────────────────────────────────────
// The persistent vitals bar mirrors the real HP/AC/Speed inputs and writes back
// through them. These exercise the damage/heal rules against the production
// source, in a stubbed sheet.
function loadVitals({ hpcur = 41, hpmax = 41, hptemp = 0, ac = '16', speed = '30 ft' } = {}) {
  const dispatched = [];
  const mkInput = (key, val) => ({
    _key: key,
    value: String(val),
    dispatchEvent(e) { dispatched.push({ key, type: e.type, value: this.value }); return true; },
  });
  const fields = {
    hpcur: mkInput('hpcur', hpcur),
    hpmax: mkInput('hpmax', hpmax),
    hptemp: mkInput('hptemp', hptemp),
    ac: mkInput('ac', ac),
    speed: mkInput('speed', speed),
  };
  const mkEl = () => {
    const attrs = {};
    return {
      textContent: '', hidden: false, value: '',
      focus() {},
      style: { _p: {}, setProperty(k, v) { this._p[k] = String(v); }, getPropertyValue(k) { return this._p[k]; } },
      setAttribute(k, v) { attrs[k] = String(v); },
      removeAttribute(k) { delete attrs[k]; },
      hasAttribute(k) { return k in attrs; },
      getAttribute(k) { return k in attrs ? attrs[k] : null; },
      toggleAttribute(k, on) { if (on) attrs[k] = ''; else delete attrs[k]; return !!on; },
      _attrs: attrs,
    };
  };
  const els = {};
  ['vitals', 'vitals-ring', 'vitals-hp', 'vitals-hpmax', 'vitals-ac', 'vitals-speed', 'vitals-amt']
    .forEach(id => { els[id] = mkEl(); });

  const ctx = createContext({
    document: {
      querySelector: sel => {
        const m = /\[data-key="([^"]+)"\]/.exec(sel);
        return m ? (fields[m[1]] || null) : null;
      },
      querySelectorAll: () => ({ forEach: () => {} }),
      getElementById: id => els[id] || null,
    },
    Event: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
    clearTimeout: () => {},
    setTimeout: () => 0,
  });
  runInContext(UTILS_SRC, ctx);
  return { ctx, els, fields, dispatched };
}

describe('vitalsApply', () => {
  it('temporary hit points soak damage before real hp, as 5e expects', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41, hptemp: 5 });
    v.els['vitals-amt'].value = '12';
    v.ctx.vitalsApply(-1);
    expect(v.fields.hptemp.value).toBe('0');   // 5 absorbed
    expect(v.fields.hpcur.value).toBe('34');   // remaining 7 hit hp
  });

  it('never drops hp below zero', () => {
    const v = loadVitals({ hpcur: 6, hpmax: 40 });
    v.els['vitals-amt'].value = '99';
    v.ctx.vitalsApply(-1);
    expect(v.fields.hpcur.value).toBe('0');
  });

  it('clamps healing to maximum hp', () => {
    const v = loadVitals({ hpcur: 10, hpmax: 41 });
    v.els['vitals-amt'].value = '999';
    v.ctx.vitalsApply(1);
    expect(v.fields.hpcur.value).toBe('41');
  });

  it('writes back through the real input so the existing autosave fires', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41 });
    v.els['vitals-amt'].value = '5';
    v.ctx.vitalsApply(-1);
    const ev = v.dispatched.find(d => d.key === 'hpcur');
    expect(ev).toBeTruthy();
    expect(ev.type).toBe('input');             // what #char-body listens for
    expect(ev.value).toBe('36');
  });

  it('ignores an empty or non-numeric amount', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41 });
    v.els['vitals-amt'].value = '';
    v.ctx.vitalsApply(-1);
    expect(v.fields.hpcur.value).toBe('41');
    v.els['vitals-amt'].value = 'abc';
    v.ctx.vitalsApply(-1);
    expect(v.fields.hpcur.value).toBe('41');
  });

  it('treats a negative amount as its magnitude', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41 });
    v.els['vitals-amt'].value = '-7';
    v.ctx.vitalsApply(-1);
    expect(v.fields.hpcur.value).toBe('34');
  });
});

describe('syncVitals', () => {
  it('spends no colour at full health', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41 });
    v.ctx.syncVitals();
    expect(v.els['vitals-ring'].style.getPropertyValue('--hp')).toBe('100');
    expect(v.els['vitals-ring'].hasAttribute('data-hurt')).toBe(false);
    expect(v.els['vitals-ring'].getAttribute('data-state')).toBe(null);
  });

  it('marks hurt at or below half', () => {
    const v = loadVitals({ hpcur: 20, hpmax: 41 });
    v.ctx.syncVitals();
    expect(v.els['vitals-ring'].hasAttribute('data-hurt')).toBe(true);
  });

  it('marks down at zero, and is not merely hurt', () => {
    const v = loadVitals({ hpcur: 0, hpmax: 41 });
    v.ctx.syncVitals();
    expect(v.els['vitals-ring'].getAttribute('data-state')).toBe('down');
    expect(v.els['vitals-ring'].hasAttribute('data-hurt')).toBe(false);
  });

  it('counts temporary hit points toward the displayed total', () => {
    const v = loadVitals({ hpcur: 41, hpmax: 41, hptemp: 5 });
    v.ctx.syncVitals();
    expect(v.els['vitals-hp'].textContent).toBe('46');
  });

  it('mirrors armour class and speed', () => {
    const v = loadVitals({ ac: '16', speed: '50 ft' });
    v.ctx.syncVitals();
    expect(v.els['vitals-ac'].textContent).toBe('16');
    expect(v.els['vitals-speed'].textContent).toBe('50 ft');
  });

  it('stays hidden when the character has no hp recorded', () => {
    const v = loadVitals({ hpcur: '', hpmax: '' });
    v.ctx.syncVitals();
    expect(v.els.vitals.hidden).toBe(true);
  });
});
