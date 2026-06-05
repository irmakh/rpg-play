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
let charPasswords    = {};   // { id: plaintext password for this session }
let charHasPassword  = {};   // { id: bool }
let charTypes        = {};   // { id: 'pc'|'npc' }

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
