/**
 * IpodWheel — classic 5-button click wheel.
 *
 * Zones (by touch angle from center):
 *   Top    315°–45°   → onMenu
 *   Right   45°–135°  → onNext
 *   Bottom 135°–225°  → onForward
 *   Left   225°–315°  → onPrevious
 *   Center (inner radius) → onSelect
 *
 * Rotary scroll fires onRotate(delta) where delta > 0 = clockwise.
 */

import React, { useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

interface IpodWheelProps {
  onSelect?: () => void;
  onMenu?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onForward?: () => void; // bottom button — seek +30s
  onRotate?: (delta: number) => void;
  disabled?: boolean;
}

const WHEEL_D = Layout.wheelDiameter;
const WHEEL_R = WHEEL_D / 2;
const CENTER_D = Layout.wheelCenterDiameter;
const CENTER_R = CENTER_D / 2;

function angleDeg(dx: number, dy: number): number {
  // atan2 gives angle from positive-x axis. We add 90° so 0° = top.
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  if (deg >= 360) deg -= 360;
  return deg;
}

function inZone(deg: number, start: number, end: number): boolean {
  if (start < end) return deg >= start && deg < end;
  // wraps through 0° (e.g. 315°–45°)
  return deg >= start || deg < end;
}

export default function IpodWheel({
  onSelect,
  onMenu,
  onNext,
  onPrevious,
  onForward,
  onRotate,
  disabled = false,
}: IpodWheelProps) {
  const wheelRef = useRef<View>(null);
  // Absolute screen position of the wheel's top-left corner (updated on layout).
  const wheelOriginRef = useRef({ x: 0, y: 0 });
  const lastAngleRef = useRef<number | null>(null);

  // Re-measure whenever the wheel lays out (handles initial render + orientation change).
  const handleLayout = useCallback(() => {
    wheelRef.current?.measureInWindow((x, y) => {
      wheelOriginRef.current = { x, y };
      console.log('[Wheel] origin measured:', x.toFixed(1), y.toFixed(1));
    });
  }, []);

  const resolveCoords = (evt: GestureResponderEvent): { dx: number; dy: number; dist: number } => {
    // pageX/pageY are always reliable absolute screen coords.
    const { pageX, pageY } = evt.nativeEvent;
    const dx = pageX - wheelOriginRef.current.x - WHEEL_R;
    const dy = pageY - wheelOriginRef.current.y - WHEEL_R;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { dx, dy, dist };
  };

  const handleWheelPress = useCallback(
    (evt: GestureResponderEvent) => {
      if (disabled) return;
      const { dx, dy, dist } = resolveCoords(evt);
      const deg = angleDeg(dx, dy);
      console.log('[Wheel] press dx:', dx.toFixed(1), 'dy:', dy.toFixed(1), 'dist:', dist.toFixed(1), 'deg:', deg.toFixed(1));

      // Center button — generous hit radius to avoid misfire into ring zones.
      if (dist <= CENTER_R * 1.4) {
        console.log('[Wheel] → CENTER (select)');
        onSelect?.();
        return;
      }

      // Dead zone between center button and ring.
      if (dist < CENTER_R * 1.55) {
        console.log('[Wheel] → dead zone, ignoring');
        return;
      }

      // Ring zone — determine sector by angle.
      if (inZone(deg, 315, 45)) {
        console.log('[Wheel] → TOP (menu)');
        onMenu?.();
      } else if (inZone(deg, 45, 135)) {
        console.log('[Wheel] → RIGHT (next)');
        onNext?.();
      } else if (inZone(deg, 135, 225)) {
        console.log('[Wheel] → BOTTOM (forward)');
        onForward?.();
      } else {
        console.log('[Wheel] → LEFT (previous)');
        onPrevious?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, onSelect, onMenu, onNext, onPrevious, onForward],
  );

  // Rotary tracking via touch move on the ring.
  const handleWheelMove = useCallback(
    (evt: GestureResponderEvent) => {
      if (disabled || !onRotate) return;
      const { dx, dy, dist } = resolveCoords(evt);
      if (dist < CENTER_R * 1.2 || dist > WHEEL_R) return;

      const angle = angleDeg(dx, dy);
      if (lastAngleRef.current !== null) {
        let delta = angle - lastAngleRef.current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) > 1) {
          onRotate(delta);
        }
      }
      lastAngleRef.current = angle;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, onRotate],
  );

  const handleWheelEnd = useCallback(() => {
    lastAngleRef.current = null;
  }, []);

  return (
    <View style={styles.container}>
      {/* Outer wheel ring — touch target */}
      <View
        ref={wheelRef}
        style={styles.wheel}
        onLayout={handleLayout}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleWheelPress}
        onResponderMove={handleWheelMove}
        onResponderRelease={handleWheelEnd}
        onResponderTerminate={handleWheelEnd}
      >
        {/* Ring labels */}
        <Text style={[styles.label, styles.labelTop]}>MENU</Text>
        <Text style={[styles.label, styles.labelRight]}>▶▶</Text>
        <Text style={[styles.label, styles.labelBottom]}>+30s</Text>
        <Text style={[styles.label, styles.labelLeft]}>◀◀</Text>

        {/* Center button */}
        <TouchableOpacity
          style={styles.center}
          onPress={disabled ? undefined : onSelect}
          activeOpacity={0.7}
          disabled={disabled}
        >
          <View style={styles.centerInner} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheel: {
    width: WHEEL_D,
    height: WHEEL_D,
    borderRadius: WHEEL_R,
    backgroundColor: Colors.wheelBackground,
    borderWidth: 2,
    borderColor: Colors.wheelRing,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  center: {
    width: CENTER_D,
    height: CENTER_D,
    borderRadius: CENTER_R,
    backgroundColor: Colors.wheelCenter,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.wheelRing,
    zIndex: 10,
  },
  centerInner: {
    width: CENTER_D * 0.4,
    height: CENTER_D * 0.4,
    borderRadius: CENTER_D * 0.2,
    backgroundColor: Colors.wheelRing,
  },
  label: {
    position: 'absolute',
    color: Colors.wheelText,
    fontSize: Layout.fontSizeXs,
    fontWeight: '600',
    letterSpacing: 1,
  },
  labelTop: {
    top: 14,
  },
  labelRight: {
    right: 14,
  },
  labelBottom: {
    bottom: 14,
  },
  labelLeft: {
    left: 14,
  },
});
