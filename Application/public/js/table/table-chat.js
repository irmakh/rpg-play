// ── Chat panel ────────────────────────────────────────────────────────────────
function chatToggle() {
  const body = document.getElementById('chat-body-wrap');
  const chev = document.getElementById('chat-chevron');
  if (!body) return;
  chatOpen = !chatOpen;
  body.classList.toggle('open', chatOpen);
  if (chev) chev.textContent = chatOpen ? '▼' : '▲';
  if (chatOpen) {
    chatUnread = 0;
    updateChatBadge();
    scrollChatLog();
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (chatUnread > 0) {
    badge.style.display = '';
    badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
  } else {
    badge.style.display = 'none';
  }
}

function appendChatEntry(e) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const rawTs = e.timestamp || '';
  const dt = rawTs ? new Date(rawTs + (rawTs.endsWith('Z') ? '' : 'Z')) : new Date();
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');

  if (e.type === 'text') {
    div.className = 'chat-entry chat-text';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span class="ce-sender">${esc(e.sender || '?')}</span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>
    <div style="word-break:break-word">${esc(e.message || '')}</div>`;
    log.appendChild(div);
    return;
  }

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    let mediaEl = '';
    if (e.mimeType && e.mimeType.startsWith('image/')) {
      mediaEl = `<img loading="lazy" src="${url}" style="max-width:100%;max-height:200px;width:auto;object-fit:contain;border-radius:4px;margin-top:4px;display:block">`;
    } else if (e.mimeType && e.mimeType.startsWith('video/')) {
      mediaEl = `<video src="${url}" controls style="max-width:100%;max-height:200px;border-radius:4px;margin-top:4px;display:block"></video>`;
    } else {
      mediaEl = `<a href="${url}" target="_blank" style="display:inline-block;margin-top:6px;padding:4px 8px;background:var(--bg3);border-radius:4px;color:var(--ac);font-size:11px">📎 Open file</a>`;
    }
    const cap = e.caption ? `<div style="font-size:10px;color:var(--txd);margin-top:4px">${esc(e.caption)}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender || 'DM')} <span style="font-size:10px;color:var(--txd);font-weight:normal">media</span></span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1
    ? ` <span style="font-size:10px;color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` — ${esc(e.label)}` : '';
  const natStr = isNat20 ? ' <span style="color:var(--ok)">✨ NAT 20!</span>'
               : isNat1  ? ' <span style="color:var(--err)">💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender || '?')}</span>
    <span style="color:var(--txd);font-size:10px">${time}</span>
  </div>
  <span style="color:var(--txd);font-size:11px">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--ok)' : isNat1 ? 'var(--err)' : 'var(--tx)'}">${e.total}${natStr}</div>`;
  log.appendChild(div);
}

function scrollChatLog() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

// ── 3D Dice Animation ─────────────────────────────────────────────────────────
// Polygon shapes (SVG points, 100×100 viewBox)
const DICE_POLY_POINTS = {
  4:   '50,8 93,83 7,83',                                   // triangle
  8:   '50,5 90,50 50,95 10,50',                            // diamond
  10:  '50,5 90,30 80,85 20,85 10,30',                      // pentagon
  12:  '50,6 81,19 94,50 81,81 50,94 19,81 6,50 19,19',    // octagon
  20:  '50,5 90,27 90,73 50,95 10,73 10,27',               // hexagon
  100: '50,6 76,14 92,36 92,64 76,86 50,94 24,86 8,64 8,36 24,14', // decagon
};
// Vertical text anchor per shape (centroid y in 0-100 space)
const DICE_TEXT_Y = { 4: 62, 8: 52, 10: 55, 12: 52, 20: 52, 100: 52 };

let _diceResolveFn   = null;
let _diceAutoClose   = null;
let _polyIntervals   = [];    // one per polygon die
const MAX_DICE_SHOW  = 8;

