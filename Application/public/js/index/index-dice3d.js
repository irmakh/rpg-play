// ── 3D Dice Animation ─────────────────────────────────────────────────────────
const DICE_POLY_POINTS = {
  4:   '50,8 93,83 7,83',
  8:   '50,5 90,50 50,95 10,50',
  10:  '50,5 90,30 80,85 20,85 10,30',
  12:  '50,6 81,19 94,50 81,81 50,94 19,81 6,50 19,19',
  20:  '50,5 90,27 90,73 50,95 10,73 10,27',
  100: '50,6 76,14 92,36 92,64 76,86 50,94 24,86 8,64 8,36 24,14',
};
const DICE_TEXT_Y = { 4: 62, 8: 52, 10: 55, 12: 52, 20: 52, 100: 52 };

let _diceResolveFn = null;
let _diceAutoClose = null;
let _polyIntervals = [];
const MAX_DICE_SHOW = 8;

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
    const pts = DICE_POLY_POINTS[sides] || DICE_POLY_POINTS[20];
    const ty  = DICE_TEXT_Y[sides] || 52;
    const fid = `dg${Math.random().toString(36).slice(2,7)}`;
    const rnd = Math.ceil(Math.random() * sides);
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
    const diceLabel = arr.length > 1 ? `${arr.length}d${sides}` : `d${sides}`;
    document.getElementById('dice-type-lbl').textContent = diceLabel;
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
    const row = document.getElementById('dice-row');
    row.innerHTML = '';
    const reveals = [];
    for (let i = 0; i < shown; i++) {
      const { container, animEl, textEl, isCube } = _makeDieEl(sides, arr[i], size, dur);
      row.appendChild(container);
      void animEl.offsetWidth;
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

function _broadcastDiceRoll(rollId, sides, dieResults, modifier, total, label, duration) {
  fetch('/api/dice/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollId, sides, dieResults, modifier, total, label, duration, sender: getChatSender() })
  }).catch(() => {});
}

// ── Dice command parser + chat input ──────────────────────────────────────────
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
    return;
  }
  await postToChat({ sender: getChatSender(), type: 'text', message: text });
}

function rollDie(sides) { return Math.ceil(Math.random() * sides); }

async function quickRoll(sides) {
  const results = [rollDie(sides)];
  const total   = results[0];
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, results, 0, total, `d${sides}`, duration);
  await showDiceAnimation(sides, results, 0, total, `d${sides}`, duration);
  await postToChat({ sender: getChatSender(), dice: `1d${sides}`, results, modifier: 0, total, label: `d${sides}` });
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function chatToggle() {
  chatOpen = !chatOpen;
  document.getElementById('chat-body-wrap').classList.toggle('open', chatOpen);
  document.getElementById('chat-chevron').textContent = chatOpen ? '▼' : '▲';
  if (chatOpen) {
    if (!initTrackerCollapsed) initTogglePanel();
    chatUnread = 0;
    const badge = document.getElementById('chat-badge');
    if (badge) badge.style.display = 'none';
    scrollChatLog();
  }
}

function getChatSender() {
  return document.querySelector('[data-key="name"]')?.value?.trim() || 'Player';
}

async function postToChat(payload) {
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {}
}

async function loadChat() {
  try {
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    const entries = await res.json();
    const log = document.getElementById('chat-log');
    if (!log) return;
    log.innerHTML = '';
    entries.forEach(e => appendChatEntry(e));
    scrollChatLog();
  } catch {}
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
    const capEsc  = e.caption ? esc(e.caption) : '';
    const capAttr = e.caption ? e.caption.replace(/\\/g,'\\\\').replace(/'/g,"\\'") : '';
    let mediaEl = '';
    if (e.mimeType.startsWith('image/')) {
      const inlineUrl = (e.mediumUrl && e.mimeType.startsWith('image/')) ? e.mediumUrl : url;
      mediaEl = `<img loading="lazy" src="${inlineUrl}" style="max-width:100%;max-height:220px;width:auto;object-fit:contain;border-radius:4px;margin-top:4px;cursor:zoom-in;display:block" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')" title="Click to view full size">`;
    } else if (e.mimeType.startsWith('video/')) {
      mediaEl = `<video src="${url}" controls style="max-width:100%;max-height:220px;border-radius:4px;margin-top:4px;display:block"></video><div style="font-size:10px;color:var(--txd);margin-top:2px;cursor:pointer" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')">⛶ Open in viewer</div>`;
    } else {
      mediaEl = `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px;background:var(--bg3);border-radius:4px" onclick="openMediaModal('${url}','${e.mimeType}','${capAttr}')"><span style="font-size:20px">🎵</span><span style="font-size:11px;color:var(--ac)">Play audio</span></div>`;
    }
    const cap = e.caption ? `<div style="font-size:10px;color:var(--txd);margin-top:4px">${capEsc}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender)} <span style="font-size:10px;color:var(--txd);font-weight:normal">shared media</span></span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1 ? ` <span style="color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` <span style="color:var(--txd)">— ${esc(e.label)}</span>` : '';
  const natStr = isNat20 ? '<span class="ce-nat" style="color:var(--ok)"> ✨ NAT 20!</span>'
               : isNat1  ? '<span class="ce-nat" style="color:var(--err)"> 💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender)}</span>
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

function openMediaModal(url, mimeType, caption) {
  const content = document.getElementById('media-modal-content');
  const capEl   = document.getElementById('media-modal-caption');
  if (mimeType.startsWith('image/')) {
    content.innerHTML = `<img src="${url}" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:6px;display:block;cursor:default" onclick="event.stopPropagation()">`;
  } else if (mimeType.startsWith('video/')) {
    content.innerHTML = `<video src="${url}" controls autoplay style="max-width:92vw;max-height:88vh;border-radius:6px;display:block" onclick="event.stopPropagation()"></video>`;
  } else {
    content.innerHTML = `<div onclick="event.stopPropagation()" style="background:#1a1a2e;border-radius:8px;padding:24px 32px;text-align:center"><div style="font-size:40px;margin-bottom:12px">🎵</div><audio src="${url}" controls autoplay style="min-width:280px"></audio></div>`;
  }
  capEl.textContent = caption || '';
  capEl.style.display = caption ? '' : 'none';
  document.getElementById('media-modal').style.display = 'flex';
}

function closeMediaModal() {
  document.getElementById('media-modal').style.display = 'none';
  document.getElementById('media-modal-content').innerHTML = '';
}

window.addEventListener('load', loadChat);
