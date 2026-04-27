// ── 3D Dice Animation (engine in js/lib/dice-engine.js) ───────────────────────

function _broadcastDiceRoll(rollId, sides, dieResults, modifier, total, label, duration) {
  fetch('/api/dice/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollId, sides, dieResults, modifier, total, label, duration, sender: getChatSender() })
  }).catch(() => {});
}

// ── Chat input + dice commands ────────────────────────────────────────────────
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

window.addEventListener('load', loadChat);
