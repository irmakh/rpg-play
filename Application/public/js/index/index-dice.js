// ── Dice rolling ──────────────────────────────────────────────────────────────
const SKILL_NAMES = ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];
const AB_NAMES = {str:'Strength',dex:'Dexterity',con:'Constitution',int:'Intelligence',wis:'Wisdom',cha:'Charisma'};

let toastTimer = null;
let toastDismissHandler = null;
let _autoSaveTimer = null;
let _initEditMode  = false;
let _spAtkEditMode = false;

function startRoll(label, modifier) {
  rollPending = { label, modifier: parseInt(modifier) || 0 };
  document.getElementById('adv-label').textContent = 'Roll: ' + label;
  document.getElementById('adv-modal').style.display = 'flex';
}


function confirmRoll(type) {
  if (!rollPending) return;
  document.getElementById('adv-modal').style.display = 'none';
  const { label, modifier, isInitiative, initCharName } = rollPending;
  rollPending = null;
  const d1 = Math.ceil(Math.random() * 20);
  const d2 = Math.ceil(Math.random() * 20);
  let used, detail;
  if (type === 'adv') {
    used = Math.max(d1, d2);
    detail = `d20(${d1}, ${d2} → ${used})`;
  } else if (type === 'dis') {
    used = Math.min(d1, d2);
    detail = `d20(${d1}, ${d2} → ${used})`;
  } else {
    used = d1;
    detail = `d20(${d1})`;
  }
  if (modifier !== 0) detail += (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier);
  const total = used + modifier;
  const entry = { time: new Date(), label, type, detail, total, isCrit: used === 20, isFail: used === 1, isDamage: false };
  pushRoll(entry);
  showToast(entry);
  if (isInitiative) submitInitiativeRoll(total, initCharName);
  const chatLabel = type === 'adv' ? `${label} (Adv)` : type === 'dis' ? `${label} (Dis)` : label;
  postToChat({ sender: getChatSender(), dice: '1d20', results: [used], modifier, total, label: chatLabel });
}


function rollDamage(label, expr) {
  const result = parseDice(expr.trim());
  if (!result) return;
  const entry = { time: new Date(), label, type: 'dmg', detail: result.detail, total: result.total, isCrit: false, isFail: false, isDamage: true };
  pushRoll(entry);
  showToast(entry);
  postToChat({ sender: getChatSender(), dice: result.diceExpr || String(result.total), results: result.rolls || [result.total], modifier: result.mod || 0, total: result.total, label });
}

function rollWeaponAtk(btn) {
  const row = btn.closest('tr');
  const inputs = row.querySelectorAll('input[type=text], input[type=number]');
  startRoll((inputs[0]?.value || 'Weapon') + ' Attack', inputs[1]?.value || '+0');
}

function rollWeaponDmg(btn) {
  const row = btn.closest('tr');
  const inputs = row.querySelectorAll('input[type=text], input[type=number]');
  rollDamage((inputs[0]?.value || 'Weapon') + ' Damage', inputs[2]?.value || '1d6');
}

function showToast(entry) {
  clearTimeout(toastTimer);
  if (toastDismissHandler) { document.removeEventListener('click', toastDismissHandler); toastDismissHandler = null; }
  document.getElementById('toast-label').textContent = entry.label;
  const badge = document.getElementById('toast-badge');
  if (entry.isDamage)          { badge.textContent = 'Damage';        badge.className = 'toast-badge dmg'; }
  else if (entry.type==='adv') { badge.textContent = 'Advantage';     badge.className = 'toast-badge adv'; }
  else if (entry.type==='dis') { badge.textContent = 'Disadvantage';  badge.className = 'toast-badge dis'; }
  else                         { badge.textContent = 'Normal';        badge.className = 'toast-badge norm'; }
  const tot = document.getElementById('toast-total');
  tot.textContent = entry.total;
  tot.className = 'toast-total' + (entry.isCrit ? ' crit' : entry.isFail ? ' fail' : '');
  document.getElementById('toast-detail').textContent = entry.detail;
  document.getElementById('roll-toast').style.display = 'block';
  toastTimer = setTimeout(hideToast, 30000);
  setTimeout(() => {
    toastDismissHandler = () => hideToast();
    document.addEventListener('click', toastDismissHandler, { once: true });
  }, 200);
}

function hideToast() {
  clearTimeout(toastTimer);
  if (toastDismissHandler) { document.removeEventListener('click', toastDismissHandler); toastDismissHandler = null; }
  document.getElementById('roll-toast').style.display = 'none';
}

