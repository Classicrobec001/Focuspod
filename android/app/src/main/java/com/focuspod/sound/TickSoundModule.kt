package com.focuspod.sound

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * TickSoundModule
 *
 * Generates and plays a short (~18 ms) mechanical click transient that
 * mimics the feel of a real iPod click-wheel.
 *
 * Implementation notes
 * ────────────────────
 * • A PCM buffer is synthesised once at module construction time:
 *     sample[i] = A · sin(2π·f·t) · exp(−decay·t)
 *   f=900 Hz, decay=280 s⁻¹, duration=18 ms at 22050 Hz sample rate.
 *   The result is a sharp transient that starts bright and dies within ~15 ms.
 *
 * • AudioTrack in MODE_STATIC loads the buffer once; subsequent play() calls
 *   only rewind the playhead — no buffer re-upload, no allocation.
 *   This gives consistent sub-millisecond trigger latency from the JS thread.
 *
 * • AudioAttributes.USAGE_ASSISTANCE_SONIFICATION routes through the
 *   "notification/system-sound" stream, which is NOT ducked by media focus
 *   changes, so the tick remains audible even while audio is playing.
 *
 * • Volume is capped at 25 % (−12 dBFS) — the tick must be subtle, not
 *   intrusive.  The caller can adjust via setVolume(), but the constructor
 *   default is intentionally quiet.
 */
class TickSoundModule(ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName() = "TickSound"

    // ─── PCM constants ────────────────────────────────────────────────────────

    private val SAMPLE_RATE = 22_050          // Hz
    private val DURATION_MS = 18              // ms  — keep under 20 ms
    private val NUM_SAMPLES = SAMPLE_RATE * DURATION_MS / 1_000   // 396

    private val FREQ_HZ     = 900.0           // fundamental — punchy mid-high click
    private val DECAY       = 280.0           // amplitude envelope time-constant (s⁻¹)
    private val GAIN        = 0.25f           // 25 % → −12 dBFS; subtle but audible

    // ─── Pre-computed PCM buffer ──────────────────────────────────────────────

    private val pcmBuffer: ShortArray = ShortArray(NUM_SAMPLES) { i ->
        val t   = i.toDouble() / SAMPLE_RATE
        val env = exp(-DECAY * t)                   // exponential decay
        val val_ = GAIN * env * sin(2.0 * PI * FREQ_HZ * t)
        (val_ * Short.MAX_VALUE).toInt()
            .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            .toShort()
    }

    // ─── AudioTrack ───────────────────────────────────────────────────────────

    private val audioTrack: AudioTrack? = buildAudioTrack()

    private fun buildAudioTrack(): AudioTrack? {
        return try {
            val bufBytes = NUM_SAMPLES * 2 // 16-bit PCM = 2 bytes per sample
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val format = AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            val track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufBytes)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setSessionId(AudioManager.AUDIO_SESSION_ID_GENERATE)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                AudioTrack(
                    AudioManager.STREAM_RING,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufBytes,
                    AudioTrack.MODE_STATIC,
                )
            }
            track.write(pcmBuffer, 0, NUM_SAMPLES)
            Log.d(TAG, "[Tick] AudioTrack created — $NUM_SAMPLES samples @ $SAMPLE_RATE Hz")
            track
        } catch (e: Exception) {
            Log.e(TAG, "[Tick] AudioTrack creation failed: ${e.message}")
            null
        }
    }

    // ─── React Method ─────────────────────────────────────────────────────────

    /**
     * play() — fire-and-forget; called from JS on every wheel-step tick.
     *
     * Does NOT take a Promise — the round-trip overhead of resolving a promise
     * from an audio callback would exceed the entire tick duration.  Errors are
     * silently swallowed so a failing tick never crashes the UI.
     */
    @ReactMethod(isBlockingSynchronousMethod = false)
    fun play() {
        val track = audioTrack ?: return
        try {
            // Rewind to the start of the static buffer, then play.
            // MODE_STATIC tracks stay in STOPPED state after the buffer finishes;
            // setPlaybackHeadPosition(0) + play() re-triggers from the beginning.
            if (track.playState != AudioTrack.PLAYSTATE_STOPPED) {
                track.stop()
            }
            track.setPlaybackHeadPosition(0)
            track.play()
        } catch (e: Exception) {
            Log.w(TAG, "[Tick] play() error: ${e.message}")
        }
    }

    override fun onCatalystInstanceDestroy() {
        try { audioTrack?.release() } catch (_: Exception) {}
        super.onCatalystInstanceDestroy()
    }

    companion object {
        private const val TAG = "FocusPod"
    }
}
