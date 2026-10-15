// Written by Irmak Hakman — 2026-10-15 19:01
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

package com.rpgplay.console

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Keeps the app up to date from the server it talks to.
 *
 * On start the app reads <server>/downloads/rpg-console.json, which build.sh
 * writes next to the APK: {versionCode, versionName, url, sha256}. When it names
 * a newer build, the app offers it; on "Update" it downloads the APK, checks its
 * SHA-256, and hands it to Android's own installer.
 *
 * Android never lets a sideloaded app replace itself silently, so there is
 * always one "Update" tap on Android's screen - and the first time, Android
 * asks to allow installs from this app. Android also refuses any APK that is
 * not signed with the same key as the installed app (make-keystore.sh), so a
 * file swapped on the server cannot take its place.
 */
object Updater {
    private const val MANIFEST_PATH = "/downloads/rpg-console.json"
    private const val ACTION_STATUS = "com.rpgplay.console.INSTALL_STATUS"
    private var checked = false

    /** Once per app start, in the background; quiet when nothing is newer or offline. */
    fun checkOnce(activity: Activity) {
        if (checked) return
        checked = true
        check(activity, quiet = true)
    }

    /** From the Back menu: always says what it found. */
    fun checkNow(activity: Activity) = check(activity, quiet = false)

    private fun check(activity: Activity, quiet: Boolean) {
        val server = Settings.server(activity)
        Thread {
            val info = try { JSONObject(fetchText("$server$MANIFEST_PATH")) } catch (_: Exception) { null }
            activity.runOnUiThread {
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                val code = info?.optInt("versionCode", 0) ?: 0
                when {
                    info == null -> if (!quiet) toast(activity, "Could not check for updates.")
                    code <= BuildConfig.VERSION_CODE -> if (!quiet) toast(activity, "This is the latest version (${BuildConfig.VERSION_NAME}).")
                    else -> offer(activity, server, info)
                }
            }
        }.start()
    }

    private fun offer(activity: Activity, server: String, info: JSONObject) {
        val name = info.optString("versionName", "")
        AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Update available")
            .setMessage("RPG Console $name is ready (you have ${BuildConfig.VERSION_NAME}). Install it now?")
            .setPositiveButton("Update") { _, _ -> install(activity, server, info) }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun install(activity: Activity, server: String, info: JSONObject) {
        // The first time, Android asks the user to allow installs from this app.
        if (!activity.packageManager.canRequestPackageInstalls()) {
            toast(activity, "Allow RPG Console to install updates, then press Back and choose Check for updates.")
            activity.startActivity(Intent(AndroidSettings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")))
            return
        }
        val url = info.optString("url", "").let { if (it.startsWith("/")) server + it else it }
        val sha = info.optString("sha256", "").lowercase()
        toast(activity, "Downloading the update…")
        Thread {
            val error = try {
                val apk = File(activity.cacheDir, "update.apk")
                download(url, apk)
                if (sha.isNotEmpty() && sha256(apk) != sha) "The download was damaged. Try again."
                else { commit(activity, apk); null }
            } catch (e: Exception) { "Update failed: ${e.message}" }
            if (error != null) activity.runOnUiThread { toast(activity, error) }
        }.start()
    }

    private fun commit(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("rpg-console.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val status = Intent(ctx, InstallStatusReceiver::class.java).setAction(ACTION_STATUS)
            val pi = PendingIntent.getBroadcast(ctx, id, status,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            session.commit(pi.intentSender)
        }
    }

    private fun fetchText(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 8000
        c.setRequestProperty("Cache-Control", "no-cache")
        try {
            if (c.responseCode != 200) throw IllegalStateException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally { c.disconnect() }
    }

    private fun download(url: String, to: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 30000
        try {
            if (c.responseCode != 200) throw IllegalStateException("HTTP ${c.responseCode}")
            c.inputStream.use { input -> to.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun toast(ctx: Context, msg: String) = Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
}

/** Android's answer about the install: show its confirm screen, or report a failure. */
class InstallStatusReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit   // the app restarts as the new version
            else -> Toast.makeText(ctx, "Update not installed: " +
                (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unknown error"), Toast.LENGTH_LONG).show()
        }
    }
}