function setInitEditMode() {
  const el = document.querySelector('[data-key="init"]');
  if (!el) return;
  _initEditMode = true;
  el.classList.remove('rollable');
  el.focus();
  el.select();
}
function setSpAtkEditMode() {
  const el = document.querySelector('[data-key="sp-atk"]');
  if (!el) return;
  _spAtkEditMode = true;
  el.classList.remove('rollable');
  el.focus();
  el.select();
}

function pushRoll(entry) {
  rollHistory.unshift(entry);
  if (rollHistory.length > 100) rollHistory.pop();
  renderRollHistory();
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => saveCharacter(true), 600);
}

function renderRollHistory() {
  const list = document.getElementById('rh-list');
  if (!list) return;
  if (rollHistory.length === 0) {
    list.innerHTML = '<li style="color:var(--txd);font-size:12px;padding:8px">No rolls yet — click any modifier on the sheet to roll!</li>';
    return;
  }
  const pad = n => String(n).padStart(2,'0');
  list.innerHTML = rollHistory.map(e => {
    const t = e.time;
    const tStr = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    const bc = e.isDamage ? 'dmg' : e.type === 'adv' ? 'adv' : e.type === 'dis' ? 'dis' : 'norm';
    const bl = e.isDamage ? 'DMG' : e.type === 'adv' ? 'ADV' : e.type === 'dis' ? 'DIS' : 'NRM';
    const tc = e.isCrit ? ' crit' : e.isFail ? ' fail' : '';
    return `<li class="rh-row"><span class="rh-time">${tStr}</span><span class="rh-label">${esc(e.label)}</span><span class="rh-badge ${bc}">${bl}</span><span class="rh-detail">${esc(e.detail)}</span><span class="rh-total${tc}">${e.total}</span></li>`;
  }).join('');
}

function clearRollHistory() {
  rollHistory.length = 0;
  renderRollHistory();
}

function rollWeaponAtkVal(name, atk) { startRoll(name + ' Attack', atk); }
function rollWeaponDmgVal(name, dmg)  { rollDamage(name + ' Damage', dmg); }

function initRollClickHandlers() {
  // Skills: insert a roll button after each skill value input
  for (let i = 0; i < 18; i++) {
    const el = document.querySelector(`[data-key="sk-${i}"]`);
    if (!el) continue;
    const btn = document.createElement('button');
    btn.className = 'sk-roll-btn';
    btn.title = 'Roll ' + SKILL_NAMES[i];
    btn.textContent = '🎲';
    btn.type = 'button';
    (function(idx) {
      btn.addEventListener('click', function() {
        const valEl = document.querySelector(`[data-key="sk-${idx}"]`);
        startRoll(SKILL_NAMES[idx], valEl ? valEl.value : '0');
      });
    })(i);
    el.parentNode.insertBefore(btn, el.nextSibling);
  }
  // Saving throws
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.querySelector(`[data-key="save-${s}"]`);
    if (!el) return;
    const btn = document.createElement('button');
    btn.className = 'sk-roll-btn';
    btn.title = 'Roll ' + AB_NAMES[s] + ' Save';
    btn.textContent = '🎲';
    btn.type = 'button';
    btn.addEventListener('click', function() {
      const valEl = document.querySelector(`[data-key="save-${s}"]`);
      startRoll(AB_NAMES[s] + ' Save', valEl ? valEl.value : '0');
    });
    el.parentNode.insertBefore(btn, el.nextSibling);
  });
  // Ability modifier circles
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (!el) return;
    el.classList.add('rollable');
    el.title = 'Click to roll ' + AB_NAMES[s] + ' check';
    el.addEventListener('click', function() { startRoll(AB_NAMES[s] + ' Check', this.value); });
  });
  // Initiative
  const initEl = document.querySelector('[data-key="init"]');
  if (initEl) {
    initEl.classList.add('rollable');
    initEl.title = 'Click to roll Initiative';
    initEl.addEventListener('click', function() { if (_initEditMode) return; rollMyInitiative(); });
    initEl.addEventListener('blur', function() { _initEditMode = false; this.classList.add('rollable'); });
  }
  // Spell attack bonus
  const spAtkEl = document.querySelector('[data-key="sp-atk"]');
  if (spAtkEl) {
    spAtkEl.classList.add('rollable');
    spAtkEl.title = 'Click to roll spell attack';
    spAtkEl.addEventListener('click', function() { if (_spAtkEditMode) return; startRoll('Spell Attack', this.value); });
    spAtkEl.addEventListener('blur', function() { _spAtkEditMode = false; this.classList.add('rollable'); });
  }
}
