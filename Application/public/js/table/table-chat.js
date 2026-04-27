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
