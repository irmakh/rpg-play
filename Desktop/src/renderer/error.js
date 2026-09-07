'use strict';

// Shown in place of a web-app screen when the server cannot be reached.
// Runs with the app preload, so only the two safe actions are available.

const params = new URLSearchParams(window.location.search);
const role = params.get('role') || 'main';
const failedUrl = params.get('url') || '';
const description = params.get('message') || 'The connection failed.';
const code = params.get('code') || '';

document.getElementById('sub').textContent =
  role === 'main' ? 'The server did not answer.' : `The ${role} screen could not load.`;
document.getElementById('detail').textContent = description;
document.getElementById('url').textContent = failedUrl || 'no address configured';
document.getElementById('code').textContent = code && code !== '0' ? `Chromium error code ${code}` : '';

function retry() {
  if (window.rpgDesktop) window.rpgDesktop.retry();
}

document.getElementById('retry').addEventListener('click', retry);
document.getElementById('setup').addEventListener('click', () => {
  if (window.rpgDesktop) window.rpgDesktop.openServerSetup();
});

// A DM restarting the server should not have to come back and click anything.
const countdown = document.getElementById('countdown');
let remaining = 20;
setInterval(() => {
  remaining -= 1;
  if (remaining <= 0) {
    remaining = 20;
    retry();
  }
  countdown.textContent = String(remaining);
}, 1000);
