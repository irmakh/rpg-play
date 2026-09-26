// Written by Irmak Hakman — 2026-09-26 15:58

// ── Private messages in chat ──────────────────────────────────────────────────
//
// Five pages carry a chat input (table, character sheet, DM panel and both
// console screens) and each has its own auth globals, so the shared parts live
// here: who I am, the recipient picker, and collecting a private message that
// has arrived.
//
// A private message is NOT broadcast with its text. The server sends every client
// a bare id on the 'chat-pm' channel and each asks /api/chat/entry/:id whether it
// is theirs — so the server decides who reads it, rather than every page being
// trusted to hide what it was already given. (The older dmOnly rolls do work that
// second way, which is why they are readable by anyone watching the socket.)
//
// Recipient keys match server/notify.js: '' is everyone, 'dm' is the DM, anything
// else is a character id.

/** The session this tab holds — same shape every page stores. */
function _pmSession() {
  try { return JSON.parse(sessionStorage.getItem('rpgSession') || 'null') || {}; } catch { return {}; }
}

/** How I prove who I am. A private message needs this; a public one does not. */
function chatPmHeaders(extra) {
  const s = _pmSession();
  const h = { 'Content-Type': 'application/json' };
  if (s.role === 'dm') {
    h['X-Master-Password'] = s.masterPw || sessionStorage.getItem('dmMasterPw') || sessionStorage.getItem('tableMasterPw') || '';
  } else if (s.role === 'character' && s.characterId) {
    h['X-Character-Id'] = s.characterId;
    if (s.charPw) h['X-Character-Password'] = s.charPw;
  }
  return { ...h, ...extra };
}

/** The key the server knows me by: 'dm', a character id, or null if nobody. */
function chatPmMe() {
  const s = _pmSession();
  if (s.role === 'dm') return 'dm';
  if (s.role === 'character' && s.characterId) return String(s.characterId);
  return null;
}

// ── The picker ────────────────────────────────────────────────────────────────

/**
 * Fill a <select> with "Everyone" plus every private recipient available to me.
 *
 * Everyone stays the default and the first option, so sending to the whole table
 * is still what happens when nobody touches this. Someone not logged in gets the
 * Everyone option alone — they have no identity to send a private message from.
 */
async function initChatRecipients(selectId = 'chat-to', inputId = 'chat-input') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const me = chatPmMe();
  const opts = ['<option value="">Everyone</option>'];

  if (me) {
    if (me !== 'dm') opts.push('<option value="dm">🔒 DM</option>');
    try {
      const res = await fetch('/api/characters', { headers: chatPmHeaders() });
      if (res.ok) {
        for (const c of await res.json()) {
          if (String(c.id) === me) continue;              // no messaging yourself
          opts.push(`<option value="${esc(c.id)}">🔒 ${esc(c.name || 'Unnamed')}</option>`);
        }
      }
    } catch {}
  }

  const keep = sel.value;
  sel.innerHTML = opts.join('');
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  _pmMarkPicker(selectId, inputId);
}

/** The chosen recipient, or '' for everyone. */
function chatPmTarget(selectId = 'chat-to') {
  const sel = document.getElementById(selectId);
  return sel ? sel.value : '';
}

/**
 * Put the picker back to Everyone after a private message is sent.
 *
 * Deliberate: a recipient that stays selected is how someone quietly tells the
 * whole table something they meant for one person — or worse, keeps whispering
 * when they think they are talking to the room.
 */
function resetChatRecipient(selectId = 'chat-to', inputId = 'chat-input') {
  const sel = document.getElementById(selectId);
  if (sel) { sel.value = ''; _pmMarkPicker(selectId, inputId); }
}

/** Colour the picker and the input while a private recipient is selected. */
function _pmMarkPicker(selectId = 'chat-to', inputId = 'chat-input') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const priv = !!sel.value;
  sel.style.borderColor = priv ? 'var(--arc)' : '';
  sel.style.color = priv ? 'var(--arc)' : '';
  const input = document.getElementById(inputId);
  if (input) {
    input.style.borderColor = priv ? 'var(--arc)' : '';
    // Remember the page's own wording so it can be put back.
    if (input._pmPlaceholder == null) input._pmPlaceholder = input.placeholder;
    input.placeholder = priv
      ? `Private to ${(sel.options[sel.selectedIndex]?.textContent || '').replace(/^🔒\s*/, '').trim() || '…'}…`
      : input._pmPlaceholder;
  }
}

/** Wire the picker's own change event. Call once, after initChatRecipients. */
function bindChatRecipientPicker(selectId = 'chat-to', inputId = 'chat-input') {
  const sel = document.getElementById(selectId);
  if (sel && !sel._pmBound) {
    sel._pmBound = true;
    sel.addEventListener('change', () => _pmMarkPicker(selectId, inputId));
  }
}

// ── Receiving ─────────────────────────────────────────────────────────────────

/**
 * A private message exists with this id. Ask whether it is mine, and show it if
 * so. A 404 is the ordinary answer for everyone it was not addressed to.
 *
 * Resolves true when the message was shown, so a page with its own unread
 * indicator (the secondary console's tab dot) can do its own bookkeeping.
 */
async function onPrivateChatSignal(id) {
  if (!id) return false;
  if (document.querySelector(`[data-entry-id="${CSS.escape(String(id))}"]`)) return false;   // already shown
  try {
    const res = await fetch(`/api/chat/entry/${encodeURIComponent(id)}`, { headers: chatPmHeaders() });
    if (!res.ok) return false;
    const entry = await res.json();
    if (typeof appendChatEntry === 'function') appendChatEntry(entry);
    if (typeof scrollChatLog === 'function') scrollChatLog();
    // Same unread bookkeeping the public 'chat' handler does, where a page has it.
    if (typeof chatOpen !== 'undefined' && !chatOpen) {
      if (typeof chatUnread !== 'undefined') chatUnread++;
      if (typeof updateChatBadge === 'function') updateChatBadge();
    }
    return true;
  } catch { return false; }
}
