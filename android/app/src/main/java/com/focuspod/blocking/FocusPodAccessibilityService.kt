package com.focuspod.blocking

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * FocusPodAccessibilityService
 *
 * Intercepts TYPE_WINDOW_STATE_CHANGED events — fired by Android any time an
 * app's window comes to the foreground — and redirects the user back to
 * FocusPod when the new foreground package is on the blocked list.
 *
 * This is the PRIMARY blocking mechanism. It is event-driven (zero latency)
 * compared to the UsageStatsManager polling fallback in FocusPodBlockingModule,
 * which can lag 2-5 seconds on emulators and is unreliable on Android 10+.
 *
 * Lifecycle:
 *   • Android starts this service when the user enables it under
 *     Settings → Accessibility → Installed apps → FocusPod.
 *   • onServiceConnected() fires — the static [instance] ref is set here.
 *   • FocusPodBlockingModule.startBlocking() writes the blocked package set to
 *     the companion [blockedPackages] field.  No IPC needed — same process.
 *   • Every window-change event calls onAccessibilityEvent().
 *   • onDestroy() clears [instance].
 *
 * Requires in AndroidManifest.xml:
 *   <service android:name=".blocking.FocusPodAccessibilityService"
 *            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
 *            android:exported="true">
 *       <intent-filter>
 *           <action android:name="android.accessibilityservice.AccessibilityService"/>
 *       </intent-filter>
 *       <meta-data android:name="android.accessibilityservice"
 *                  android:resource="@xml/accessibility_service_config"/>
 *   </service>
 */
class FocusPodAccessibilityService : AccessibilityService() {

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "[A11y] Service CONNECTED — configuring event filter")

        // Configure programmatically (belt-and-suspenders alongside the XML).
        // Only TYPE_WINDOW_STATE_CHANGED is needed; anything else is noise.
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes    = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType  = AccessibilityServiceInfo.FEEDBACK_GENERIC
            // FLAG_REPORT_VIEW_IDS not needed — we only care about the package.
            flags         = 0
            notificationTimeout = 50L // ms; respond quickly to app switches
        }
        Log.d(TAG, "[A11y] Service ready. Current blocked packages: $blockedPackages")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = event.packageName?.toString()
        Log.d(TAG, "[A11y] onAccessibilityEvent: TYPE_WINDOW_STATE_CHANGED" +
              " pkg=$pkg className=${event.className}")

        if (pkg == null) return

        // Ignore our own package — we must never redirect back to ourselves
        // while we are already in the foreground or we get an infinite loop.
        if (pkg == applicationContext.packageName) return

        val blocked = blockedPackages
        if (blocked.isEmpty()) {
            // Session not active — nothing to block.
            return
        }

        if (blocked.contains(pkg)) {
            Log.w(TAG, "[A11y] BLOCKED app detected in foreground: $pkg" +
                  " — firing redirect intent to bring FocusPod to front")
            bringFocusPodToFront()
            // Also tell JS so it can show an overlay/toast if desired.
            FocusPodBlockingModule.emitBlockEvent(pkg)
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "[A11y] Service INTERRUPTED")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.d(TAG, "[A11y] Service DESTROYED — instance ref cleared")
    }

    // ─── Redirect ─────────────────────────────────────────────────────────────

    private fun bringFocusPodToFront() {
        val pm = packageManager
        val ownPkg = applicationContext.packageName
        val intent = pm.getLaunchIntentForPackage(ownPkg)
        if (intent == null) {
            Log.e(TAG, "[A11y] getLaunchIntentForPackage($ownPkg) returned null — cannot redirect")
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        Log.d(TAG, "[A11y] Starting intent for $ownPkg: flags=NEW_TASK|REORDER_TO_FRONT")
        try {
            startActivity(intent)
            Log.d(TAG, "[A11y] startActivity succeeded")
        } catch (e: Exception) {
            Log.e(TAG, "[A11y] startActivity FAILED: ${e.message}")
        }
    }

    // ─── Companion ────────────────────────────────────────────────────────────

    companion object {
        private const val TAG = "FocusPod"

        /** Live reference to the running service instance, or null if not enabled. */
        @Volatile var instance: FocusPodAccessibilityService? = null
            private set

        /**
         * Package names that should be blocked during an active session.
         * Written by FocusPodBlockingModule.startBlocking(); read by onAccessibilityEvent().
         * Volatile ensures visibility across threads without synchronisation overhead.
         */
        @Volatile var blockedPackages: Set<String> = emptySet()

        /** True when the user has enabled FocusPod's accessibility service in Settings. */
        fun isRunning(): Boolean = instance != null
    }
}
