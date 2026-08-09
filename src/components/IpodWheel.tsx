/**
 * IpodWheel — physical click-wheel replica.
 *
 * Gesture model
 * ─────────────
 * • Touch lands inside CENTER_R × 1.1  → center tap (fires onSelect on release).
 * • Touch lands on the ring:
 *     – Rotate ≥ DRAG_THRESHOLD degrees total → drag mode; fires onRotate(delta)
 *       each move event; haptic every HAPTIC_STEP degrees.
 *     – Release before DRAG_THRESHOLD     → tap; zone determined by the angle
 *       at grant time (MENU top, ▶▶ right, ▶/|| bottom, ◀◀ left).
 *
 * Props
 * ─────
 *   onSelect    – center button tapped
 *   onMenu      – top button (MENU)
 *   onNext      – right button (▶▶  skip next)
 *   onPrevious  – left button (◀◀  skip prev)
 *   onPlayPause – bottom button (▶/||)
 *   onRotate    – drag delta in degrees (+CW / −CCW)
 *
 * Android elevation note
 * ──────────────────────
 * The center button must NOT have elevation > 0.  On Android, an elevated child
 * View receives touches at the native layer before the JS responder system sees
 * them — even when pointerEvents="none" is set in JS — silently swallowing all
 * center-area touches.  Keep all child Views at elevation 0 so every touch
 * bubbles up to the parent wheel responder.
 */

import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  GestureResponderEvent,
  Platform,
  Vibration,
} from 'react-native';
import { IpodColors } from '../constants/colors';
import { IpodLayout } from '../constants/layout';
import { playTick } from '../services/tickSoundService';

export interface IpodWheelProps {
  onSelect?: () => void;
  onMenu?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onRotate?: (delta: number) => void;
  disabled?: boolean;
}

