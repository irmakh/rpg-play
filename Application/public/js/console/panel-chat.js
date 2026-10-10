// Written by Irmak Hakman — 2026-10-10 21:41
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: Chat tab ─────────────────────────────────────────────────────
// The log itself is drawn by js/lib/chat-render.js (appendChatEntry), the same
// renderer every other chat in the app uses; private messages by chat-pm.js.

function sSendChat() {
  const input = sEl('s-chat-input');
  const msg   = (input?.value || '').trim();
  if (!msg) return;
  input.value = '';
  // "/r 2d6+5" rolls dice instead of sending text.
  const rollMatch = msg.match(/^\/r\s+(.+)/i);
  if (rollMatch) { sRollDiceExpr(rollMatch[1]); return; }
  // A recipient makes this a private message. sAuthHeaders() already carries our
  // credential, which the server needs to know who a private message is from.
  const to = typeof chatPmTarget === 'function' ? chatPmTarget('s-chat-to') : '';
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({ type: 'text', message: msg, sender: sGetSender(), ...(to ? { to } : {}) }),
  }).then(async res => {
    if (!to) return;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      sToast('Message not sent: ' + (err.error || res.status));
      return;
    }
    // Back to Everyone, so nobody keeps whispering by accident.
    resetChatRecipient('s-chat-to', 's-chat-input');
  }).catch(() => {});
}

function sRollDie(sides) { sRollDiceExpr(`d${sides}`); }

function sRollDiceExpr(expr) {
  const m = expr.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { sToast('Write dice like 2d6+5.'); return; }
  const count   = parseInt(m[1] || '1');
  const sides   = parseInt(m[2]);
  const mod     = parseInt(m[3] || '0');
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total   = results.reduce((a, b) => a + b, 0) + mod;
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({
      type: 'roll', dice: expr.trim(), results, modifier: mod,
      total, sender: sGetSender(), rollId: Math.random().toString(36).slice(2),
    }),
  }).catch(() => {});
}

// Posts a titled card to chat: a spell, an action. `html` is trusted markup
// (a player's own spell notes), `text` is plain and gets escaped here. The
// server keeps html:true only from a logged-in sender, so the card carries our
// credential; without it the card would arrive as escaped text.
function sPostInfoCard({ name, meta, text, html } = {}) {
  let body = `<strong>${esc(name || '')}</strong>`;
  const parts = (meta || []).filter(Boolean);
  if (parts.length) body += `<div style="font-size:10px;opacity:.7;margin-top:1px">${esc(parts.join(', '))}</div>`;
  const desc = html != null && html !== '' ? html : (text ? esc(String(text)).replace(/\n/g, '<br>') : '');
  if (desc) body += `<div style="margin-top:4px">${desc}</div>`;
  sMark('chat', sCurrentTab !== 'chat');
  return fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({ sender: sGetSender(), type: 'text', message: body, html: true }),
  }).catch(() => {});
}

// A new line arrived: keep the log at the bottom, and mark the tab if it is not open.
function sChatArrived() {
  const log = sEl('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  if (sCurrentTab !== 'chat') {
    sChatUnread++;
    sMark('chat', true);
  }
}
