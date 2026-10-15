// Written by Irmak Hakman — 2026-10-15 18:28
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.view.InputDevice
import android.view.InputEvent
import android.view.KeyEvent
import android.view.MotionEvent

/**
 * The handheld's controller, read natively and kept as one "standard layout"
 * gamepad: 17 buttons and 4 axes, numbered the way the browser Gamepad API
 * numbers them. The map page reads it as window.__rpgNativePad
 * (js/console/console-gamepad.js), so its button table, repeats and the
 * remapping in the info panel's More tab all work unchanged.
 *
 * Both screens' activities feed this one object, so it does not matter which
 * screen Android is giving the controller to (the last one touched).
 */
object NativePad {
    private const val BUTTONS = 17

    // Button state from key presses, and from the hat / trigger axes, kept
    // apart: a pad that reports its D-pad as a hat sends no key-up for it.
    private val keys = FloatArray(BUTTONS)
    private val analog = FloatArray(BUTTONS)
    private val axes = FloatArray(4)

    private val KEY_TO_BUTTON = mapOf(
        KeyEvent.KEYCODE_BUTTON_A to 0, KeyEvent.KEYCODE_BUTTON_B to 1,
        KeyEvent.KEYCODE_BUTTON_X to 2, KeyEvent.KEYCODE_BUTTON_Y to 3,
        KeyEvent.KEYCODE_BUTTON_L1 to 4, KeyEvent.KEYCODE_BUTTON_R1 to 5,
        KeyEvent.KEYCODE_BUTTON_L2 to 6, KeyEvent.KEYCODE_BUTTON_R2 to 7,
        KeyEvent.KEYCODE_BUTTON_SELECT to 8, KeyEvent.KEYCODE_BUTTON_START to 9,
        KeyEvent.KEYCODE_BUTTON_THUMBL to 10, KeyEvent.KEYCODE_BUTTON_THUMBR to 11,
        KeyEvent.KEYCODE_DPAD_UP to 12, KeyEvent.KEYCODE_DPAD_DOWN to 13,
        KeyEvent.KEYCODE_DPAD_LEFT to 14, KeyEvent.KEYCODE_DPAD_RIGHT to 15,
        KeyEvent.KEYCODE_BUTTON_MODE to 16,
    )

    /** From the controller, not a keyboard or the touch screen. */
    private fun fromPad(e: InputEvent): Boolean {
        val pad = InputDevice.SOURCE_GAMEPAD
        val stick = InputDevice.SOURCE_JOYSTICK
        if (e.source and pad == pad || e.source and stick == stick) return true
        val dev = e.device ?: return false
        return dev.sources and pad == pad || dev.sources and stick == stick
    }

    /** Takes a controller key; returns true when it was one (and is consumed). */
    fun onKey(e: KeyEvent): Boolean {
        val i = KEY_TO_BUTTON[e.keyCode] ?: return false
        if (!fromPad(e)) return false
        when (e.action) {
            KeyEvent.ACTION_DOWN -> keys[i] = 1f
            KeyEvent.ACTION_UP -> keys[i] = 0f
        }
        return true
    }

    /** Takes stick / hat / trigger movement; returns true when it was the controller's. */
    fun onMotion(e: MotionEvent): Boolean {
        if (!fromPad(e) || e.action != MotionEvent.ACTION_MOVE) return false
        axes[0] = e.getAxisValue(MotionEvent.AXIS_X)
        axes[1] = e.getAxisValue(MotionEvent.AXIS_Y)
        axes[2] = e.getAxisValue(MotionEvent.AXIS_Z)
        axes[3] = e.getAxisValue(MotionEvent.AXIS_RZ)
        val hx = e.getAxisValue(MotionEvent.AXIS_HAT_X)
        val hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y)
        analog[12] = if (hy < -0.5f) 1f else 0f
        analog[13] = if (hy > 0.5f) 1f else 0f
        analog[14] = if (hx < -0.5f) 1f else 0f
        analog[15] = if (hx > 0.5f) 1f else 0f
        analog[6] = maxOf(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE))
        analog[7] = maxOf(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS))
        return true
    }

    /** Lets go of everything (a screen lost the controller mid-press). */
    fun releaseAll() { keys.fill(0f); analog.fill(0f); axes.fill(0f) }

    /** The pad as a Gamepad-shaped JSON object for the page. */
    fun json(): String {
        val sb = StringBuilder("{\"buttons\":[")
        for (i in 0 until BUTTONS) {
            val v = maxOf(keys[i], analog[i])
            if (i > 0) sb.append(',')
            sb.append("{\"pressed\":").append(v > 0.5f).append(",\"value\":").append(v).append('}')
        }
        sb.append("],\"axes\":[")
        axes.forEachIndexed { i, v -> if (i > 0) sb.append(','); sb.append(v) }
        return sb.append("]}").toString()
    }
}
