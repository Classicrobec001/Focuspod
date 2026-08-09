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
import java.lang.ref.WeakReference

/**
 * FocusPodBlockingModule
 *
 * Exposes native Android app-blocking primitives to React Native.
 *
 * ─── Blocking architecture ────────────────────────────────────────────────────
 *
 * PRIMARY:  FocusPodAccessibilityService (TYPE_WINDOW_STATE_CHANGED)
 *   • Event-driven — fires the instant an app window comes to the foreground.
 *   • Zero polling overhead.
 *   • Requires the user to enable FocusPod under Settings → Accessibility.
 *   • startBlocking() sets FocusPodAccessibilityService.blockedPackages.
 *
 * FALLBACK: UsageStatsManager polling thread (500 ms interval)
 *   • Always started alongside the accessibility path as a safety net.
 *   • Effective on devices/emulators where the accessibility service is not yet
 *     enabled, or where it is killed by the system under memory pressure.
 *   • Requires PACKAGE_USAGE_STATS permission (Usage Access in Settings).
 *   • On Android 10+ and most emulators the UsageStats data may be stale by
 *     several seconds, so this path is intentionally secondary.
 *
 * ─── Permissions required ─────────────────────────────────────────────────────
 *   - PACKAGE_USAGE_STATS  (Settings > Special App Access > Usage Access)
 *   - BIND_ACCESSIBILITY_SERVICE  (Settings > Accessibility > FocusPod)
 */
class FocusPodBlockingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "FocusPodBlocking"

    // ─── Audio focus state ────────────────────────────────────────────────────

    private var audioFocusRequest: AudioFocusRequest? = null  // API 26+ only

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
        Log.d(TAG, "[AudioFocus] change: $label")
        jsEvent?.let {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(it, label)
        }
    }

    // ─── Blocking state ───────────────────────────────────────────────────────

    private var blockingThread: Thread? = null
    @Volatile private var isBlocking = false

    // ─── Permission checks ────────────────────────────────────────────────────

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
        promise.resolve(isAccessibilityServiceEnabled())
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        // Check 1: live instance (most reliable — the service is definitely running).
        if (FocusPodAccessibilityService.isRunning()) return true

        // Check 2: system enabled-services string (service declared but may not
        // have fired onServiceConnected yet, e.g. during a cold app start).
        val enabledServices = Settings.Secure.getString(
            reactContext.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        while (splitter.hasNext()) {
            if (splitter.next().contains(reactContext.packageName, ignoreCase = true)) {
                return true
            }
        }
        return false
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

    // ─── Audio focus ──────────────────────────────────────────────────────────

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
            Log.d(TAG, "[AudioFocus] requestAudioFocus result=$result granted=$granted")
            promise.resolve(granted)
        } catch (e: Exception) {
            Log.e(TAG, "[AudioFocus] requestAudioFocus error: ${e.message}")
            promise.reject("AUDIO_FOCUS_ERROR", e.message)
        }
    }

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
            Log.d(TAG, "[AudioFocus] abandonAudioFocus done")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("AUDIO_FOCUS_ERROR", e.message)
        }
    }

    // ─── Volume ───────────────────────────────────────────────────────────────

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

    // ─── Installed apps ───────────────────────────────────────────────────────

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

    // ─── Blocking control ─────────────────────────────────────────────────────

    @ReactMethod
    fun startBlocking(packages: ReadableArray, promise: Promise) {
        val pkgSet = (0 until packages.size())
            .map { packages.getString(it) ?: "" }
            .filter { it.isNotBlank() }
            .toSet()

        // ── Diagnostics ───────────────────────────────────────────────────────
        val a11yRunning   = FocusPodAccessibilityService.isRunning()
        val a11yEnabled   = isAccessibilityServiceEnabled()
        val appOps        = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val usageGranted  = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            reactContext.packageName,
        ) == AppOpsManager.MODE_ALLOWED

        Log.d(TAG, "═══════════════════════════════════════════")
        Log.d(TAG, "[Blocking] startBlocking() called")
        Log.d(TAG, "[Blocking]   packages to block : $pkgSet")
        Log.d(TAG, "[Blocking]   a11y service live  : $a11yRunning")
        Log.d(TAG, "[Blocking]   a11y in sys setting: $a11yEnabled")
        Log.d(TAG, "[Blocking]   PACKAGE_USAGE_STATS: $usageGranted")
        if (!a11yEnabled) {
            Log.w(TAG, "[Blocking] ⚠ Accessibility service NOT enabled — " +
                  "real-time blocking unavailable. User must enable FocusPod " +
                  "under Settings → Accessibility. Falling back to UsageStats polling.")
        }
        if (!usageGranted) {
            Log.w(TAG, "[Blocking] ⚠ PACKAGE_USAGE_STATS NOT granted — " +
                  "UsageStats fallback will also be ineffective. " +
                  "Grant Usage Access in Settings → Special App Access.")
        }
        Log.d(TAG, "═══════════════════════════════════════════")

        // ── Wire blocked packages into the accessibility service ──────────────
        // The service reads this @Volatile field directly in onAccessibilityEvent.
        FocusPodAccessibilityService.blockedPackages = pkgSet

        // ── Start UsageStats polling fallback ─────────────────────────────────
        isBlocking = true
        blockingThread?.interrupt()
        blockingThread = Thread {
            val usm = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            var pollCount = 0L
            Log.d(TAG, "[Blocking/Poll] thread started (fallback path)")
            while (isBlocking && !Thread.currentThread().isInterrupted) {
                try {
                    val now = System.currentTimeMillis()
                    // 5-second look-back: UsageStatsManager only updates every
                    // few seconds on emulators; a 1-second window misses events.
                    val stats = usm.queryUsageStats(
                        UsageStatsManager.INTERVAL_DAILY,
                        now - 5_000L,
                        now,
                    )
                    val topEntry   = stats?.maxByOrNull { it.lastTimeUsed }
                    val foreground = topEntry?.packageName

                    // Log every poll so the user can verify what the system sees.
                    // Use Log.v (verbose) to keep it filterable; logcat -s FocusPod:V
                    Log.v(TAG, "[Blocking/Poll] #$pollCount foreground=$foreground" +
                          " statsEntries=${stats?.size ?: 0}" +
                          " a11yLive=$a11yRunning")

                    if (foreground != null && pkgSet.contains(foreground)) {
                        Log.w(TAG, "[Blocking/Poll] BLOCKED app foreground: $foreground" +
                              " — firing redirect (UsageStats fallback path)")
                        bringFocusPodToFront()
                        emitBlockEvent(foreground)
                    }

                    pollCount++
                    Thread.sleep(500)
                } catch (_: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "[Blocking/Poll] unexpected error: ${e.message}")
                }
            }
            Log.d(TAG, "[Blocking/Poll] thread exited after $pollCount polls")
        }.also { it.start() }

        Log.d(TAG, "[Blocking] polling thread id=${blockingThread?.id}")
        promise.resolve(null)
    }

    @ReactMethod
    fun stopBlocking(promise: Promise) {
        Log.d(TAG, "[Blocking] stopBlocking() — clearing a11y packages + stopping poll thread")
        FocusPodAccessibilityService.blockedPackages = emptySet()
        isBlocking = false
        blockingThread?.interrupt()
        blockingThread = null
        promise.resolve(null)
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun bringFocusPodToFront() {
        val ownPkg = reactContext.packageName
        val intent  = reactContext.packageManager.getLaunchIntentForPackage(ownPkg)
        if (intent == null) {
            Log.e(TAG, "[Blocking] getLaunchIntentForPackage($ownPkg) returned null")
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        Log.d(TAG, "[Blocking] startActivity → $ownPkg (NEW_TASK|REORDER_TO_FRONT)")
        reactContext.startActivity(intent)
    }

    // ─── Static helpers (called from FocusPodAccessibilityService) ────────────

    companion object {
        private const val TAG = "FocusPod"

        // Weak ref so the module doesn't prevent GC if React reloads.
        private var moduleRef: WeakReference<FocusPodBlockingModule>? = null

        fun register(module: FocusPodBlockingModule) {
            moduleRef = WeakReference(module)
        }

        /**
         * Emit a JS DeviceEvent when a blocked app is detected.
         * Called from both the polling thread and FocusPodAccessibilityService.
         */
        fun emitBlockEvent(packageName: String) {
            moduleRef?.get()?.let { module ->
                try {
                    module.reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("FocusPodAppBlocked", packageName)
                } catch (e: Exception) {
                    Log.w(TAG, "[Blocking] emitBlockEvent failed: ${e.message}")
                }
            }
        }
    }

    init {
        // Register this instance so FocusPodAccessibilityService can emit JS events.
        register(this)
    }
}
