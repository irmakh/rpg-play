// Written by Irmak Hakman — 2026-10-15 19:16
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * One console screen: a full-screen WebView showing one page of the server.
 *
 * Both screens run in this one app, so they share its cookies (the campaign)
 * and localStorage (button layout, display template); each page keeps its own
 * sessionStorage, and the two log in together through the page's own
 * BroadcastChannel (js/console/console-login.js).
 */
abstract class ScreenActivity : Activity() {
    /** The page this screen shows, e.g. "/console/table-console.html". */
    abstract val path: String

    /** Whether this screen takes the controller for the console (NativePad). */
    open val readsPad = true

    protected lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var lastPad = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)   // a tabletop sits idle a lot
        window.setDecorFitsSystemWindows(false)

        // Inspect the pages from a PC over USB (chrome://inspect) when something misbehaves.
        WebView.setWebContentsDebuggingEnabled(true)
        CookieManager.getInstance().setAcceptCookie(true)

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // the table's music starts on its own
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString RpgConsoleApp/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "RpgNative")
        // The remembered login, on every page before its own scripts run.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, REMEMBER_JS, setOf("*"))
        }
        web.webViewClient = object : WebViewClient() {
            // Pages of the server stay here; any other link opens in the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val server = Uri.parse(Settings.server(this@ScreenActivity))
                val url = request.url
                if (url.scheme == server.scheme && url.authority == server.authority) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: ActivityNotFoundException) {}
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // <input type="file">: a portrait, a chat picture, a handout.
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
        setContentView(web)
        Screens.register(this)
        load()
        if (this !is PanelActivity && this !is MaintenanceActivity) Updater.checkOnce(this)
    }

    private fun load() = web.loadUrl(Settings.server(this) + path)

    override fun onDestroy() {
        Screens.unregister(this)
        web.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    @Deprecated("Still the simplest result path for a plain Activity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    // ── The controller ──────────────────────────────────────────────────────
    // Taken here, before the WebView sees it, and handed to the map page as one
    // virtual gamepad - whichever screen Android is giving the controller to.

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (readsPad && NativePad.onKey(event)) { sendPad(); return true }
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (readsPad && NativePad.onMotion(event)) { sendPad(); return true }
        return super.dispatchGenericMotionEvent(event)
    }

    private fun sendPad() {
        val json = NativePad.json()
        if (json == lastPad) return
        lastPad = json
        Screens.padTarget()?.web?.evaluateJavascript("window.__rpgNativePad=$json;", null)
    }

    override fun onPause() {
        super.onPause()
        // Focus may move mid-press: a button held then would never be let go.
        NativePad.releaseAll()
        sendPad()
        // The campaign cookie goes to disk now, not whenever WebView gets to it:
        // the remembered login (console-login.js) needs it after a restart.
        CookieManager.getInstance().flush()
    }

    // ── Back: the app's own menu ────────────────────────────────────────────
    // Back goes back a page when there is one (the whole app moves between
    // pages; a pop-out opens in place), and opens the app's menu otherwise.
    @Deprecated("Back still reaches onBackPressed without the predictive-back opt-in")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else showMenu() }

    private fun showMenu() {
        val maintenance = this is MaintenanceActivity
        val items = mutableListOf<String>()
        if (maintenance) items += "Back to campaign"
        items += "Reload"
        if (!maintenance) items += "Server address…"
        if (this is MapActivity && !Screens.panelOpen) items += "Open info panel"
        if (!maintenance) items += "Maintenance"
        items += "Check for updates"
        items += "Exit"
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(getString(R.string.app_name))
            .setItems(items.toTypedArray()) { _, which ->
                when (items[which]) {
                    // Reload never touches the other side: reloading the
                    // maintenance page would log the super admin out.
                    "Reload" -> if (maintenance) load() else Screens.campaignScreens().forEach { it.load() }
                    "Back to campaign" -> moveTaskToBack(true)
                    "Maintenance" -> Screens.openMaintenance(this)
                    "Server address…" -> askServer()
                    "Open info panel" -> Screens.openPanel(this)
                    "Check for updates" -> Updater.checkNow(this)
                    "Exit" -> Screens.finishAll()
                }
            }
            .show()
    }

    private fun askServer() {
        val field = EditText(this).apply { setText(Settings.server(this@ScreenActivity)); setSingleLine() }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Server address")
            .setMessage("Default: ${Settings.DEFAULT_SERVER}")
            .setView(field)
            .setPositiveButton("Save") { _, _ ->
                if (Settings.setServer(this, field.text.toString())) Screens.campaignScreens().forEach { it.load() }
                else Toast.makeText(this, "Start it with https:// or http://", Toast.LENGTH_LONG).show()
            }
            .setNeutralButton("Default") { _, _ ->
                Settings.setServer(this, Settings.DEFAULT_SERVER)
                Screens.campaignScreens().forEach { it.load() }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── What the pages may ask of the app (window.RpgNative) ────────────────
    // Nothing here reads or changes anything outside the app's own two screens.
    inner class Bridge {
        /** The map's "Open info panel": on the bottom screen, not a browser window. */
        @JavascriptInterface
        fun openPanel() = runOnUiThread { Screens.openPanel(this@ScreenActivity) }

        /**
         * Whether this screen shows the login form. With both console screens
         * open only the map (top) does; the panel waits and follows it
         * (js/console/console-login.js). Alone, any screen does.
         */
        @JavascriptInterface
        fun isLoginScreen(): Boolean = this@ScreenActivity !is PanelActivity || !Screens.mapOpen

        /** The app's Back menu, for a page that wants to offer it. */
        @JavascriptInterface
        fun openMenu() = runOnUiThread { showMenu() }
    }

    private companion object {
        const val REQ_FILE = 1

        /**
         * Keeps the login on the device. The pages keep it in sessionStorage,
         * which a WebView loses when the app closes; this mirrors those keys
         * into localStorage as they are written or removed, and puts them back
         * before a page reads them. Logging out (or the server ending the
         * session, js/lib/realtime.js) removes them, and so removes the copy.
         * The server makes the session itself last (remember: true, sent by
         * the login forms when window.RpgNative is there).
         */
        const val REMEMBER_JS = """
(function () {
  if (window.__rpgRemember) return;
  window.__rpgRemember = true;
  var KEYS = ['rpgSession', 'tableMasterPw', 'dmMasterPw'], P = 'rpgApp:';
  try {
    var ss = window.sessionStorage, ls = window.localStorage;
    if (!ss.getItem('rpgSession')) {
      KEYS.forEach(function (k) { var v = ls.getItem(P + k); if (v !== null) ss.setItem(k, v); });
    }
    var proto = Storage.prototype, set = proto.setItem, rem = proto.removeItem, clr = proto.clear;
    proto.setItem = function (k, v) {
      set.call(this, k, v);
      if (this === ss && KEYS.indexOf(k) >= 0) set.call(ls, P + k, String(v));
    };
    proto.removeItem = function (k) {
      rem.call(this, k);
      if (this === ss && KEYS.indexOf(k) >= 0) rem.call(ls, P + k);
    };
    proto.clear = function () {
      clr.call(this);
      if (this === ss) KEYS.forEach(function (k) { rem.call(ls, P + k); });
    };
  } catch (e) {}
})();
"""
    }
}
