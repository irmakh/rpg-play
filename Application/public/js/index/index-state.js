// Written by Irmak Hakman — 2026-09-27 11:13
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Shared mutable state (SKILL_AB, SKILL_NAMES, AB_NAMES in js/lib/dnd-data.js) ──

// Session (read once on page load from sessionStorage)
let _indexSession = null;
try { _indexSession = JSON.parse(sessionStorage.getItem('rpgSession') || 'null'); } catch {}
function indexIsDM() { return _indexSession?.role === 'dm'; }
function indexCharId() { return _indexSession?.role === 'character' ? _indexSession.characterId : null; }
function indexCharPw() { return _indexSession?.role === 'character' ? _indexSession.charPw : null; }
function indexMasterPw() { return _indexSession?.role === 'dm' ? _indexSession.masterPw : null; }

// Character
let currentCharId    = null;
let charPasswords    = {};   // { id: session token for that character }
let charHasPassword  = {};   // { id: bool }
let charTypes        = {};   // { id: 'pc'|'npc' }

/**
 * The credential this sheet holds, as request headers: the open character's
 * session token (from login, or from the unlock screen, which keeps it only in
 * charPasswords), else the DM's token when a DM is looking at the sheet, else
 * the logged-in character's own. Empty when nobody is logged in.
 *
 * Posting to chat, the 3D dice and turn control all need a login since v240, so
 * every such call sends this.
 */
function sheetAuthHeaders(extra) {
  const h = { 'Content-Type': 'application/json' };
  if (currentCharId) h['X-Character-Id'] = currentCharId;
  const token = (currentCharId && charPasswords[currentCharId]) || indexMasterPw() || indexCharPw();
  if (token) h['X-Character-Password'] = token;
  return { ...h, ...extra };
}

// Dice / rolls
let rollPending = null;
const rollHistory = [];

// Items (shared between index-calc.js, index-char.js, index-items.js)
let items = [];
let itemIdCounter = 0;

// Custom actions (shared with index-actions.js) — Actions tab + table right panel
let actions = [];
let actionIdCounter = 0;
let _actionFilter = 'all';

// SSE suppression (set by saveCharacter, read by realtime handler)
let _suppressSSEReload = false;

// Snapshot of the last-persisted character data (keyed like collectData()).
// Autosave diffs against this to PATCH only changed keys; applyPartial uses it
// to detect locally-dirty fields so an incoming change never clobbers an edit
// in progress. Reset on load / full save / applyData.
let _lastSavedData = {};

// Media (shared between index-char.js clearSheet and index-media.js)
let mediaList = [];

// Loot (shared between index-char.js collectData/clearSheet/applyData and index-loot.js)
let claimedLoots = [];

// Initiative (shared between index-initiative.js and index-realtime.js)
let initData = { entries: [], currentId: null };

// Chat (shared between index-initiative.js and index-dice3d.js)
let chatOpen    = false;
let chatUnread  = 0;

// Dice broadcast dedup (written by index-dice3d.js, read by index-realtime.js)
const _selfRollIds = new Set();
