// Written by Irmak Hakman — 2026-10-15 19:16
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

/** The top screen: the map (console/table-console.html). */
class MapActivity : ScreenActivity() {
    override val path = "/console/table-console.html"
}

/** The bottom screen: the info panel (console/table-secondary.html). */
class PanelActivity : ScreenActivity() {
    override val path = "/console/table-secondary.html"
}

/**
 * A device with one screen: the whole RPG Play app (campaigns, then the sheet,
 * the table and the rest), as in a browser. The controller is left to the page.
 */
class AppActivity : ScreenActivity() {
    override val path = "/"
    override val readsPad = false
}

/**
 * The super admin's maintenance page, in a window of its own beside the
 * campaign screens. Its login lives only in the page's memory, so the window
 * is kept rather than reloaded: Back menu → "Back to campaign" sends it behind
 * the campaign, and "Maintenance" brings it back still logged in.
 */
class MaintenanceActivity : ScreenActivity() {
    override val path = "/maintenance.html"
    override val readsPad = false
}
