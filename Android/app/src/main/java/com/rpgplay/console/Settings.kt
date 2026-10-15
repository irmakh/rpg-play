// Written by Irmak Hakman — 2026-10-15 18:28
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.content.Context

/** The one setting: which RPG Play server the two screens open. */
object Settings {
    const val DEFAULT_SERVER = "https://dnd.kimse.me"
    private const val PREFS = "rpg-console"
    private const val KEY_SERVER = "server"

    fun server(ctx: Context): String =
        (ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SERVER, null) ?: DEFAULT_SERVER)
            .trimEnd('/')

    /** Saves an address typed by the user; returns false when it is not http(s). */
    fun setServer(ctx: Context, value: String): Boolean {
        val url = value.trim().trimEnd('/')
        if (!url.startsWith("https://") && !url.startsWith("http://")) return false
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_SERVER, url).apply()
        return true
    }
}
