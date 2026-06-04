// ── Shared State ─────────────────────────────────────────────────────────────
let masterPw = '';
// Session — populated from sessionStorage on page load
let sessionRole = null;     // 'dm' | 'character' | null
let sessionCharId = null;   // character id when role === 'character'
let sessionCharPw = null;   // character plaintext pw (for header auth)
let tableState = { cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, mapDataUrl: '' };
let tokens = [];
let initData = { entries: [], currentId: null };
let currentTool = 'move';
let dragState = null;   // { tokenId, origX, origY, origPxX, origPxY, remainingFt, ghostEl }
let _dragPendingTimer = null; // setTimeout handle — drag starts 500ms after mousedown
let rulerState = null;  // { x1, y1 }
let panState = null;    // { startX, startY, startScrollLeft, startScrollTop }
let selectedTokenId = null;
let bulkTokenIds = new Set(); // DM multi-selection for bulk HP/condition edits
let multiSelectState = null;  // { x1, y1 } while DM is drag-selecting an area
let rollPending = null; // { label, modifier, sender }
let placementState = null; // { payload } — click-to-place mode
let qrollCharName = '';
let qrollData = null;
let _sideQrollTokenId = null; // cache: skip reload if same token is still active
let _sideViewInitId = null;    // initiative entry the user clicked to preview in side panel
let drawings = [];             // committed shapes [{id,type,x1,y1,x2,y2,color,thickness}]
let drawMode = { type: 'circle', color: '#ff4444', thickness: 2 };
let drawingState = null;       // { x1, y1 } while dragging in draw mode
let drawSubMode = 'draw';      // 'draw' | 'select' sub-mode within the draw tool
let selectedShapeId = null;    // ID of selected shape in select sub-mode, or null
let shapeEditState = null;     // { mode:'move'|'h1'|'h2', startX, startY, origShape } while dragging
let _drawPreviewTimer = null;  // throttle for live preview broadcast
let _sidePrevTokenId = null;   // last token actually rendered in side panel (for section reset detection)
const _sideOpenSections = new Set(); // tracks which qroll sections the user has expanded
let _initCharData = {}; // entry id → { hpCurrent, hpMax, ac } fetched fresh from character API
let chatUnread = 0;
let fogRegions = [];   // [{ id, label, x, y, w, h, visible }]
let hiddenItems = [];  // [{ id, label, type, x, y, description, visible }]
let zoomPct = 100;     // client-local zoom, not synced to server
let chatOpen = true;
let initPanelOpen = true;
let _offsetDebounce = null;
let _pendingTokenTab = 'chars';
let _pendingTokenLinkedId = null;
let _pendingTokenType = null;
let _pendingTokenData = {};
let _charList = [];
let _monsterList = [];
let _addTokenBusy = false; // true while in placement mode or while placement POST is in flight
let _hpPanelAc = null; // cached AC for the currently open HP panel

// Serialises all token-mutating network requests so they never interleave.
// Optimistic UI updates happen immediately outside the queue; only fetch() calls go in.
const _tokQ = { _p: Promise.resolve(), run(fn) { this._p = this._p.then(() => fn(), () => fn()); } };

// CONDITIONS, COND_ABBREV, SKILL_NAMES, SAVE_NAMES, SAVE_KEYS in js/lib/dnd-data.js

// Used by both table-chat.js (add) and table-realtime.js (check/delete) to deduplicate
// dice-roll SSE events that originated from this client.
const _selfRollIds = new Set();