// Build one die DOM element; returns { container, animEl, textEl, isCube }
function _makeDieEl(sides, value, size, dur) {
  const isD6 = sides === 6;
  if (isD6) {
    const tz = size / 2;
    const faceTransforms = [
      `translateZ(${tz}px)`, `rotateY(180deg) translateZ(${tz}px)`,
      `rotateY(90deg) translateZ(${tz}px)`, `rotateY(-90deg) translateZ(${tz}px)`,
      `rotateX(90deg) translateZ(${tz}px)`, `rotateX(-90deg) translateZ(${tz}px)`,
    ];
    const faceVals = [value, ...Array.from({length:5}, () => Math.ceil(Math.random() * 6))];
    const fs = Math.round(size * 0.25);
    const br = Math.round(size * 0.12);

    const scene = document.createElement('div');
    scene.style.cssText = `perspective:700px;width:${size}px;height:${size}px;flex-shrink:0`;
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    cube.style.cssText = `width:${size}px;height:${size}px`;
    cube.style.setProperty('--roll-dur', `${dur}ms`);
    faceTransforms.forEach((t, i) => {
      const face = document.createElement('div');
      face.className = 'dice-face';
      face.style.cssText = `width:${size}px;height:${size}px;transform:${t};font-size:${fs}px;border-radius:${br}px`;
      face.textContent = faceVals[i];
      cube.appendChild(face);
    });
    scene.appendChild(cube);
    return { container: scene, animEl: cube, textEl: cube.children[0], isCube: true };
  } else {
    const pts  = DICE_POLY_POINTS[sides] || DICE_POLY_POINTS[20];
    const ty   = DICE_TEXT_Y[sides] || 52;
    const fid  = `dg${Math.random().toString(36).slice(2,7)}`;
    const rnd  = Math.ceil(Math.random() * sides);

    const wrap  = document.createElement('div');
    wrap.style.cssText = `perspective:700px;flex-shrink:0`;
    const inner = document.createElement('div');
    inner.className = 'dice-poly-inner';
    inner.style.setProperty('--roll-dur', `${dur}ms`);
    inner.innerHTML =
      `<svg width="${size}" height="${size}" viewBox="-5 -5 110 110">` +
      `<defs><filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="3" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
      `<polygon points="${pts}" fill="#0f3460" stroke="#c8a04a" stroke-width="2.5" filter="url(#${fid})"/>` +
      `<text x="50" y="${ty}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-size="26" font-weight="bold" fill="#c8a04a" font-family="Segoe UI,sans-serif">${rnd}</text></svg>`;
    wrap.appendChild(inner);
    return { container: wrap, animEl: inner, textEl: inner.querySelector('text'), isCube: false };
  }
}

