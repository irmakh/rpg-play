// Written by Irmak Hakman — 2026-10-10 23:39
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: tabs, unread marks and the command bar ───────────────────────
// Six tabs: Turn, Token, Chat, Handouts, Table (DM only) and More. A tab that received
// something while you were elsewhere carries a small mark until you open it.
// The command bar along the bottom holds the actions that belong to the tab
// you are on; it disappears on tabs that have none.

const S_TABS = ['turn', 'token', 'chat', 'handouts', 'table', 'more'];

function sMark(tab, on) {
  const m = sEl(`s-mark-${tab}`);
  if (m) m.hidden = !on;
}

function sShowTab(name) {
  if (!S_TABS.includes(name)) name = 'turn';
  if (name === 'table' && !sIsDM()) name = 'turn';
  sCurrentTab = name;

  document.querySelectorAll('.p-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const t of S_TABS) {
    const view = sEl(`s-tab-${t}`);
    if (view) view.hidden = t !== name;
  }
  // Opening a tab is what clears its mark - except More, whose mark means
  // "music is playing" and stays for as long as it is.
  if (name !== 'more') sMark(name, false);

  if (name === 'turn') sRenderInitiative();
  if (name === 'token') sRenderHpPanel(sSelectedToken);
  if (name === 'chat') {
    sChatUnread = 0;
    const log = sEl('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (name === 'handouts') { sRenderHandouts(); sLoadHandouts(); }
  if (name === 'table') {
    sRenderTableInit();
    sRenderDmHpList();
    sRenderFogSection();
    sRenderItemsSection();
    sLoadPrepMaps();
  }

  sRenderCmd();
}

// What the logged-in role may see: the Table tab is the DM's.
function sApplyRole() {
  const dm = sIsDM();
  const tableTab = document.querySelector('.p-tab[data-tab="table"]');
  if (tableTab) tableTab.hidden = !dm;
  const who = sEl('s-who');
  if (who) who.textContent = sSessionName();
}

// ── Command bar ──────────────────────────────────────────────────────────────
// Each entry: [label, name of the function to call, optional class]. The entry
// marked 'go' is the one that moves the turn on; the gamepad's X button runs it.
function sCmdFor(tab) {
  if (tab !== 'turn') return [];
  const running = !!sInitData.currentId;
  if (sIsDM()) {
    return running
      ? [['Previous', 'sPrevTurn'], ['End initiative', 'sToggleInitiative'], ['Next turn', 'sNextTurn', 'go']]
      : [['Start initiative', 'sToggleInitiative', 'go']];
  }
  // A player may end a turn only while it is their own token's turn.
  const active = sTokens.find(t => t.id === sGetActiveTokId());
  if (running && active && sIsMyToken(active)) return [['End my turn', 'sNextTurn', 'go']];
  return [];
}

function sRenderCmd() {
  const bar = sEl('s-cmd');
  if (!bar) return;
  const cmds = sCmdFor(sCurrentTab);
  bar.hidden = cmds.length === 0;
  // Labels and function names are fixed strings from sCmdFor - nothing typed by
  // a user. The X badge shows only once a gamepad has been used (.pad-only).
  bar.innerHTML = cmds.map(([label, fn, cls]) =>
    `<button type="button" class="${cls || ''}" onclick="${fn}()">${cls === 'go' ? '<span class="c-key pad-only">X</span>' : ''}${label}</button>`).join('');
}
