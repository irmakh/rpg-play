// Written by Irmak Hakman — 2026-11-15 12:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * "Send to chat" cards for what a character has: an item, a spell, a
 * companion, an action. Shared by the character sheet and the table so a card
 * reads the same whichever page posted it.
 *
 * Each *ChatCard() returns { name, meta: [..], text } or { name, meta, html }:
 * `text` is plain (escaped here, newlines kept), `html` is already safe markup
 * (a library spell's text from spell-data.js; the chat sanitises it again).
 * chatCardHTML() turns one into the message body. Needs esc.js.
 */

// Long descriptions are cut to fit the chat's 4000 characters for a formatted
// message (escaping and <br> make the text longer once it is markup).
function chatCardTrim(t) {
  const s = String(t || '').trim();
  return s.length > 2400 ? s.slice(0, 2400).replace(/\s+\S*$/, '') + ' …' : s;
}

function chatCardHTML({ name, meta, text, html } = {}) {
  let body = `<strong>${esc(name || '')}</strong>`;
  const parts = (meta || []).filter(Boolean);
  if (parts.length) body += `<div style="font-size:calc(10px * var(--fs, 1));opacity:.7;margin-top:1px">${esc(parts.join(' · '))}</div>`;
  const descHtml = html != null && html !== ''
    ? html
    : (text ? esc(String(text)).replace(/\n/g, '<br>') : '');
  if (descHtml) body += `<div style="margin-top:calc(4px*var(--fs, 1))">${descHtml}</div>`;
  return body;
}

function _ccSigned(n) {
  const v = parseInt(n) || 0;
  return (v >= 0 ? '+' : '') + v;
}

function itemChatCard(it) {
  const t = it.itemType;
  const meta = [t === 'armor' ? `${it.armorType || 'light'} armor`.replace(/^./, c => c.toUpperCase())
    : t === 'shield' ? 'Shield' : t === 'weapon' ? 'Weapon' : t === 'potion' ? 'Potion'
    : t === 'wondrous' || t === 'item' ? 'Wondrous item' : 'Item'];
  if (it.unidentified) {
    meta.push('Unidentified');
  } else {
    if (t === 'armor') meta.push(`AC ${parseInt(it.acBase) || 10}`);
    if (t === 'weapon' && it.weaponDmg) meta.push(`${parseInt(it.weaponAtk) ? _ccSigned(it.weaponAtk) + ' ' : ''}${it.weaponDmg}`);
    if (parseInt(it.acBonus)) meta.push(`AC ${_ccSigned(it.acBonus)}`);
    if (parseInt(it.initBonus)) meta.push(`Init ${_ccSigned(it.initBonus)}`);
    if (parseInt(it.speedBonus)) meta.push(`Speed ${_ccSigned(it.speedBonus)} ft`);
    if (parseInt(it.spellAtkBonus)) meta.push(`Spell atk ${_ccSigned(it.spellAtkBonus)}`);
    if (parseInt(it.spellDcBonus)) meta.push(`Spell DC ${_ccSigned(it.spellDcBonus)}`);
    const max = Math.max(0, parseInt(it.charges) || 0);
    if (max) meta.push(`${Math.max(0, max - Math.min(max, parseInt(it.chargesUsed) || 0))}/${max} charges`);
    if (it.requiresAttunement) meta.push('Requires attunement');
  }
  return { name: it.name || 'Item', meta, text: chatCardTrim(it.notes) };
}

function spellChatCard(s) {
  const meta = [typeof spellLevelLabel === 'function' ? spellLevelLabel(s.level) : (s.level ? `Level ${s.level}` : 'Cantrip')];
  const cast = s.castText || (typeof spellCastLabel === 'function' ? spellCastLabel(s) : '');
  if (cast) meta.push(`⏱ ${cast}`);
  if (s.range) meta.push(`🎯 ${s.range}`);
  if (s.duration) meta.push(`⏳ ${s.conc ? 'Concentration, ' : ''}${s.duration}`);
  // A library spell's own text (built safe by spell-data.js), then the
  // player's notes, which may carry links (chat sanitises them).
  const desc = (typeof spellDescHTML === 'function' ? spellDescHTML(s) : '') + (s.notes || '');
  return { name: s.name || 'Spell', meta, html: desc };
}

function companionChatCard(c) {
  const meta = [`HP ${parseInt(c.hpMax) || 0}`];
  if (c.ac !== '' && c.ac != null) meta.push(`AC ${c.ac}`);
  meta.push(`${parseInt(c.speed) || 0} ft`, `Init ${_ccSigned(c.initBonus)}`);
  const atks = (Array.isArray(c.attacks) ? c.attacks : []).map(a =>
    `${a.name || 'Attack'}${a.toHit !== '' && a.toHit != null ? ' ' + _ccSigned(a.toHit) + ' to hit' : ''}${a.damage ? ', ' + a.damage : ''}`);
  const text = [atks.join('\n'), chatCardTrim(c.notes)].filter(Boolean).join('\n\n');
  return { name: c.name || 'Companion', meta, text };
}

function actionChatCard(a) {
  const meta = [];
  const cat = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction', other: 'Other' }[a.category];
  if (cat) meta.push(cat);
  if (a.dice) meta.push(`🎲 ${a.dice}`);
  const uses = parseInt(a.uses) || 0;
  if (uses > 0) meta.push(`Uses ${uses - Math.min(parseInt(a.used) || 0, uses)}/${uses}`);
  return { name: a.name || 'Action', meta, text: chatCardTrim(a.description) };
}
