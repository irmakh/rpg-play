// Written by Irmak Hakman — 2026-10-10 21:36
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: notifications ────────────────────────────────────────────────
// The bell, the list and the pop-up toasts are the shared code every page uses
// (js/lib/notifications.js); the panel only has to contain a [data-notif-bell]
// button and pass on the live 'notification' event (panel-realtime.js).
//
// One thing must differ here. Elsewhere, opening a notification follows its
// link to another page (/table.html, /index.html). On the console that would
// replace the info panel with a page that does not belong on this screen, so
// a notification opens the TAB that shows the same thing instead.

// Which tab shows what a notification of each kind is about.
const S_NOTIF_TABS = {
  'your-turn': 'turn', 'combat-started': 'turn',
  'chat': 'chat', 'dice': 'chat',
  'damage': 'token', 'healing': 'token', 'condition': 'token',
  'handout': 'handouts',
  'music': 'more',
};

// A toast's click only hands notifFollow() the notification's `data`, not its
// kind - so the kind is noted on the data when the toast is made.
const _sPrevNotifToast = notifToast;
window.notifToast = function (n) {
  if (n && n.data) n.data._kind = n.kind;
  _sPrevNotifToast(n);
};

// Replaces the shared notifFollow (which navigates to data.href).
window.notifFollow = function (data) {
  const kind = (data && data._kind)
    || (_notifItems.find(i => i.data === data) || {}).kind;
  const tab = S_NOTIF_TABS[kind];
  notifClose();
  // sShowTab falls back to Turn for a tab this page or this role does not have.
  if (tab) sShowTab(tab);
};

function sNotifListOpen() {
  return typeof _notifOpen !== 'undefined' && _notifOpen;
}
