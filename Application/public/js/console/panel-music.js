// Written by Irmak Hakman — 2026-10-10 21:34
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: music ────────────────────────────────────────────────────────
// The panel used to carry its own copy of the music player. It now uses the
// same code as the table screen:
//
//   js/table/table-music.js  the audio element, the "now playing" line, the
//                            per-device volume, and the full player (/music.html)
//                            opened over the panel for the DM
//   js/lib/music-sync.js     decides which ONE window on this device makes the
//                            sound, so two open screens never play the track twice
//
// table-music.js finds its elements by id (bg-music, now-playing-*, music-modal,
// ...), and the panel's page simply provides those ids in its own design. All
// that is left here is what is particular to the panel.

// When something starts or stops playing: swap the "No music playing" line for
// the now-playing line, show the position row, and mark the More tab.
const _sPrevUpdateNowPlaying = updateNowPlaying;
window.updateNowPlaying = function (name, state) {
  _sPrevUpdateNowPlaying(name, state);
  const none = sEl('s-music-none');
  if (none) none.hidden = !!name;
  const seek = sEl('s-music-seekrow');
  if (seek) seek.hidden = !name;
  sMark('more', !!name && state !== 'paused');
};

function sMusicSheetOpen() {
  const modal = sEl('music-modal');
  return !!modal && modal.style.display !== 'none';
}