const WHEEL_R = IpodLayout.wheelRadius;
const WHEEL_D = IpodLayout.wheelDiameter;
const CENTER_R = IpodLayout.centerButtonRadius;
const CENTER_D = IpodLayout.centerButtonDiameter;
const DRAG_THRESHOLD = 8;   // degrees before a move is classified as a drag
const HAPTIC_STEP    = 18;  // degrees between haptic pulses during drag

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Returns degrees 0–360, with 0° at the top (12-o'clock). */
function angleDeg(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  if (deg >= 360) deg -= 360;
  return deg;
}

/** True when deg is in the arc [start, end), wrapping through 0 if needed. */
function inZone(deg: number, start: number, end: number): boolean {
  if (start < end) return deg >= start && deg < end;
  return deg >= start || deg < end;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IpodWheel({
  onSelect,
  onMenu,
  onNext,
  onPrevious,
  onPlayPause,
  onRotate,
  disabled = false,
}: IpodWheelProps) {
  const wheelRef = useRef<View>(null);
  const wheelOriginRef = useRef({ x: 0, y: 0 });

  // Gesture state — all refs so updates don't trigger re-renders
  const isCenterRef            = useRef(false);
  const gestureStartAngleRef   = useRef<number | null>(null);
  const lastAngleRef           = useRef<number | null>(null);
  const totalRotationRef       = useRef(0);
  const isDraggingRef          = useRef(false);
  const hapticAccumRef         = useRef(0);

  // ── Layout: capture absolute position once the view is measured ─────────
  const handleLayout = useCallback(() => {
    wheelRef.current?.measureInWindow((x, y, width, height) => {
      wheelOriginRef.current = { x, y };
      console.log(
        `[Wheel] measureInWindow → x=${x.toFixed(1)} y=${y.toFixed(1)}` +
        ` w=${width.toFixed(1)} h=${height.toFixed(1)}` +
        ` (expecting WHEEL_D=${WHEEL_D})`,
      );
    });
  }, []);

  // ── Coordinate helper (reads refs — safe to call from any stale closure) ─
  const resolveCoords = useCallback((evt: GestureResponderEvent) => {
    const { pageX, pageY } = evt.nativeEvent;
    const dx   = pageX - wheelOriginRef.current.x - WHEEL_R;
    const dy   = pageY - wheelOriginRef.current.y - WHEEL_R;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { dx, dy, dist, pageX, pageY };
  }, []); // wheelOriginRef is a ref — reads current value at call time

  // ── Responder: should this view claim the touch? ─────────────────────────
  const shouldSetResponder = useCallback((): boolean => {
    console.log(`[Wheel] onStartShouldSetResponder — disabled=${disabled} → ${!disabled}`);
    return !disabled;
  }, [disabled]);

  // ── Grant: touch begins on this view ─────────────────────────────────────
  const handleGrant = useCallback(
    (evt: GestureResponderEvent) => {
      if (disabled) return;
      const { dx, dy, dist, pageX, pageY } = resolveCoords(evt);

      const isCenter = dist <= CENTER_R * 1.1;
      console.log(
        `[Wheel] GRANT pageX=${pageX.toFixed(1)} pageY=${pageY.toFixed(1)}` +
        ` → dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} dist=${dist.toFixed(1)}` +
        ` (CENTER_R=${CENTER_R.toFixed(1)} WHEEL_R=${WHEEL_R.toFixed(1)})` +
        ` zone=${isCenter ? 'CENTER' : 'RING'}`,
      );

      if (isCenter) {
        isCenterRef.current = true;
        return;
      }

      isCenterRef.current              = false;
      const angle                      = angleDeg(dx, dy);
      gestureStartAngleRef.current     = angle;
      lastAngleRef.current             = angle;
      totalRotationRef.current         = 0;
      isDraggingRef.current            = false;
      hapticAccumRef.current           = 0;
    },
    [disabled, resolveCoords],
  );

  // ── Move: finger dragging ─────────────────────────────────────────────────
  const handleMove = useCallback(
    (evt: GestureResponderEvent) => {
      if (disabled || isCenterRef.current || !onRotate) return;
      if (lastAngleRef.current === null) return;

      const { dx, dy, dist } = resolveCoords(evt);
      if (dist > WHEEL_R * 1.15 || dist < CENTER_R * 0.7) return;

      const angle = angleDeg(dx, dy);
      let delta   = angle - lastAngleRef.current;
      if (delta >  180) delta -= 360;
      if (delta < -180) delta += 360;
      lastAngleRef.current      = angle;
      totalRotationRef.current += delta;

      if (!isDraggingRef.current && Math.abs(totalRotationRef.current) >= DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        console.log('[Wheel] drag threshold crossed → drag mode');
      }

      if (isDraggingRef.current && Math.abs(delta) > 0.3) {
        onRotate(delta);
        hapticAccumRef.current += Math.abs(delta);
        if (hapticAccumRef.current >= HAPTIC_STEP) {
          hapticAccumRef.current -= HAPTIC_STEP;
          // Haptic pulse + tick sound fire together on every 18° step.
          if (Platform.OS === 'android') Vibration.vibrate(1);
          playTick();
        }
      }
    },
    [disabled, onRotate, resolveCoords],
  );

  // ── Release / terminate: fire tap callback ────────────────────────────────
  const handleRelease = useCallback(() => {
    if (disabled) return;

    if (isCenterRef.current) {
      console.log('[Wheel] RELEASE → CENTER (onSelect)');
      isCenterRef.current = false;
      onSelect?.();
      return;
    }

    if (!isDraggingRef.current && gestureStartAngleRef.current !== null) {
      const deg = gestureStartAngleRef.current;
      if (inZone(deg, 315, 45)) {
        console.log(`[Wheel] RELEASE → TOP/MENU (deg=${deg.toFixed(1)})`);
        onMenu?.();
      } else if (inZone(deg, 45, 135)) {
        console.log(`[Wheel] RELEASE → RIGHT/NEXT (deg=${deg.toFixed(1)})`);
        onNext?.();
      } else if (inZone(deg, 135, 225)) {
        console.log(`[Wheel] RELEASE → BOTTOM/PLAYPAUSE (deg=${deg.toFixed(1)})`);
        onPlayPause?.();
      } else {
        console.log(`[Wheel] RELEASE → LEFT/PREV (deg=${deg.toFixed(1)})`);
        onPrevious?.();
      }
    } else if (isDraggingRef.current) {
      console.log('[Wheel] RELEASE after drag — no tap fired');
    }

    // Reset all gesture state
    isCenterRef.current          = false;
    gestureStartAngleRef.current = null;
    lastAngleRef.current         = null;
    totalRotationRef.current     = 0;
    isDraggingRef.current        = false;
    hapticAccumRef.current       = 0;
  }, [disabled, onSelect, onMenu, onNext, onPrevious, onPlayPause]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View
        ref={wheelRef}
        style={styles.wheel}
        onLayout={handleLayout}
        onStartShouldSetResponder={shouldSetResponder}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleRelease}
      >
        {/* Ring labels — Text without onPress never claims the responder */}
        <Text style={[styles.label, styles.labelTop]}>MENU</Text>
        <Text style={[styles.label, styles.labelRight]}>▶▶</Text>
        <Text style={[styles.label, styles.labelBottom]}>+30s</Text>
        <Text style={[styles.label, styles.labelLeft]}>−30s</Text>

        {/* Inner shadow ring — gives the wheel a recessed, physical look */}
        <View style={styles.innerShadowRing} pointerEvents="none" />

        {/*
          Center button — visual only.
          IMPORTANT: NO elevation here.  An elevated Android View receives touches
          at the native layer before the JS responder system, silently swallowing
          them even when pointerEvents="none" is set in JS.
        */}
        <View style={styles.center} pointerEvents="none">
          <View style={styles.centerRing} />
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheel: {
    width: WHEEL_D,
    height: WHEEL_D,
    borderRadius: WHEEL_R,
    backgroundColor: IpodColors.wheelSurface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    // Pronounced ring border — lighter top edge, darker bottom gives depth
    borderWidth: 2.5,
    borderTopColor: IpodColors.wheelHighlight,
    borderBottomColor: IpodColors.wheelCenterRing,
    borderLeftColor: '#C4C4BE',
    borderRightColor: '#C4C4BE',
    // Shadow on the wheel itself is fine — it's the parent, not a blocking child
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.30,
    shadowRadius: 14,
    elevation: 10,
  },
  center: {
    width: CENTER_D,
    height: CENTER_D,
    borderRadius: CENTER_R,
    backgroundColor: IpodColors.wheelCenterBtn,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: IpodColors.wheelCenterRing,
    zIndex: 10,
    // ⚠️  NO elevation here — see component-level comment above.
  },
  centerRing: {
    width: CENTER_D * 0.35,
    height: CENTER_D * 0.35,
    borderRadius: CENTER_D * 0.175,
    borderWidth: 1.5,
    borderColor: IpodColors.wheelCenterRing,
    backgroundColor: 'transparent',
  },
  innerShadowRing: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: WHEEL_R - 4,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.12)',
    // No background — purely a border to simulate inner shadow
  },
  label: {
    position: 'absolute',
    color: IpodColors.wheelLabel,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  labelTop:    { top: 14 },
  labelRight:  { right: 14 },
  labelBottom: { bottom: 14 },
  labelLeft:   { left: 14 },
});
