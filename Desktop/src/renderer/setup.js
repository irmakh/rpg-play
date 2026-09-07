'use strict';

const urlInput = document.getElementById('url');
const testButton = document.getElementById('test');
const connectButton = document.getElementById('connect');
const cancelButton = document.getElementById('cancel');
const message = document.getElementById('msg');
const mismatch = document.getElementById('mismatch');

let firstRun = true;

function say(text, kind) {
  message.textContent = text;
  message.className = 'msg' + (kind ? ' ' + kind : '');
}

function busy(on) {
  testButton.disabled = on;
  urlInput.disabled = on;
  if (on) connectButton.disabled = true;
}

// A probe has to succeed before Connect lights up, so a typo cannot be saved.
function invalidate() {
  connectButton.disabled = true;
  showMismatch(null);
  if (message.classList.contains('ok')) say('');
}

// The server told us which host it publishes live updates on. If that is not
// the host being connected to — the usual cause is reaching it by IP when it has
// a domain — say so and offer the switch, because the symptom otherwise is a
// table that silently stops updating.
function showMismatch(result) {
  mismatch.textContent = '';
  if (!result || !result.hostMismatch) return;

  const box = document.createElement('div');
  box.className = 'warn';

  const text = document.createElement('div');
  text.textContent =
    `This server sends live updates from ${result.hostMismatch}, not from the address you entered. ` +
    `Connecting this way puts realtime traffic on a different origin than the pages. ` +
    `Use the published address instead.`;

  const button = document.createElement('button');
  button.textContent = `Use ${result.hostMismatch}`;
  button.style.marginTop = '10px';
  button.addEventListener('click', () => {
    const scheme = result.url.startsWith('https') ? 'https' : 'http';
    urlInput.value = `${scheme}://${result.hostMismatch}`;
    invalidate();
    test();
  });

  box.append(text, button);
  mismatch.append(box);
}

async function test() {
  const value = urlInput.value.trim();
  if (!value) return say('Enter a server address.', 'err');

  busy(true);
  say('Contacting server…', 'info');
  try {
    const result = await window.desktop.probeServer(value);
    if (result.ok) {
      connectButton.disabled = false;
      say(`Found an RPG Table server at ${result.url} (${result.dbProvider}).`, 'ok');
      showMismatch(result);
    } else {
      say(result.error, 'err');
      showMismatch(null);
    }
  } catch (err) {
    say(String((err && err.message) || err), 'err');
  } finally {
    busy(false);
  }
}

async function connect() {
  const value = urlInput.value.trim();
  busy(true);
  connectButton.disabled = true;
  say('Connecting…', 'info');
  try {
    const result = await window.desktop.saveServer(value);
    // On success the main process opens the app window and closes this one.
    if (!result.ok) {
      say(result.error, 'err');
      busy(false);
    }
  } catch (err) {
    say(String((err && err.message) || err), 'err');
    busy(false);
  }
}

testButton.addEventListener('click', test);
connectButton.addEventListener('click', connect);
cancelButton.addEventListener('click', () => window.desktop.close());
urlInput.addEventListener('input', invalidate);
urlInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!connectButton.disabled) connect();
  else test();
});

(async function init() {
  try {
    const state = await window.desktop.state();
    firstRun = !state.config.serverUrl;
    if (state.config.serverUrl) {
      urlInput.value = state.config.serverUrl;
      say('Currently connected to this server. Change it and press Test.', 'info');
    }
    // Cancel would strand a first-run user on an empty app, so it quits instead
    // of pretending there is something to go back to.
    cancelButton.textContent = firstRun ? 'Quit' : 'Cancel';
  } catch {
    say('Could not read settings.', 'err');
  }
  urlInput.focus();
  urlInput.select();
})();