// dieResults is an array of individual die face values; usedIdx = index of kept die for adv/dis (-1 = no dim)
function showDiceAnimation(sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
  const arr = Array.isArray(dieResults) ? dieResults : [dieResults];
  return new Promise(resolve => {
    if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
    _polyIntervals.forEach(clearInterval); _polyIntervals = [];
    if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
    _diceResolveFn = resolve;

    const dur   = duration ?? (1000 + Math.random() * 2000);
    const shown = Math.min(arr.length, MAX_DICE_SHOW);
    const size  = shown === 1 ? 120 : shown === 2 ? 100 : shown <= 4 ? 80 : 60;

    // Die-type label
    const diceLabel = arr.length > 1 ? `${arr.length}d${sides}` : `d${sides}`;
    document.getElementById('dice-type-lbl').textContent = diceLabel;

    // Result display (hidden until reveal)
    const bigEl = document.getElementById('dice-result-big');
    const subEl = document.getElementById('dice-result-sub');
    bigEl.textContent = total;
    bigEl.className   = 'dice-result-big';
    const usedVal = usedIdx >= 0 ? arr[usedIdx] : arr[0];
    if (sides === 20 && usedVal === 20) bigEl.classList.add('nat20');
    else if (sides === 20 && usedVal === 1) bigEl.classList.add('nat1');
    subEl.className = 'dice-result-sub';
    let sub = label || diceLabel;
    if (modifier !== 0) sub += (modifier > 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`) + ` = ${total}`;
    subEl.textContent = sub;

    // Build dice row
    const row = document.getElementById('dice-row');
    row.innerHTML = '';
    const reveals = []; // { textEl, val, isCube, container, isDimmed }

    for (let i = 0; i < shown; i++) {
      const { container, animEl, textEl, isCube } = _makeDieEl(sides, arr[i], size, dur);
      row.appendChild(container);
      void animEl.offsetWidth; // reflow → restart animation
      animEl.classList.add('rolling');
      const isDimmed = shown > 1 && usedIdx >= 0 && i !== usedIdx;
      reveals.push({ textEl, val: arr[i], isCube, container, isDimmed });

      if (!isCube) {
        const el = textEl;
        const id = setInterval(() => { el.textContent = Math.ceil(Math.random() * sides); }, 100);
        _polyIntervals.push(id);
      }
    }

    document.getElementById('dice-overlay').classList.add('active');

    setTimeout(() => {
      _polyIntervals.forEach(clearInterval); _polyIntervals = [];
      reveals.forEach(({ textEl, val, container, isDimmed }) => {
        textEl.textContent = val;
        if (isDimmed) container.style.cssText += ';opacity:0.35;filter:blur(1.5px);transition:opacity .4s,filter .4s';
      });
      bigEl.classList.add('show');
      subEl.classList.add('show');
      if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
      _diceAutoClose = setTimeout(dismissDiceOverlay, 2500);
    }, dur);
  });
}

function dismissDiceOverlay() {
  if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
  _polyIntervals.forEach(clearInterval); _polyIntervals = [];
  document.getElementById('dice-overlay').classList.remove('active');
  document.getElementById('dice-row').innerHTML = '';
  if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
}

// ── Dice roll helpers ─────────────────────────────────────────────────────────
function getActiveCharLinkedId() {
  const activeTokId = getActiveTurnTokenId() || selectedTokenId;
  const tok = tokens.find(t => t.id === activeTokId);
  if (!tok || tok.type === 'monster') return null;
  return tok.linkedId || null;
}

function _pushRollToChar(charId, entry) {
  if (!charId) return;
  fetch(`/api/characters/${charId}/roll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }).catch(() => {});
}

function _broadcastDiceRoll(rollId, sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
  fetch('/api/dice/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollId, sides, dieResults: Array.isArray(dieResults) ? dieResults : [dieResults], modifier, total, label, duration, usedIdx, sender: getChatSender() })
  }).catch(() => {});
}

async function postToChat(payload) {
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'roll' })
    });
  } catch {}
}

function getChatSender() {
  return qrollCharName || 'Table';
}

function parseDiceCommand(text) {
  const m = text.match(/^\/r(?:oll)?\s+(\d+)?d(\d+)\s*([+-]\d+)?\s*(.*)?$/i);
  if (!m) return null;
  return {
    count: Math.max(1, Math.min(20, parseInt(m[1] || '1'))),
    sides: parseInt(m[2]),
    modifier: parseInt(m[3] || '0'),
    label: (m[4] || '').trim() || null
  };
}

async function sendChatInput() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  const roll = parseDiceCommand(text);
  if (roll) {
    const { count, sides, modifier, label } = roll;
    const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
    const total = results.reduce((s, r) => s + r, 0) + modifier;
    const duration = 1000 + Math.random() * 2000;
    const rollId = Math.random().toString(36).slice(2);
    const lbl = label || `${count}d${sides}`;
    _selfRollIds.add(rollId);
    _broadcastDiceRoll(rollId, sides, results, modifier, total, lbl, duration);
    await showDiceAnimation(sides, results, modifier, total, lbl, duration);
    await postToChat({ sender: getChatSender(), dice: `${count}d${sides}`, results, modifier, total, label: lbl });
    _pushRollToChar(getActiveCharLinkedId(), { label: lbl, type: 'norm', detail: `${count}d${sides}(${results.join(',')})${modifier !== 0 ? (modifier > 0 ? '+' : '') + modifier : ''}`, total, isCrit: false, isFail: false, isDamage: false, time: new Date().toISOString() });
    return;
  }
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: getChatSender(), type: 'text', message: text })
    });
  } catch {}
}

