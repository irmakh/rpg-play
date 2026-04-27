// ── Shared mutable state (SKILL_AB, SKILL_NAMES, AB_NAMES in js/lib/dnd-data.js) ──

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
