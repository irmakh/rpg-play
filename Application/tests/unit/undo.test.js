// Written by Irmak Hakman — 2026-11-16 12:58
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/** lib/undo.js — the undo registry on its own, with a controlled clock. */
import { describe, it, expect } from 'vitest';
import { createUndoRegistry, UndoError, UNDO_WINDOW_MS } from '../../lib/undo.js';

function reg() {
  let t = 0;
  const r = createUndoRegistry({ now: () => t, setTimer: () => null });
  return { r, advance: (ms) => { t += ms; } };
}

const DM = { campaignId: 'c1', isDm: true, charId: '' };
const A  = { campaignId: 'c1', isDm: false, charId: 'a' };
const B  = { campaignId: 'c1', isDm: false, charId: 'b' };

describe('undo registry', () => {
  it('reports the window the page should show', () => {
    const { r } = reg();
    const info = r.register({ campaignId: 'c1', run: async () => {} });
    expect(info.undoUntil).toBe(UNDO_WINDOW_MS);
    expect(info.undoId).toMatch(/^[\w-]{16}$/);
  });

  it('runs the reverse for its owner, once', async () => {
    const { r } = reg();
    let ran = 0;
    const { undoId } = r.register({ campaignId: 'c1', ownerCharId: 'a', run: async () => { ran++; } });
    expect((await r.undo(undoId, A)).status).toBe(200);
    expect((await r.undo(undoId, A)).status).toBe(410);
    expect(ran).toBe(1);
  });

  it('lets the DM undo anyone\'s action but not another player', async () => {
    const { r } = reg();
    const one = r.register({ campaignId: 'c1', ownerCharId: 'a', run: async () => {} });
    expect((await r.undo(one.undoId, B)).status).toBe(403);
    expect((await r.undo(one.undoId, DM)).status).toBe(200);
  });

  it('only the DM can undo what the DM did', async () => {
    const { r } = reg();
    const one = r.register({ campaignId: 'c1', ownerCharId: '', run: async () => {} });
    expect((await r.undo(one.undoId, A)).status).toBe(403);
  });

  it('never crosses campaigns', async () => {
    const { r } = reg();
    const one = r.register({ campaignId: 'c1', run: async () => {} });
    expect((await r.undo(one.undoId, { ...DM, campaignId: 'c2' })).status).toBe(410);
  });

  it('keeps a short grace after the window, then forgets', async () => {
    const { r, advance } = reg();
    const one = r.register({ campaignId: 'c1', run: async () => {} });
    advance(UNDO_WINDOW_MS + 1000);
    expect((await r.undo(one.undoId, DM)).status).toBe(200);
    const two = r.register({ campaignId: 'c1', run: async () => {} });
    advance(UNDO_WINDOW_MS + 6000);
    expect((await r.undo(two.undoId, DM)).status).toBe(410);
  });

  it('runs onExpire when time runs out, not when undone', async () => {
    const { r, advance } = reg();
    let expired = 0;
    const one = r.register({ campaignId: 'c1', run: async () => {}, onExpire: () => { expired++; } });
    await r.undo(one.undoId, DM);
    expect(expired).toBe(0);
    r.register({ campaignId: 'c1', run: async () => {}, onExpire: () => { expired++; } });
    advance(60000);
    r.sweep();
    expect(expired).toBe(1);
  });

  it('turns an UndoError into its status and runs onExpire', async () => {
    const { r } = reg();
    let expired = 0;
    const one = r.register({ campaignId: 'c1', run: async () => { throw new UndoError(409, 'Gone'); }, onExpire: () => { expired++; } });
    expect(await r.undo(one.undoId, DM)).toEqual({ status: 409, error: 'Gone' });
    expect(expired).toBe(1);
  });
});
