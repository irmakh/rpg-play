// ── 3D Dice Animation (engine in js/lib/dice-engine.js) ───────────────────────

// `groups` (optional) carries a multi-type damage roll so every other client
// replays the same grouped overlay. sides/dieResults stay populated from the
// first group, so a client that does not understand groups still animates.
function _broadcastDiceRoll(rollId, sides, dieResults, modifier, total, label, duration, usedIdx = -1, groups = null) {
  fetch('/api/dice/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollId, sides, dieResults, modifier, total, label, duration, ...(groups ? { groups } : {}), sender: getChatSender() })
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
    // Typed damage — "/dmg 1d6 fire" or "/r 1d6 piercing, 2d8 fire".
    if (roll.damage) {
      const dmg = rollDamageSpec(roll.damage);
      const lbl = roll.expr;
      const duration = 1000 + Math.random() * 2000;
      const rollId = Math.random().toString(36).slice(2);
      const first = dmg.parts[0];
      _selfRollIds.add(rollId);
      _broadcastDiceRoll(rollId, first.sides || 6, first.rolls.length ? first.rolls : [first.total],
                         first.modifier, dmg.total, lbl, duration, -1, dmg.groups);
      await showDiceGroups(dmg.groups, dmg.total, lbl, duration);
      await postToChat({ sender: getChatSender(), ...dmgChatPayload(dmg, lbl) });
      return;
    }
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
