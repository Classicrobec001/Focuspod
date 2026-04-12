package com.focuspod.blocking

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * FocusPodBlockingModule
 *
 * Exposes native Android app-blocking primitives to React Native.
 *
 * Permissions required (declared in AndroidManifest.xml):
 *   - PACKAGE_USAGE_STATS  (granted via Settings.ACTION_USAGE_ACCESS_SETTINGS)
 *   - BIND_ACCESSIBILITY_SERVICE  (granted via Settings.ACTION_ACCESSIBILITY_SETTINGS)
 *
 * The blocking loop polls the foreground app every 500ms using UsageStatsManager.
 * When a blocked app is detected, it launches FocusPod's MainActivity on top.
 */
class FocusPodBlockingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "FocusPodBlocking"

    // ─── Audio focus state ────────────────────────────────────────────────
    private var audioFocusRequest: AudioFocusRequest? = null  // API 26+ only

    /**
     * Listener registered for both the legacy and modern audio focus APIs.
     *
     * Emits React Native DeviceEvents so JS can react to every focus change:
     *   FocusPodAudioFocusGained  — focus is ours; resume playback if paused
     *   FocusPodAudioFocusLost    — permanent loss; stop gracefully
     *   FocusPodAudioFocusDucked  — transient loss/duck; pause or lower volume
     *
     * ExoPlayer (via RNTP autoHandleInterruptions) already acts on these
     * internally, but on some OEM Android builds that internal handler is
     * unreliable — emitting events gives JS a guaranteed second chance.
     */
    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
        val (label, jsEvent) = when (change) {
            AudioManager.AUDIOFOCUS_GAIN ->
                Pair("GAIN", "FocusPodAudioFocusGained")
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT ->
                Pair("GAIN_TRANSIENT", "FocusPodAudioFocusGained")
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK ->
                Pair("GAIN_TRANSIENT_MAY_DUCK", "FocusPodAudioFocusGained")
            AudioManager.AUDIOFOCUS_LOSS ->
                Pair("LOSS (permanent)", "FocusPodAudioFocusLost")
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ->
                Pair("LOSS_TRANSIENT", "FocusPodAudioFocusDucked")
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                Pair("LOSS_TRANSIENT_CAN_DUCK", "FocusPodAudioFocusDucked")
            else ->
                Pair("UNKNOWN($change)", null)
        }
        Log.d("FocusPod", "[AudioFocus] change: $label")
        jsEvent?.let {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(it, label)
        }
    }

    private var blockedPackages: Set<String> = emptySet()
    private var blockingThread: Thread? = null
    @Volatile private var isBlocking = false

    // ─── Permission Checks ─────────────────────────────────────────────────

    @ReactMethod
    fun hasUsageStatsPermission(promise: Promise) {
        val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            reactContext.packageName,
        )
        promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    }

    @ReactMethod
    fun hasAccessibilityPermission(promise: Promise) {
        val enabledServices = Settings.Secure.getString(
            reactContext.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: ""
        val colonSplitter = TextUtils.SimpleStringSplitter(':')
        colonSplitter.setString(enabledServices)
        var hasPermission = false
        while (colonSplitter.hasNext()) {
            val componentName = colonSplitter.next()
            if (componentName.contains(reactContext.packageName, ignoreCase = true)) {
                hasPermission = true
                break
            }
        }
        promise.resolve(hasPermission)
    }

    @ReactMethod
    fun openUsageStatsSettings(promise: Promise) {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        reactContext.startActivity(intent)
        promise.resolve(null)
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        reactContext.startActivity(intent)
        promise.resolve(null)
    }

    // ─── Audio Focus ──────────────────────────────────────────────────────

    /**
     * Requests AUDIOFOCUS_GAIN for long-running media playback.
     * Uses AudioFocusRequest.Builder on API 26+ and falls back to the
     * deprecated single-arg overload on older versions.
     * Returns true if focus was granted immediately, false if it was delayed
     * or denied (RNTP/ExoPlayer will still attempt playback regardless).
     */
    @ReactMethod
    fun requestAudioFocus(promise: Promise) {
        try {
            val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val result: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .build()
                audioFocusRequest = req
                result = am.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                result = am.requestAudioFocus(
                    audioFocusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN,
                )
            }
            val granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            Log.d("FocusPod", "[AudioFocus] requestAudioFocus result=$result granted=$granted")
            promise.resolve(granted)
        } catch (e: Exception) {
            Log.e("FocusPod", "[AudioFocus] requestAudioFocus error: ${e.message}")
            promise.reject("AUDIO_FOCUS_ERROR", e.message)
        }
    }

    /**
     * Abandons audio focus when playback is intentionally stopped (not just paused).
     * Allows other apps (music, podcasts) to reclaim focus cleanly.
     */
    @ReactMethod
    fun abandonAudioFocus(promise: Promise) {
        try {
            val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(audioFocusChangeListener)
            }
            audioFocusRequest = null
            Log.d("FocusPod", "[AudioFocus] abandonAudioFocus done")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("AUDIO_FOCUS_ERROR", e.message)
        }
    }

    // ─── Volume ────────────────────────────────────────────────────────────

    /**
     * Sets STREAM_MUSIC to its hardware maximum and returns the max volume step.
     * No special permission is required — any app can call setStreamVolume on STREAM_MUSIC.
     * The FLAG_SHOW_UI flag (0x1) is intentionally omitted so the system volume OSD
     * is not displayed.
     */
    @ReactMethod
    fun setMusicVolumeToMax(promise: Promise) {
        try {
            val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            am.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0)
            promise.resolve(max)
        } catch (e: Exception) {
            promise.reject("SET_VOLUME_ERROR", e.message)
        }
    }

    // ─── Installed Apps ────────────────────────────────────────────────────

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            val result = Arguments.createArray()
            for (app in apps) {
                if (app.flags and ApplicationInfo.FLAG_SYSTEM != 0) continue
                val map = Arguments.createMap()
                map.putString("packageName", app.packageName)
                map.putString("appName", pm.getApplicationLabel(app).toString())
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("GET_APPS_ERROR", e.message)
        }
    }

    // ─── Blocking Control ──────────────────────────────────────────────────

    @ReactMethod
    fun startBlocking(packages: ReadableArray, promise: Promise) {
        blockedPackages = (0 until packages.size()).map { packages.getString(it) ?: "" }.toSet()
        isBlocking = true
        blockingThread?.interrupt()
        blockingThread = Thread {
            val usm = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            while (isBlocking && !Thread.currentThread().isInterrupted) {
                try {
                    val now = System.currentTimeMillis()
                    val stats = usm.queryUsageStats(
                        UsageStatsManager.INTERVAL_DAILY,
                        now - 1000,
                        now,
                    )
                    val foreground = stats?.maxByOrNull { it.lastTimeUsed }?.packageName
                    if (foreground != null && blockedPackages.contains(foreground)) {
                        bringFocusPodToFront()
                        sendBlockEvent(foreground)
                    }
                    Thread.sleep(500)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.also { it.start() }
        promise.resolve(null)
    }

    @ReactMethod
    fun stopBlocking(promise: Promise) {
        isBlocking = false
        blockingThread?.interrupt()
        blockingThread = null
        blockedPackages = emptySet()
        promise.resolve(null)
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private fun bringFocusPodToFront() {
        val pm = reactContext.packageManager
        val intent = pm.getLaunchIntentForPackage(reactContext.packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        reactContext.startActivity(intent)
    }

    private fun sendBlockEvent(packageName: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("FocusPodAppBlocked", packageName)
    }
}
