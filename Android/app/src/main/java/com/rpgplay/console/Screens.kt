// Written by Irmak Hakman — 2026-10-15 19:02
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.app.Activity
import android.app.ActivityOptions
import android.content.Intent
import android.hardware.display.DisplayManager
import android.view.Display
import java.lang.ref.WeakReference

/**
 * Where the two screens are and how they are opened.
 *
 * The map goes on the main display (the Thor's top screen) and the info panel
 * on the second one (the bottom screen), each as its own task so each can sit
 * on its own display: the "second activity" way of using the bottom screen,
 * as OpenNOW's Thor deck does (a Presentation window there is reported to
 * take the controller's focus, and on Android 13 to be refused).
 * On a device with one screen the icon opens the whole app instead
 * (AppActivity), as in a browser.
 */
object Screens {
    private var map: WeakReference<ScreenActivity>? = null
    private var panel: WeakReference<ScreenActivity>? = null
    private var app: WeakReference<ScreenActivity>? = null

    fun register(a: ScreenActivity) {
        when (a) {
            is MapActivity -> map = WeakReference(a)
            is PanelActivity -> panel = WeakReference(a)
            else -> app = WeakReference(a)
        }
    }

    fun unregister(a: ScreenActivity) {
        if (map?.get() === a) map = null
        if (panel?.get() === a) panel = null
        if (app?.get() === a) app = null
    }

    private fun alive(ref: WeakReference<ScreenActivity>?) = ref?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }

    val panelOpen: Boolean get() = alive(panel) != null
    val mapOpen: Boolean get() = alive(map) != null

    /** The page the controller is fed to: the map, or the panel when it is alone. */
    fun padTarget(): ScreenActivity? = alive(map) ?: alive(panel)

    fun all(): List<ScreenActivity> = listOfNotNull(alive(map), alive(panel), alive(app))

    /** The display the info panel belongs on, or null when there is only one. */
    fun secondDisplay(a: Activity): Display? {
        val dm = a.getSystemService(DisplayManager::class.java)
        return dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }
            ?: dm.displays.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }
    }

    private fun start(from: Activity, cls: Class<out Activity>, displayId: Int?) {
        val intent = Intent(from, cls).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (displayId == null) { from.startActivity(intent); return }
        val opts = ActivityOptions.makeBasic().setLaunchDisplayId(displayId)
        try {
            from.startActivity(intent, opts.toBundle())
        } catch (e: SecurityException) {
            // The display refused us (not every second display takes apps):
            // open it where we are instead.
            from.startActivity(intent)
        }
    }

    /** What the app icon does: both console screens, or the whole app on a one-screen device. */
    fun openBoth(from: Activity) {
        val second = secondDisplay(from)
        if (second == null) { start(from, AppActivity::class.java, null); return }
        start(from, MapActivity::class.java, Display.DEFAULT_DISPLAY)
        start(from, PanelActivity::class.java, second.displayId)
    }

    /** The info panel, on the second display when there is one. */
    fun openPanel(from: Activity) {
        start(from, PanelActivity::class.java, secondDisplay(from)?.displayId)
    }

    fun finishAll() { all().forEach { it.finish() } }
}