async function quickRoll(sides) {
  const result   = Math.ceil(Math.random() * sides);
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, [result], 0, result, `d${sides}`, duration);
  await showDiceAnimation(sides, [result], 0, result, `d${sides}`, duration);
  await postToChat({ sender: getChatSender(), dice: `1d${sides}`, results: [result], modifier: 0, total: result, label: `d${sides}` });
  _pushRollToChar(getActiveCharLinkedId(), { label: `d${sides}`, type: 'norm', detail: `d${sides}(${result})`, total: result, isCrit: sides === 20 && result === 20, isFail: sides === 20 && result === 1, isDamage: false, time: new Date().toISOString() });
}

async function sendCustomRoll() {
  const count   = Math.max(1, Math.min(20, parseInt(document.getElementById('chat-count')?.value) || 1));
  const sides   = parseInt(document.getElementById('chat-sides')?.value) || 20;
  const mod     = parseInt(document.getElementById('chat-mod')?.value) || 0;
  const label   = document.getElementById('chat-label')?.value?.trim() || `${count}d${sides}`;
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total   = results.reduce((s, r) => s + r, 0) + mod;
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, results, mod, total, label, duration);
  await showDiceAnimation(sides, results, mod, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: `${count}d${sides}`, results, modifier: mod, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'norm', detail: `${count}d${sides}(${results.join(',')})${mod !== 0 ? (mod > 0 ? '+' : '') + mod : ''}`, total, isCrit: false, isFail: false, isDamage: false, time: new Date().toISOString() });
}

// ── Dice Roller Modal ─────────────────────────────────────────────────────────
const DICE_ROLLER_TYPES = [4, 6, 8, 10, 12, 20, 100];

function openDiceRollerModal() {
  const tbody = document.getElementById('dice-roller-tbody');
  if (tbody && !tbody.hasChildNodes()) {
    tbody.innerHTML = DICE_ROLLER_TYPES.map(sides => {
      const cells = [1,2,3,4,5,6].map(n =>
        `<td style="padding:2px 3px;text-align:center"><button class="btn sm" onclick="rollDiceModal(${n},${sides})" style="min-width:28px;font-size:11px">${n}</button></td>`
      ).join('');
      return `<tr><td style="padding:4px 6px;color:var(--ac);font-weight:bold;white-space:nowrap">d${sides}</td>${cells}</tr>`;
    }).join('');
  }
  document.getElementById('dice-roller-modal').style.display = 'flex';
}

function closeDiceRollerModal() {
  document.getElementById('dice-roller-modal').style.display = 'none';
}

async function rollDiceModal(count, sides) {
  const results  = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total    = results.reduce((s, r) => s + r, 0);
  const label    = `${count}d${sides}`;
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, results, 0, total, label, duration);
  await showDiceAnimation(sides, results, 0, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: label, results, modifier: 0, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'norm', detail: `${label}(${results.join(',')})`, total, isCrit: false, isFail: false, isDamage: false, time: new Date().toISOString() });
}

async function diceRollerD20(type) {
  const mod   = parseInt(document.getElementById('dice-roller-mod')?.value) || 0;
  const label = document.getElementById('dice-roller-label')?.value?.trim() || 'd20 roll';
  const r1 = Math.ceil(Math.random() * 20);
  const r2 = Math.ceil(Math.random() * 20);
  const results = type === 'norm' ? [r1] : [r1, r2];
  const picked  = type === 'adv' ? Math.max(r1, r2) : type === 'dis' ? Math.min(r1, r2) : r1;
  const total   = picked + mod;
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, 20, results, mod, total, label, duration);
  await showDiceAnimation(20, results, mod, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: type === 'norm' ? '1d20' : '2d20', results, modifier: mod, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type, detail: `d20(${results.join(',')})${mod !== 0 ? (mod > 0 ? '+' : '') + mod : ''}`, total, isCrit: picked === 20, isFail: picked === 1, isDamage: false, time: new Date().toISOString() });
}
