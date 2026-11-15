// Written by Irmak Hakman — 2026-11-15 12:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Players handing things to each other: one inventory item, or coins.
 *
 * Used by POST /api/characters/:id/give (server/routes/characters.js). Pure —
 * it works on two parsed character data objects and changes them in place,
 * with no database and no request — so the rules are tested on their own
 * (tests/unit/give.test.js).
 *
 * An item moves exactly as it is held: an unidentified copy stays
 * unidentified, charges already spent stay spent, the treasury source (srcId)
 * goes with it so identifying the item later still reaches the new owner. It
 * arrives taken off and out of attunement — the giver was wearing it, not the
 * receiver. A weapon's attack row leaves with it and is built again for the
 * receiver, whose STR/DEX and proficiency make the numbers.
 */

// Sheet field for each coin. Platinum is "pp2" because "pp" is passive perception.
export const COIN_KEYS = { cp: 'cp', sp: 'sp', ep: 'ep', gp: 'gp', pp: 'pp2' };
const MAX_COINS = 10000000;

export class GiveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseList(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

/**
 * Move one item from `from` to `to`.
 * makeWeaponRow(data, item) → [name, atk, dmg, notes] for the receiver.
 * Returns { item, wasEquipped } — the item as the receiver now holds it.
 */
export function moveItem(from, to, itemId, makeWeaponRow) {
  const fromItems = parseList(from._items);
  const idx = fromItems.findIndex(x => x && sameId(x.id, itemId));
  if (idx < 0) throw new GiveError(404, 'That item is not in the inventory any more');
  const [item] = fromItems.splice(idx, 1);

  // The giver's attack row for it (the 5th entry is the item's id).
  const fromWeapons = parseList(from._weapons);
  const hadRow = fromWeapons.some(w => Array.isArray(w) && sameId(w[4], item.id));
  from._items = JSON.stringify(fromItems);
  if (hadRow) from._weapons = JSON.stringify(fromWeapons.filter(w => !(Array.isArray(w) && sameId(w[4], item.id))));

  const toItems = parseList(to._items);
  const known = toItems.map(i => parseInt(i && i.id) || 0);
  const counter = Math.max(parseInt(to._itemIdCounter) || 0, ...known, 0);
  const moved = { ...item, id: counter + 1, equipped: false, attuned: false };
  toItems.push(moved);
  to._items = JSON.stringify(toItems);
  to._itemIdCounter = moved.id;

  // A known weapon gets its attack row on the new sheet. An unidentified one
  // never had one: its damage dice are what is being withheld.
  if (moved.itemType === 'weapon' && !moved.unidentified && typeof makeWeaponRow === 'function') {
    const row = makeWeaponRow(to, moved);
    if (Array.isArray(row)) {
      const toWeapons = parseList(to._weapons);
      toWeapons.push([...row.slice(0, 4), moved.id]);
      to._weapons = JSON.stringify(toWeapons);
    }
  }
  return { item: moved, wasEquipped: !!item.equipped };
}

/**
 * Check and clean a coins object: whole numbers, none negative, at least one.
 * Returns { cp, sp, ep, gp, pp } with every key present.
 */
export function cleanCoins(coins) {
  if (!coins || typeof coins !== 'object') throw new GiveError(400, 'No coins given');
  const out = {};
  let total = 0;
  for (const k of Object.keys(COIN_KEYS)) {
    const raw = coins[k] ?? 0;
    const n = Number(raw === '' ? 0 : raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COINS) throw new GiveError(400, 'Coins must be whole numbers');
    out[k] = n;
    total += n;
  }
  if (!total) throw new GiveError(400, 'Choose how many coins to give');
  return out;
}

/**
 * Move coins from `from` to `to`, coin for coin: gold leaves as gold. Nothing
 * is changed into other coins, so the giver must hold enough of each kind.
 */
export function moveCoins(from, to, coins) {
  const c = cleanCoins(coins);
  for (const [k, key] of Object.entries(COIN_KEYS)) {
    if (c[k] > (parseInt(from[key]) || 0)) throw new GiveError(400, `Not enough ${k.toUpperCase()}`);
  }
  for (const [k, key] of Object.entries(COIN_KEYS)) {
    if (!c[k]) continue;
    from[key] = String((parseInt(from[key]) || 0) - c[k]);
    to[key] = String((parseInt(to[key]) || 0) + c[k]);
  }
  return c;
}

/** "12 GP, 5 SP" — for notifications and chat. */
export function coinsLabel(c) {
  return ['pp', 'gp', 'ep', 'sp', 'cp'].filter(k => c[k]).map(k => `${c[k]} ${k.toUpperCase()}`).join(', ');
}
