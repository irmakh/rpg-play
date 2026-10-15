// Written by Irmak Hakman — 2026-10-15 18:28
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.app.Activity
import android.os.Bundle

/** The app icon: opens the map and the info panel on their screens, then closes. */
class LaunchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Screens.openBoth(this)
        finish()
    }
}
