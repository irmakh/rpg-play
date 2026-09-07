'use strict';

const message = document.getElementById('msg');
const grid = document.getElementById('shortcut-grid');
const warning = document.getElementById('shortcut-warning');

const inputs = new Map();       // action -> <input>
let state = null;

function say(text, kind) {
  message.textContent = text;
  message.className = 'msg' + (kind ? ' ' + kind : '');
}

// ── Accelerator capture ───────────────────────────────────────────────────────

const NAMED_KEYS = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  Backslash: '\\',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
};

// Translates a key press into the accelerator syntax Electron registers with.
function keyFromEvent(event) {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
  return NAMED_KEYS[code] || null;
}

function acceleratorFromEvent(event) {
  const key = keyFromEvent(event);
  if (!key) return null;

  const parts = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');

  // A system-wide shortcut with no modifier would swallow that key everywhere.
  if (!parts.length) return null;

  parts.push(key);
  return parts.join('+');
}

function attachCapture(input) {
  input.addEventListener('keydown', (event) => {
    event.preventDefault();

    if (event.key === 'Backspace' || event.key === 'Delete') {
      input.value = '';
      say('');
      return;
    }

    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) {
      // Modifier-only presses are the normal case here — stay quiet for those.
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        say('Use at least one modifier — Ctrl, Alt, Shift or Win.', 'err');
      }
      return;
    }

    input.value = accelerator;
    say('');
  });

  input.addEventListener('focus', () => input.select());
}

function buildShortcutRows(actions, values) {
  grid.textContent = '';
  for (const [action, label] of Object.entries(actions)) {
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;          // the value only ever comes from a key press
    input.placeholder = 'Not set';
    input.value = values[action] || '';
    attachCapture(input);

    grid.append(name, input);
    inputs.set(action, input);
  }
}

function showFailures(failures) {
  warning.textContent = '';
  if (!failures || !failures.length) return;
  const box = document.createElement('div');
  box.className = 'warn';
  box.textContent =
    'Windows would not grant these shortcuts — another application already owns them: ' +
    failures.map((f) => f.accelerator).join(', ') + '.';
  warning.append(box);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

async function load() {
  state = await window.desktop.state();
  const config = state.config;

  document.getElementById('server-url').textContent = config.serverUrl || 'not configured';
  document.getElementById('config-path').textContent = state.configPath || '—';
  document.getElementById('shortcuts-enabled').checked = !!config.shortcutsEnabled;
  document.getElementById('tray-enabled').checked = !!config.trayEnabled;
  document.getElementById('close-to-tray').checked = !!config.closeToTray;

  buildShortcutRows(state.shortcutActions, config.shortcuts || {});
  showFailures(state.shortcutFailures);
}

async function save() {
  const shortcuts = {};
  for (const [action, input] of inputs) shortcuts[action] = input.value.trim();

  const result = await window.desktop.saveSettings({
    shortcuts,
    shortcutsEnabled: document.getElementById('shortcuts-enabled').checked,
    trayEnabled: document.getElementById('tray-enabled').checked,
    closeToTray: document.getElementById('close-to-tray').checked,
  });

  showFailures(result.shortcutFailures);
  if (result.shortcutFailures && result.shortcutFailures.length) {
    say('Saved, but some shortcuts could not be registered.', 'err');
  } else {
    say('Saved.', 'ok');
  }
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('close').addEventListener('click', () => window.desktop.close());
document.getElementById('change-server').addEventListener('click', () => window.desktop.openSetup());

document.getElementById('reset-windows').addEventListener('click', async () => {
  await window.desktop.resetWindowState();
  say('Window positions and zoom levels cleared. They apply the next time each window opens.', 'ok');
});

document.getElementById('forget-certs').addEventListener('click', async () => {
  await window.desktop.forgetCertificates();
  say('Trusted certificates forgotten. You will be asked again on the next connection.', 'ok');
});

document.getElementById('clear-data').addEventListener('click', async () => {
  const result = await window.desktop.clearData();
  if (result.cancelled) return;
  say(result.ok ? 'Browsing data cleared.' : 'Could not clear browsing data.', result.ok ? 'ok' : 'err');
});

load().catch(() => say('Could not read settings.', 'err'));
